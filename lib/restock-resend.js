const RESEND_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
const BASE = 'https://api.resend.com';

async function resend(path, options = {}) {
  if (!RESEND_KEY) throw new Error('Resend is not configured');
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PeptideLab-restock/1.0',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Resend ${response.status}: ${body.message || body.name || 'Request failed'}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function segmentName(productId) {
  return `Restock Alerts - ${productId}`;
}

async function findSegment(productId) {
  const list = await resend('/segments');
  return (list.data || []).find(segment => segment.name === segmentName(productId));
}

async function subscribeToRestock(email, productId) {
  let segment = await findSegment(productId);
  if (!segment) segment = await resend('/segments', { method: 'POST', body: JSON.stringify({ name: segmentName(productId) }) });
  try {
    await resend(`/contacts/${encodeURIComponent(email)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await resend('/contacts', { method: 'POST', body: JSON.stringify({ email, segments: [{ id: segment.id }] }) });
    return segment.id;
  }
  // Keep an existing contact's unsubscribe preference unchanged.
  await resend(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segment.id)}`, { method: 'POST' });
  return segment.id;
}

async function sendRestockBroadcast(productId, productName, productSlug) {
  const segment = await findSegment(productId);
  if (!segment) return { status: 'no_subscribers' };
  const contacts = await resend(`/segments/${encodeURIComponent(segment.id)}/contacts?limit=1`);
  if (!contacts.data?.length) return { status: 'no_subscribers' };

  const url = `https://www.aupeptidelab.com/products/${productSlug}`;
  const html = `<p>${productName} is available again for laboratory research.</p>
<p><a href="${url}">View ${productName}</a></p>
<p>For laboratory research only. Not for human or veterinary use.</p>
<p>PeptideLab · <a href="mailto:support@aupeptidelab.com">support@aupeptidelab.com</a></p>
<p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe from restock emails</a></p>`;
  const result = await resend('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${productName} restock ${new Date().toISOString().slice(0, 10)}`,
      segment_id: segment.id,
      from: 'PeptideLab <orders@aupeptidelab.com>',
      reply_to: ['support@aupeptidelab.com'],
      subject: `${productName} is back in stock`,
      preview_text: `${productName} is available again for laboratory research.`,
      html,
      send: true,
    }),
  });
  return { status: 'submitted', broadcastId: result.id };
}

module.exports = { subscribeToRestock, sendRestockBroadcast };
