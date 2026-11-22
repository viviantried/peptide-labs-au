const API = 'https://www.fanbasis.com';
const pricing = require('../checkout-pricing');

async function request(path, method = 'GET', body) {
  const response = await fetch(API + '/public-api' + path, {
    method, redirect:'error', signal:AbortSignal.timeout(12000),
    headers:{'x-api-key':process.env.COMMAS_API_KEY, 'Content-Type':'application/json'},
    body:body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.status !== 'success') throw new Error('PAYMENT_PROVIDER_UNAVAILABLE');
  return payload.data;
}

async function verifySession(session, amountCents) {
  const id = String(session.id || '');
  if (!/^[a-zA-Z0-9]+$/.test(id)) throw new Error('INVALID_PAYMENT_SESSION');
  const link = new URL(session.payment_link);
  if (link.protocol !== 'https:' || !['commas.com','www.commas.com'].includes(link.hostname) || link.username || link.password || link.port) throw new Error('INVALID_PAYMENT_LINK');
  const token = link.pathname.match(/^\/checkout\/([A-Za-z0-9]+)$/)?.[1];
  if (!token || link.search || link.hash) throw new Error('INVALID_PAYMENT_LINK');
  const details = await request('/checkout-sessions/' + id);
  if (details.amount_cents !== amountCents || !details.product?.id) throw new Error('PAYMENT_AMOUNT_MISMATCH');
  // This is the same bootstrap the hosted Commas checkout uses. Metadata and
  // local environment labels cannot establish the processor's charge currency.
  const response = await fetch(API + '/api/payments/checkout/' + token, {
    headers:{Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(12000),
  });
  const payload = await response.json();
  const actual = payload.data;
  if (!response.ok || payload.success !== true || !actual?.product || !actual?.billing) throw new Error('PAYMENT_VERIFICATION_UNAVAILABLE');
  if (String(actual.product.currency).toUpperCase() !== pricing.CURRENCY) throw new Error('PAYMENT_CURRENCY_MISMATCH');
  if (String(actual.product.encoded_product_id) !== id) throw new Error('PAYMENT_PRODUCT_MISMATCH');
  const charge = Number(actual.billing.total_chargeable_amount);
  if (actual.billing.total_chargeable_amount == null || !Number.isFinite(charge) || Math.round(charge * 100) !== amountCents) throw new Error('PAYMENT_AMOUNT_MISMATCH');
  const creatorId = actual.organization?.handle;
  if (!/^[A-Za-z0-9-]+$/.test(creatorId || '')) throw new Error('INVALID_PAYMENT_ACCOUNT');
  return {productId:id, creatorId, sessionId:String(details.product.id), paymentLink:link.href,
    currency:pricing.CURRENCY, amountCents, verifiedAt:new Date().toISOString()};
}

async function discard(session) {
  if (!session?.id || !/^[a-zA-Z0-9]+$/.test(String(session.id))) return;
  await request('/checkout-sessions/' + session.id, 'DELETE');
}

async function createVerifiedSession(body) {
  if (!Number.isSafeInteger(body.amount_cents) || body.amount_cents < 100) throw new Error('INVALID_PAYMENT_AMOUNT');
  const session = await request('/checkout-sessions','POST',body);
  try { return await verifySession(session,body.amount_cents); }
  catch (error) {
    try { await discard(session); } catch { console.error('Commas unsafe session cleanup failed',String(session.id)); }
    throw error;
  }
}

async function createEmbeddedSession(payment, orderId) {
  const session = await request('/checkout-sessions/embedded','POST',{
    metadata:{order_id:orderId, allowed_payment_methods:['card','apple_pay','google_pay']},
  });
  const secret = session.checkout_session_secret;
  if (!/^[A-Za-z0-9-]{20,100}$/.test(secret || '')) throw new Error('INVALID_EMBEDDED_SESSION');
  const response = await fetch(API + '/api/payments/' + [payment.creatorId,payment.productId,secret].map(encodeURIComponent).join('/'),{
    headers:{Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(12000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true || String(payload.data?.product?.currency).toUpperCase() !== pricing.CURRENCY || String(payload.data?.product?.encoded_product_id) !== payment.productId || Math.round(Number(payload.data?.billing?.total_chargeable_amount) * 100) !== payment.amountCents) throw new Error('EMBEDDED_PAYMENT_MISMATCH');
  return {creatorId:payment.creatorId,productId:payment.productId,checkoutSessionSecret:secret};
}
module.exports = {createVerifiedSession, verifySession, createEmbeddedSession, discard};
