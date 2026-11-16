// Shared helpers for the concert-ticket admin scripts (list-tickets, mark-paid, cancel-ticket).
// Credentials come from the usual AWS chain (AWS_PROFILE, ~/.aws/credentials, ...).
// The generic AWS helpers are reused from lib.mjs; nothing here touches the student-area stack.
import { createInterface } from 'node:readline/promises';
import { ScanCommand, TransactWriteItemsCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { dynamo, stackOutputs } from './lib.mjs';

/** Minimal DynamoDB AttributeValue -> JS for the few scalar types this table uses. */
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

export const DEFAULT_KONZERT_STACK = process.env.KONZERT_STACK || 'laguitarrita-konzert';
export const COUNTER_ID = '#counter';

/** The reference the buyer pastes into TWINT, e.g. "Konzert Anna 2". Must match the Lambda. */
export const referenceFor = (name, tickets) => `Konzert ${name} ${tickets}`;

/** Reads every row once: the active/cancelled tickets and the seats-taken counter. */
export async function scanTickets({ stack = DEFAULT_KONZERT_STACK } = {}) {
  const { TicketsTableName } = await stackOutputs(stack);
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(new ScanCommand({ TableName: TicketsTableName, ExclusiveStartKey }));
    rows.push(...(page.Items ?? []).map((i) => unmarshall(i)));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const counter = rows.find((r) => r.id === COUNTER_ID);
  const tickets = rows.filter((r) => r.id !== COUNTER_ID);
  return { tickets, sold: Number(counter?.sold ?? 0) };
}

/** Capacity and price per ticket from the stack outputs (single source of truth). */
export async function konzertConfig(stack = DEFAULT_KONZERT_STACK) {
  const out = await stackOutputs(stack);
  return {
    table: out.TicketsTableName,
    capacity: Number(out.Capacity),
    price: Number(out.PriceChf),
    concertIso: out.ConcertIso,
  };
}

/** Matches tickets by exact id, by reference text ("Konzert Anna 2") or by name (case-insensitive). */
export function matchTickets(tickets, selector) {
  const needle = String(selector).trim();
  const lower = needle.toLowerCase();
  const byId = tickets.filter((t) => t.id === needle);
  if (byId.length) return byId;
  const byRef = tickets.filter((t) => (t.reference ?? '').toLowerCase() === lower);
  if (byRef.length) return byRef;
  return tickets.filter((t) => (t.name ?? '').toLowerCase() === lower);
}

export async function setPaid({ stack = DEFAULT_KONZERT_STACK, id, paid }) {
  const { TicketsTableName } = await stackOutputs(stack);
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TicketsTableName,
      Key: { id: { S: id } },
      UpdateExpression: 'SET paid = :p',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: { ':p': { BOOL: !!paid } },
    }),
  );
}

/**
 * Cancels an active ticket and frees its seats in the same transaction, so the capacity count
 * stays correct. A ticket that is already cancelled is left untouched.
 */
export async function cancelTicket({ stack = DEFAULT_KONZERT_STACK, ticket }) {
  const { TicketsTableName } = await stackOutputs(stack);
  await dynamo.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: TicketsTableName,
            Key: { id: { S: ticket.id } },
            UpdateExpression: 'SET #s = :cancelled',
            ConditionExpression: '#s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':cancelled': { S: 'cancelled' }, ':active': { S: 'active' } },
          },
        },
        {
          Update: {
            TableName: TicketsTableName,
            Key: { id: { S: COUNTER_ID } },
            UpdateExpression: 'SET sold = sold - :n',
            ConditionExpression: 'sold >= :n',
            ExpressionAttributeValues: { ':n': { N: String(ticket.tickets) } },
          },
        },
      ],
    }),
  );
}

/** Asks the user to pick one ticket out of several matches (returns the chosen ticket or null). */
export async function chooseTicket(matches, label = 'ticket') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Several tickets match this ${label}:`);
    matches.forEach((t, i) => {
      console.log(
        `  [${i + 1}] ${t.reference}  ·  ${t.tickets} ticket(s)  ·  ${t.paid ? 'paid' : 'unpaid'}` +
          `  ·  ${t.status}  ·  ${t.id}`,
      );
    });
    const answer = (await rl.question('Choose a number (or Enter to skip): ')).trim();
    const n = Number(answer);
    return Number.isInteger(n) && n >= 1 && n <= matches.length ? matches[n - 1] : null;
  } finally {
    rl.close();
  }
}

/** Formats a date for the tables as YYYY-MM-DD HH:mm (local time of the machine). */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
