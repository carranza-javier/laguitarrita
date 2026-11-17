// Integration tests for the private /admin API against a deployed concert stack
// (default: laguitarrita-konzert-test, Capacity=10). Checks that:
//   - every /admin route rejects a missing, malformed or foreign-pool token with 401,
//   - the capacity can never be exceeded by concurrent manual + public creations,
//   - cancelling frees seats exactly once (idempotent),
//   - PATCH rejects any field other than paid.
//
//   KONZERT_STACK=laguitarrita-konzert-test node --test konzert/tests/admin.test.mjs
process.env.KONZERT_STACK ||= 'laguitarrita-konzert-test';

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { BatchWriteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoUser, CognitoUserPool, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { cognito, dynamo, stackOutputs } from '../../scripts/lib.mjs';
import { konzertConfig } from '../../scripts/konzert-lib.mjs';

const STACK = process.env.KONZERT_STACK;
const ORIGIN = 'https://laguitarrita.ch';
const TEST_ADMIN = 'test-admin';
const TEST_PASSWORD = 'Test-Admin-Pw-123456';
// A user pool that is NOT this stack's admin pool (the student-area prod pool). A token minted for it
// must be rejected by the admin API. We only need its issuer string, not any real credentials.
const FOREIGN_ISSUER = 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_ayxyse307';

let out;
let capacity;
let token; // a real access token from this stack's admin pool

const api = (path, init = {}) =>
  fetch(`${out.ApiUrl}${path}`, { ...init, headers: { origin: ORIGIN, ...init.headers } });

const auth = (path, init = {}) => api(path, { ...init, headers: { authorization: token, ...init.headers } });

const authJson = (path, method, body) =>
  auth(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const publicPost = (body) =>
  api('/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const availability = async () => (await api('/availability')).json();

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

/** SRP sign-in against the admin pool; returns the access token (same token type the web app uses). */
function signIn(username, password) {
  const pool = new CognitoUserPool({ UserPoolId: out.AdminUserPoolId, ClientId: out.AdminUserPoolClientId });
  const user = new CognitoUser({ Username: username, Pool: pool });
  return new Promise((resolve, reject) => {
    user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
      onSuccess: (session) => resolve(session.getAccessToken().getJwtToken()),
      onFailure: reject,
      newPasswordRequired: () => reject(new Error('newPasswordRequired')),
    });
  });
}

/** A self-signed RS256 JWT that looks like a Cognito access token from a different pool. */
function foreignToken() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data =
    b64({ alg: 'RS256', kid: 'foreign-key', typ: 'JWT' }) +
    '.' +
    b64({ sub: 'intruder', iss: FOREIGN_ISSUER, client_id: 'foreign', token_use: 'access', iat: now, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url');
  return `${data}.${sig}`;
}

before(async () => {
  out = await stackOutputs(STACK);
  ({ capacity } = await konzertConfig(STACK));
  assert.ok(capacity > 0 && capacity <= 20, `expected a small test capacity, got ${capacity}`);
  assert.ok(out.AdminUserPoolId && out.AdminUserPoolClientId, 'stack must expose the admin pool outputs');

  // A throwaway admin user with a permanent password, used for the authorized tests.
  await cognito.send(
    new AdminCreateUserCommand({ UserPoolId: out.AdminUserPoolId, Username: TEST_ADMIN, MessageAction: 'SUPPRESS' }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: out.AdminUserPoolId,
      Username: TEST_ADMIN,
      Password: TEST_PASSWORD,
      Permanent: true,
    }),
  );
  token = await signIn(TEST_ADMIN, TEST_PASSWORD);
});

after(async () => {
  await clearTable();
  await cognito
    .send(new AdminDeleteUserCommand({ UserPoolId: out.AdminUserPoolId, Username: TEST_ADMIN }))
    .catch(() => {});
});

beforeEach(clearTable);

describe('admin auth', () => {
  // method + path for each admin route; the body does not matter, the authorizer runs first.
  const routes = [
    ['GET', '/admin/tickets'],
    ['POST', '/admin/tickets'],
    ['PATCH', '/admin/tickets/some-id'],
    ['POST', '/admin/tickets/some-id/cancel'],
    ['DELETE', '/admin/tickets/some-id'],
  ];

  for (const [method, path] of routes) {
    test(`${method} ${path} is 401 without a token`, async () => {
      assert.equal((await api(path, { method })).status, 401);
    });
    test(`${method} ${path} is 401 with a malformed token`, async () => {
      assert.equal((await api(path, { method, headers: { authorization: 'Bearer not-a-token' } })).status, 401);
    });
    test(`${method} ${path} is 401 with a token from another pool`, async () => {
      assert.equal((await api(path, { method, headers: { authorization: foreignToken() } })).status, 401);
    });
  }

  test('a valid admin token is accepted', async () => {
    const res = await auth('/admin/tickets');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totals.capacity, capacity);
    assert.ok(Array.isArray(body.tickets));
  });
});

