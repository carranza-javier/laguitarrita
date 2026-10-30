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

const contentDisposition = (fileName) => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
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

  const files = objects.filter((o) => o.Size > 0 && !o.Key.slice(prefix.length).includes('/'));
  const notes = await loadNotes(sub);

  const videos = await Promise.all(
    files.map(async (o) => {
      const name = o.Key.slice(prefix.length);
      const [date, playUrl, downloadUrl] = await Promise.all([
        recordedAt(o),
        getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }), {
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
      return { name, date, size: o.Size, playUrl, downloadUrl, note: notes.get(name) ?? '' };
    }),
  );

  videos.sort((a, b) => b.date.localeCompare(a.date));
  return json(200, { videos, expiresIn: URL_TTL_SECONDS });
};

/** Recording date stored by the upload script (from the video's own metadata), else the upload date. */
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
