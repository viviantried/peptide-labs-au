const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tracker = require('./tracker');
const commasCatalog = require('./commas-catalog');

const payments = require('./commas-payment');
const CHECKOUT_COUNTRIES = new Set(['AU','NZ','US','GB','CA','DE','FR','JP','SG','HK','IE','IT','ES','NL','SE','NO','DK','FI','CH','AT','BE','PT','PL','GR','CZ','RO','HU','SK','HR','BG','LT','LV','EE','MT','CY','LU','SI','KR','TW','MY','TH','PH','ID','VN','IN','AE','SA','IL','ZA','MX','BR','AR','CL','CO']);

function checkoutOrderId() {
  return `PL-${crypto.randomInt(10_000, 100_000)}`;
}

function validText(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function bankDetails(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const methods = [];
  const bsb = process.env.BSB_NUMBER || process.env.bsb_number;
  const account = process.env.ACCOUNT_NUMBER || process.env.account_number;
  const accountName = process.env.BANK_ACCOUNT_NAME || 'Australian Peptide Labs Store';
  const payidValue = process.env.PAYID_VALUE || process.env.payid_value;
  const payidType = process.env.PAYID_TYPE || process.env.payid_type || 'PayID';
  const bank = bsb && account ? { accountName, bsb, accountNumber:account } : null;
  const payid = payidValue ? { value:payidValue, type:payidType, accountName } : null;

  if (bank) {
    methods.push({
      id:'aud', label:'Australian Bank Transfer', currency:'AUD',
      fields:[
        { label:'Account Name', value:accountName },
        { label:'BSB', value:bsb },
        { label:'Account No.', value:account },
      ],
    });
    methods.push({
      id:'intl', label:'International Transfer via Wise / Revolut', currency:'AUD',
      fields:[
        { label:'Account Name', value:accountName },
        { label:'BSB', value:bsb },
        { label:'Account No.', value:account },
      ],
    });
  }

  return res.status(200).json({ methods, paymentDetails:{ bank, payid, preferredMethod:payid ? 'payid' : 'bank' } });
}

async function inventory(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (tracker.enabled()) {
      const rows = await tracker.inventory();
      return res.status(200).json({
        stock:Object.fromEntries(rows.map(row => [row.sku, row.available])),
        restocking:Object.fromEntries(rows.map(row => [row.sku, row.restocking])),
      });
    }
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'inventory.json'), 'utf8'));
    const stock = {};
    const restocking = {};
    for (const [id, value] of Object.entries(raw)) {
      stock[id] = typeof value === 'number' ? value : value.stock ?? 0;
      restocking[id] = typeof value === 'number' ? false : value.restocking ?? false;
    }
    return res.status(200).json({ stock, restocking });
  } catch {
    return res.status(500).json({ error:'Could not read inventory', stock:{}, restocking:{} });
  }
}