describe('admin list and manual create', () => {
  test('a manual ticket counts towards the capacity and shows up with its totals', async () => {
    const created = await (await authJson('/admin/tickets', 'POST', { name: 'Pedro', tickets: 2, paid: true })).json();
    assert.equal(created.reference, 'Konzert Pedro 2');
    assert.equal(created.paid, true);

    assert.equal((await availability()).remaining, capacity - 2);

    const { tickets, totals } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.length, 1);
    assert.equal(totals.sold, 2);
    assert.equal(totals.remaining, capacity - 2);
    assert.equal(totals.capacity, capacity);
  });

  test('a manual create is refused when it would exceed the capacity', async () => {
    const res = await authJson('/admin/tickets', 'POST', { name: 'TooBig', tickets: capacity + 1 });
    assert.equal(res.status, 400); // more than the venue holds
    const ok = await authJson('/admin/tickets', 'POST', { name: 'Full', tickets: capacity });
    assert.equal(ok.status, 201);
    const over = await authJson('/admin/tickets', 'POST', { name: 'Extra', tickets: 1 });
    assert.equal(over.status, 409);
    assert.equal((await over.json()).code, 'capacity');
  });
});

describe('admin patch', () => {
  let id;
  beforeEach(async () => {
    id = (await (await authJson('/admin/tickets', 'POST', { name: 'Ana', tickets: 1 })).json()).id;
  });

  test('toggles paid on and off', async () => {
    const on = await authJson(`/admin/tickets/${id}`, 'PATCH', { paid: true });
    assert.equal(on.status, 200);
    assert.equal((await on.json()).paid, true);

    const { tickets } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.find((x) => x.id === id).paid, true);

    const off = await authJson(`/admin/tickets/${id}`, 'PATCH', { paid: false });
    assert.equal((await off.json()).paid, false);
  });

  for (const [label, body] of [
    ['an unknown field', { foo: true }],
    ['the removed arrived field', { arrived: true }],
    ['the status field', { status: 'cancelled' }],
    ['a non-boolean value', { paid: 'yes' }],
    ['an empty body', {}],
  ]) {
    test(`rejects ${label}`, async () => {
      assert.equal((await authJson(`/admin/tickets/${id}`, 'PATCH', body)).status, 400);
    });
  }
});

describe('admin cancel', () => {
  test('frees the seats exactly once (idempotent)', async () => {
    const id = (await (await authJson('/admin/tickets', 'POST', { name: 'Leo', tickets: 3, paid: true })).json()).id;
    assert.equal((await availability()).remaining, capacity - 3);

    const first = await auth(`/admin/tickets/${id}/cancel`, { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal((await availability()).remaining, capacity, 'cancelling a paid ticket frees its seats');

    // Cancelling again must not free the seats a second time.
    const second = await auth(`/admin/tickets/${id}/cancel`, { method: 'POST' });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).alreadyCancelled, true);
    assert.equal((await availability()).remaining, capacity);

    const { tickets } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.find((t) => t.id === id).status, 'cancelled');
  });
});

