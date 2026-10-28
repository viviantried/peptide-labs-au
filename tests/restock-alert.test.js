const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const originalEnv = { ...process.env };
process.env.NODE_ENV = 'test';
process.env.TRACKER_ENABLED = 'true';
process.env.RESEND_API_KEY = 'test-resend-key';
delete process.env.AIRTABLE_TOKEN;
delete process.env.airtable_token;

const store = require('../lib/tracker');
const alerts = require('../lib/restock-alerts');
const restockHandler = require('../api/restock-alert');
const trackerHandler = require('../api/tracker');

const original = {
  fetch: global.fetch,
  query: store.query,
  enabled: store.enabled,
  authorized: store.authorized,
  notifyAvailable: alerts.notifyAvailable,
  error: console.error,
};

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, body) {
  const res = response();
  await handler({
    method: 'POST',
    body,
    headers: { host: 'localhost:4187', origin: 'http://localhost:4187', authorization: 'Bearer test' },
  }, res);
  return res;
}

beforeEach(() => {
  process.env.TRACKER_ENABLED = 'true';
  process.env.RESEND_API_KEY = 'test-resend-key';
  store.enabled = () => true;
  store.authorized = () => true;
  alerts.notifyAvailable = original.notifyAvailable;
  alerts._resetForTest();
  console.error = () => {};
});

afterEach(() => {
  global.fetch = original.fetch;
  store.query = original.query;
  store.enabled = original.enabled;
  store.authorized = original.authorized;
  alerts.notifyAvailable = original.notifyAvailable;
  console.error = original.error;
});

after(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test('tracker subscriptions normalize email and use an idempotent email-and-SKU upsert', async () => {
  const statements = [];
  store.query = async (sql, params = []) => {
    statements.push({ sql, params });
    if (sql.startsWith('INSERT INTO pl_restock_alerts')) {
      return [{ email: params[0], sku: params[1], requested_at: '2026-10-29T00:00:00.000Z', notified_at: null }];
    }
    return [];
  };

  const first = await invoke(restockHandler, { email: ' Researcher@EXAMPLE.com ', productId: 'PL-001' });
  const second = await invoke(restockHandler, { email: 'researcher@example.com', productId: 'PL-001' });

  assert.deepEqual(first.body, { ok: true, delivery: 'stored' });
  assert.deepEqual(second.body, { ok: true, delivery: 'stored' });
  const inserts = statements.filter(item => item.sql.startsWith('INSERT INTO pl_restock_alerts'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map(item => item.params), [
    ['researcher@example.com', 'PL-001'],
    ['researcher@example.com', 'PL-001'],
  ]);
  assert.match(inserts[0].sql, /ON CONFLICT \(email, sku\) DO UPDATE/);
  assert.equal(statements.filter(item => item.sql.startsWith('CREATE TABLE')).length, 1);
});

test('optional request identity deduplicates support fallback retries when tracker storage is unavailable', async () => {
  const sends = [];
  store.query = async () => { throw new Error('database unavailable'); };
  global.fetch = async (url, options) => {
    sends.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'support-email-id' }) };
  };
  const body = {
    email: 'researcher@example.com',
    productId: 'PL-001',
    requestId: 'a6e6942e-5414-4bed-8b01-3be2248f7b39',
  };

  const first = await invoke(restockHandler, body);
  const retry = await invoke(restockHandler, body);

  assert.equal(first.body.delivery, 'support');
  assert.equal(retry.body.delivery, 'support');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].options.headers['Idempotency-Key'], sends[1].options.headers['Idempotency-Key']);
  assert.match(sends[0].options.headers['Idempotency-Key'], /^support-a6e6942e-/);
  assert.equal((await invoke(restockHandler, { ...body, requestId: '../../bad' })).code, 400);
});

test('a real database timestamp revision is marked notified after provider acceptance', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync('db/tracker.sql', 'utf8'));
    await db.query("INSERT INTO pl_inventory(sku,name,on_hand,restocking) VALUES('PL-001','Retatrutide',1,false)");
    store.query = async (sql, params = []) => (await db.query(sql, params)).rows;
    alerts._resetForTest();
    await alerts.subscribe('Researcher@EXAMPLE.com', 'PL-001');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'accepted-email-id' }) });

    const result = await alerts.notifyAvailable('PL-001');
    const saved = (await db.query("SELECT email,notified_at,provider_id FROM pl_restock_alerts WHERE sku='PL-001'")).rows[0];

    assert.deepEqual(result, { status: 'sent', attempted: 1, accepted: 1, failed: 0 });
    assert.equal(saved.email, 'researcher@example.com');
    assert.ok(saved.notified_at instanceof Date);
    assert.equal(saved.provider_id, 'accepted-email-id');
  } finally {
    await db.close();
  }
});

