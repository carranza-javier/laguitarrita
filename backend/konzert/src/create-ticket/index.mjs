import { randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({});
const TABLE = process.env.TICKETS_TABLE;
const COUNTER_ID = process.env.COUNTER_ID ?? '#counter';
const CAPACITY = Number(process.env.CAPACITY ?? 0);
const PRICE_CHF = Number(process.env.PRICE_CHF ?? 0);

export const MAX_NAME_LENGTH = 40;
export const MAX_TICKETS = 4;

// All ticket data is deleted 30 days after the concert (DynamoDB TTL).
const TTL = Math.floor(Date.parse(process.env.CONCERT_ISO ?? '') / 1000) + 30 * 24 * 60 * 60;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/**
 * The reference the buyer pastes into the TWINT message, e.g. "Konzert Anna 2".
 * The server is the single source of truth for it, so the page and the admin scripts always agree.
 */
export const referenceFor = (name, tickets) => `Konzert ${name} ${tickets}`;

/**
 * Keeps the name on a single, printable line so it can never break the TWINT reference text:
 * control characters and line breaks become spaces, runs of whitespace collapse, and the result
 * is trimmed and capped. Returns '' when nothing usable is left.
 */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ') // control characters (incl. newlines, tabs) -> space
    .replace(/\p{Cf}/gu, '') // zero-width / format characters -> removed
    .replace(/\s+/gu, ' ') // collapse any run of whitespace (incl. line/para separators)
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The atomic counter-update + ticket-insert used for every purchase attempt. */
function buildTransaction({ id, name, tickets, reference }) {
  return new TransactWriteItemsCommand({
    TransactItems: [
      {
        // Atomically take `tickets` seats, but only while that keeps the total within capacity.
        Update: {
          TableName: TABLE,
          Key: { id: { S: COUNTER_ID } },
          // DynamoDB forbids arithmetic in a ConditionExpression, so the "+ n" is folded into the
          // right-hand side: sold <= capacity - n  <=>  sold + n <= capacity.
          UpdateExpression: 'SET sold = if_not_exists(sold, :zero) + :n, #ttl = :ttl',
          // Neither arithmetic nor if_not_exists is allowed in a ConditionExpression, so the first
          // purchase (no counter yet) is its own branch; tickets (<=4) always fits an empty counter.
          ConditionExpression: 'attribute_not_exists(sold) OR sold <= :capMinusN',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':zero': { N: '0' },
            ':n': { N: String(tickets) },
            ':capMinusN': { N: String(CAPACITY - tickets) },
            ':ttl': { N: String(TTL) },
          },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            id: { S: id },
            name: { S: name },
            tickets: { N: String(tickets) },
            status: { S: 'active' },
            paid: { BOOL: false },
            reference: { S: reference },
            createdAt: { S: new Date().toISOString() },
            ttl: { N: String(TTL) },
          },
          ConditionExpression: 'attribute_not_exists(id)',
        },
      },
    ],
  });
}

async function seatsLeft() {
  const res = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: COUNTER_ID } }, ConsistentRead: true }),
  );
  const sold = Number(res.Item?.sold?.N ?? 0);
  return Math.max(0, CAPACITY - sold);
}

export const handler = async (event) => {
  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
    body = JSON.parse(raw ?? '');
  } catch {
    return json(400, { message: 'Invalid JSON', code: 'invalid' });
  }

  // Honeypot: a hidden field real visitors never fill. If it has any value, silently reject.
  if (body?.website) return json(400, { message: 'Rejected', code: 'invalid' });

  const name = cleanName(body?.name);
  if (!name) return json(400, { message: 'A name is required', code: 'name' });

  const tickets = Number(body?.tickets);
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS) {
    return json(400, { message: `tickets must be an integer between 1 and ${MAX_TICKETS}`, code: 'tickets' });
  }

  const reference = referenceFor(name, tickets);

  // Retry only transient transaction conflicts; a failed capacity condition is final.
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; ; attempt++) {
    const id = randomUUID();
    try {
      await dynamo.send(buildTransaction({ id, name, tickets, reference }));
      return json(201, { id, name, tickets, amount: tickets * PRICE_CHF, currency: 'CHF', reference });
    } catch (err) {
      const reasons = err.CancellationReasons ?? [];
      // Index 0 is the counter update: a failed condition there means the capacity is reached.
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        return json(409, { message: 'Not enough tickets left', code: 'capacity', remaining: await seatsLeft() });
      }
      const retryable =
        err.name === 'TransactionCanceledException' || // conflict with a concurrent purchase
        err.name === 'ThrottlingException' ||
        err.name === 'ProvisionedThroughputExceededException';
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(Math.min(200, 10 * 2 ** attempt) * (0.5 + Math.random()));
    }
  }
};
