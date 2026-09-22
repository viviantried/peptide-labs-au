const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
let client;
function enabled() { return process.env.TRACKER_ENABLED === 'true'; }
function db() {
  if (!process.env.DATABASE_URL) throw new Error('TRACKER_NOT_CONFIGURED');
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}
async function query(text, params = []) { return db().query(text, params, {fetchOptions:{signal:AbortSignal.timeout(10000)}}); }
async function expire() { await query('SELECT pl_expire_orders()'); }
function quantities(items) {
  const result = {};
  for (const item of items) for (const part of item.selections || [item]) {
    result[part.id] = (result[part.id] || 0) + part.qty * (item.selections ? item.qty : 1);
  }
  return result;
}
function fingerprint(details) { return crypto.createHash('sha256').update(JSON.stringify(details)).digest('hex'); }
async function create(id, key, details, items) {
  await expire();
  const [row] = await query('SELECT pl_create_order($1,$2,$3,$4::jsonb,$5::jsonb) AS value',
    [id,key,fingerprint(details),JSON.stringify(details),JSON.stringify(quantities(items))]);
  return row.value;
}
async function setEmails(id, emails) {
  await query('UPDATE pl_orders SET emails=emails || $2::jsonb,updated_at=now() WHERE id=$1',[id,JSON.stringify(emails)]);
}
async function change(id,status,tracking=null,carrier=null) {
  const [row] = await query('SELECT pl_change_order($1,$2,$3,$4) AS value',[id,status,tracking,carrier]);
  return row.value;
}
async function find(id) { return (await query('SELECT * FROM pl_orders WHERE id=$1',[id]))[0] || null; }
async function cancelReminder(order) {
  const emailKey=process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!order?.emails?.reminderId || !emailKey) return;
  try {
    const r=await fetch('https://api.resend.com/emails/'+encodeURIComponent(order.emails.reminderId)+'/cancel',{method:'POST',headers:{Authorization:'Bearer '+emailKey},signal:AbortSignal.timeout(5000)});
    await setEmails(order.id,{reminderCancel:r.ok?'accepted':'failed'});
  } catch { try { await setEmails(order.id,{reminderCancel:'failed'}); } catch {} }
}
async function inventory() {
  await expire();
  return query('SELECT *,on_hand-reserved AS available FROM pl_inventory ORDER BY sku');
}
function secureEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
}
function authorized(req) {
  const key = process.env.TRACKER_ADMIN_KEY || process.env.admin_key || process.env.ADMIN_KEY;
  return secureEqual((req.headers.authorization || '').replace(/^Bearer /,''),key);
}
module.exports = { enabled, query, expire, quantities, fingerprint, create, setEmails, change, find, cancelReminder, inventory, authorized };
if (process.env.NODE_ENV === 'test') module.exports.setClientForTest = value => { client=value; };
