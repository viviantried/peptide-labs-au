const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/newsletter');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const segment = '6ce9787b-48fc-439c-9a13-c09144568a64';
const signup = { email: 'reader@example.com', consent: true, website: '' };
let calls;

beforeEach(() => {
  calls = [];
  for (const key of [
    'RESEND_API_KEY',
    'resend_api_key',
    'RESEND_AUDIENCE_ID',
    'resend_audience_id',
    'RESEND_NEWSLETTER_SEGMENT_ID',
    'resend_newsletter_segment_id',
  ]) delete process.env[key];
  process.env.RESEND_API_KEY = 'local-test-only';
  process.env.RESEND_AUDIENCE_ID = segment;
  global.fetch = async () => { throw new Error('No real network calls allowed'); };
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function responses(sequence) {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const item = sequence.shift();
    assert.ok(item, 'Unexpected extra provider request');
    return {
      ok: item[0] >= 200 && item[0] < 300,
      status: item[0],
      headers: { get: () => null },
      json: async () => item[1],
    };
  };
}

async function invoke(
  body = signup,
  method = 'POST',
  headers = { host: 'localhost', origin: 'http://localhost' },
) {
  const res = {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(bodyValue) { this.body = bodyValue; return this; },
  };
  await handler({ method, body, headers }, res);
  return res;
}

test('missing configuration cannot claim a subscription succeeded', async () => {
  delete process.env.RESEND_API_KEY;
  const result = await invoke();
  assert.equal(result.code, 503);
  assert.match(result.body.error, /could not subscribe/i);
  assert.equal(calls.length, 0);
});

test('invalid email, missing consent and honeypot submissions are rejected before Resend', async () => {
  for (const invalid of [
    { email: 'bad' },
    { email: `x${'y'.repeat(250)}@example.com` },
    { consent: undefined },
    { consent: false },
    { consent: 'true' },
    { website: 'bot.example' },
    { website: 0 },
  ]) {
    assert.equal((await invoke({ ...signup, ...invalid })).code, 400);
  }
  assert.equal(calls.length, 0);
});

test('method and same-origin checks run before processing a signup', async () => {
  const crossOrigin = await invoke(signup, 'POST', {
    host: 'localhost',
    origin: 'https://unrelated.example',
  });
  assert.equal(crossOrigin.code, 403);
  const wrongMethod = await invoke(signup, 'DELETE');
  assert.equal(wrongMethod.code, 405);
  assert.equal(wrongMethod.headers.Allow, 'POST');
  assert.equal(calls.length, 0);
});

test('new signups create a normalized subscribed contact and newsletter membership', async () => {
  responses([[404, {}], [200, { id: 'new-contact' }], [200, { id: segment }]]);
  const result = await invoke({ ...signup, email: ' Reader@EXAMPLE.com ' });
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  const saved = JSON.parse(calls[1].options.body);
  assert.equal(saved.email, 'reader@example.com');
  assert.equal(saved.unsubscribed, false);
  assert.deepEqual(saved.segments, [{ id: segment }]);
  assert.ok(calls[2].url.endsWith(`/segments/${segment}`));
});

test('existing subscribed contacts are added without unnecessary contact updates', async () => {
  responses([[200, { id: 'existing-contact', unsubscribed: false }], [200, { id: segment }]]);
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.method !== 'PATCH'));
  assert.equal(calls.filter(call => call.url.endsWith('/contacts')).length, 0);
});

test('explicit consent resubscribes an opted-out contact after confirming newsletter membership', async () => {
  responses([
    [200, { id: 'existing-contact', unsubscribed: true }],
    [200, { id: segment }],
    [200, { id: 'existing-contact' }],
  ]);
  assert.equal((await invoke()).code, 200);
  assert.ok(calls[1].url.endsWith(`/segments/${segment}`));
  assert.equal(calls[2].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[2].options.body), { unsubscribed: false });
});

test('a competing contact creation is recovered and resubscribed when necessary', async () => {
  responses([
    [404, {}],
    [409, {}],
    [200, { id: 'existing-contact', unsubscribed: true }],
    [200, { id: segment }],
    [200, { id: 'existing-contact' }],
  ]);
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.length, 5);
  assert.ok(calls[3].url.endsWith(`/segments/${segment}`));
  assert.equal(calls[4].options.method, 'PATCH');
});

test('a failed segment add cannot globally resubscribe an opted-out contact', async () => {
  responses([
    [200, { id: 'existing-contact', unsubscribed: true }],
    [500, {}],
    [200, { data: [] }],
  ]);
  assert.equal((await invoke()).code, 503);
  assert.ok(calls.every(call => call.options.method !== 'PATCH'));
});

test('repeated segment membership is acknowledged only after reading it back', async () => {
  responses([
    [200, { id: 'contact', unsubscribed: false }],
    [409, {}],
    [200, { data: [{ id: segment }] }],
  ]);
  assert.equal((await invoke()).code, 200);

  responses([
    [200, { id: 'contact', unsubscribed: false }],
    [409, {}],
    [200, { data: [{ id: 'another-segment' }] }],
  ]);
  assert.equal((await invoke()).code, 503);
});

test('provider rejections, invalid acknowledgements and network errors cannot show success', async () => {
  for (const sequence of [
    [[403, {}]],
    [[200, {}]],
    [[404, {}], [400, {}]],
    [[200, { id: 'contact', unsubscribed: true }], [200, { id: segment }], [200, {}]],
    [[200, { id: 'contact', unsubscribed: false }], [200, {}], [200, { data: [] }]],
  ]) {
    responses(sequence);
    assert.equal((await invoke()).code, 503);
  }
  global.fetch = async () => { throw new Error('Offline'); };
  assert.equal((await invoke()).code, 503);
});

test('a dedicated newsletter segment takes priority over the general audience', async () => {
  process.env.RESEND_NEWSLETTER_SEGMENT_ID = 'dedicated-newsletter';
  responses([
    [200, { id: 'contact', unsubscribed: false }],
    [200, { id: 'dedicated-newsletter' }],
  ]);
  assert.equal((await invoke()).code, 200);
  assert.ok(calls[1].url.endsWith('/segments/dedicated-newsletter'));
});
