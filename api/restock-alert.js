const { validEmail, escapeHtml, requestAllowed, sendSupportEmail } = require('../lib/support-requests');
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.airtable_token;
const AIRTABLE_BASE = 'appwbIeYvWxx7R9Y8';
const TABLE = 'Restock Alerts';

const PRODUCTS = {
  'PL-001': 'Retatrutide', 'PL-002': 'BPC-157', 'PL-003': 'TB-500',
  'PL-004': 'Tesamorelin', 'PL-005': 'Semax', 'PL-006': 'Selank',
  'PL-007': 'Deep Sleep Inducing Peptide', 'PL-008': 'Melanotan-2',
  'PL-009': 'Melanotan-1', 'PL-011': 'NAD+', 'PL-012': 'GHK-Cu',
  'PL-013': 'Glutathione', 'PL-014': 'BAC Water', 'PL-015': 'Research Starter Kit',
};

async function ensureAlertTable() {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE}/tables`, {
    signal: AbortSignal.timeout(4000),
    method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name: TABLE, fields: [
      { name:'Email', type:'email' }, { name:'Product ID', type:'singleLineText' }, { name:'Product', type:'singleLineText' },
      { name:'Status', type:'singleLineText' }, { name:'Subscribed At', type:'dateTime', options:{ dateFormat:{name:'iso'}, timeFormat:{name:'24hour'}, timeZone:'utc' } },
      { name:'Notified At', type:'dateTime', options:{ dateFormat:{name:'iso'}, timeFormat:{name:'24hour'}, timeZone:'utc' } },
    ] }),
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  if (!requestAllowed(req, res)) return;

  const { email, productId } = req.body || {};
  const product = Object.hasOwn(PRODUCTS, productId) ? PRODUCTS[productId] : null;
  if (!product || typeof email !== 'string' || !validEmail(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const address = String(email).trim().toLowerCase();
  let stored = false;
  if (AIRTABLE_TOKEN) {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}`, {
        signal: AbortSignal.timeout(4000),
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          Email: address, 'Product ID': productId, Product: product, Status: 'Pending', 'Subscribed At': new Date().toISOString(),
        }}] }),
      });
      stored = r.ok;
      if (!stored && r.status === 404 && await ensureAlertTable()) {
        const retry = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}`, {
          signal: AbortSignal.timeout(4000),
          method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: { Email: address, 'Product ID': productId, Product: product, Status: 'Pending', 'Subscribed At': new Date().toISOString() } }] }),
        });
        stored = retry.ok;
      }
    } catch (err) {
      console.error('Restock request: storage unavailable');
    }
  }

  if (stored) return res.status(200).json({ ok: true, delivery: 'stored' });

  {
    try {
      const accepted = await sendSupportEmail({
        subject: `Restock alert request — ${product}`,
        html: `<p><strong>${escapeHtml(address)}</strong> requested a restock alert for <strong>${escapeHtml(product)}</strong> (${productId}).</p><p>This request could not be saved to the restock list. Please follow up manually.</p>`,
        replyTo: address,
      });
      if (accepted) return res.status(200).json({ ok: true, delivery: 'support' });
    } catch (err) {
      console.error('Restock request: email provider unavailable');
    }
  }

  return res.status(503).json({ error: 'We could not save your request. Please retry or email support@aupeptidelab.com.' });
};
