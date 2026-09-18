const Stripe = require('stripe');
const zlib = require('zlib');
const { _pricing } = require('./order');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.STRIPE_ENABLED !== 'true' || process.env.STRIPE_PRODUCT_ELIGIBLE !== 'true' || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Card payments are currently unavailable' });
  }
  const body = req.body || {};
  const { email, firstName, lastName, address1, address2, suburb, state, postcode, country, phone, items, shippingMethod, promoCode, marketingConsent } = body;
  if (![email, firstName, lastName, address1, suburb, postcode].every(value => typeof value === 'string' && value.trim()) || !/^\S+@\S+\.\S+$/.test(email) || !/^[A-Z]{2}$/.test(country || '') || !Array.isArray(items) || !items.length || items.length > 30) {
    return res.status(400).json({ error: 'Invalid customer or cart details' });
  }
  try {
    _pricing.validateAvailability(items);
    const order = _pricing.calculateOrder(items, country, shippingMethod, promoCode);
    const totalCents = Math.round(order.total * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents < 50) throw new Error('Invalid total');
    const details = { email, firstName, lastName, address1, address2:address2 || '', suburb, state:state || '', postcode, country, phone:phone || '', items:order.items, shippingMethod:shippingMethod || 'Standard', promoCode:promoCode || '', marketingConsent:!!marketingConsent, subtotal:order.subtotal, shipping:order.shipping, discount:order.discount, total:order.total };
    const encoded = zlib.deflateSync(JSON.stringify(details)).toString('base64');
    const parts = encoded.match(/.{1,480}/g) || [];
    if (parts.length > 30) throw new Error('Order details too large');
    const metadata = { order_parts:String(parts.length) };
    parts.forEach((part, index) => { metadata[`order_${index}`] = part; });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteUrl = process.env.VERCEL_ENV === 'preview' && /^[a-z0-9.-]+\.vercel\.app$/i.test(process.env.VERCEL_URL || '')
      ? `https://${process.env.VERCEL_URL}` : 'https://www.aupeptidelab.com';
    const session = await stripe.checkout.sessions.create({
      mode:'payment', payment_method_types:['card'], customer_email:email,
      client_reference_id:require('crypto').randomUUID(),
      line_items:[{ price_data:{ currency:'aud', unit_amount:totalCents, product_data:{ name:'PeptideLab order', description:`${order.items.length} cart item(s), shipping and discounts included` } }, quantity:1 }],
      metadata,
      success_url:`${siteUrl}/?stripe_return=success`,
      cancel_url:`${siteUrl}/?stripe_return=cancel`,
    });
    return res.status(200).json({ url:session.url });
  } catch (error) {
    if (/Invalid|unavailable|too large/.test(error.message)) return res.status(400).json({ error:error.message });
    console.error('Stripe session error', error);
    return res.status(500).json({ error:'Could not start card checkout' });
  }
};
