const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let requests;
beforeEach(() => {
  requests = [];
  for (const key of ['RESEND_API_KEY', 'resend_api_key', 'AIRTABLE_TOKEN', 'airtable_token']) delete process.env[key];
  process.env.CONFIRM_SECRET = 'local-test-secret';
  global.fetch = async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request'); };
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function load(name) {
  const path = require.resolve(`../api/${name}`);
  delete require.cache[path];
  return require(path);
}
async function invoke(name, body, overrides = {}) {
  const res = {
    headers: {}, code: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
  await load(name)({ method: 'POST', body, headers: { host: 'localhost:4187', origin: 'http://localhost:4187' }, ...overrides }, res);
  return res;
}
function provider(status, body) {
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}
const contact = { name: 'Test researcher', email: 'researcher@example.com', topic: 'Order Support', orderNumber: '', message: 'Please check my order.', requestId: 'a6e6942e-5414-4bed-8b01-3be2248f7b39' };

test('contact fails honestly without a configured email service', async () => {
  const result = await invoke('contact', contact);
  assert.equal(result.code, 503);
  assert.match(result.body.error, /could not send/i);
  assert.equal(requests.length, 0);
});
test('contact rejects invalid fields and cross-origin submissions without sending', async () => {
  for (const invalid of [{ email: 'bad' }, { topic: 'Spam' }, { message: ' '.repeat(20) }, { message: 'x'.repeat(5001) }, { website: 'spam.test' }, { requestId: '../../bad' }]) {
    assert.equal((await invoke('contact', { ...contact, ...invalid })).code, 400);
  }
  assert.equal((await invoke('contact', contact, { headers: { host: 'localhost:4187', origin: 'https://unrelated.example' } })).code, 403);
  assert.equal((await invoke('contact', contact, { method: 'GET' })).code, 405);
  assert.equal(requests.length, 0);
});
test('contact requires provider acceptance with an email ID', async () => {
  process.env.RESEND_API_KEY = 'local-fake';
  for (const [status, body] of [[429, {}], [500, {}], [200, {}]]) {
    provider(status, body);
    assert.equal((await invoke('contact', contact)).code, 503);
  }
  provider(200, { id: 'test-email-id' });
  assert.equal((await invoke('contact', contact)).body.ok, true);
});
test('contact escapes submitted content and uses stable payload-specific retry keys', async () => {
  process.env.RESEND_API_KEY = 'local-fake';
  provider(200, { id: 'test-email-id' });
  const body = { ...contact, name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>\nNext line' };
  await invoke('contact', body);
  await invoke('contact', body);
  await invoke('contact', { ...body, message: 'Edited message' });
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.to, 'support@aupeptidelab.com');
  assert.equal(sent.reply_to, contact.email);
  assert.doesNotMatch(sent.html, /<script>|<img/);
  assert.match(sent.html, /&lt;img/);
  assert.match(sent.html, /<br>Next line/);
  assert.equal(requests[0].options.headers['Idempotency-Key'], requests[1].options.headers['Idempotency-Key']);
  assert.notEqual(requests[1].options.headers['Idempotency-Key'], requests[2].options.headers['Idempotency-Key']);
});
test('restock fails when neither storage nor email is available', async () => {
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).code, 503);
  assert.equal(requests.length, 0);
});
test('restock rejects inherited property names and malformed addresses', async () => {
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'constructor' })).code, 400);
  assert.equal((await invoke('restock-alert', { email: '<img>@example.com', productId: 'PL-001' })).code, 400);
});
test('restock reports a stored request only after successful storage', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  provider(200, {});
  const result = await invoke('restock-alert', { email: ' Researcher@EXAMPLE.com ', productId: 'PL-001' });
  assert.deepEqual(result.body, { ok: true, delivery: 'stored' });
  assert.equal(JSON.parse(requests[0].options.body).records[0].fields.Email, 'researcher@example.com');
  assert.equal(requests.length, 1);
});
test('restock distinguishes an accepted support fallback from a saved alert', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  process.env.RESEND_API_KEY = 'local-fake';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: url.includes('resend.com'), status: url.includes('resend.com') ? 200 : 500, json: async () => ({ id: 'test-email-id' }) };
  };
  assert.deepEqual((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).body, { ok: true, delivery: 'support' });
  provider(500, {});
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).code, 503);
});
test('restock retries storage after successfully creating a missing table', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: requests.length > 1, status: requests.length === 1 ? 404 : 200 };
  };
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).body.delivery, 'stored');
  assert.equal(requests.length, 3);
});
function feedback(extra = {}) {
  const order = 'PL-TEST';
  const email = contact.email;
  const token = crypto.createHmac('sha256', process.env.CONFIRM_SECRET).update(`${order}:${email}:feedback`).digest('hex').slice(0, 20);
  return { order, email, token, rating: 5, comment: 'Good packaging', ...extra };
}
test('feedback rejects malformed ratings instead of accepting empty star counts', async () => {
  for (const rating of ['nope', 0, 6, 2.5]) assert.equal((await invoke('feedback', feedback({ rating }))).code, 400);
  assert.equal(requests.length, 0);
});
test('feedback preserves escaped text after provider failure and only thanks after acceptance', async () => {
  const result = await invoke('feedback', feedback({ comment: '</textarea><script>alert(1)</script>' }));
  assert.equal(result.code, 503);
  assert.match(result.body, /could not submit/);
  assert.match(result.body, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.doesNotMatch(result.body, /<script>/);
  process.env.RESEND_API_KEY = 'local-fake';
  provider(200, { id: 'test-email-id' });
  assert.match((await invoke('feedback', feedback())).body, /Thank you/);
});
test('all inline storefront scripts parse after edits', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(require.resolve('../storefront-support.js'), 'utf8'));
});
