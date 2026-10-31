const store = require('../lib/tracker');

const unavailable = 'Newsletter subscribers are unavailable. Please retry.';

function segmentId() {
  return (process.env.RESEND_NEWSLETTER_SEGMENT_ID
    || process.env.resend_newsletter_segment_id
    || process.env.RESEND_AUDIENCE_ID
    || process.env.resend_audience_id
    || '').trim();
}

function validCursor(value) {
  return value === undefined || (typeof value === 'string'
    && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!store.authorized(req)) return res.status(401).json({ error: 'Please enter your admin key.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawLimit = req.query?.limit ?? '100';
  const limit = Number(rawLimit);
  const after = req.query?.after;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !validCursor(after)) {
    return res.status(400).json({ error: 'Invalid subscriber page request.' });
  }

  const apiKey = (process.env.RESEND_API_KEY || process.env.resend_api_key || '').trim();
  const newsletterSegment = segmentId();
  if (!apiKey || !newsletterSegment) return res.status(503).json({ error: unavailable });

  const query = new URLSearchParams({ limit: String(limit) });
  if (after) query.set('after', after);
  const path = `/segments/${encodeURIComponent(newsletterSegment)}/contacts?${query}`;

  try {
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.data)) throw new Error('Provider unavailable');

    const contacts = body.data.map(contact => {
      if (!contact || typeof contact.id !== 'string' || typeof contact.email !== 'string') {
        throw new Error('Invalid provider response');
      }
      return {
        id: contact.id,
        email: contact.email,
        createdAt: typeof contact.created_at === 'string' ? contact.created_at : null,
        unsubscribed: contact.unsubscribed === true,
      };
    });
    const hasMore = body.has_more === true;
    return res.status(200).json({
      contacts,
      hasMore,
      nextCursor: hasMore && contacts.length ? contacts.at(-1).id : null,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    console.error('Newsletter admin: Resend contacts unavailable');
    return res.status(503).json({ error: unavailable });
  }
};

if (process.env.NODE_ENV === 'test') module.exports._private = { segmentId, validCursor };
