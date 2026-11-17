import { randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

// Private admin API for the concert tickets. Every route here is behind the AdminJwt authorizer,
// so by the time this code runs the caller already holds a valid access token from the admin pool.
// The capacity is enforced with the exact same atomic conditional write as the public purchase flow.
const dynamo = new DynamoDBClient({});
const TABLE = process.env.TICKETS_TABLE;
const COUNTER_ID = process.env.COUNTER_ID ?? '#counter';
const CAPACITY = Number(process.env.CAPACITY ?? 0);
const PRICE_CHF = Number(process.env.PRICE_CHF ?? 0);

const MAX_NAME_LENGTH = 40;

// All ticket data is deleted 30 days after the concert (DynamoDB TTL), same as the public flow.
const TTL = Math.floor(Date.parse(process.env.CONCERT_ISO ?? '') / 1000) + 30 * 24 * 60 * 60;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** The reference the buyer pastes into TWINT, e.g. "Konzert Anna 2". Same format as the public flow. */
const referenceFor = (name, tickets) => `Konzert ${name} ${tickets}`;

/** Keeps the name on one printable line so it can never break the TWINT reference text. */
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal DynamoDB AttributeValue -> JS for the scalar types this table uses. */
function unmarshall(item = {}) {
  const value = (av) => {
    if (av == null) return undefined;
    if (av.S !== undefined) return av.S;
    if (av.N !== undefined) return Number(av.N);
    if (av.BOOL !== undefined) return av.BOOL;
    if (av.NULL) return null;
    return undefined;
  };
  return Object.fromEntries(Object.entries(item).map(([k, av]) => [k, value(av)]));
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
  return JSON.parse(raw ?? '{}');
}

async function seatsLeft() {
  const res = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: COUNTER_ID } }, ConsistentRead: true }),
  );
  return Math.max(0, CAPACITY - Number(res.Item?.sold?.N ?? 0));
}

// ---------------------------------------------------------------- GET /admin/tickets
async function listTickets() {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    rows.push(...(page.Items ?? []).map(unmarshall));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const counter = rows.find((r) => r.id === COUNTER_ID);
  const sold = Number(counter?.sold ?? 0);
  const tickets = rows
    .filter((r) => r.id !== COUNTER_ID)
    .map((r) => ({
      id: r.id,
      name: r.name ?? '',
      tickets: Number(r.tickets ?? 0),
      status: r.status ?? 'active',
      paid: !!r.paid,
      reference: r.reference ?? referenceFor(r.name ?? '', Number(r.tickets ?? 0)),
      createdAt: r.createdAt ?? null,
    }));

  return json(200, {
    tickets,
    totals: {
      capacity: CAPACITY,
      price: PRICE_CHF,
      currency: 'CHF',
      sold, // seats taken by active tickets
      remaining: Math.max(0, CAPACITY - sold),
    },
  });
}

// ---------------------------------------------------------------- POST /admin/tickets
async function createTicket(event) {
  let body;
  try {
    body = parseBody(event);
  } catch {
    return json(400, { message: 'Invalid JSON', code: 'invalid' });
  }

  const name = cleanName(body?.name);
  if (!name) return json(400, { message: 'A name is required', code: 'name' });

  const tickets = Number(body?.tickets);
  // The admin may enter larger groups than the public max of 4, but never more than the venue holds.
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > CAPACITY) {
    return json(400, { message: `tickets must be an integer between 1 and ${CAPACITY}`, code: 'tickets' });
  }

  const paid = !!body?.paid;
  const reference = referenceFor(name, tickets);

  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; ; attempt++) {
    const id = randomUUID();
    try {
      await dynamo.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { id: { S: COUNTER_ID } },
                UpdateExpression: 'SET sold = if_not_exists(sold, :zero) + :n, #ttl = :ttl',
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
                  paid: { BOOL: paid },
                  reference: { S: reference },
                  createdAt: { S: new Date().toISOString() },
                  source: { S: 'admin' },
                  ttl: { N: String(TTL) },
                },
                ConditionExpression: 'attribute_not_exists(id)',
              },
            },
          ],
        }),
      );
      return json(201, {
        id,
        name,
        tickets,
        status: 'active',
        paid,
        amount: tickets * PRICE_CHF,
        currency: 'CHF',
        reference,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      const reasons = err.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        return json(409, { message: 'Not enough tickets left', code: 'capacity', remaining: await seatsLeft() });
      }
      const retryable =
        err.name === 'TransactionCanceledException' ||
        err.name === 'ThrottlingException' ||
        err.name === 'ProvisionedThroughputExceededException';
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(Math.min(200, 10 * 2 ** attempt) * (0.5 + Math.random()));
    }
  }
}

