// Dependency-free regression checks. Never submits an order or sends email.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
for (const script of scripts) new vm.Script(script[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML ids must be unique');
for (const match of html.matchAll(/(?:src|href)="(\/?(?:images\/[^"?]+|styles\.css))/g)) {
  assert.ok(fs.existsSync(path.join(root, match[1].replace(/^\//, ''))), match[1]);
}
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false,
    classList: {add(){}, remove(){}, toggle(){}, contains(){return false;}},
    setAttribute(){}, getAttribute(){return '';}, focus(){}, querySelectorAll(){return [];}
  });
  return elements.get(id);
}
const storage = new Map();
const context = vm.createContext({
  console, Date, URLSearchParams,
  document: {getElementById:element, querySelectorAll(){return [];}, querySelector(){return null;}, addEventListener(){}, body:{style:{}}},
  window: {addEventListener(){}, scrollTo(){}},
  history:{pushState(){},replaceState(){}},
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  setTimeout(){}, clearTimeout(){}
});
vm.runInContext(scripts.at(-1)[1].split('// INIT')[0],context);
context.assert = assert;
vm.runInContext(`
  // Stub display-only notifications; every business calculation remains real.
  showToast = () => {};
  document.getElementById('homeShipZone').value='AU';
  document.getElementById('homeShipSubtotal').value='200';
  document.getElementById('pdpShipZone').value='AU';
  const expected={'PL-003':79,'PL-005':69,'PL-006':69,'PL-008':69,'PL-009':69,'PL-011':75,'PL-013':85,'PL-012':49,'PL-001':135};
  for(const [id,price] of Object.entries(expected)) assert.equal(PRODUCTS.find(p=>p.id===id).price,price,id);
  assert.equal(PRODUCTS.find(p=>p.id==='PL-011').specs.find(r=>r[0]==='Quantity')[1],'500mg per vial');
  for(const [zone,standard,express] of [['AU',10,15],['NZ',15,28],['INTL',20,40]]) {
    assert.equal(coShipPrice(SHIP_ZONES[zone][0],199.99),standard);
    assert.equal(coShipPrice(SHIP_ZONES[zone][1],199.99),express);
    assert.equal(coShipPrice(SHIP_ZONES[zone][0],200),0);
    assert.equal(coShipPrice(SHIP_ZONES[zone][1],200),5);
  }
  assert.equal(getShippingCost(100,'NZ'),15);
  renderHomeShipping(); assert.match(document.getElementById('homeShipRates').innerHTML,/Free/);
  document.getElementById('homeShipSubtotal').value='-1';renderHomeShipping();
  assert.match(document.getElementById('homeShipRates').textContent,/valid/);
  renderFeatured(); assert.match(document.getElementById('featuredGrid').innerHTML,/BPC-157/);
  document.getElementById('catalogSearch').value='ghkcu';renderShop();
  assert.match(document.getElementById('catalogCount').textContent,/1 product/);
  document.getElementById('catalogSearch').value='not-a-product';renderShop();
  assert.match(document.getElementById('shopGrid').innerHTML,/Reset filters/);
  document.getElementById('catalogSearch').value='';document.getElementById('catalogSort').value='low';renderShop();
  assert.ok(document.getElementById('shopGrid').innerHTML.indexOf('BAC Water')<document.getElementById('shopGrid').innerHTML.indexOf('GHK-Cu'));
  inventory={'PL-012':0};document.getElementById('catalogInStock').checked=true;renderShop();
  assert.ok(!document.getElementById('shopGrid').innerHTML.includes('/products/ghk-cu'));
  for(const id of ['PL-012','PL-002','PL-003','PL-001'])toggleCompare(id,{checked:true});
  assert.equal(comparedIds.length,3); assert.match(document.getElementById('comparePanel').innerHTML,/50mg/);
  clearComparison(); assert.equal(document.getElementById('comparePanel').hidden,true);
  inventory={'PL-012':3}; currentProduct=PRODUCTS.find(p=>p.id==='PL-012');
  pdpQuantity=2;renderPdpSelection();
  assert.match(document.getElementById('pdpSelectionPrice').textContent,/95.06/);
  assert.match(document.getElementById('pdpShippingEstimate').innerHTML,/105.06/);
  addToCart('PL-012',2); assert.equal(getCartCount(),2);
  addToCart('PL-012',2); assert.equal(getCartCount(),2,'stock limit');
  changeQty(0,1);assert.equal(getCartCount(),3);
  changeQty(0,1);assert.equal(getCartCount(),3,'quantity button stock limit');
  localStorage.setItem('pl-cart-v1',JSON.stringify({saved:Date.now(),items:[{id:'PL-012',qty:2,price:1},{id:'bad',qty:99},{id:'PL-002',qty:-1}]}));
  restoreLocalCart();assert.equal(getCartTotal(),98,'stored cart is repriced');
  assert.equal(cart.length,1);
  localStorage.setItem('pl-cart-v1','broken json');restoreLocalCart();
  currentCurrency='USD';setSpotlight('PL-002');assert.match(document.getElementById('spotlightPrice').textContent,/55.25/);
  currentCurrency='AUD';
  cart=[{id:'PL-012',name:'GHK-Cu',size:'50mg',price:49,qty:4},{id:'PL-014',name:'BAC Water',size:'10ml',price:19,qty:1}];
  renderCart();assert.equal(getCartTotal(),215);assert.equal(getMultibuyDiscount(),.1);
  assert.match(document.getElementById('freeShipMsg').innerHTML,/unlocked/);
  assert.equal(coShipPrice(SHIP_ZONES.AU[0],getCartTotal()),0,'threshold uses pre-discount subtotal');
  assert.ok(!document.getElementById('cartSuggestionsEl').innerHTML.includes('+ Add'),'no duplicate accessory upsell');
`,context);
const server = vm.createContext({require,process:{env:{}},module:{exports:{}},console});
vm.runInContext(fs.readFileSync(path.join(root,'api/order.js'),'utf8')+'\nthis.catalog=PRODUCT_CATALOG;this.calculate=calculateOrder;',server);
const products = vm.runInContext('PRODUCTS',context);
for(const product of products) {
  assert.equal(server.catalog[product.id].price,product.price,'server price '+product.id);
  assert.equal(server.catalog[product.id].size,product.size,'server size '+product.id);
}
for(const country of ['AU','NZ','US']) for(const shipping of ['Standard','Express']) for(const qty of [1,2,3,5]) {
  const result=server.calculate([{id:'PL-012',qty,price:1}],country,shipping,'');
  context.qtyForTest=qty;context.countryForTest=country;context.shipForTest=shipping;
  const expected=vm.runInContext(`49*qtyForTest*(1-quantityDiscount(qtyForTest))+coShipPrice(SHIP_ZONES[countryForTest==='US'?'INTL':countryForTest][shipForTest==='Express'?1:0],49*qtyForTest)`,context);
  assert.ok(Math.abs(result.total-expected)<.00001,'server/frontend total parity');
}
console.log('PASS: HTML/assets, all server prices/sizes, shipping in three regions, search/sort/filter, compare limit, quantity savings, stock limits, cart restore/repricing, currency, accessory and free-shipping rules.');
