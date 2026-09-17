// Vercel serverless function — POST /api/order
// CommonJS — no vercel.json or package.json required

const crypto       = require('crypto');
const fs           = require('fs');
const path         = require('path');
const BSB          = process.env.BSB_NUMBER      || process.env.bsb_number;
const ACCOUNT      = process.env.ACCOUNT_NUMBER  || process.env.account_number;
const RESEND_KEY   = process.env.RESEND_API_KEY  || process.env.resend_api_key;
const CONFIRM_SECRET = process.env.CONFIRM_SECRET || process.env.confirm_secret || RESEND_KEY;
const ACCOUNT_NAME   = 'Australian Peptide Labs Store';
const BENEFICIARY_ADDRESS = process.env.BENEFICIARY_ADDRESS || process.env.beneficiary_address || '';
const OWNER_EMAIL    = 'support@aupeptidelab.com';
const ORDER_ALERT_EMAIL = 'viviantriedk@gmail.com';
const FROM_EMAIL     = 'orders@aupeptidelab.com';
const SITE_URL       = 'https://www.aupeptidelab.com';
const AIRTABLE_TOKEN    = process.env.AIRTABLE_TOKEN    || process.env.airtable_token;
const AIRTABLE_BASE     = 'appwbIeYvWxx7R9Y8';
const RESEND_AUDIENCE   = process.env.RESEND_AUDIENCE_ID || process.env.resend_audience_id;
const PRODUCT_CATALOG = {
  'PL-001': { name:'Retatrutide', size:'10mg', price:135 },
  'PL-002': { name:'BPC-157', size:'10mg', price:85 },
  'PL-003': { name:'TB-500', size:'5mg', price:79 },
  'PL-004': { name:'Tesamorelin', size:'5mg', price:95 },
  'PL-005': { name:'Semax', size:'10mg', price:69 },
  'PL-006': { name:'Selank', size:'10mg', price:59 },
  'PL-007': { name:'Deep Sleep Inducing Peptide', size:'5mg', price:49 },
  'PL-008': { name:'Melanotan-2', size:'10mg', price:69 },
  'PL-009': { name:'Melanotan-1', size:'10mg', price:69 },
  'PL-011': { name:'NAD+', size:'500mg', price:75 },
  'PL-012': { name:'GHK-Cu', size:'50mg', price:49 },
  'PL-013': { name:'Glutathione', size:'1500mg', price:85 },
  'PL-014': { name:'BAC Water', size:'10ml', price:19 },
  'PL-015': { name:'Research Starter Kit', size:'1 kit', price:29 },
};
const PROMO_CODES = { VIVIAN: { type:'percent', value:10 } };
const FREE_SHIP_THRESHOLD = 200;
const MIX_BUNDLE_ID = 'PL-MIX-10';

function bundleSelection(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) throw new Error('Invalid bundle');
  const selections = raw.map(selection => {
    const product = PRODUCT_CATALOG[selection.id];
    const qty = Number(selection.qty);
    if (!product || ['PL-014', 'PL-015'].includes(selection.id) || !Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error('Invalid bundle');
    return { id:selection.id, name:product.name, size:product.size, price:product.price, qty };
  });
  if (selections.reduce((sum, item) => sum + item.qty, 0) !== 10 || new Set(selections.map(item => item.id)).size !== selections.length) throw new Error('Invalid bundle');
  return selections;
}

function paymentDetails(method) {
  if (method === 'intl') {
    return [
      { label:'Account Name', value:ACCOUNT_NAME },
      { label:'Bank', value:'Commonwealth Bank of Australia' },
      { label:'SWIFT / BIC', value:'CTBAAU2S' },
      { label:'BSB', value:BSB },
      { label:'Account No.', value:ACCOUNT },
      { label:'14-digit account', value:`${BSB || ''}${ACCOUNT || ''}`.replace(/\D/g, '') },
      { label:'Beneficiary address', value:BENEFICIARY_ADDRESS },
      { label:'Currency', value:'AUD' },
    ].filter(field => field.value);
  }
  return [
    { label:'Account Name', value:ACCOUNT_NAME },
    { label:'BSB', value:BSB },
    { label:'Account No.', value:ACCOUNT },
  ].filter(field => field.value);
}

