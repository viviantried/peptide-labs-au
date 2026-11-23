// POST /api/send-tracking
// Owner submits tracking number after shipping — sends branded tracking email to customer.

const crypto = require('crypto');
const tracker = require('../lib/tracker');

const RESEND_KEY  = process.env.RESEND_API_KEY || process.env.resend_api_key;
const SECRET      = process.env.CONFIRM_SECRET || process.env.confirm_secret || RESEND_KEY;
const FROM_EMAIL  = 'support@aupeptidelab.com';
const OWNER_EMAIL = 'support@aupeptidelab.com';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CARRIER_TRACK_URLS = {
  'Australia Post': 'https://auspost.com.au/track/',
  'DHL Express':    'https://www.dhl.com/au-en/home/tracking/tracking-express.html?submit=1&tracking-id=',
  'FedEx':          'https://www.fedex.com/fedextrack/?trknbr=',
  'StarTrack':      'https://startrack.com.au/track/search?id=',
  'Aramex':         'https://www.aramex.com.au/tools/track?l=',
};

function makeToken(order, email, action) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${order}:${email}:${action}`)
    .digest('hex')
    .slice(0, 20);
}

function page(body, type = 'info') {
  const styles = {
    info:    { bg: '#eff6ff', border: '#93c5fd' },
    success: { bg: '#f0fdf4', border: '#86efac' },
    error:   { bg: '#fef2f2', border: '#fca5a5' },
  }[type];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab</title></head>
  <body style="margin:0;padding:60px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
    <div style="max-width:440px;margin:0 auto;background:${styles.bg};border:2px solid ${styles.border};border-radius:12px;padding:36px">${body}</div>
  </body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  const json = String(req.headers?.['content-type'] || '').includes('application/json');
  const fail = (status,message) => json ? res.status(status).json({error:message}) : res.status(status).send(page(escapeHtml(message),'error'));
  if (!SECRET || !RESEND_KEY) return fail(500,'Server configuration error.');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { order, token, carrier = 'Australia Post', requestId } = req.body || {};
  let {email,items=''}=req.body || {};
  const tracking=typeof req.body?.tracking==='string'?req.body.tracking.trim():'';
  const admin=tracker.authorized({headers:req.headers || {}});
  if (typeof order!=='string' || !/^[A-Za-z0-9-]{1,100}$/.test(order) || !tracking || tracking.length>150 || /[\r\n\x00-\x1f]/.test(tracking) || ![...Object.keys(CARRIER_TRACK_URLS),'Other'].includes(carrier) || (requestId!==undefined && (typeof requestId!=='string' || !/^[A-Za-z0-9-]{8,100}$/.test(requestId)))) {
    return fail(400,'Enter a valid order, carrier and tracking number.');
  }
  if (!admin) {
    if (typeof email!=='string' || typeof token!=='string' || token!==makeToken(order,email,'track')) return fail(403,'Please sign in to the tracker or use a valid tracking link.');
  }
  let savedOrder;
  if (admin && !tracker.enabled()) return fail(503,'The order tracker is unavailable. Please retry.');
  if (tracker.enabled()) {
    try {
      savedOrder=await tracker.find(order);
      if (admin && !savedOrder) return fail(404,'Order not found.');
      if (savedOrder) {
        if (!admin && savedOrder.details.email!==email) return fail(403,'Order details do not match.');
        email=savedOrder.details.email;
        items=Buffer.from(JSON.stringify((savedOrder.details.items || []).map(i=>({id:i.id,qty:i.qty,...(i.selections?{selections:i.selections.map(s=>({id:s.id,qty:s.qty}))}:{})})))).toString('base64');
        if (typeof email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400,'This order does not have a valid customer email.');
        // Preserve the normal paid-order dispatch flow. Other statuses may
        // receive tracking without changing payment status or inventory.
        if (savedOrder.status==='paid') {
          try { savedOrder=await tracker.change(order,'shipped',tracking,carrier); }
          catch(error) { if (!error.message.includes('INVALID_STATUS_CHANGE')) throw error; }
        }
        savedOrder=await tracker.saveTracking(order,tracking,carrier);
      }
    } catch { return fail(503,'Could not save tracking details. Please retry.'); }
  }
  if (typeof email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400,'A valid customer email is required.');

  const trackUrl = CARRIER_TRACK_URLS[carrier]
    ? CARRIER_TRACK_URLS[carrier] + encodeURIComponent(tracking)
    : null;
  let reorderUrl = '';
  try {
    if (items && Array.isArray(JSON.parse(Buffer.from(items, 'base64').toString('utf8')))) {
      reorderUrl = 'https://www.aupeptidelab.com/?reorder=' + encodeURIComponent(items);
    }
  } catch {}

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
      <div style="background:#000;padding:24px 32px">
        <div style="color:#fff;font-size:20px;font-weight:800">PeptideLab</div>
        <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
      </div>
      <div style="padding:32px">
        <div style="display:inline-block;background:#eff6ff;border:2px solid #93c5fd;border-radius:50px;padding:8px 20px;margin-bottom:20px">
          <span style="color:#1d4ed8;font-weight:700;font-size:14px">📦 Your Order Has Shipped</span>
        </div>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Your order is on its way.</h1>
        <p style="color:#666;margin:0 0 24px;font-size:15px">Order <strong>${escapeHtml(order)}</strong> has been dispatched.</p>
        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:20px;margin:0 0 24px">
          <div style="font-size:11px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700">Tracking Details</div>
          <div style="margin-bottom:6px"><span style="font-size:13px;color:#555">Carrier:</span> <strong>${escapeHtml(carrier)}</strong></div>
          <div style="margin-bottom:${trackUrl ? '16px' : '0'}"><span style="font-size:13px;color:#555">Tracking number:</span> <strong style="font-size:16px;color:#1d4ed8">${escapeHtml(tracking)}</strong></div>
          ${trackUrl ? `<a href="${trackUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;font-size:14px;font-weight:700;padding:10px 24px;border-radius:8px;text-decoration:none">Track My Order →</a>` : ''}
        </div>
        ${reorderUrl ? `<div style="margin:0 0 20px;padding:18px 20px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px"><div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:6px">Need to order again?</div><div style="font-size:13px;color:#166534;margin-bottom:14px">Your previous items are ready to add back to your cart.</div><a href="${reorderUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-size:14px;font-weight:700;padding:11px 20px;border-radius:8px;text-decoration:none">Reorder these items →</a></div>` : ''}
        <p style="color:#666;font-size:13px;margin:0">Tracking may take a short time to activate after lodgement. Questions? <a href="mailto:${OWNER_EMAIL}" style="color:#111;font-weight:600">${OWNER_EMAIL}</a></p>
      </div>
      <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
        <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
      </div>
    </div>
  </body></html>`;

  try {
    if (process.env.VERCEL_ENV === 'preview' && process.env.TRACKER_TEST_MODE === 'true') throw new Error('Email delivery disabled for preview testing');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect:'error',signal:AbortSignal.timeout(12000),
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key':'tracking-'+crypto.createHash('sha256').update(JSON.stringify([order,email,tracking,carrier,requestId || 'signed-link'])).digest('hex') },
      body: JSON.stringify({
        from: `PeptideLab <${FROM_EMAIL}>`,
        reply_to: OWNER_EMAIL,
        to: email,
        subject: `Your order ${order} has shipped — Tracking: ${tracking}`,
        html,
      }),
    });
    if (!r.ok) throw new Error('Email provider unavailable');
    const sent=await r.json();
    if (!sent.id) throw new Error('Email provider did not confirm acceptance');
    const sentAt=new Date().toISOString();
    let emailRecorded=true;
    if (savedOrder) {
      try { await tracker.setEmails(order,{tracking:'accepted',trackingId:sent.id,trackingSentAt:sentAt,trackingNumber:tracking,trackingCarrier:carrier}); }
      catch { emailRecorded=false;console.error('Tracking email accepted but record update failed',order); }
    }
    if (json) return res.status(200).json({ok:true,email,tracking,carrier,status:savedOrder?.status,emailId:sent.id,sentAt,emailRecorded});

    return res.status(200).send(page(`
      <h2 style="color:#1d4ed8;margin:0 0 8px">📦 Tracking email sent</h2>
      <p style="color:#555;margin:0 0 4px">Sent to <strong>${escapeHtml(email)}</strong></p>
      <p style="color:#555;margin:0 0 4px">Order <strong>${escapeHtml(order)}</strong></p>
      <p style="color:#555;margin:0">Tracking: <strong>${escapeHtml(tracking)}</strong> via ${escapeHtml(carrier)}</p>
    `, 'success'));
  } catch (err) {
    if (savedOrder) { try { await tracker.setEmails(order,{tracking:'failed'}); } catch {} }
    return fail(502,'Tracking details were saved, but the email could not be confirmed. Please retry sending.');
  }
};