describe('admin permanent delete', () => {
  const del = (id) => auth(`/admin/tickets/${id}`, { method: 'DELETE' });

  test('a cancelled ticket can be permanently deleted', async () => {
    const id = (await (await authJson('/admin/tickets', 'POST', { name: 'Tom', tickets: 2 })).json()).id;
    await auth(`/admin/tickets/${id}/cancel`, { method: 'POST' });

    const res = await del(id);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, true);

    const { tickets } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.find((t) => t.id === id), undefined, 'the row is gone');
  });

  test('an active ticket cannot be deleted and keeps its seats', async () => {
    const id = (await (await authJson('/admin/tickets', 'POST', { name: 'Keep', tickets: 2 })).json()).id;
    const res = await del(id);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'notCancelled');

    const { tickets } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.find((t) => t.id === id).status, 'active', 'still there');
    assert.equal((await availability()).remaining, capacity - 2, 'the seats are untouched');
  });

  test('deleting an unknown id is idempotent', async () => {
    const res = await del('does-not-exist');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, true);
  });
});

describe('capacity under mixed concurrency', () => {
  test('manual and public creations together never exceed the capacity', async () => {
    const attempts = capacity * 4;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        i % 2 === 0
          ? publicPost({ name: `public-${i}`, tickets: 1 })
          : authJson('/admin/tickets', 'POST', { name: `admin-${i}`, tickets: 1 }),
      ),
    );
    const statuses = results.map((r) => r.status);
    const created = statuses.filter((s) => s === 201).length;
    const rejected = statuses.filter((s) => s === 409).length;

    assert.equal(created, capacity, 'exactly capacity creations succeed');
    assert.equal(rejected, attempts - capacity, 'every other creation is refused');
    assert.ok(!statuses.some((s) => s !== 201 && s !== 409), `unexpected statuses: ${[...new Set(statuses)]}`);

    const a = await availability();
    assert.equal(a.remaining, 0);
    assert.equal(a.soldOut, true);

    const { tickets, totals } = await (await auth('/admin/tickets')).json();
    const active = tickets.filter((t) => t.status === 'active');
    assert.equal(active.length, capacity);
    assert.equal(totals.sold, capacity);
  });

  test('concurrent creations and cancellations keep the counter consistent', async () => {
    // Fill the venue, then fire a burst of new creations and cancellations of those tickets at once.
    const ids = [];
    for (let i = 0; i < capacity; i++) {
      ids.push((await (await authJson('/admin/tickets', 'POST', { name: `seed-${i}`, tickets: 1 })).json()).id);
    }
    assert.equal((await availability()).remaining, 0);

    await Promise.all([
      ...ids.map((id) => auth(`/admin/tickets/${id}/cancel`, { method: 'POST' })),
      ...Array.from({ length: capacity }, (_, i) => authJson('/admin/tickets', 'POST', { name: `new-${i}`, tickets: 1 })),
    ]);

    // Whatever the interleaving, the counter must equal the seats held by active tickets and stay in range.
    const { tickets, totals } = await (await auth('/admin/tickets')).json();
    const activeSeats = tickets.filter((t) => t.status === 'active').reduce((n, t) => n + t.tickets, 0);
    assert.ok(totals.sold >= 0 && totals.sold <= capacity, `sold out of range: ${totals.sold}`);
    assert.equal(totals.sold, activeSeats, 'the counter matches the active seats');
    assert.equal((await availability()).remaining, capacity - totals.sold);
  });
});

describe('list and cancelled filtering', () => {
  test('the list returns active and cancelled tickets flagged by status (the UI hides cancelled)', async () => {
    const keep = (await (await authJson('/admin/tickets', 'POST', { name: 'Active', tickets: 1 })).json()).id;
    const drop = (await (await authJson('/admin/tickets', 'POST', { name: 'Gone', tickets: 1 })).json()).id;
    await auth(`/admin/tickets/${drop}/cancel`, { method: 'POST' });

    const { tickets } = await (await auth('/admin/tickets')).json();
    assert.equal(tickets.find((t) => t.id === keep).status, 'active');
    assert.equal(tickets.find((t) => t.id === drop).status, 'cancelled');
    assert.equal(tickets.filter((t) => t.status === 'active').length, 1, 'only one ticket is active');
  });
});
