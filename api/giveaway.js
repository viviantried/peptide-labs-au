const { validEmail, requestAllowed } = require('../lib/support-requests');

const unavailable = 'We could not save your entry. Please try again. Your email address is still in the form.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resendRequest(apiKey, path, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.resend.com${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 429 && attempt < 2) {
      const retrySeconds = Number(response.headers?.get('retry-after')) || 1;
      await pause(Math.min(3, Math.max(1, retrySeconds)) * 1000);
      continue;
    }
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const apiKey = (process.env.RESEND_API_KEY || process.env.resend_api_key || '').trim();
  // Resend migrated Audiences to Segments; existing audience IDs remain supported.
  const segmentId = (process.env.RESEND_GIVEAWAY_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID || process.env.resend_audience_id || '').trim();

  if (req.method === 'GET') {
    if (!apiKey || !segmentId) return res.status(503).json({ available: false });
    try {
      const target = await resendRequest(apiKey, `/segments/${encodeURIComponent(segmentId)}`);
      const available = target.ok && target.body.id === segmentId;
      return res.status(available ? 200 : 503).json({ available });
    } catch {
      return res.status(503).json({ available: false });
    }
  }
  if (!requestAllowed(req, res)) return;
  const { email, entryConsent, marketingConsent = false, website = '' } = req.body || {};
  if (typeof email !== 'string' || !validEmail(email.trim()) || entryConsent !== true
      || typeof marketingConsent !== 'boolean' || website) {
    return res.status(400).json({ error: 'Please enter a valid email address and confirm your giveaway entry.' });
  }
  if (!apiKey || !segmentId) return res.status(503).json({ error: unavailable });

  const address = email.trim().toLowerCase();
  const contactPath = `/contacts/${encodeURIComponent(address)}`;
  try {
    let contact = await resendRequest(apiKey, contactPath);
    if (contact.status === 404) {
      contact = await resendRequest(apiKey, '/contacts', {
        method: 'POST',
        body: JSON.stringify({ email: address, unsubscribed: !marketingConsent, segments: [{ id: segmentId }] }),
      });
      // Another request may have created the same address while this one was running.
      if (contact.status === 409) contact = await resendRequest(apiKey, contactPath);
    }
    if (!contact.ok || !contact.body.id) throw new Error('Contact not saved');

    // Segment membership records entry; existing subscription preferences are preserved.
    const joined = await resendRequest(apiKey, `${contactPath}/segments/${encodeURIComponent(segmentId)}`, { method: 'POST' });
    if (!joined.ok || joined.body.id !== segmentId) throw new Error('Entry not saved');
    return res.status(200).json({ ok: true });
  } catch {
    console.error('Giveaway entry: Resend storage unavailable');
    return res.status(503).json({ error: unavailable });
  }
};