test('provider acceptance retries use a stable idempotency key and only then mark the alert notified', async () => {
  const timeline = [];
  const sends = [];
  let markAttempts = 0;
  const pending = { email: 'researcher@example.com', sku: 'PL-001', request_revision: '2026-10-29 00:00:00.123456+00' };
  store.query = async sql => {
    if (sql.startsWith('SELECT email, sku, requested_at::text')) return [pending];
    if (sql.startsWith('UPDATE pl_restock_alerts')) {
      timeline.push('mark');
      markAttempts += 1;
      if (markAttempts === 1) throw new Error('temporary database failure');
      return [{ email: pending.email }];
    }
    return [];
  };
  global.fetch = async (url, options) => {
    timeline.push('provider');
    sends.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'resend-email-id' }) };
  };

  const first = await alerts.notifyAvailable('PL-001');
  const retry = await alerts.notifyAvailable('PL-001');

  assert.equal(first.status, 'failed');
  assert.equal(retry.status, 'sent');
  assert.deepEqual(timeline, ['provider', 'mark', 'provider', 'mark']);
  assert.equal(sends[0].options.headers['Idempotency-Key'], sends[1].options.headers['Idempotency-Key']);
  assert.match(sends[0].options.headers['Idempotency-Key'], /^restock-[a-f0-9]{64}$/);
  assert.equal(JSON.parse(sends[0].options.body).to, pending.email);
});

test('provider rejection leaves the subscriber pending', async () => {
  let marked = false;
  store.query = async sql => {
    if (sql.startsWith('SELECT email, sku, requested_at::text')) {
      return [{ email: 'researcher@example.com', sku: 'PL-001', request_revision: '2026-10-29 00:00:00.123456+00' }];
    }
    if (sql.startsWith('UPDATE pl_restock_alerts')) marked = true;
    return [];
  };
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  const result = await alerts.notifyAvailable('PL-001');

  assert.deepEqual(result, { status: 'failed', attempted: 1, accepted: 0, failed: 1 });
  assert.equal(marked, false);
});

function stockQueries({ initialRestocking = true, notificationError = null } = {}) {
  const calls = [];
  let restocking = initialRestocking;
  store.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT pl_adjust_stock')) {
      assert.equal(restocking, initialRestocking);
      restocking = params[3];
      return [{ value: { sku: 'PL-001', on_hand: 1, reserved: 0, low_stock: 5, restocking: false, version: 2 } }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  let notifications = 0;
  alerts.notifyAvailable = async sku => {
    notifications += 1;
    assert.equal(sku, 'PL-001');
    if (notificationError) throw notificationError;
    return { status: 'sent', attempted: 1, accepted: 1, failed: 0 };
  };
  return { calls, notifications: () => notifications };
}

function stockBody() {
  return { action: 'stock', sku: 'PL-001', on_hand: 1, low_stock: 5, restocking: false, version: 1, reason: 'delivery received' };
}

test('positive stock changing from restocking to available dispatches alerts', async () => {
  const state = stockQueries();

  const result = await invoke(trackerHandler, stockBody());

  assert.equal(result.code, 200);
  assert.equal(state.notifications(), 1);
  assert.deepEqual(result.body.restockAlerts, { status: 'sent', attempted: 1, accepted: 1, failed: 0 });
});

test('notification failure does not roll back or report failure for the committed stock update', async () => {
  const state = stockQueries({ notificationError: new Error('provider unavailable') });

  const result = await invoke(trackerHandler, stockBody());

  assert.equal(result.code, 200);
  assert.equal(state.notifications(), 1);
  assert.equal(state.calls.filter(call => call.sql.startsWith('SELECT pl_adjust_stock')).length, 1);
  assert.equal(result.body.inventory.restocking, false);
  assert.deepEqual(result.body.restockAlerts, { status: 'failed', attempted: 0, accepted: 0, failed: 0 });
});

test('an available stock action retries any still-pending alerts', async () => {
  const state = stockQueries({ initialRestocking: false });

  const result = await invoke(trackerHandler, stockBody());

  assert.equal(result.code, 200);
  assert.equal(state.notifications(), 1);
  assert.deepEqual(result.body.restockAlerts, { status: 'sent', attempted: 1, accepted: 1, failed: 0 });
});