// ---------------------------------------------------------------- PATCH /admin/tickets/{id}
async function patchTicket(id, event) {
  if (!id || id === COUNTER_ID) return json(404, { message: 'Not found', code: 'notFound' });

  let body;
  try {
    body = parseBody(event);
  } catch {
    return json(400, { message: 'Invalid JSON', code: 'invalid' });
  }

  // `paid` is the only field that may be changed here. Anything else is rejected outright.
  const keys = Object.keys(body ?? {});
  const unknown = keys.filter((k) => k !== 'paid');
  if (unknown.length) {
    return json(400, { message: `Not allowed: ${unknown.join(', ')}`, code: 'invalidField' });
  }
  if (typeof body?.paid !== 'boolean') {
    return json(400, { message: 'paid must be a boolean', code: 'invalidField' });
  }

  try {
    const res = await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { id: { S: id } },
        UpdateExpression: 'SET paid = :paid',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':paid': { BOOL: body.paid } },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const t = unmarshall(res.Attributes);
    return json(200, { id, paid: !!t.paid, status: t.status ?? 'active' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return json(404, { message: 'Not found', code: 'notFound' });
    }
    throw err;
  }
}

// ---------------------------------------------------------------- POST /admin/tickets/{id}/cancel
async function cancelTicket(id) {
  if (!id || id === COUNTER_ID) return json(404, { message: 'Not found', code: 'notFound' });

  const res = await dynamo.send(new GetItemCommand({ TableName: TABLE, Key: { id: { S: id } }, ConsistentRead: true }));
  if (!res.Item) return json(404, { message: 'Not found', code: 'notFound' });
  const ticket = unmarshall(res.Item);

  // Idempotent: cancelling an already-cancelled ticket is a no-op success and never frees seats twice.
  if (ticket.status !== 'active') {
    return json(200, { id, status: 'cancelled', alreadyCancelled: true });
  }

  const seats = Number(ticket.tickets ?? 0);
  try {
    await dynamo.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: { id: { S: id } },
              UpdateExpression: 'SET #s = :cancelled',
              ConditionExpression: '#s = :active',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':cancelled': { S: 'cancelled' }, ':active': { S: 'active' } },
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { id: { S: COUNTER_ID } },
              UpdateExpression: 'SET sold = sold - :n',
              ConditionExpression: 'sold >= :n',
              ExpressionAttributeValues: { ':n': { N: String(seats) } },
            },
          },
        ],
      }),
    );
    return json(200, { id, status: 'cancelled' });
  } catch (err) {
    // A concurrent cancel won the race: the ticket is cancelled and its seats already freed. Idempotent.
    const reasons = err.CancellationReasons ?? [];
    if (err.name === 'TransactionCanceledException' && reasons[0]?.Code === 'ConditionalCheckFailed') {
      return json(200, { id, status: 'cancelled', alreadyCancelled: true });
    }
    throw err;
  }
}

export const handler = async (event) => {
  const route = event.routeKey ?? `${event.requestContext?.http?.method} ${event.rawPath}`;
  const id = event.pathParameters?.id;
  try {
    switch (route) {
      case 'GET /admin/tickets':
        return await listTickets();
      case 'POST /admin/tickets':
        return await createTicket(event);
      case 'PATCH /admin/tickets/{id}':
        return await patchTicket(id, event);
      case 'POST /admin/tickets/{id}/cancel':
        return await cancelTicket(id);
      default:
        return json(404, { message: 'Not found', code: 'notFound' });
    }
  } catch (err) {
    console.error(err);
    return json(500, { message: 'Internal error', code: 'error' });
  }
};
