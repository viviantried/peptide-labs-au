// POST /api/send-tracking
// Owner submits tracking number after shipping — sends branded tracking email to customer.

const crypto = require('crypto');
const tracker = require('../lib/tracker');

const RESEND_KEY  = process.env.RESEND_API_KEY || process.env.resend_api_key;
const SECRET      = process.env.CONFIRM_SECRET || process.env.confirm_secret || RESEND_KEY;
const FROM_EMAIL  = 'orders@aupeptidelab.com';
const OWNER_EMAIL = 'support@aupeptidelab.com';

const CARRIER_TRACK_URLS = {
  'Australia Post': 'https://auspost.com.au/mypost/track/#/search?id=',
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
  if (!SECRET || !RESEND_KEY) return res.status(500).send(page('Server configuration error.', 'error'));
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { order, email, token, tracking, carrier = 'Australia Post', items = '' } = req.body || {};
  if (!order || !email || !token || !tracking) {
    return res.status(400).send(page('Missing required fields.', 'error'));
  }

  const expected = makeToken(order, email, 'track');
  if (token !== expected) {
    return res.status(403).send(page('Invalid or expired link.', 'error'));
  }
  if (tracker.enabled()) {
    try {
      const saved=await tracker.find(order);
      if (saved) {
        if (saved.details.email!==email) return res.status(403).send(page('Order details do not match.','error'));
        await tracker.change(order,'shipped',tracking,carrier);
      }
    } catch { return res.status(503).send(page('Could not save dispatch. Check the order in /admin before trying again.','error')); }
  }

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
        <p style="color:#666;margin:0 0 24px;font-size:15px">Order <strong>${order}</strong> has been dispatched.</p>
        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:20px;margin:0 0 24px">
          <div style="font-size:11px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700">Tracking Details</div>
          <div style="margin-bottom:6px"><span style="font-size:13px;color:#555">Carrier:</span> <strong>${carrier}</strong></div>
          <div style="margin-bottom:${trackUrl ? '16px' : '0'}"><span style="font-size:13px;color:#555">Tracking number:</span> <strong style="font-size:16px;color:#1d4ed8">${tracking}</strong></div>
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
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `PeptideLab <${FROM_EMAIL}>`,
        reply_to: OWNER_EMAIL,
        to: email,
        subject: `Your order ${order} has shipped — Tracking: ${tracking}`,
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());

    return res.status(200).send(page(`
      <h2 style="color:#1d4ed8;margin:0 0 8px">📦 Tracking email sent</h2>
      <p style="color:#555;margin:0 0 4px">Sent to <strong>${email}</strong></p>
      <p style="color:#555;margin:0 0 4px">Order <strong>${order}</strong></p>
      <p style="color:#555;margin:0">Tracking: <strong>${tracking}</strong> via ${carrier}</p>
    `, 'success'));
  } catch (err) {
    return res.status(500).send(page('Failed to send tracking email: ' + err.message, 'error'));
  }
};
