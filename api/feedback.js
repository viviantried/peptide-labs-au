// GET  /api/feedback?order=&email=&token=&rating= — show feedback form or record star click
// POST /api/feedback — submit comment + send to owner

const crypto = require('crypto');
const { escapeHtml, validEmail } = require('../lib/support-requests');

const RESEND_KEY  = process.env.RESEND_API_KEY || process.env.resend_api_key;
const SECRET      = process.env.CONFIRM_SECRET || process.env.confirm_secret;
const OWNER_EMAIL = 'support@aupeptidelab.com';
const FROM_EMAIL  = 'orders@aupeptidelab.com';

function makeToken(order, email, action) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${order}:${email}:${action}`)
    .digest('hex').slice(0, 20);
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('Email provider unavailable');
  const r = await fetch('https://api.resend.com/emails', {
    signal: AbortSignal.timeout(8000),
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `PeptideLab <${FROM_EMAIL}>`, reply_to: OWNER_EMAIL, to, subject, html }),
  });
  if (!r.ok || !(await r.json()).id) throw new Error('Email provider unavailable');
}

const STARS = ['★★★★★','★★★★☆','★★★☆☆','★★☆☆☆','★☆☆☆☆'];
const STAR_COLORS = { 5:'#16a34a', 4:'#65a30d', 3:'#d97706', 2:'#ea580c', 1:'#dc2626' };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!SECRET) return res.status(500).send(page('Server configuration error.', 'error'));

  if (req.method === 'GET') {
    const { order, email, token, rating } = req.query;

    if (typeof order !== 'string' || !order || order.length > 80 || !validEmail(email) || typeof token !== 'string') return res.status(400).send(page('Invalid link.', 'error'));

    const expected = makeToken(order, email, 'feedback');
    if (token !== expected) return res.status(403).send(page('Invalid or expired feedback link.', 'error'));

    const r = rating ? Number(rating) : null;
    if (r !== null && (!Number.isInteger(r) || r < 1 || r > 5)) return res.status(400).send(page('Please choose a rating from 1 to 5.', 'error'));

    return res.status(200).send(feedbackForm({ order, email, token, rating: r }));
  }

  if (req.method === 'POST') {
    const { order, email, token, rating, comment } = req.body || {};

    if (typeof order !== 'string' || !order || order.length > 80 || !validEmail(email) || typeof token !== 'string' || (comment !== undefined && (typeof comment !== 'string' || comment.length > 5000))) return res.status(400).send(page('Missing fields.', 'error'));

    const expected = makeToken(order, email, 'feedback');
    if (token !== expected) return res.status(403).send(page('Invalid or expired feedback link.', 'error'));

    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).send(page('Please choose a rating from 1 to 5.', 'error'));
    const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
    const color = STAR_COLORS[r] || '#111';

    const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#111;padding:20px 28px">
    <div style="color:#fff;font-size:16px;font-weight:700">New Feedback — ${escapeHtml(order)}</div>
    <div style="color:#aaa;font-size:13px;margin-top:2px">${escapeHtml(email)}</div>
  </div>
  <div style="padding:28px">
    <div style="font-size:36px;color:${color};margin-bottom:8px">${stars}</div>
    <div style="font-size:20px;font-weight:700;color:${color};margin-bottom:20px">${r}/5 stars</div>
    ${comment ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.6">${escapeHtml(comment)}</div>` : '<p style="color:#999;font-size:14px">No comment left.</p>'}
  </div>
</div>
</body></html>`;

    try {
      await sendEmail(OWNER_EMAIL, `${stars} Feedback for ${order} — ${r}/5 stars`, ownerHtml);
    } catch (err) {
      console.error('Feedback request: email provider unavailable');
      return res.status(503).send(feedbackForm({ order, email, token, rating: r, comment, error: true }));
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

function feedbackForm({ order, email, token, rating, comment = '', error = false }) {
  const BASE = '';
  const activeCol = rating ? (STAR_COLORS[rating] || '#111') : '#d1d5db';
  const starBtns = [1,2,3,4,5].map(n => {
    const filled = rating && n <= rating;
    return `<a href="${BASE}/api/feedback?order=${encodeURIComponent(order)}&email=${encodeURIComponent(email)}&token=${token}&rating=${n}"
      style="display:inline-block;font-size:38px;color:${filled ? activeCol : '#d1d5db'};text-decoration:none;padding:2px 4px" title="${n} star${n>1?'s':''}">★</a>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PeptideLab Feedback</title></head>
<body style="margin:0;padding:40px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="font-size:13px;color:#999;margin-bottom:20px">Order ${escapeHtml(order)}</div>

  ${error ? '<p role="alert" style="color:#b91c1c">We could not submit your feedback. Your comment is preserved below. Please retry or email support@aupeptidelab.com.</p>' : ''}
  <h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 8px">How was your experience?</h2>
  <p style="color:#666;font-size:14px;margin:0 0 6px;line-height:1.5">We'd love to know how ordering, documentation, packaging and delivery went.</p>
  <p style="color:#aaa;font-size:13px;margin:0 0 20px">Tap a star to get started</p>

  <div style="margin-bottom:${rating ? '24px' : '0'}">${starBtns}</div>

  ${rating ? `
  <form method="POST" action="${BASE}/api/feedback" style="margin-top:24px;text-align:left">
    <input type="hidden" name="order" value="${escapeHtml(order)}">
    <input type="hidden" name="email" value="${escapeHtml(email)}">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <input type="hidden" name="rating" value="${rating}">
    <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:8px">
      ${'★'.repeat(rating)}${'☆'.repeat(5-rating)} — Tell us more <span style="color:#999;font-weight:400">(optional)</span>
    </label>
    <textarea name="comment" rows="4" maxlength="5000" placeholder="How did ordering, documentation and delivery go? Please do not include personal health information."
      style="width:100%;box-sizing:border-box;padding:12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;font-family:Arial,sans-serif;resize:vertical;outline:none">${escapeHtml(comment)}</textarea>
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
