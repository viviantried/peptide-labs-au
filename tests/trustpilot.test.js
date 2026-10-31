const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { queueTrustpilotInvite, _private } = require('../lib/trustpilot');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let calls;

beforeEach(() => {
  calls = [];
  process.env.RESEND_API_KEY = 'local-test-only';
  process.env.TRUSTPILOT_AFS_EMAIL = 'aupeptidelab.com+test@invite.trustpilot.com';
  global.fetch = async () => { throw new Error('No real network calls allowed'); };
});

after(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test('dispatch trigger sends only the minimum structured order data with idempotency', async () => {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: 'trustpilot-trigger-1' }) };
  };
  const result = await queueTrustpilotInvite({
    order: 'PL-12345',
    email: ' Customer@Example.com ',
    name: 'Research Customer',
  });
  assert.deepEqual(result, { status: 'accepted', id: 'trustpilot-trigger-1' });
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.to, 'aupeptidelab.com+test@invite.trustpilot.com');
  assert.doesNotMatch(sent.html, /tracking|address|product/i);
  assert.match(sent.html, /"recipientEmail":"customer@example\.com"/);
  assert.match(sent.html, /"recipientName":"Research Customer"/);
  assert.match(sent.html, /"referenceId":"PL-12345"/);
  assert.match(calls[0].options.headers['Idempotency-Key'], /^trustpilot-dispatch-[a-f0-9]{64}$/);
});

test('structured data escapes markup in customer names', async () => {
  const encoded = _private.structuredData({ recipientName: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(encoded, /<\/script>|<script>/);
  assert.match(encoded, /\\u003c\/script\\u003e/);
});

test('missing or malformed AFS configuration does not block dispatch workflows', async () => {
  delete process.env.TRUSTPILOT_AFS_EMAIL;
  assert.deepEqual(await queueTrustpilotInvite({ order: 'PL-1', email: 'buyer@example.com' }), { status: 'disabled' });
  process.env.TRUSTPILOT_AFS_EMAIL = 'not-an-invite@example.com';
  assert.deepEqual(await queueTrustpilotInvite({ order: 'PL-1', email: 'buyer@example.com' }), { status: 'disabled' });
  assert.equal(calls.length, 0);
});

test('provider rejection returns a non-throwing failed status without exposing data', async () => {
  global.fetch = async () => ({ ok: false, json: async () => ({ message: 'provider detail' }) });
  assert.deepEqual(await queueTrustpilotInvite({ order: 'PL-1', email: 'buyer@example.com' }), { status: 'failed' });
});

