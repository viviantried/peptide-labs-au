const {test,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.TRACKER_ENABLED='true';process.env.BSB_NUMBER='000000';process.env.ACCOUNT_NUMBER='000000';process.env.CONFIRM_SECRET='test-secret';process.env.ADMIN_KEY='private-test-key';
const tracker=require('../lib/tracker');
const handler=require('../api/order');
const originalFetch=global.fetch;
let saved=[],emailUpdates=[];
beforeEach(()=>{saved=[];emailUpdates=[];tracker.expire=async()=>{};tracker.create=async(id,key,details,items)=>{saved.push({id,key,details,items});return{id,replayed:false}};tracker.setEmails=async(id,emails)=>emailUpdates.push({id,emails});global.fetch=async()=>{throw new Error('Simulated email outage')};});
after(()=>global.fetch=originalFetch);
const body=()=>({email:'test@example.invalid',firstName:'Test',lastName:'Order',address1:'Test address',suburb:'Test suburb',state:'VIC',postcode:'3000',country:'AU',items:[{id:'PL-001',qty:1}],checkoutKey:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(b){this.body=b;return this},end(){return this}}}
test('email outage still returns durable order reference and records failures',async()=>{const r=res();await handler({method:'POST',body:body()},r);assert.equal(r.statusCode,200);assert.equal(r.body.orderSaved,true);assert.equal(r.body.customerEmailAccepted,false);assert.equal(saved.length,1);assert.equal(emailUpdates[0].emails.owner,'failed')});
test('storage outage stops checkout before any email attempt',async()=>{tracker.create=async()=>{throw new Error('database offline')};let attempts=0;global.fetch=async()=>{attempts++;throw new Error('must not send')};const r=res();await handler({method:'POST',body:body()},r);assert.equal(r.statusCode,503);assert.equal(attempts,0);assert.equal(r.body.orderName,undefined)});
test('saved retry returns same reference without resending emails',async()=>{tracker.create=async()=>({id:'PL-existing',replayed:true,status:'pending',details:{total:145},emails:{customer:'failed',owner:'failed'}});let attempts=0;global.fetch=async()=>{attempts++;throw new Error('must not send')};const r=res();await handler({method:'POST',body:body()},r);assert.equal(r.statusCode,200);assert.equal(r.body.orderName,'PL-existing');assert.equal(attempts,0)});
test('invalid cart is rejected without writing a record',async()=>{const b=body();b.items=[{id:'PL-001',qty:-1}];const r=res();await handler({method:'POST',body:b},r);assert.equal(r.statusCode,400);assert.equal(saved.length,0)});
test('bundle quantities include components and individual quantities',()=>{assert.deepEqual(tracker.quantities([{id:'PL-MIX-10',qty:1,selections:[{id:'PL-001',qty:6},{id:'PL-002',qty:4}]},{id:'PL-001',qty:2}]),{'PL-001':8,'PL-002':4})});
test('admin authorization requires correct secret header',()=>{assert.equal(tracker.authorized({headers:{}}),false);assert.equal(tracker.authorized({headers:{authorization:'Bearer wrong'}}),false);assert.equal(tracker.authorized({headers:{authorization:'Bearer private-test-key'}}),true)});
