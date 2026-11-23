const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
process.env.NODE_ENV='test';process.env.TRACKER_ENABLED='true';
process.env.CONFIRM_SECRET='tracking-test-secret';process.env.RESEND_API_KEY='test-only';
process.env.TRACKER_ADMIN_KEY='tracking-test-admin';process.env.DATABASE_URL='test-only';
const tracker=require('../lib/tracker');
const handler=require('../api/send-tracking');
let db,sends,providerFails;
const realFetch=global.fetch;
before(async()=>{
  db=new PGlite();await db.exec(fs.readFileSync('db/tracker.sql','utf8'));
  tracker.setClientForTest({query:async(sql,params)=>(await db.query(sql,params)).rows});
});
beforeEach(async()=>{
  sends=[];providerFails=false;
  await db.exec('TRUNCATE pl_events,pl_order_items,pl_orders,pl_inventory RESTART IDENTITY CASCADE');
  await db.query("INSERT INTO pl_inventory(sku,name,on_hand) VALUES('PL-001','Test product',20)");
  for(const state of ['pending','paid','shipped','expired','cancelled']){
    const id='PL-'+state;
    await tracker.create(id,id,{email:'buyer@example.invalid',items:[{id:'PL-001',qty:1}],total:135},[{id:'PL-001',qty:1}]);
    if(['paid','shipped'].includes(state))await tracker.change(id,'paid');
    if(state==='shipped')await tracker.change(id,'shipped','OLD123','Australia Post');
    if(['expired','cancelled'].includes(state))await tracker.change(id,state);
  }
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    sends.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});
    return {ok:!providerFails,json:async()=>({id:'email-'+sends.length})};
  };
});
after(async()=>{global.fetch=realFetch;await db.close();});
async function request(state,extra={},headers={authorization:'Bearer tracking-test-admin','content-type':'application/json'}){
  const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
  await handler({method:'POST',headers,body:{order:'PL-'+state,tracking:'NEW123',carrier:'Australia Post',requestId:'request-12345678',...extra}},response);
  return response;
}
async function inventory(){return(await db.query('SELECT on_hand,reserved FROM pl_inventory')).rows;}
for(const state of ['pending','expired','cancelled','shipped'])test('admin can email tracking for '+state+' without changing status or stock',async()=>{
  const before=await inventory();
  const response=await request(state);
  assert.equal(response.code,200);assert.equal(response.body.status,state);
  assert.deepEqual(await inventory(),before);
  const saved=await tracker.find('PL-'+state);
  assert.equal(saved.tracking,'NEW123');assert.equal(saved.carrier,'Australia Post');assert.equal(saved.emails.tracking,'accepted');assert.equal(saved.emails.customer,'pending');
  assert.equal(sends.length,1);assert.equal(sends[0].body.from,'PeptideLab <support@aupeptidelab.com>');assert.equal(sends[0].body.reply_to,'support@aupeptidelab.com');
  assert.equal(sends[0].body.to,'buyer@example.invalid');assert.match(sends[0].body.html,/https:\/\/auspost.com.au\/track\/NEW123/);
});
test('paid order dispatch deducts stock once; a corrected tracking email updates the shipped record',async()=>{
  const [before]=await inventory();assert.equal((await request('paid')).code,200);
  const [after]=await inventory();assert.equal(after.on_hand,before.on_hand-1);assert.equal(after.reserved,before.reserved-1);
  const response=await request('paid',{tracking:'CORRECTED456',requestId:'request-87654321'});
  assert.equal(response.code,200);assert.deepEqual(await inventory(),[after]);assert.equal((await tracker.find('PL-paid')).tracking,'CORRECTED456');
});
test('expired order can also use its existing signed tracking form',async()=>{
  const email='buyer@example.invalid';const token=crypto.createHmac('sha256','tracking-test-secret').update('PL-expired:'+email+':track').digest('hex').slice(0,20);
  const response=await request('expired',{email,token},{});
  assert.equal(response.code,200);assert.match(response.body,/Tracking email sent/);assert.equal((await tracker.find('PL-expired')).status,'expired');
});
test('admin requests use the order recipient and items rather than submitted replacements',async()=>{
  const response=await request('expired',{email:'other@example.invalid',items:Buffer.from('[{"id":"wrong"}]').toString('base64')});
  assert.equal(response.code,200);assert.equal(sends[0].body.to,'buyer@example.invalid');
  const encoded=sends[0].body.html.match(/\?reorder=([^" ]+)/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(decodeURIComponent(encoded),'base64').toString()),[{id:'PL-001',qty:1}]);
});
test('unauthorized or mismatched signed requests cannot update an order or send email',async()=>{
  assert.equal((await request('expired',{},{})).code,403);
  const email='other@example.invalid';const token=crypto.createHmac('sha256','tracking-test-secret').update('PL-expired:'+email+':track').digest('hex').slice(0,20);
  assert.equal((await request('expired',{email,token},{})).code,403);
  assert.equal((await tracker.find('PL-expired')).tracking,null);assert.equal(sends.length,0);
});
test('failed email retains tracking and failed status; retry uses the same provider idempotency key',async()=>{
  providerFails=true;assert.equal((await request('expired')).code,502);
  const saved=await tracker.find('PL-expired');assert.equal(saved.tracking,'NEW123');assert.equal(saved.emails.tracking,'failed');
  providerFails=false;assert.equal((await request('expired')).code,200);
  assert.equal(sends[0].key,sends[1].key);assert.equal((await tracker.find('PL-expired')).emails.tracking,'accepted');
});
test('invalid input or missing order does not send',async()=>{
  assert.equal((await request('missing')).code,404);
  for(const extra of [{tracking:'   '},{tracking:'x'.repeat(151)},{tracking:'abc\nxyz'},{carrier:'<img>'}])assert.equal((await request('expired',extra)).code,400);
  assert.equal(sends.length,0);
});
test('customer-visible tracking is HTML escaped',async()=>{
  assert.equal((await request('expired',{tracking:'TEST<img>'})).code,200);
  assert.match(sends[0].body.html,/TEST&lt;img&gt;/);assert.doesNotMatch(sends[0].body.html,/TEST<img>/);
});
test('database failure prevents sending',async()=>{
  const original=tracker.saveTracking;tracker.saveTracking=async()=>{throw new Error('database unavailable');};
  try{assert.equal((await request('expired')).code,503);assert.equal(sends.length,0);}finally{tracker.saveTracking=original;}
});