async function addToAudience(email, firstName, lastName) {
  if (!RESEND_KEY || !RESEND_AUDIENCE) return;
  try {
    await fetch(`https://api.resend.com/audiences/${RESEND_AUDIENCE}/contacts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, first_name: firstName, last_name: lastName, unsubscribed: false }),
    });
  } catch (err) {
    console.error('Resend audience error:', err.message);
  }
}

async function logToAirtable(order) {
  if (!AIRTABLE_TOKEN) return;
  try {
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: order }] }),
    });
  } catch (err) {
    console.error('Airtable log error:', err.message);
  }
}

function makeConfirmToken(order, email, amt) {
  return crypto.createHmac('sha256', CONFIRM_SECRET)
    .update(`${order}:${email}:${amt}`)
    .digest('hex')
    .slice(0, 20);
}

function generateOrderId() {
  const number = crypto.randomInt(10_000, 100_000);
  return `PL-${number}`;
}

function validateAvailability(rawItems) {
  const inventory = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'inventory.json'), 'utf8'));
  const required = {};
  for (const item of rawItems) {
    const contents = item.id === MIX_BUNDLE_ID ? bundleSelection(item.selections) : [{ id:item.id, qty:Number(item.qty) }];
    for (const part of contents) required[part.id] = (required[part.id] || 0) + part.qty;
  }
  for (const [id, qty] of Object.entries(required)) {
    const entry = inventory[id];
    const stock = typeof entry === 'number' ? entry : entry?.stock;
    const restocking = typeof entry === 'object' && entry?.restocking === true;
    if (!PRODUCT_CATALOG[id] || !Number.isInteger(qty) || qty < 1 || !Number.isInteger(stock) || qty > stock || restocking) throw new Error('An item in your cart is currently unavailable');
  }
}

function calculateOrder(rawItems, country, shippingMethod, promoCode) {
  const items = rawItems.map(item => {
    if (item.id === MIX_BUNDLE_ID) {
      if (Number(item.qty) !== 1) throw new Error('Invalid bundle');
      const selections = bundleSelection(item.selections);
      const regularPrice = selections.reduce((sum, selection) => sum + selection.price * selection.qty, 0);
      return { id:MIX_BUNDLE_ID, name:'Mix & Match 10-Vial Set', size:'10 vials', price:Math.round(regularPrice * 75) / 100, regularPrice, selections, qty:1 };
    }
    const product = PRODUCT_CATALOG[item.id];
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error('Invalid cart item');
    return { id:item.id, ...product, qty };
  });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const individualItems = items.filter(item => item.id !== MIX_BUNDLE_ID);
  const totalQty = individualItems.reduce((sum, item) => sum + item.qty, 0);
  const individualSubtotal = individualItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const mbRate = totalQty >= 5 ? 0.10 : totalQty >= 3 ? 0.05 : totalQty >= 2 ? 0.03 : 0;
  const mbDiscount = individualSubtotal * mbRate;
  const promo = PROMO_CODES[String(promoCode || '').toUpperCase()];
  const promoDiscount = promo?.type === 'percent' ? (subtotal - mbDiscount) * promo.value / 100 : 0;
  const isExpress = String(shippingMethod || '').toLowerCase().startsWith('express');
  const baseShipping = country === 'AU' ? (isExpress ? 15 : 10)
    : country === 'NZ' ? (isExpress ? 28 : 15)
    : (isExpress ? 40 : 20);
  const shipping = subtotal >= FREE_SHIP_THRESHOLD ? (isExpress ? 5 : 0) : baseShipping;
  const discount = mbDiscount + promoDiscount;
  const total = Math.max(0, subtotal - discount) + shipping;
  return { items, subtotal, shipping, discount, total, mbDiscount, promoDiscount };
}

async function sendEmail(to, subject, html, orderName, role) {
  if (!RESEND_KEY) throw new Error('Email service is not configured');
  const payload = JSON.stringify({
    from: `PeptideLab <${FROM_EMAIL}>`, reply_to: OWNER_EMAIL, to, subject, html,
    tags: [{ name:'order', value:orderName }, { name:'role', value:role }],
  });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers: {
          Authorization:`Bearer ${RESEND_KEY}`,
          'Content-Type':'application/json',
          'Idempotency-Key':`${role}/${orderName}`,
        },
        body:payload,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.id) {
        console.info('Order email accepted', JSON.stringify({ orderName, role, emailId:body.id }));
        return body.id;
      }
      lastError = new Error(`Resend ${response.status}: ${body.message || body.name || 'No email ID returned'}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw lastError;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!CONFIRM_SECRET || !RESEND_KEY) return res.status(500).json({ error: 'Order email service unavailable' });
  if (!BSB || !ACCOUNT) return res.status(500).json({ error: 'Payment details unavailable' });

  const {
    email, firstName, lastName,
    address1, address2, suburb, state, postcode, country, phone,
    items: rawItems, promoCode, shippingMethod, marketingConsent,
  } = req.body;

  if (!email || !firstName || !lastName || !address1 || !suburb || !postcode || !rawItems?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email)) || !/^[A-Z]{2}$/.test(String(country || ''))) {
    return res.status(400).json({ error: 'Invalid customer details' });
  }

  const paymentMethod = country === 'AU' ? 'aud' : 'intl';
  const paymentLabel = paymentMethod === 'intl' ? 'International Wire Transfer (SWIFT)' : 'Australian Bank Transfer';
  const paymentFields = paymentDetails(paymentMethod);
  const paymentRowsHtml = paymentFields.map(field => `
        <tr><td style="padding:6px 0;color:#555;font-size:14px;width:44%">${field.label}</td><td style="padding:6px 0;font-weight:700;font-size:14px">${field.value}</td></tr>`).join('');

  let calculated;
  try {
    validateAvailability(rawItems);
    calculated = calculateOrder(rawItems, country, shippingMethod, promoCode);
  } catch {
    return res.status(400).json({ error: 'Invalid cart' });
  }
  const { items, subtotal, shipping, discount, total, mbDiscount, promoDiscount } = calculated;

  const orderName = generateOrderId();

  const paymentWindowHours = paymentMethod === 'intl' ? 72 : 24;
  const deadline = new Date(Date.now() + paymentWindowHours * 60 * 60 * 1000);
  const deadlineStr = deadline.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const reorderData = encodeURIComponent(Buffer.from(JSON.stringify(items.map(i => ({ id: i.id, qty: i.qty, ...(i.selections ? { selections:i.selections.map(s => ({ id:s.id, qty:s.qty })) } : {}) })))).toString('base64'));

  const totalQty = items.filter(i => i.id !== MIX_BUNDLE_ID).reduce((s, i) => s + i.qty, 0);
  const bundleTier = totalQty >= 5 ? '5+ item bundle — 10% off'
    : totalQty >= 3 ? '3+ item bundle — 5% off'
    : totalQty >= 2 ? '2 item bundle — 3% off'
    : null;
  const mbD    = Number(mbDiscount)    || 0;
  const promoD = Number(promoDiscount) || 0;
  const gotFreeShipping = Number(shipping) === 0 && Number(subtotal) >= 200;
  const subItems = (items || []).filter(i => i.subscription);

  const orderRecord = {
    'Name':orderName,
    'Customer':`${firstName} ${lastName}`,
    'Email':email,
    'Phone':phone || '',
    'Address':`${address1}${address2 ? ', ' + address2 : ''}, ${suburb} ${state || ''} ${postcode}, ${country}`,
    'Items':items.map(i => `${i.name}${i.size ? ` (${i.size})` : ''}${i.subscription ? ' [MONTHLY SUB]' : ''} x${i.qty} — A$${(i.price * i.qty).toFixed(2)}${i.selections ? ` [${i.selections.map(s => `${s.name} (${s.size}) x${s.qty}`).join(', ')}]` : ''}`).join('\n'),
    'Subtotal':Number(subtotal),
    'Bundle Tier':bundleTier || 'None',
    'Bundle Discount':mbD,
    'Promo Code':promoCode || '',
    'Promo Discount':promoD,
    'Discount':Number(discount) || 0,
    'Free Standard Shipping':gotFreeShipping ? 'Yes' : 'No',
    'Shipping':Number(shipping),
    'Total':Number(total),
    'Subscriptions':subItems.length > 0 ? subItems.map(i => `${i.name}${i.size ? ` (${i.size})` : ''} x${i.qty}`).join(', ') : 'None',
    'Payment Method':paymentLabel || paymentMethod,
    'Status':'Pending Payment',
    'Date':new Date().toISOString(),
  };
  const intelRows = [
    bundleTier && mbD > 0
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9fe;font-size:13px"><span style="color:#555">Bundle</span><span style="font-weight:700;color:#7c3aed">${bundleTier} · −A$${mbD.toFixed(2)}</span></div>`
      : null,
    gotFreeShipping
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9fe;font-size:13px"><span style="color:#555">Free Standard Shipping</span><span style="font-weight:700;color:#16a34a">Applied — order of $200+</span></div>`
      : `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9fe;font-size:13px"><span style="color:#555">Free Standard Shipping</span><span style="color:#aaa">${Number(subtotal) >= 200 ? 'Eligible; express upgrade selected' : `Not yet (A$${Number(subtotal).toFixed(2)} order)`}</span></div>`,
    promoCode && promoD > 0
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9fe;font-size:13px"><span style="color:#555">Promo Code</span><span style="font-weight:700;color:#dc2626">${promoCode} · −A$${promoD.toFixed(2)}</span></div>`
      : promoCode
        ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9fe;font-size:13px"><span style="color:#555">Promo Code</span><span style="font-weight:700;color:#dc2626">${promoCode}</span></div>`
        : null,
    subItems.length > 0
      ? `<div style="padding:6px 0;font-size:13px"><span style="color:#555">Monthly Subscriptions</span><div style="margin-top:4px">${subItems.map(i => `<div style="font-weight:700;color:#6366f1;margin-left:8px">· ${i.name}${i.size ? ` (${i.size})` : ''} × ${i.qty}</div>`).join('')}</div></div>`
      : `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:#555">Subscription</span><span style="color:#aaa">None — one-time purchase</span></div>`,
  ].filter(Boolean).join('');

  const intelBox = `
    <div style="background:#f8f4ff;border:1px solid #ddd6fe;border-radius:8px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Order Details</div>
      ${intelRows}
    </div>`;

  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${i.name}${i.size ? ` — ${i.size}` : ''}${i.selections ? `<div style="font-size:12px;color:#555;margin-top:4px">${i.selections.map(s => `${s.name} (${s.size}) × ${s.qty}`).join(', ')}</div>` : ''}${i.subscription ? ' <span style="display:inline-block;background:#6366f1;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle">MONTHLY</span>' : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:14px">x${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px">A$${(i.price * i.qty).toFixed(2)}</td>
    </tr>`).join('');

  const reminderEmailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;background:#fff8e1;border:2px solid #ffe082;border-radius:50px;padding:8px 20px;margin-bottom:20px">
      <span style="color:#b45309;font-weight:700;font-size:14px">⏰ Payment Reminder</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Your order is waiting, ${firstName}!</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px">We noticed payment hasn't been received yet for order <strong>${orderName}</strong>. Please transfer as soon as possible to avoid cancellation.</p>
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:22px;margin:0 0 24px">
      <h2 style="font-size:16px;font-weight:700;color:#111;margin:0 0 16px">${paymentMethod === 'intl' ? 'International Wire Transfer (SWIFT)' : 'Bank Transfer Details'}</h2>
      <table style="width:100%;border-collapse:collapse">
        ${paymentRowsHtml}
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Amount</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#16a34a">A$${Number(total).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Reference</td><td style="padding:6px 0;font-weight:800;font-size:15px;color:#dc2626">${orderName}</td></tr>
      </table>
      ${paymentMethod === 'intl' ? `<div style="margin-top:10px;font-size:12px;line-height:1.6;color:#555">Send in AUD and choose a fee option that ensures the full total reaches us. International transfers may take 1–3 business days.</div>` : ''}
    </div>
    <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  // ── Send reminder first so we have its ID for the owner confirm-link ──
  let reminderId = '';
  try {
    const reminderRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `PeptideLab <${FROM_EMAIL}>`,
        reply_to: OWNER_EMAIL,
        to: email,
        subject: `Reminder: Payment still pending — Order ${orderName}`,
        html: reminderEmailHtml,
        scheduled_at: new Date(Date.now() + (paymentMethod === 'intl' ? 48 : 12) * 60 * 60 * 1000).toISOString(),
      }),
    });
    if (reminderRes.ok) {
      const rj = await reminderRes.json();
      reminderId = rj.id || '';
    }
  } catch (err) {
    console.error('Reminder email error:', err);
  }

  const customerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 6px">Order Received — Payment Required</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px">Hi ${firstName}, thank you for your order. Please complete your ${paymentMethod === 'intl' ? 'international wire transfer within 72 hours' : 'bank transfer within 24 hours'} to confirm it.</p>

    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 16px;margin:0 0 24px">
      <div style="font-size:13px;font-weight:700;color:#b45309">PAYMENT DUE BY ${deadlineStr.toUpperCase()} (AEST)</div>
      <div style="font-size:13px;color:#92400e;margin-top:4px">Your order will be cancelled if payment is not received in time.${paymentMethod === 'intl' ? ' International transfers may take 1–3 business days to clear.' : ''}</div>
    </div>

    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;background:#fafafa">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Order Reference</div>
      <div style="font-size:28px;font-weight:800;color:#111;letter-spacing:-1px">${orderName}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin:0 0 8px">${itemsHtml}</table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 28px">
      <tr><td style="padding:6px 0;color:#666;font-size:14px">Subtotal</td><td style="padding:6px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td></tr>
      ${Number(discount) > 0 ? `<tr><td style="padding:6px 0;color:#16a34a;font-size:14px">Discount${promoCode ? ` (${promoCode})` : ''}</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#16a34a">−A$${Number(discount).toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#666;font-size:14px">Shipping${shippingMethod ? `<div style="font-size:11px;color:#999;margin-top:2px">${shippingMethod}</div>` : ''}</td><td style="padding:6px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : 'A$' + Number(shipping).toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700;font-size:16px;border-top:2px solid #111">Total Due</td><td style="padding:10px 0;text-align:right;font-weight:800;font-size:18px;color:#111;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td></tr>
    </table>

    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:22px;margin:0 0 24px">
      <h2 style="font-size:16px;font-weight:700;color:#111;margin:0 0 16px">${paymentMethod === 'intl' ? 'International Wire Transfer (SWIFT)' : 'Bank Transfer Details'}</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#555;font-size:14px;width:44%">Account Name</td><td style="padding:6px 0;font-weight:700;font-size:14px">${ACCOUNT_NAME}</td></tr>
        ${paymentMethod === 'intl' ? `
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Bank</td><td style="padding:6px 0;font-weight:700;font-size:14px">Commonwealth Bank of Australia</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">SWIFT / BIC</td><td style="padding:6px 0;font-weight:700;font-size:14px">CTBAAU2S</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">BSB</td><td style="padding:6px 0;font-weight:700;font-size:14px">${BSB}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Account No.</td><td style="padding:6px 0;font-weight:700;font-size:14px">${ACCOUNT}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">14-digit account</td><td style="padding:6px 0;font-weight:700;font-size:14px">${`${BSB || ''}${ACCOUNT || ''}`.replace(/\D/g, '')}</td></tr>
        ${BENEFICIARY_ADDRESS ? `<tr><td style="padding:6px 0;color:#555;font-size:14px">Beneficiary address</td><td style="padding:6px 0;font-weight:700;font-size:14px">${BENEFICIARY_ADDRESS}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Currency</td><td style="padding:6px 0;font-weight:700;font-size:14px">AUD</td></tr>
        ` : `
        <tr><td style="padding:6px 0;color:#555;font-size:14px">BSB</td><td style="padding:6px 0;font-weight:700;font-size:14px">${BSB}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Account Number</td><td style="padding:6px 0;font-weight:700;font-size:14px">${ACCOUNT}</td></tr>
        `}
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Amount</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#16a34a">A$${Number(total).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Reference</td><td style="padding:6px 0;font-weight:800;font-size:15px;color:#dc2626">${orderName}</td></tr>
      </table>
      <div style="margin-top:14px;padding:10px 12px;background:#dcfce7;border-radius:6px;font-size:13px;color:#166534">Always use <strong>${orderName}</strong> as your payment reference.</div>
      ${paymentMethod === 'intl' ? `<div style="margin-top:10px;font-size:12px;line-height:1.6;color:#555">Send in AUD. Choose a fee option that ensures the full total reaches the recipient. Australia does not use IBAN; if your bank requires one, enter the 14-digit BSB + account number without spaces. If your bank requires a beneficiary address and none is shown, contact support before sending.</div>` : ''}
    </div>

    <p style="color:#666;font-size:13px;margin:0 0 8px">Once your payment clears, your order will be dispatched within 1-2 business days. A <strong>dispatch confirmation email</strong> with your tracking number will be sent when your order ships.</p>
    <div style="margin:0 0 16px;padding:12px 16px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;font-size:13px;color:#3730a3">
      📦 <strong>To track your order:</strong> Visit <a href="https://www.aupeptidelab.com" style="color:#3730a3">aupeptidelab.com</a> → Track Order, and enter your tracking number from the dispatch email.
    </div>
    <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#111;padding:20px 32px">
    <div style="color:#fff;font-size:17px;font-weight:700">New Order — ${orderName}</div>
    <div style="color:#aaa;font-size:13px;margin-top:2px">A$${Number(total).toFixed(2)} — Awaiting ${paymentMethod === 'intl' ? 'SWIFT Transfer' : 'Bank Transfer'}</div>
  </div>
  <div style="padding:28px 32px">
    <div style="margin-bottom:20px">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Customer</div>
      <div style="font-size:14px;font-weight:700">${firstName} ${lastName}</div>
      <div style="font-size:13px;color:#555">${email}${phone ? ' · ' + phone : ''}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">${address1}${address2 ? ', ' + address2 : ''}, ${suburb} ${state || ''} ${postcode}, ${country}</div>
    </div>

    <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Items</div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">${itemsHtml}
      <tr><td style="padding:8px 0;color:#666;font-size:14px">Subtotal</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td></tr>
      ${mbD > 0 ? `<tr><td style="padding:8px 0;color:#7c3aed;font-size:14px">Bundle discount</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px;color:#7c3aed">−A$${mbD.toFixed(2)}</td></tr>` : ''}
      ${promoD > 0 ? `<tr><td style="padding:8px 0;color:#16a34a;font-size:14px">Promo (${promoCode})</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px;color:#16a34a">−A$${promoD.toFixed(2)}</td></tr>` : ''}
      ${mbD === 0 && promoD === 0 && Number(discount) > 0 ? `<tr><td style="padding:8px 0;color:#16a34a;font-size:14px">Discount${promoCode ? ` (${promoCode})` : ''}</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px;color:#16a34a">−A$${Number(discount).toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666;font-size:14px">Shipping${shippingMethod ? `<div style="font-size:11px;color:#999;margin-top:2px">${shippingMethod}</div>` : ''}</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : 'A$' + Number(shipping).toFixed(2)}</td></tr>
      <tr><td style="padding:12px 0;font-weight:800;font-size:16px;border-top:2px solid #111">TOTAL</td><td style="border-top:2px solid #111"></td><td style="padding:12px 0;text-align:right;font-weight:800;font-size:18px;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td></tr>
    </table>

    ${intelBox}

    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:#92400e">Expires: ${deadlineStr} AEST</div>
      <div style="font-size:13px;color:#78350f;margin-top:4px">Watch for a transfer with reference <strong>${orderName}</strong>. Once payment clears, click below to notify the customer.</div>
    </div>

    <div style="text-align:center">
      <a href="${SITE_URL}/api/confirm-payment?order=${encodeURIComponent(orderName)}&email=${encodeURIComponent(email)}&amt=${encodeURIComponent(total)}&name=${encodeURIComponent(firstName + ' ' + lastName)}&token=${makeConfirmToken(orderName, email, String(total))}&items=${reorderData}${reminderId ? '&reminder_id=' + encodeURIComponent(reminderId) : ''}"
        style="display:inline-block;background:#16a34a;color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none">
        ✓ Confirm Payment Received
      </a>
      <div style="font-size:12px;color:#999;margin-top:8px">Clicking this sends a dispatch confirmation email to the customer.</div>
    </div>
  </div>
</div>
</body></html>`;

  const ownerSubject = `New Order ${orderName} — A$${Number(total).toFixed(2)} (${paymentMethod === 'intl' ? 'SWIFT' : 'bank transfer'} pending)`;
  const [customerResult, ownerResult] = await Promise.allSettled([
    sendEmail(email, `Order ${orderName} — Complete Your Bank Transfer`, customerHtml, orderName, 'customer'),
    (async () => {
      try {
        return await sendEmail(ORDER_ALERT_EMAIL, ownerSubject, ownerHtml, orderName, 'owner-direct');
      } catch (error) {
        console.error('Direct owner alert failed; trying support inbox', JSON.stringify({ orderName, reason:error.message }));
        return sendEmail(OWNER_EMAIL, ownerSubject, ownerHtml, orderName, 'owner-forwarding-fallback');
      }
    })(),
  ]);
  const customerEmailAccepted = customerResult.status === 'fulfilled';
  const storeAlertAccepted = ownerResult.status === 'fulfilled';
  if (!customerEmailAccepted) console.error('Customer order email failed', JSON.stringify({ orderName, reason:customerResult.reason?.message }));
  if (!storeAlertAccepted) console.error('Store order alert failed', JSON.stringify({ orderName, reason:ownerResult.reason?.message }));

  if (marketingConsent) addToAudience(email, firstName, lastName);
  logToAirtable(orderRecord);

  return res.status(200).json({ orderName, total, paymentMethod, paymentLabel, paymentFields, bsb: BSB, acct: ACCOUNT, customerEmailAccepted, storeAlertAccepted });
};
if (process.env.NODE_ENV === 'test') module.exports._pricing = { calculateOrder, validateAvailability };
