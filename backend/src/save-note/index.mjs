import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const BUCKET = process.env.BUCKET_NAME;
const NOTES_TABLE = process.env.NOTES_TABLE;

export const MAX_NOTE_LENGTH = 5000;

const SUB_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/**
 * PUT /notes {video, text}: saves the caller's note for one of their own videos (empty text deletes it).
 * As in list-videos, the student id comes ONLY from the JWT validated by the API Gateway authorizer.
 */
export const handler = async (event) => {
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
  const sub = claims.sub;
  if (typeof sub !== 'string' || !SUB_PATTERN.test(sub) || claims.token_use !== 'access') {
    return json(401, { message: 'Unauthorized' });
  }

  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
    body = JSON.parse(raw ?? '');
  } catch {
    return json(400, { message: 'Invalid JSON' });
  }
  const { video, text } = body ?? {};
  if (typeof video !== 'string' || !video || video.length > 1024 || video.includes('/')) {
    return json(400, { message: 'Invalid video' });
  }
  if (typeof text !== 'string' || text.length > MAX_NOTE_LENGTH) {
    return json(400, { message: `The note must be a text of at most ${MAX_NOTE_LENGTH} characters` });
  }

  // Notes can only be attached to videos that exist in the caller's own folder.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `students/${sub}/videos/${video}` }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return json(404, { message: 'Not found' });
    throw err;
  }

  const key = { sub: { S: sub }, video: { S: video } };
  if (text.trim()) {
    await dynamo.send(
      new PutItemCommand({
        TableName: NOTES_TABLE,
        Item: { ...key, text: { S: text }, updatedAt: { S: new Date().toISOString() } },
      }),
    );
  } else {
    await dynamo.send(new DeleteItemCommand({ TableName: NOTES_TABLE, Key: key }));
  }
  return json(200, { video, text: text.trim() ? text : '' });
};
