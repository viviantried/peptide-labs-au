const crypto = require('crypto');
const tracker = require('./tracker');
const API = 'https://www.fanbasis.com/public-api';
function enabled() { return process.env.COMMAS_ENABLED === 'true' && !!process.env.COMMAS_API_KEY && !!process.env.COMMAS_WEBHOOK_SECRET && process.env.COMMAS_CURRENCY === 'AUD'; }
async function request(path, body) {
  const response = await fetch(API + path, { method:body ? 'POST' : 'GET', redirect:'error', headers:{'Content-Type':'application/json','x-api-key':process.env.COMMAS_API_KEY}, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.status !== 'success') throw new Error('COMMAS_REQUEST_FAILED');
  return data.data;
}
// Legacy card entry is closed; all new payments use the verified AUD route.
async function begin() { throw new Error('USE_VERIFIED_AUD_CHECKOUT'); }
function verify(raw, signature, secret) {
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(signature||'')) return false;
  const expected = crypto.createHmac('sha256',secret).update(raw).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
async function settle(event) {
  if (event.type !== 'payment.succeeded') return {ignored:true};
  const data = event.data || {};
  const id = data.api_metadata?.data?.order_id || data.api_metadata?.order_id || data.metadata?.order_id;
  if (!/^PL-\d{5}$/.test(id||'')) return {ignored:true};
  const order = await tracker.find(id);
  const payment = order?.details?.commas;
  if (!payment) throw new Error('UNKNOWN_PAYMENT_ORDER');
  if (String(data.currency).toUpperCase() !== 'AUD' || Math.round(Number(data.amount)*100) !== payment.amountCents || String(data.item?.id) !== payment.productId || data.status !== 'succeeded') throw new Error('PAYMENT_MISMATCH');
  if (['paid','shipped'].includes(order.status)) return {duplicate:true};
  if (order.status !== 'pending') throw new Error('ORDER_NOT_PENDING');
  await tracker.change(id,'paid');
  await tracker.query("UPDATE pl_orders SET details=jsonb_set(details,'{commas,paymentId}',to_jsonb($2::text)),updated_at=now() WHERE id=$1",[id,String(data.payment_id||'')]);
  await tracker.cancelReminder(order);
  return {paid:true};
}
module.exports = {enabled,request,begin,verify,settle};
