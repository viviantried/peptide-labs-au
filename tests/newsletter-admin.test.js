const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.TRACKER_ADMIN_KEY = 'newsletter-admin-test-key';
const handler = require('../api/newsletter-admin');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let calls;

beforeEach(() => {
  calls = [];
  process.env.RESEND_API_KEY = 'local-test-only';
  process.env.RESEND_NEWSLETTER_SEGMENT_ID = 'newsletter-segment';
  delete process.env.RESEND_AUDIENCE_ID;
  global.fetch = async () => { throw new Error('No real network calls allowed'); };
});

after(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke({ method = 'GET', query = {}, key = 'newsletter-admin-test-key' } = {}) {
  const res = response();
  await handler({ method, query, headers: key ? { authorization: `Bearer ${key}` } : {} }, res);
  return res;
}

test('subscriber list rejects unauthenticated requests before contacting the provider', async () => {
  const result = await invoke({ key: '' });
  assert.equal(result.code, 401);
  assert.equal(calls.length, 0);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('subscriber list is GET-only and validates pagination before provider access', async () => {
  assert.equal((await invoke({ method: 'POST' })).code, 405);
  assert.equal((await invoke({ query: { limit: '0' } })).code, 400);
  assert.equal((await invoke({ query: { limit: '101' } })).code, 400);
  assert.equal((await invoke({ query: { after: '../contacts' } })).code, 400);
  assert.equal(calls.length, 0);
});

test('subscriber list requires Resend and segment configuration', async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal((await invoke()).code, 503);
  process.env.RESEND_API_KEY = 'local-test-only';
  delete process.env.RESEND_NEWSLETTER_SEGMENT_ID;
  assert.equal((await invoke()).code, 503);
  assert.equal(calls.length, 0);
});

test('subscriber list returns a minimal private page and stable cursor', async () => {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        object: 'list',
        has_more: true,
        data: [
          { id: 'contact-1', email: 'active@example.com', created_at: '2026-10-31T01:00:00.000Z', unsubscribed: false, properties: { private: 'not returned' } },
          { id: 'contact-2', email: 'left@example.com', created_at: '2026-10-30T01:00:00.000Z', unsubscribed: true },
        ],
      }),
    };
  };
  const result = await invoke({ query: { limit: '25', after: 'contact_0' } });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, {
    contacts: [
      { id: 'contact-1', email: 'active@example.com', createdAt: '2026-10-31T01:00:00.000Z', unsubscribed: false },
      { id: 'contact-2', email: 'left@example.com', createdAt: '2026-10-30T01:00:00.000Z', unsubscribed: true },
    ],
    hasMore: true,
    nextCursor: 'contact-2',
    checkedAt: result.body.checkedAt,
  });
  assert.match(calls[0].url, /\/segments\/newsletter-segment\/contacts\?limit=25&after=contact_0$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer local-test-only');
});

test('dedicated segment wins and provider failures stay generic', async () => {
  process.env.RESEND_AUDIENCE_ID = 'general-audience';
  global.fetch = async url => {
    calls.push({ url });
    return { ok: false, json: async () => ({ message: 'private provider detail' }) };
  };
  const result = await invoke();
  assert.equal(result.code, 503);
  assert.equal(result.body.error, 'Newsletter subscribers are unavailable. Please retry.');
  assert.match(calls[0].url, /\/segments\/newsletter-segment\/contacts/);
  assert.doesNotMatch(JSON.stringify(result.body), /private provider detail/);
});

