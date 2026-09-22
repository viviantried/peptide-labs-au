const { createHash } = require('node:crypto');

const SUPPORT_EMAIL = 'support@aupeptidelab.com';
const EMAIL_PATTERN = /^[^\s@<>"\\]+@[^\s@<>"\\]+\.[^\s@<>"\\]+$/;

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function requestAllowed(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  const origin = req.headers?.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) throw new Error('Origin mismatch');
    } catch {
      res.status(403).json({ error: 'Please submit this request from the website.' });
      return false;
    }
  }
  return true;
}

async function sendSupportEmail({ subject, html, replyTo, requestId }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!apiKey) return false;
  const body = { from: 'PeptideLab <orders@aupeptidelab.com>', to: SUPPORT_EMAIL, subject, html, reply_to: replyTo };
  // Include a payload fingerprint so editing a failed request cannot reuse a key for different content.
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'Idempotency-Key': `support-${requestId}-${fingerprint}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return typeof result.id === 'string' && result.id.length > 0;
}

module.exports = { SUPPORT_EMAIL, validEmail, escapeHtml, requestAllowed, sendSupportEmail };
