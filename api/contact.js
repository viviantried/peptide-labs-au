const { validEmail, escapeHtml, requestAllowed, sendSupportEmail } = require('../lib/support-requests');

const TOPICS = new Set(['Order Support', 'Shipping Enquiry', 'Batch Certificate Request', 'Bulk / Institutional Order', 'Product Information', 'Returns & Refunds', 'Other']);
const REQUEST_ID = /^[a-zA-Z0-9-]{16,80}$/;

module.exports = async function handler(req, res) {
  if (!requestAllowed(req, res)) return;
  const body = req.body || {};
  const { name, email, topic, orderNumber = '', message, website = '', requestId } = body;
  if (website || typeof name !== 'string' || !name.trim() || name.length > 120
      || typeof email !== 'string' || !validEmail(email.trim()) || !TOPICS.has(topic)
      || typeof orderNumber !== 'string' || orderNumber.length > 80
      || typeof message !== 'string' || !message.trim() || message.length > 5000
      || typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return res.status(400).json({ error: 'Please check your name, email, topic and message, then try again.' });
  }
  try {
    const accepted = await sendSupportEmail({
      subject: `Website enquiry: ${topic}`,
      replyTo: email.trim(), requestId,
      html: `<h2>Website support enquiry</h2><p><strong>Name:</strong> ${escapeHtml(name.trim())}<br><strong>Email:</strong> ${escapeHtml(email.trim())}<br><strong>Topic:</strong> ${escapeHtml(topic)}<br><strong>Order:</strong> ${escapeHtml(orderNumber.trim() || 'Not provided')}</p><p>${escapeHtml(message.trim()).replace(/\r?\n/g, '<br>')}</p>`,
    });
    if (accepted) return res.status(200).json({ ok: true });
  } catch {
    console.error('Contact request: email provider unavailable');
  }
  return res.status(503).json({ error: 'We could not send your message. Your text is still here; please retry or email support@aupeptidelab.com.' });
};
