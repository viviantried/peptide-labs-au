// GET /api/confirm-payment?order=PL-xxxxx&email=...&amt=...&token=...
// Owner clicks this link from their notification email to confirm payment received.
// Sends a dispatch confirmation email to the customer.

const crypto = require('crypto');

const RESEND_KEY   = process.env.RESEND_API_KEY  || process.env.resend_api_key;
const SECRET       = process.env.CONFIRM_SECRET  || process.env.confirm_secret || 'pl-confirm-2024';
const FROM_EMAIL   = 'orders@aupeptidelab.com';
const SITE_URL     = 'https://www.aupeptidelab.com';

function makeToken(order, email, amt) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${order}:${email}:${amt}`)
    .digest('hex')
    .slice(0, 20);
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `PeptideLab <${FROM_EMAIL}>`, reply_to: 'support@aupeptidelab.com', to, subject, html }),
  });
  if (!r.ok) throw new Error(await r.text());
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { order, email, amt, name, token } = req.query;

  if (!order || !email || !token) {
    return res.status(400).send(page('Missing parameters', 'error'));
  }

  const expected = makeToken(order, email, amt || '');
  if (token !== expected) {
    return res.status(403).send(page('Invalid or expired confirmation link.', 'error'));
  }

  const firstName = (name || 'there').split(' ')[0];
  const amtDisplay = amt ? `A$${Number(amt).toFixed(2)}` : 'the full amount';

  const confirmHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;background:#f0fdf4;border:2px solid #86efac;border-radius:50px;padding:8px 20px;margin-bottom:20px">
      <span style="color:#16a34a;font-weight:700;font-size:14px">✓ Payment Confirmed</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Your order is on its way, ${firstName}!</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px">We've received your payment of <strong>${amtDisplay}</strong> for order <strong>${order}</strong>. Your order is now being prepared for dispatch.</p>

    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px;margin:0 0 24px">
      <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:6px">What happens next</div>
      <div style="font-size:13px;color:#166534;line-height:1.8">
        📦 Your order will be dispatched within <strong>1–2 business days</strong><br>
        📧 You'll receive a separate email with your <strong>tracking number</strong> once shipped<br>
        🔍 Track your parcel at <a href="${SITE_URL}" style="color:#166534">aupeptidelab.com</a> → Track Order
      </div>
    </div>

    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Order Reference</div>
      <div style="font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">${order}</div>
    </div>

    <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  try {
    await sendEmail(email, `Payment Confirmed — Order ${order} is Being Dispatched`, confirmHtml);
    return res.status(200).send(page(`
      <h2 style="color:#16a34a;margin:0 0 8px">✓ Payment confirmed</h2>
      <p style="color:#555;margin:0 0 4px">Confirmation email sent to <strong>${email}</strong></p>
      <p style="color:#555;margin:0">Order <strong>${order}</strong> — ${amtDisplay}</p>
    `, 'success'));
  } catch (err) {
    return res.status(500).send(page('Failed to send email: ' + err.message, 'error'));
  }
};

function page(body, type) {
  const color = type === 'success' ? '#f0fdf4' : '#fef2f2';
  const border = type === 'success' ? '#86efac' : '#fca5a5';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab</title></head>
<body style="margin:0;padding:60px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
  <div style="max-width:420px;margin:0 auto;background:${color};border:2px solid ${border};border-radius:12px;padding:36px">
    ${body}
  </div>
</body></html>`;
}
