const {test,afterEach} = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../checkout-pricing');
const payments = require('../lib/commas-payment');
const routes = require('../lib/public-routes');
const originalFetch = global.fetch;
afterEach(()=>{global.fetch=originalFetch;});

test('every storefront product and both server checkout paths share the AUD catalogue',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const products=vm.runInNewContext(html.match(/const PRODUCTS = ([\s\S]*?);\n\n\/\//)[1],{CheckoutPricing:pricing});
  assert.equal(products.length,pricing.PRODUCTS.length);
  process.env.NODE_ENV='test';const bank=require('../api/order')._pricing;delete process.env.NODE_ENV;
  for(const p of products){
    assert.equal(p.price,pricing.PRODUCT_MAP[p.id].price,p.id);
    assert.equal(bank.calculateOrder([{id:p.id,qty:1}],'NZ','nz-std').amountCents,pricing.calculate([{id:p.id,qty:1}],'NZ','nz-std').amountCents,p.id);
  }
  assert.doesNotMatch(html,/charged in USD|card in USD|Pay securely in USD/);
});

test('the reported BPC-157 order is A$85 plus A$15 NZ shipping, exactly A$100',()=>{
  const t=pricing.calculate([{id:'PL-002',qty:1,price:57}],'NZ','nz-std');
  assert.equal(t.currency,'AUD');assert.equal(t.subtotal,85);assert.equal(t.shipping,15);assert.equal(t.amountCents,10000);
});
test('shipping, protection, accessories, discounts and bundles use AUD cents',()=>{
  assert.equal(pricing.calculate([{id:'PL-002',qty:1}],'AU','au-std','',true).amountCents,10000);
  assert.equal(pricing.calculate([{id:'PL-001',qty:2}],'AU','au-exp').amountCents,26690);
  assert.equal(pricing.calculate([{id:'PL-016',qty:2}],'AU','au-std').amountCents,3000);
  assert.equal(pricing.calculate([{id:'PL-002',qty:1}],'NZ','nz-std','VIVIAN').amountCents,9150);
  assert.equal(pricing.calculate([{id:'PL-MIX-10',qty:1,selections:[{id:'PL-002',qty:10}]}],'AU','au-std').amountCents,63750);
});
test('rejects invalid shipping and duplicate cart lines',()=>{
  assert.throws(()=>pricing.calculate([{id:'PL-002',qty:1}],'NZ','au-std'));
  assert.throws(()=>pricing.calculate([{id:'PL-002',qty:1},{id:'PL-002',qty:1}],'NZ','nz-std'));
});
function mockProvider({currency='AUD',amount=100,missingCurrency=false,encoded='abc12',unavailable=false}={}){
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    let data;
    if(options.method==='DELETE')data={status:'success',data:[]};
    else if(options.method==='POST')data={status:'success',data:{id:'abc12',payment_link:'https://commas.com/checkout/abc12token'}};
    else if(url.includes('/public-api/'))data={status:'success',data:{amount_cents:10000,product:{id:123}}};
    else data={success:!unavailable,data:{product:{currency:missingCurrency?undefined:currency,encoded_product_id:encoded},billing:{total_chargeable_amount:amount},organization:{handle:'australian-1'}}};
    return {ok:true,json:async()=>data};
  };
  return calls;
}
test('returns a payment link only after verifying actual AUD100 at Commas',async()=>{
  const calls=mockProvider();const p=await payments.createVerifiedSession({amount_cents:10000,metadata:{currency:'AUD'}});
  assert.equal(p.currency,'AUD');assert.equal(p.amountCents,10000);assert.equal(calls.length,3);
  assert.equal(calls[0].body.amount_cents,10000);
});
for(const [label,options] of Object.entries({USD:{currency:'USD'},undercharge:{amount:67},overcharge:{amount:101},missingCurrency:{missingCurrency:true},wrongProduct:{encoded:'another'},unverifiable:{unavailable:true}})){
  test('blocks and retires a '+label+' session even if metadata says AUD',async()=>{
    const calls=mockProvider(options);await assert.rejects(payments.createVerifiedSession({amount_cents:10000,metadata:{currency:'AUD'}}));
    assert.equal(calls.at(-1).method,'DELETE');
  });
}
function response(){return {setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
test('old browser checkout and an altered amount are blocked before creating payments',async()=>{
  process.env.COMMAS_API_KEY='test-only';
  global.fetch=async()=>{throw new Error('MUST_NOT_CALL_PROVIDER');};
  const old=response();await routes.commasCheckout({method:'POST',body:{}},old);assert.equal(old.statusCode,409);
  const wrong=response();await routes.commasCheckout({method:'POST',body:{currency:'AUD',checkoutVersion:pricing.VERSION,expectedTotalCents:6700,email:'test@example.invalid',firstName:'Test',lastName:'Validation',address1:'Test',city:'Auckland',postcode:'1010',country:'NZ',shippingId:'nz-std',items:[{id:'PL-002',qty:1}]}},wrong);
  assert.equal(wrong.statusCode,409);assert.equal(wrong.body.code,'TOTAL_CHANGED');
  delete process.env.COMMAS_API_KEY;
});
