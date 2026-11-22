const { validEmail, requestAllowed } = require('../lib/support-requests');

const unavailable = 'We could not subscribe this email address. Please try again.';
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
  if (!requestAllowed(req, res)) return;

  const { email, consent, website = '' } = req.body || {};
  if (typeof email !== 'string' || !validEmail(email.trim()) || consent !== true
      || typeof website !== 'string' || website.trim()) {
    return res.status(400).json({
      error: 'Please enter a valid email address and confirm that you want to receive email updates.',
    });
  }

  const apiKey = (process.env.RESEND_API_KEY || process.env.resend_api_key || '').trim();
  // Resend migrated Audiences to Segments; existing audience IDs remain supported.
  const segmentId = (process.env.RESEND_NEWSLETTER_SEGMENT_ID
    || process.env.resend_newsletter_segment_id
    || process.env.RESEND_AUDIENCE_ID
    || process.env.resend_audience_id
    || '').trim();
  if (!apiKey || !segmentId) return res.status(503).json({ error: unavailable });

  const address = email.trim().toLowerCase();
  const contactPath = `/contacts/${encodeURIComponent(address)}`;

  try {
    let contact = await resendRequest(apiKey, contactPath);
    if (contact.status === 404) {
      contact = await resendRequest(apiKey, '/contacts', {
        method: 'POST',
        body: JSON.stringify({
          email: address,
          unsubscribed: false,
          segments: [{ id: segmentId }],
        }),
      });
      // Another request may have created the same address while this one was running.
      if (contact.status === 409) contact = await resendRequest(apiKey, contactPath);
    }
    if (!contact.ok || !contact.body.id) throw new Error('Contact not saved');

    const joined = await resendRequest(
      apiKey,
      `${contactPath}/segments/${encodeURIComponent(segmentId)}`,
      { method: 'POST' },
    );
    if (!joined.ok || joined.body.id !== segmentId) {
      // Repeated adds may be rejected. Read membership back before acknowledging success.
      const membership = await resendRequest(apiKey, `${contactPath}/segments?limit=100`);
      if (!membership.ok || !Array.isArray(membership.body.data)
          || !membership.body.data.some(item => item.id === segmentId)) {
        throw new Error('Newsletter membership not saved');
      }
    }

    // Confirm the intended membership before changing the global opt-out flag. This
    // prevents a failed segment add from enabling mail from unrelated segments.
    if (contact.body.unsubscribed === true) {
      const updated = await resendRequest(apiKey, contactPath, {
        method: 'PATCH',
        body: JSON.stringify({ unsubscribed: false }),
      });
      if (!updated.ok || !updated.body.id) throw new Error('Contact not resubscribed');
    }

    return res.status(200).json({ ok: true });
  } catch {
    console.error('Newsletter signup: Resend storage unavailable');
    return res.status(503).json({ error: unavailable });
  }
};
