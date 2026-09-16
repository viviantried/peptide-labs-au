const assert = require('node:assert/strict');
const test = require('node:test');

process.env.CONFIRM_SECRET = 'test-secret';
process.env.BSB_NUMBER = '123456';
process.env.ACCOUNT_NUMBER = '12345678';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.AIRTABLE_TOKEN = 'test-airtable-key';
const handler = require('../api/order');

function request() {
  return { method:'POST', body:{
    email:'buyer@example.com', firstName:'Alex', lastName:'Researcher',
    address1:'1 Lab Street', suburb:'Melbourne', postcode:'3000', state:'VIC', country:'AU',
    items:[{ id:'PL-002', qty:1 }], shippingMethod:'Standard', marketingConsent:false,
  } };
}

function response() {
  return {
    code:200, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}, end() {},
  };
}

function ok(body) { return { ok:true, status:200, async json() { return body; } }; }

test('saves the order before sending email and alerts the direct owner inbox', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('airtable.com')) return ok({ records:[{ id:'rec123' }] });
    return ok({ id:`email-${calls.length}` });
  };
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.orderRecordId, 'rec123');
  assert.equal(res.body.storeAlertAccepted, true);
  assert.match(calls[0].url, /airtable\.com/);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body).performUpsert.fieldsToMergeOn, ['Name']);
  assert(calls.some(call => call.url.includes('resend.com') && JSON.parse(call.options.body).to === 'viviantriedk@gmail.com'));
});

test('does not confirm or email an order when database storage fails', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok:false, status:422, async json() { return { error:{ type:'INVALID_VALUE' } }; } };
  };
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 503);
  assert(calls.every(call => call.url.includes('airtable.com')));
});

test('preserves a saved order and reports store alert failure', async () => {
  global.fetch = async (url, options = {}) => {
    if (url.includes('airtable.com')) return ok({ records:[{ id:'rec456' }] });
    const body = JSON.parse(options.body);
    if (body.to === 'viviantriedk@gmail.com' || body.to === 'support@aupeptidelab.com') {
      return { ok:false, status:400, async json() { return { message:'recipient rejected' }; } };
    }
    return ok({ id:'email-customer' });
  };
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.orderRecordId, 'rec456');
  assert.equal(res.body.customerEmailAccepted, true);
  assert.equal(res.body.storeAlertAccepted, false);
});

test('health check confirms the Orders table is reachable', async () => {
  global.fetch = async url => {
    assert.match(url, /airtable\.com.*Orders\?maxRecords=1/);
    return ok({ records:[] });
  };
  const res = response();
  await handler({ method:'GET', query:{ health:'1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.orderDatabase, 'ready');
});
