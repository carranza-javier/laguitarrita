import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({});
const TABLE = process.env.TICKETS_TABLE;
const COUNTER_ID = process.env.COUNTER_ID ?? '#counter';
const CAPACITY = Number(process.env.CAPACITY ?? 0);
const PRICE_CHF = Number(process.env.PRICE_CHF ?? 0);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** GET /availability: how many tickets are still free (public, no body). */
export const handler = async () => {
  const res = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: COUNTER_ID } }, ConsistentRead: true }),
  );
  const sold = Number(res.Item?.sold?.N ?? 0);
  const remaining = Math.max(0, CAPACITY - sold);
  return json(200, { remaining, capacity: CAPACITY, price: PRICE_CHF, currency: 'CHF', soldOut: remaining === 0 });
};
