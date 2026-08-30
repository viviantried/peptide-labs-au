// POST /api/send-tracking
// Owner submits tracking number after shipping — sends branded tracking email to customer.

const crypto = require('crypto');

const RESEND_KEY  = process.env.RESEND_API_KEY || process.env.resend_api_key;
const SECRET      = process.env.CONFIRM_SECRET || process.env.confirm_secret || 'pl-confirm-2024';
const FROM_EMAIL  = 'orders@aupeptidelab.com';
const OWNER_EMAIL = 'support@aupeptidelab.com';
const SITE_URL    = 'https://www.aupeptidelab.com';

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
    .digest('hex').slice(0, 20);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { order, email, token, tracking, carrier } = req.body || {};

  if (!order || !email || !token || !tracking) {
    return res.status(400).send(page('Missing required fields.', 'error'));
  }

  const expected = makeToken(order, email, 'track');
  if (token !== expected) {
    return res.status(403).send(page('Invalid or expired link.', 'error'));
  }

  const firstName = email.split('@')[0];
  const trackUrl  = CARRIER_TRACK_URLS[carrier]
    ? CARRIER_TRACK_URLS[carrier] + encodeURIComponent(tracking)
    : null;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;background:#eff6ff;border:2px solid #93c5fd;border-radius:50px;padding:8px 20px;margin-bottom:20px">
      <span style="color:#1d4ed8;font-weight:700;font-size:14px">📦 Your Order Has Shipped!</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Your order is on its way!</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px">Order <strong>${order}</strong> has been dispatched and is heading your way.</p>

    <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:20px;margin:0 0 24px">
      <div style="font-size:11px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700">Tracking Details</div>
      <div style="margin-bottom:6px"><span style="font-size:13px;color:#555">Carrier:</span> <span style="font-size:14px;font-weight:700;color:#111">${carrier}</span></div>
      <div style="margin-bottom:${trackUrl ? '16px' : '0'}"><span style="font-size:13px;color:#555">Tracking Number:</span> <span style="font-size:16px;font-weight:800;color:#1d4ed8;letter-spacing:1px">${tracking}</span></div>
      ${trackUrl ? `<a href="${trackUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;font-size:14px;font-weight:700;padding:10px 24px;border-radius:8px;text-decoration:none">Track My Order →</a>` : ''}
    </div>

    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px">
      <div style="font-size:13px;color:#555;line-height:1.8">
        🕐 Allow <strong>1–2 business days</strong> for tracking to activate<br>
        📬 Delivery typically within <strong>3–10 business days</strong> depending on your location
      </div>
    </div>

    <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  const feedbackToken = makeToken(order, email, 'feedback');
  const feedbackBase  = `${SITE_URL}/api/feedback?order=${encodeURIComponent(order)}&email=${encodeURIComponent(email)}&token=${feedbackToken}`;

  const feedbackHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:36px;text-align:center">

    <div style="font-size:40px;margin-bottom:16px">🧪</div>
    <h1 style="font-size:22px;font-weight:800;color:#111;margin:0 0 12px;line-height:1.3">Thank you for being a part of the PeptideLab community.</h1>
    <p style="color:#777;margin:0 0 8px;font-size:14px;line-height:1.6">Your order <strong style="color:#111">${order}</strong> has had a week to arrive.</p>
    <p style="color:#777;margin:0 0 28px;font-size:14px;line-height:1.6">PeptideLab aims to improve every day so we'd love to know how everything went.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:0 0 24px;text-align:left">
      <div style="font-size:12px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">A few things we care about</div>
      <div style="font-size:14px;color:#555;line-height:2">
        ✓ &nbsp;Product quality &amp; purity on arrival<br>
        ✓ &nbsp;Packaging — sealed, labelled, and intact<br>
        ✓ &nbsp;Delivery speed and communication<br>
        ✓ &nbsp;Overall experience ordering from us
      </div>
    </div>

    <p style="color:#555;font-size:14px;margin:0 0 14px;font-weight:600">How would you rate your experience?</p>
    <div style="margin-bottom:28px;font-size:0">
      <a href="${feedbackBase}&rating=5" style="display:inline-block;font-size:38px;color:#d1d5db;text-decoration:none;padding:2px 5px" title="5 — Excellent">★</a>
      <a href="${feedbackBase}&rating=4" style="display:inline-block;font-size:38px;color:#d1d5db;text-decoration:none;padding:2px 5px" title="4 — Great">★</a>
      <a href="${feedbackBase}&rating=3" style="display:inline-block;font-size:38px;color:#d1d5db;text-decoration:none;padding:2px 5px" title="3 — Good">★</a>
      <a href="${feedbackBase}&rating=2" style="display:inline-block;font-size:38px;color:#d1d5db;text-decoration:none;padding:2px 5px" title="2 — Fair">★</a>
      <a href="${feedbackBase}&rating=1" style="display:inline-block;font-size:38px;color:#d1d5db;text-decoration:none;padding:2px 5px" title="1 — Poor">★</a>
    </div>

    <a href="${feedbackBase}" style="display:inline-block;background:#111;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px;text-decoration:none">Share Your Feedback →</a>

    <p style="color:#bbb;font-size:12px;margin:20px 0 0">Takes less than a minute — and it genuinely helps us improve.</p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#888">support@aupeptidelab.com</a></p>
    <p style="margin:4px 0 0;font-size:11px;color:#ccc">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  try {
    const sendAt7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const [trackRes] = await Promise.all([
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `PeptideLab <${FROM_EMAIL}>`,
          reply_to: OWNER_EMAIL,
          to: email,
          subject: `Your order ${order} has shipped — Tracking: ${tracking}`,
          html,
        }),
      }),
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `PeptideLab <${FROM_EMAIL}>`,
          reply_to: OWNER_EMAIL,
          to: email,
          subject: `How was your PeptideLab order? — ${order}`,
          html: feedbackHtml,
          scheduled_at: sendAt7Days,
        }),
      }),
    ]);

    if (!trackRes.ok) throw new Error(await trackRes.text());

    return res.status(200).send(page(`
      <h2 style="color:#1d4ed8;margin:0 0 8px">📦 Tracking email sent</h2>
      <p style="color:#555;margin:0 0 4px">Sent to <strong>${email}</strong></p>
      <p style="color:#555;margin:0 0 4px">Order <strong>${order}</strong></p>
      <p style="color:#555;margin:0 0 8px">Tracking: <strong>${tracking}</strong> via ${carrier}</p>
      <p style="font-size:12px;color:#999;margin:0">⏱ Feedback request scheduled for 7 days from now</p>
    `, 'info'));
  } catch (err) {
    return res.status(500).send(page('Failed to send tracking email: ' + err.message, 'error'));
  }
};

function page(body, type) {
  const styles = {
    info:    { bg: '#eff6ff', border: '#93c5fd' },
    success: { bg: '#f0fdf4', border: '#86efac' },
    error:   { bg: '#fef2f2', border: '#fca5a5' },
  }[type] || { bg: '#f0fdf4', border: '#86efac' };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab</title></head>
<body style="margin:0;padding:60px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
  <div style="max-width:420px;margin:0 auto;background:${styles.bg};border:2px solid ${styles.border};border-radius:12px;padding:36px">
    ${body}
  </div>
</body></html>`;
}