async function commasStatus(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  const { orderName, token } = req.body || {};
  if (!/^PL-\d{5}$/.test(orderName || '') || !/^[a-f0-9]{64}$/.test(token || '')) return res.status(400).json({ error:'Invalid reference' });
  try {
    const order = await tracker.find(orderName);
    const expected = order?.details?.commas?.statusToken;
    if (!expected || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return res.status(404).json({ error:'Order not found' });
    return res.status(200).json({ status:order.status, orderName:order.id, total:order.details.total });
  } catch {
    return res.status(503).json({ error:'Payment status unavailable' });
  }
}

async function commasCheckout(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ currency:commasCatalog.CURRENCY, version:commasCatalog.VERSION, products:commasCatalog.PRODUCTS });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  const apiKey = process.env.COMMAS_API_KEY;
  if (!apiKey) return res.status(503).json({ error:'Card checkout is not configured yet' });
  const body = req.body || {};
  if (body.currency !== commasCatalog.CURRENCY || body.checkoutVersion !== commasCatalog.VERSION) {
    return res.status(409).json({error:'Checkout has been updated to AUD. Please refresh this page before paying.', code:'CHECKOUT_UPDATED'});
  }
  const required = [body.email, body.firstName, body.lastName, body.address1, body.city, body.postcode];
  if (!required.every(value => validText(value)) || !/^\S+@\S+\.\S+$/.test(body.email) || !CHECKOUT_COUNTRIES.has(body.country)) {
    return res.status(400).json({ error:'Please complete all required customer and delivery fields' });
  }
  if ([body.address2, body.state, body.phone, body.promoCode, body.shippingId].some(value => value != null && typeof value !== 'string') || (body.shippingProtection != null && typeof body.shippingProtection !== 'boolean')) {
    return res.status(400).json({ error:'Invalid customer details' });
  }

  let calculated;
  try { calculated = commasCatalog.calculate(body.items, body.country, body.shippingId, body.promoCode, body.shippingProtection); }
  catch { return res.status(400).json({ error:'Invalid cart' }); }
  if (!Number.isSafeInteger(body.expectedTotalCents) || body.expectedTotalCents !== calculated.amountCents) {
    return res.status(409).json({error:'Your order total has changed. Please refresh checkout to review the AUD total.', code:'TOTAL_CHANGED'});
  }

  if (!tracker.enabled()) return res.status(503).json({error:'Order tracking is unavailable. Please try again shortly.'});

  const checkoutKey = validText(body.checkoutKey, 100) && /^[a-zA-Z0-9-]{20,100}$/.test(body.checkoutKey)
    ? body.checkoutKey : crypto.randomUUID();
  const address = [body.address1, body.address2, body.city, body.state, body.postcode, body.country].filter(Boolean).join(', ');
  const itemSummary = calculated.items.map(item => `${item.qty}x ${item.name} ${item.size}`).join('; ') + (calculated.shippingProtection ? '; Shipping protection' : '');
  const details = {
    email:body.email, firstName:body.firstName, lastName:body.lastName, phone:body.phone || '',
    address1:body.address1, address2:body.address2 || '', suburb:body.city, state:body.state || '', postcode:body.postcode, country:body.country,
    items:calculated.items, subtotal:calculated.subtotal, shipping:calculated.shipping,
    discount:calculated.multibuyDiscount + calculated.promoDiscount, total:calculated.total,
    promoCode:body.promoCode || '', shippingMethod:calculated.shippingMethod,
    shippingProtection:calculated.shippingProtection, shippingProtectionPrice:calculated.shippingProtectionPrice,
    paymentMethod:'commas', paymentLabel:'Card payment', currency:commasCatalog.CURRENCY,
  };

  let reference = checkoutOrderId();
  let saved;
  try {
    if (tracker.enabled()) {
      for (let attempt = 0; ; attempt++) {
        try {
          saved = await tracker.create(reference, checkoutKey, details, calculated.items);
          reference = saved.id;
          break;
        } catch (error) {
          if (error.code !== '23505' || error.constraint !== 'pl_orders_pkey' || attempt >= 9) throw error;
          reference = checkoutOrderId();
        }
      }
    }
  } catch (error) {
    if (/OUT_OF_STOCK/.test(error.message)) return res.status(409).json({ error:'An item in your cart is currently unavailable' });
    if (/IDEMPOTENCY_CONFLICT/.test(error.message)) return res.status(409).json({ error:'This checkout was already started. Refresh the page to try again.' });
    return res.status(503).json({ error:'Could not reserve your items. Please try again.' });
  }
  if (saved?.replayed) {
    try {
      const order = await tracker.find(reference);
      const payment = order?.details?.commas;
      if (order.status !== 'pending' || !payment?.embed || payment.currency !== 'AUD' || payment.amountCents !== calculated.amountCents) throw new Error('CHECKOUT_NOT_PAYABLE');
      await payments.verifySession({id:payment.productId,payment_link:payment.paymentLink},calculated.amountCents);
      return res.status(200).json({paymentLink:payment.paymentLink,reference,orderName:reference,embed:payment.embed,statusToken:payment.statusToken,total:calculated.total,amountCents:calculated.amountCents,currency:'AUD'});
    } catch { return res.status(409).json({error:'This payment is already being prepared or is no longer payable. Please keep your order reference and contact support if needed.'}); }
  }

  try {
    const origin = process.env.PUBLIC_SITE_URL || 'https://aupeptidelab.com';
    const payment = await payments.createVerifiedSession({
      product:{ title:`PeptideLab order ${reference}`, description:itemSummary.slice(0,500) },
      amount_cents:calculated.amountCents,
      type:'onetime_non_reusable',
      expiration_date:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0,10),
      success_url:`${origin}/card-checkout?success=${encodeURIComponent(reference)}`,
      metadata:{
        order_id:reference, currency:commasCatalog.CURRENCY, pricing_version:commasCatalog.VERSION, allowed_payment_methods:['card','apple_pay','google_pay'],
        customer_email:body.email, customer_name:`${body.firstName} ${body.lastName}`.slice(0,200),
        phone:String(body.phone || '').slice(0,80), shipping_address:address.slice(0,500), items:itemSummary.slice(0,1000),
      },
    });
    try { payment.embed = await payments.createEmbeddedSession(payment,reference); }
    catch (error) { try { await payments.discard({id:payment.productId}); } catch {} throw error; }
    payment.statusToken = crypto.randomBytes(32).toString('hex');
    if (tracker.enabled()) {
      try {
        await tracker.query("UPDATE pl_orders SET details=jsonb_set(details,'{commas}',$2::jsonb),updated_at=now() WHERE id=$1", [reference, JSON.stringify(payment)]);
      } catch(error) {
        try { await payments.discard({id:payment.productId}); } catch { console.error('Commas unsaved payment cleanup failed',payment.productId); }
        throw error;
      }
    }
    const paymentLink = payment.paymentLink;
    return res.status(200).json({ paymentLink, reference, orderName:reference, embed:payment.embed, statusToken:payment.statusToken, total:calculated.total, amountCents:calculated.amountCents, currency:commasCatalog.CURRENCY });
  } catch (error) {
    console.error('Commas checkout error', error.message);
    if (tracker.enabled()) {
      try { await tracker.change(reference, 'cancelled'); } catch {}
    }
    return res.status(502).json({ error:'Card payment could not be verified in AUD. No payment has been taken. Please use bank transfer or contact support.', code:'PAYMENT_NOT_VERIFIED' });
  }
}

module.exports = Object.freeze({ bankDetails, inventory, commasStatus, commasCheckout });
