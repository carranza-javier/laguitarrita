// Integration tests against a deployed concert stack (default: laguitarrita-konzert-test, Capacity=10).
// Checks that the capacity can never be exceeded under concurrent purchases, that invalid tickets
// are rejected, and that the buyer name is cleaned so it cannot break the TWINT reference.
//
//   KONZERT_STACK=laguitarrita-konzert-test node --test konzert/tests/
process.env.KONZERT_STACK ||= 'laguitarrita-konzert-test';

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchWriteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { dynamo, stackOutputs } from '../../scripts/lib.mjs';
import { konzertConfig, scanTickets } from '../../scripts/konzert-lib.mjs';

const STACK = process.env.KONZERT_STACK;
const ORIGIN = 'https://laguitarrita.ch';

let out;
let capacity;
let price;

const api = (path, init = {}) =>
  fetch(`${out.ApiUrl}${path}`, { ...init, headers: { origin: ORIGIN, ...init.headers } });

const post = (body) =>
  api('/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const availability = async () => (await api('/availability')).json();

/** Removes every row (tickets and the counter) so each test starts from a known, empty state. */
async function clearTable() {
  const { TicketsTableName } = out;
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(
      new ScanCommand({ TableName: TicketsTableName, ProjectionExpression: 'id', ExclusiveStartKey }),
    );
    const keys = (page.Items ?? []).map((i) => ({ DeleteRequest: { Key: { id: i.id } } }));
    for (let i = 0; i < keys.length; i += 25) {
      let RequestItems = { [TicketsTableName]: keys.slice(i, i + 25) };
      while (RequestItems && Object.keys(RequestItems).length) {
        ({ UnprocessedItems: RequestItems } = await dynamo.send(new BatchWriteItemCommand({ RequestItems })));
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

before(async () => {
  out = await stackOutputs(STACK);
  ({ capacity, price } = await konzertConfig(STACK));
  assert.ok(capacity > 0 && capacity <= 20, `expected a small test capacity, got ${capacity}`);
});

beforeEach(clearTable);
after(clearTable);

describe('availability', () => {
  test('starts at full capacity and reports the price', async () => {
    const a = await availability();
    assert.equal(a.remaining, capacity);
    assert.equal(a.capacity, capacity);
    assert.equal(a.price, price);
    assert.equal(a.soldOut, false);
  });
});

describe('buying a ticket', () => {
  test('a valid purchase is recorded and lowers the availability', async () => {
    const res = await post({ name: 'Anna', tickets: 2 });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.match(body.id, /^[0-9a-f-]{36}$/);
    assert.equal(body.reference, 'Konzert Anna 2');
    assert.equal(body.amount, 2 * price);
    assert.equal(body.currency, 'CHF');
    assert.equal((await availability()).remaining, capacity - 2);

    const { tickets, sold } = await scanTickets({ stack: STACK });
    assert.equal(sold, 2);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'active');
    assert.equal(tickets[0].paid, false);
  });

  test('the name is cleaned so it cannot break the reference', async () => {
    const res = await post({ name: '  Anna\n\tMüller  ', tickets: 1 });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).reference, 'Konzert Anna Müller 1');

    const long = 'X'.repeat(60);
    const res2 = await post({ name: long, tickets: 1 });
    const body2 = await res2.json();
    assert.equal(body2.name.length, 40);
    assert.ok(!body2.reference.includes('\n'));
  });
});

describe('validation', () => {
  const invalid = [
    ['missing fields', {}],
    ['empty name', { name: '', tickets: 2 }],
    ['blank name', { name: '   ', tickets: 2 }],
    ['control-only name', { name: '\n\t', tickets: 2 }],
    ['zero tickets', { name: 'Anna', tickets: 0 }],
    ['too many tickets', { name: 'Anna', tickets: 5 }],
    ['fractional tickets', { name: 'Anna', tickets: 2.5 }],
    ['non-numeric tickets', { name: 'Anna', tickets: 'two' }],
    ['honeypot filled', { name: 'Anna', tickets: 2, website: 'http://spam' }],
  ];

  for (const [label, body] of invalid) {
    test(`rejects: ${label}`, async () => {
      assert.equal((await post(body)).status, 400);
    });
  }

  test('rejects a non-JSON body', async () => {
    assert.equal((await post('not json')).status, 400);
  });

  test('no invalid request consumed any capacity', async () => {
    for (const [, body] of invalid) await post(body);
    await post('not json');
    assert.equal((await availability()).remaining, capacity);
    assert.equal((await scanTickets({ stack: STACK })).sold, 0);
  });
});

describe('capacity', () => {
  test('concurrent purchases never exceed the capacity', async () => {
    // Fire many more single-ticket purchases at once than there are seats.
    const attempts = capacity * 4;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) => post({ name: `buyer-${i}`, tickets: 1 })),
    );
    const statuses = results.map((r) => r.status);
    const created = statuses.filter((s) => s === 201).length;
    const rejected = statuses.filter((s) => s === 409).length;

    assert.equal(created, capacity, 'exactly capacity purchases succeed');
    assert.equal(rejected, attempts - capacity, 'every other purchase is refused');
    assert.ok(!statuses.some((s) => s !== 201 && s !== 409), `unexpected statuses: ${[...new Set(statuses)]}`);

    const a = await availability();
    assert.equal(a.remaining, 0);
    assert.equal(a.soldOut, true);

    const { tickets, sold } = await scanTickets({ stack: STACK });
    const active = tickets.filter((t) => t.status === 'active');
    assert.equal(sold, capacity, 'the counter matches the capacity');
    assert.equal(active.length, capacity, 'exactly capacity tickets were written');
    assert.equal(new Set(active.map((t) => t.id)).size, capacity, 'all ticket ids are unique');
  });

  test('a multi-ticket purchase is all-or-nothing when few seats remain', async () => {
    // Leave exactly one seat.
    for (let i = 0; i < capacity - 1; i++) assert.equal((await post({ name: `p${i}`, tickets: 1 })).status, 201);
    assert.equal((await availability()).remaining, 1);

    // A request for 2 cannot be partially filled.
    const two = await post({ name: 'Greedy', tickets: 2 });
    assert.equal(two.status, 409);
    assert.equal((await two.json()).remaining, 1);
    assert.equal((await availability()).remaining, 1, 'the refused request left the seat untouched');

    // The last seat can still be sold.
    assert.equal((await post({ name: 'Last', tickets: 1 })).status, 201);
    assert.equal((await availability()).soldOut, true);
  });
});

describe('CORS', () => {
  test('preflight allows laguitarrita.ch and rejects other origins', async () => {
    const preflight = (origin) =>
      api('/tickets', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      });
    assert.equal((await preflight(ORIGIN)).headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal((await preflight('https://evil.example')).headers.get('access-control-allow-origin'), null);
  });
});
