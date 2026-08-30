// GET  /api/feedback?order=&email=&token=&rating= — show feedback form or record star click
// POST /api/feedback — submit comment + send to owner

const crypto = require('crypto');

const RESEND_KEY  = process.env.RESEND_API_KEY || process.env.resend_api_key;
const SECRET      = process.env.CONFIRM_SECRET || process.env.confirm_secret || 'pl-confirm-2024';
const OWNER_EMAIL = 'support@aupeptidelab.com';
const FROM_EMAIL  = 'orders@aupeptidelab.com';

function makeToken(order, email, action) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${order}:${email}:${action}`)
    .digest('hex').slice(0, 20);
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `PeptideLab <${FROM_EMAIL}>`, reply_to: OWNER_EMAIL, to, subject, html }),
  });
  if (!r.ok) throw new Error(await r.text());
}

const STARS = ['★★★★★','★★★★☆','★★★☆☆','★★☆☆☆','★☆☆☆☆'];
const STAR_COLORS = { 5:'#16a34a', 4:'#65a30d', 3:'#d97706', 2:'#ea580c', 1:'#dc2626' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const { order, email, token, rating } = req.query;

    if (!order || !email || !token) return res.status(400).send(page('Invalid link.', 'error'));

    const expected = makeToken(order, email, 'feedback');
    if (token !== expected) return res.status(403).send(page('Invalid or expired feedback link.', 'error'));

    const r = rating ? Math.min(5, Math.max(1, parseInt(rating))) : null;

    return res.status(200).send(feedbackForm({ order, email, token, rating: r }));
  }

  if (req.method === 'POST') {
    const { order, email, token, rating, comment } = req.body || {};

    if (!order || !email || !token || !rating) return res.status(400).send(page('Missing fields.', 'error'));

    const expected = makeToken(order, email, 'feedback');
    if (token !== expected) return res.status(403).send(page('Invalid or expired feedback link.', 'error'));

    const r = Math.min(5, Math.max(1, parseInt(rating)));
    const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
    const color = STAR_COLORS[r] || '#111';

    const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#111;padding:20px 28px">
    <div style="color:#fff;font-size:16px;font-weight:700">New Feedback — ${order}</div>
    <div style="color:#aaa;font-size:13px;margin-top:2px">${email}</div>
  </div>
  <div style="padding:28px">
    <div style="font-size:36px;color:${color};margin-bottom:8px">${stars}</div>
    <div style="font-size:20px;font-weight:700;color:${color};margin-bottom:20px">${r}/5 stars</div>
    ${comment ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.6">${comment.replace(/</g,'&lt;')}</div>` : '<p style="color:#999;font-size:14px">No comment left.</p>'}
  </div>
</div>
</body></html>`;

    try {
      await sendEmail(OWNER_EMAIL, `${stars} Feedback for ${order} — ${r}/5 stars`, ownerHtml);
    } catch (err) {
      console.error('Feedback email error:', err.message);
    }

    return res.status(200).send(page(`
      <div style="font-size:40px;margin-bottom:12px">${'★'.repeat(r)}${'☆'.repeat(5-r)}</div>
      <h2 style="color:#111;margin:0 0 8px">Thank you so much, it means a lot to us.</h2>
      <p style="color:#555;margin:0 0 10px">Your feedback helps us serve the research community better. We read every single one.</p>
      <p style="color:#aaa;font-size:13px;margin:0">The PeptideLab team</p>
    `, 'success'));
  }

  return res.status(405).send('Method not allowed');
};

function feedbackForm({ order, email, token, rating }) {
  const BASE = 'https://www.aupeptidelab.com';
  const activeCol = rating ? (STAR_COLORS[rating] || '#111') : '#d1d5db';
  const starBtns = [1,2,3,4,5].map(n => {
    const filled = rating && n <= rating;
    return `<a href="${BASE}/api/feedback?order=${encodeURIComponent(order)}&email=${encodeURIComponent(email)}&token=${token}&rating=${n}"
      style="display:inline-block;font-size:38px;color:${filled ? activeCol : '#d1d5db'};text-decoration:none;padding:2px 4px" title="${n} star${n>1?'s':''}">★</a>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab Feedback</title></head>
<body style="margin:0;padding:40px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="font-size:13px;color:#999;margin-bottom:20px">Order ${order}</div>

  <h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 8px">How was your experience?</h2>
  <p style="color:#666;font-size:14px;margin:0 0 6px;line-height:1.5">We'd love to know how the quality, packaging, and delivery went.</p>
  <p style="color:#aaa;font-size:13px;margin:0 0 20px">Tap a star to get started</p>

  <div style="margin-bottom:${rating ? '24px' : '0'}">${starBtns}</div>

  ${rating ? `
  <form method="POST" action="${BASE}/api/feedback" style="margin-top:24px;text-align:left">
    <input type="hidden" name="order" value="${order}">
    <input type="hidden" name="email" value="${email}">
    <input type="hidden" name="token" value="${token}">
    <input type="hidden" name="rating" value="${rating}">
    <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:8px">
      ${'★'.repeat(rating)}${'☆'.repeat(5-rating)} — Tell us more <span style="color:#999;font-weight:400">(optional)</span>
    </label>
    <textarea name="comment" rows="4" placeholder="e.g. How did the product arrive? Was purity what you expected? Anything we could improve for your next order?"
      style="width:100%;box-sizing:border-box;padding:12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;font-family:Arial,sans-serif;resize:vertical;outline:none"></textarea>
    <button type="submit"
      style="width:100%;margin-top:14px;background:#111;color:#fff;font-size:14px;font-weight:700;padding:13px;border:none;border-radius:8px;cursor:pointer">
      Submit Feedback
    </button>
  </form>` : ''}
</div>
</body></html>`;
}

function page(body, type) {
  const styles = { success: { bg:'#f0fdf4', border:'#86efac' }, error: { bg:'#fef2f2', border:'#fca5a5' } }[type] || { bg:'#f0fdf4', border:'#86efac' };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab</title></head>
<body style="margin:0;padding:60px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
<div style="max-width:420px;margin:0 auto;background:${styles.bg};border:2px solid ${styles.border};border-radius:12px;padding:36px">${body}</div>
</body></html>`;
}
