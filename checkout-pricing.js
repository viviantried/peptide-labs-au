// One AUD price calculation shared by the shop, card checkout and order server.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CheckoutPricing = factory();
})(typeof globalThis === 'object' ? globalThis : this, function() {
'use strict';
const PRODUCTS = [
  { id:'PL-001', name:'Retatrutide', size:'10mg', price:135, image:'/images/retatrutide.jpg' },
  { id:'PL-018', name:'Retatrutide', size:'5mg', price:95, image:'/images/retatrutide.jpg' },
  { id:'PL-002', name:'BPC-157', size:'10mg', price:85, image:'/images/bpc-157.jpg' },
  { id:'PL-003', name:'TB-500', size:'5mg', price:69, image:'/images/tb-500.jpg' },
  { id:'PL-004', name:'Tesamorelin', size:'5mg', price:95, image:'/images/tesamorelin.jpg' },
  { id:'PL-005', name:'Semax', size:'10mg', price:59, image:'/images/semax.jpg' },
  { id:'PL-006', name:'Selank', size:'10mg', price:49, image:'/images/selank.jpg' },
  { id:'PL-007', name:'DSIP', size:'5mg', price:49, image:'/images/dsip.jpg' },
  { id:'PL-008', name:'Melanotan-2', size:'10mg', price:69, image:'/images/melanotan-2.jpg' },
  { id:'PL-009', name:'Melanotan-1', size:'10mg', price:69, image:'/images/melanotan-1.jpg' },
  { id:'PL-011', name:'NAD+', size:'500mg', price:65, image:'/images/nad-plus.jpg' },
  { id:'PL-012', name:'GHK-Cu', size:'50mg', price:45, image:'/images/ghk-cu.jpg' },
  { id:'PL-013', name:'Glutathione', size:'1500mg', price:75, image:'/images/glutathione.jpg' },
  { id:'PL-014', name:'BAC Water', size:'10ml', price:19, image:'/images/bac-water.jpg' },
  { id:'PL-016', name:'Research Syringes', size:'10 pack', price:10, image:'/images/syringes-10-pack.png', accessory:true },
  { id:'PL-017', name:'Research Syringes', size:'30 pack', price:25, image:'/images/syringes-10-pack.png', accessory:true },
  { id:'PL-015', name:'Research Starter Kit', size:'1 kit', price:25, image:'/images/research-starter-kit.webp' },
];

const PRODUCT_MAP = Object.fromEntries(PRODUCTS.map(product => [product.id, product]));
const PROMO_CODES = { VIVIAN:10, TIKTOK:10, INSTA:10, REORDER:15 };
const MIX_BUNDLE_ID = 'PL-MIX-10';
const MIX_EXCLUDED = new Set(['PL-014','PL-015','PL-016','PL-017','PL-018']);
const CURRENCY = 'AUD';
const VERSION = 'aud-2026-11-22-v1';
const FREE_SHIP_THRESHOLD = 200;
const SHIPPING_PROTECTION_PRICE = 5;

function shippingOptions(country) {
  if (country === 'AU') return [
    { id:'au-std', label:'Standard · 3–7 business days', price:10 },
    { id:'au-exp', label:'Express · 1–3 business days', price:15 },
  ];
  if (country === 'NZ') return [
    { id:'nz-std', label:'Standard · 6–12 business days', price:15 },
    { id:'nz-exp', label:'Express · 2–5 business days', price:28 },
  ];
  return [
    { id:'int-std', label:'Standard · 7–21 business days', price:20 },
    { id:'int-exp', label:'Express · 3–12 business days', price:40 },
  ];
}

function calculate(rawItems, country, shippingId, promoCode, shippingProtection = false) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > PRODUCTS.length + 1) throw new Error('INVALID_CART');
  const seen = new Set();
  const items = rawItems.map(item => {
    if (item.id === MIX_BUNDLE_ID) {
      if (seen.has(item.id) || Number(item.qty) !== 1 || !Array.isArray(item.selections) || item.selections.length < 1) throw new Error('INVALID_CART');
      const selectionIds = new Set();
      const selections = item.selections.map(selection => {
        const product = PRODUCT_MAP[selection.id];
        const qty = Number(selection.qty);
        if (!product || MIX_EXCLUDED.has(selection.id) || selectionIds.has(selection.id) || !Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error('INVALID_CART');
        selectionIds.add(selection.id);
        return { id:product.id, name:product.name, size:product.size, qty };
      });
      if (selections.reduce((sum, selection) => sum + selection.qty, 0) !== 10) throw new Error('INVALID_CART');
      const regular = selections.reduce((sum, selection) => sum + PRODUCT_MAP[selection.id].price * selection.qty, 0);
      seen.add(item.id);
      return { id:MIX_BUNDLE_ID, name:'Mix & Match 10-Vial Set', size:'10 vials', price:Math.round(regular * 75) / 100, qty:1, selections, bundle:true };
    }
    const product = PRODUCT_MAP[item.id];
    const qty = Number(item.qty);
    if (!product || seen.has(item.id) || !Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error('INVALID_CART');
    seen.add(item.id);
    return { ...product, qty };
  });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const eligibleItems = items.filter(item => !item.accessory && !item.bundle);
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const eligibleQuantity = eligibleItems.reduce((sum, item) => sum + item.qty, 0);
  const multibuyRate = eligibleQuantity >= 5 ? .10 : eligibleQuantity >= 3 ? .05 : eligibleQuantity >= 2 ? .03 : 0;
  const multibuyDiscount = Math.round(eligibleSubtotal * multibuyRate * 100) / 100;
  const promoRate = PROMO_CODES[String(promoCode || '').toUpperCase()] || 0;
  const promoDiscount = Math.round((subtotal - multibuyDiscount) * promoRate) / 100;
  const options = shippingOptions(country);
  const requested = String(shippingId || 'standard').toLowerCase();
  const selected = options.find(option => option.id === requested || option.label.toLowerCase() === requested || requested === (option.id.endsWith('-exp') ? 'express' : 'standard'));
  if (!selected) throw new Error('INVALID_SHIPPING');
  const shipping = subtotal >= FREE_SHIP_THRESHOLD ? Math.max(0, selected.price - options[0].price) : selected.price;
  const shippingProtectionPrice = shippingProtection === true ? SHIPPING_PROTECTION_PRICE : 0;
  const total = Math.round((subtotal - multibuyDiscount - promoDiscount + shipping + shippingProtectionPrice) * 100) / 100;
  return { currency:CURRENCY, version:VERSION, amountCents:Math.round(total * 100), items, subtotal, multibuyDiscount, mbDiscount:multibuyDiscount, promoDiscount, discount:Math.round((multibuyDiscount + promoDiscount) * 100) / 100, shipping, shippingMethodId:selected.id, shippingMethod:selected.label, shippingProtection:shippingProtection === true, shippingProtectionPrice, total };
}

return Object.freeze({ CURRENCY, VERSION, FREE_SHIP_THRESHOLD, SHIPPING_PROTECTION_PRICE, PRODUCTS, PRODUCT_MAP, PROMO_CODES, shippingOptions, calculate });
});
