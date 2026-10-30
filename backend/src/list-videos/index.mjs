import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const BUCKET = process.env.BUCKET_NAME;
const NOTES_TABLE = process.env.NOTES_TABLE;

// Presigned URLs are only a per-visit key: the objects themselves never expire.
export const URL_TTL_SECONDS = 3600;

const SUB_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

// Only these kinds of files are listed; anything else in the folder is ignored.
const TYPES = {
  video: ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'],
  audio: ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'],
  pdf: ['.pdf'],
};

const fileType = (name) => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return Object.keys(TYPES).find((type) => TYPES[type].includes(ext));
};

const contentDisposition = (fileName, disposition = 'attachment') => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const handler = async (event) => {
  // The student id comes ONLY from the JWT validated by the API Gateway authorizer,
  // never from the path, query string, headers or body.
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
  const sub = claims.sub;
  if (typeof sub !== 'string' || !SUB_PATTERN.test(sub) || claims.token_use !== 'access') {
    return json(401, { message: 'Unauthorized' });
  }

  const prefix = `students/${sub}/videos/`;
  const objects = [];
  let continuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    objects.push(...(page.Contents ?? []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const files = objects.filter((o) => {
    const name = o.Key.slice(prefix.length);
    return o.Size > 0 && !name.includes('/') && fileType(name);
  });
  const notes = await loadNotes(sub);

  const videos = await Promise.all(
    files.map(async (o) => {
      const name = o.Key.slice(prefix.length);
      const type = fileType(name);
      // PDFs open in the browser's own viewer, so their "play" URL is served inline as a PDF.
      const view =
        type === 'pdf'
          ? { ResponseContentType: 'application/pdf', ResponseContentDisposition: contentDisposition(name, 'inline') }
          : {};
      const [date, playUrl, downloadUrl] = await Promise.all([
        recordedAt(o),
        getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: o.Key, ...view }), {
          expiresIn: URL_TTL_SECONDS,
        }),
        getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: BUCKET,
            Key: o.Key,
            ResponseContentDisposition: contentDisposition(name),
          }),
          { expiresIn: URL_TTL_SECONDS },
        ),
      ]);
      return { name, type, date, size: o.Size, playUrl, downloadUrl, note: notes.get(name) ?? '' };
    }),
  );

  videos.sort((a, b) => b.date.localeCompare(a.date));
  return json(200, { videos, expiresIn: URL_TTL_SECONDS });
};

/** Recording date stored by the upload script (from the file's own metadata), else the upload date. */
async function recordedAt(object) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: object.Key }));
  const recorded = Date.parse(head.Metadata?.recorded ?? '');
  return new Date(Number.isNaN(recorded) ? object.LastModified : recorded).toISOString();
}

/** The student's notes, keyed by video file name. */
async function loadNotes(sub) {
  const notes = new Map();
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: NOTES_TABLE,
        KeyConditionExpression: '#sub = :sub',
        ExpressionAttributeNames: { '#sub': 'sub' },
        ExpressionAttributeValues: { ':sub': { S: sub } },
        ExclusiveStartKey,
      }),
    );
    for (const item of page.Items ?? []) notes.set(item.video.S, item.text?.S ?? '');
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return notes;
}
