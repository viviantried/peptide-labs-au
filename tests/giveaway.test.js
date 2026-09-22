const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handler = require('../api/giveaway');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const segment = '4b146890-a529-4fd0-9a27-e74c9cbbf822';
let calls;
beforeEach(() => {
  calls = [];
  for (const key of ['RESEND_API_KEY','resend_api_key','RESEND_AUDIENCE_ID','resend_audience_id','RESEND_GIVEAWAY_SEGMENT_ID']) delete process.env[key];
  process.env.RESEND_API_KEY = 'local-test-only';
  process.env.RESEND_AUDIENCE_ID = segment;
  global.fetch = async () => { throw new Error('No real network calls allowed'); };
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
const entry = { email: 'entrant@example.com', entryConsent: true, marketingConsent: false };
function responses(sequence) {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const item = sequence.shift();
    assert.ok(item, 'Unexpected extra provider request');
    return { ok: item[0] >= 200 && item[0] < 300, status: item[0], json: async () => item[1] };
  };
}
async function invoke(body = entry, method = 'POST', headers = { host: 'localhost', origin: 'http://localhost' }) {
  const res = { code:200, setHeader(){}, status(code){this.code=code;return this;}, json(body){this.body=body;return this;} };
  await handler({ method, body, headers }, res);
  return res;
}
test('missing configuration cannot confirm a giveaway entry', async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal((await invoke()).code, 503);
  assert.deepEqual((await invoke(null, 'GET')).body, { available:false });
});
test('invalid entry data is rejected before contacting Resend', async () => {
  for (const invalid of [{ email:'bad' }, { entryConsent:false }, { marketingConsent:'true' }, { website:'spam' }, { email:'x'.repeat(255)+'@example.com' }]) {
    assert.equal((await invoke({ ...entry, ...invalid })).code, 400);
  }
  assert.equal((await invoke(entry, 'POST', {host:'localhost',origin:'https://unrelated.example'})).code, 403);
  assert.equal((await invoke(entry, 'DELETE')).code, 405);
});
test('new entries save normalized contact and giveaway membership without requiring marketing', async () => {
  responses([[404, {}], [200, { id:'new-contact' }], [200, { id:segment }]]);
  assert.deepEqual((await invoke({...entry,email:' Entrant@EXAMPLE.com '})).body, {ok:true});
  const saved = JSON.parse(calls[1].options.body);
  assert.equal(saved.email, 'entrant@example.com');
  assert.equal(saved.unsubscribed, true);
  assert.deepEqual(saved.segments, [{id:segment}]);
  assert.ok(calls[2].url.endsWith('/segments/'+segment));
});
test('new contacts can explicitly opt into marketing', async () => {
  responses([[404, {}], [200, { id:'new-contact' }], [200, { id:segment }]]);
  assert.equal((await invoke({...entry,marketingConsent:true})).code, 200);
  assert.equal(JSON.parse(calls[1].options.body).unsubscribed, false);
});
test('repeat entries preserve existing opt-outs and do not create another contact', async () => {
  responses([[200, { id:'existing-contact',unsubscribed:true }], [200, { id:segment }]]);
  assert.equal((await invoke({...entry,marketingConsent:true})).code, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.options.method !== 'PATCH'));
  assert.equal(calls.filter(c => c.url.endsWith('/contacts')).length, 0);
});
test('a competing contact creation is recovered by looking up the existing contact', async () => {
  responses([[404, {}], [409, {}], [200, { id:'existing-contact' }], [200, { id:segment }]]);
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.length, 4);
});
test('entry cannot succeed when adding its giveaway membership fails', async () => {
  responses([[200, { id:'existing-contact' }], [500, {}]]);
  assert.equal((await invoke()).code, 503);
});
test('provider rejection, invalid acceptance bodies and network errors cannot show success', async () => {
  for (const sequence of [[[403,{}]], [[200,{}]], [[404,{}],[400,{}]], [[200,{id:'contact'}],[200,{}]]]) {
    responses(sequence);
    assert.equal((await invoke()).code, 503);
  }
  global.fetch = async () => { throw new Error('Offline'); };
  assert.equal((await invoke()).code, 503);
});
test('availability checks validate the configured Resend list without creating contacts', async () => {
  responses([[200, { id:segment, name:'Giveaway' }]]);
  assert.deepEqual((await invoke(null, 'GET')).body, {available:true});
  assert.equal(calls[0].options.method, undefined);
  responses([[200, { id:'wrong-list' }]]);
  assert.equal((await invoke(null, 'GET')).code, 503);
});
test('a dedicated giveaway segment takes priority over the general audience', async () => {
  process.env.RESEND_GIVEAWAY_SEGMENT_ID = 'dedicated-giveaway';
  responses([[200,{id:'contact'}], [200,{id:'dedicated-giveaway'}]]);
  assert.equal((await invoke()).code, 200);
  assert.ok(calls[1].url.endsWith('/segments/dedicated-giveaway'));
});
test('the restored browser controller parses', () => {
  new vm.Script(fs.readFileSync(require.resolve('../giveaway.js'),'utf8'));
});
