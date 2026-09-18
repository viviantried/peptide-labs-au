const Stripe = require('stripe');
const zlib = require('zlib');

const BASE = 'appwbIeYvWxx7R9Y8';
const FROM = 'orders@aupeptidelab.com';
const SUPPORT = 'support@aupeptidelab.com';
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

async function sendEmail(key, to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY || process.env.resend_api_key}`, 'Content-Type':'application/json', 'Idempotency-Key':key },
    body:JSON.stringify({ from:`PeptideLab <${FROM}>`, reply_to:SUPPORT, to, subject, html }),
  });
  if (!response.ok) throw new Error(`Email service returned ${response.status}`);
}

async function savePaidOrder(session, order, name) {
  const token = process.env.AIRTABLE_TOKEN || process.env.airtable_token;
  const url = `https://api.airtable.com/v0/${BASE}/Orders`;
  const query = await fetch(`${url}?filterByFormula=${encodeURIComponent(`{Name}='${name}'`)}&maxRecords=1`, { headers:{ Authorization:`Bearer ${token}` } });
  if (!query.ok) throw new Error(`Order lookup returned ${query.status}`);
  const existing = await query.json();
  if (existing.records?.length) return;
  const fields = {
    Name:name, Customer:`${order.firstName} ${order.lastName}`, Email:order.email, Phone:order.phone,
    Address:`${order.address1}${order.address2 ? ', ' + order.address2 : ''}, ${order.suburb} ${order.state} ${order.postcode}, ${order.country}`,
    Items:order.items.map(item => `${item.name} (${item.size}) x${item.qty}${item.selections ? ` [${item.selections.map(s => `${s.name} x${s.qty}`).join(', ')}]` : ''}`).join('\n'),
    Subtotal:order.subtotal, Discount:order.discount, Shipping:order.shipping, Total:order.total,
    'Promo Code':order.promoCode, 'Payment Method':'Stripe card', Status:'Paid', Date:new Date().toISOString(),
  };
  const response = await fetch(url, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify({ records:[{ fields }] }) });
  if (!response.ok) throw new Error(`Order save returned ${response.status}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return res.status(503).end();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], secret);
  } catch { return res.status(400).json({ error:'Invalid webhook signature' }); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return res.status(200).json({ received:true });
  const session = event.data.object;
  if (session.payment_status !== 'paid' || session.currency !== 'aud' || session.mode !== 'payment') return res.status(200).json({ received:true });
  if (!(process.env.AIRTABLE_TOKEN || process.env.airtable_token) || !(process.env.RESEND_API_KEY || process.env.resend_api_key)) return res.status(503).end();
  try {
    const count = Number(session.metadata?.order_parts);
    if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('Missing order details');
    const encoded = Array.from({ length:count }, (_, i) => session.metadata[`order_${i}`] || '').join('');
    const order = JSON.parse(zlib.inflateSync(Buffer.from(encoded, 'base64')).toString('utf8'));
    if (!order.email || Math.round(order.total * 100) !== session.amount_total || session.customer_email !== order.email) throw new Error('Order amount or customer mismatch');
    const name = `PL-${session.id.slice(-10).toUpperCase()}`;
    const itemLines = order.items.map(item => `<li>${escapeHtml(item.name)} (${escapeHtml(item.size)}) × ${item.qty}</li>`).join('');
    const address = `${order.address1}${order.address2 ? ', ' + order.address2 : ''}, ${order.suburb} ${order.state} ${order.postcode}, ${order.country}`;
    const common = `<p>Order <strong>${escapeHtml(name)}</strong> · A$${Number(order.total).toFixed(2)} paid by card.</p><ul>${itemLines}</ul><p>Shipping to: ${escapeHtml(address)}</p>`;
    await sendEmail(`stripe-customer-${session.id}`, order.email, `Payment received — order ${name}`, `<p>Hi ${escapeHtml(order.firstName)}, your payment was received. We'll prepare your order for dispatch.</p>${common}<p>Questions? Reply to this email.</p>`);
    await sendEmail(`stripe-owner-${session.id}`, 'viviantriedk@gmail.com', `Paid Stripe order ${name}`, `<p>Paid order ready for fulfilment. Stripe session: ${escapeHtml(session.id)}</p><p>${escapeHtml(order.email)} · ${escapeHtml(order.phone)}</p>${common}`);
    await savePaidOrder(session, order, name);
    if (order.marketingConsent && process.env.RESEND_AUDIENCE_ID) {
      fetch(`https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`, { method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY || process.env.resend_api_key}`, 'Content-Type':'application/json' }, body:JSON.stringify({ email:order.email, first_name:order.firstName, last_name:order.lastName, unsubscribed:false }) }).catch(() => {});
    }
    return res.status(200).json({ received:true });
  } catch (error) {
    console.error('Paid Stripe order processing failed', session.id, error);
    return res.status(500).json({ error:'Paid order processing failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
