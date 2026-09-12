const RESEND_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.airtable_token;
const AIRTABLE_BASE = 'appwbIeYvWxx7R9Y8';
const TABLE = 'Restock Alerts';
const OWNER_EMAIL = 'support@aupeptidelab.com';

const PRODUCTS = {
  'PL-001': 'Retatrutide', 'PL-002': 'BPC-157', 'PL-003': 'TB-500',
  'PL-004': 'Tesamorelin', 'PL-005': 'Semax', 'PL-006': 'Selank',
  'PL-007': 'Deep Sleep Inducing Peptide', 'PL-008': 'Melanotan-2',
  'PL-009': 'Melanotan-1', 'PL-011': 'NAD+', 'PL-012': 'GHK-Cu',
  'PL-013': 'Glutathione', 'PL-014': 'BAC Water',
};

async function emailOwner(subject, html) {
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'PeptideLab <orders@aupeptidelab.com>', to: OWNER_EMAIL, subject, html }),
  });
}

async function ensureAlertTable() {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE}/tables`, {
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, productId } = req.body || {};
  const product = PRODUCTS[productId];
  if (!product || !/^\S+@\S+\.\S+$/.test(String(email || ''))) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const address = String(email).trim().toLowerCase();
  let stored = false;
  if (AIRTABLE_TOKEN) {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          Email: address, 'Product ID': productId, Product: product, Status: 'Pending', 'Subscribed At': new Date().toISOString(),
        }}] }),
      });
      stored = r.ok;
      if (!stored && r.status === 404 && await ensureAlertTable()) {
        const retry = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: { Email: address, 'Product ID': productId, Product: product, Status: 'Pending', 'Subscribed At': new Date().toISOString() } }] }),
        });
        stored = retry.ok;
      }
    } catch (err) {
      console.error('Restock alert storage error:', err.message);
    }
  }

  if (!stored) {
    try {
      await emailOwner(`Restock alert request — ${product}`, `<p><strong>${address}</strong> requested a restock alert for <strong>${product}</strong> (${productId}).</p>`);
    } catch (err) {
      console.error('Restock alert owner email error:', err.message);
    }
  }

  return res.status(200).json({ ok: true });
};
