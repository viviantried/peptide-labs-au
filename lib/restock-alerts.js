const { createHash } = require('node:crypto');
const store = require('./tracker');

const PRODUCTS = Object.freeze({
  'PL-001': { name: 'Retatrutide', slug: 'retatrutide' },
  'PL-002': { name: 'BPC-157', slug: 'bpc-157' },
  'PL-003': { name: 'TB-500', slug: 'tb-500' },
  'PL-004': { name: 'Tesamorelin', slug: 'tesamorelin' },
  'PL-005': { name: 'Semax', slug: 'semax' },
  'PL-006': { name: 'Selank', slug: 'selank' },
  'PL-007': { name: 'Deep Sleep Inducing Peptide', slug: 'deep-sleep-inducing-peptide' },
  'PL-008': { name: 'Melanotan-2', slug: 'melanotan-2' },
  'PL-009': { name: 'Melanotan-1', slug: 'melanotan-1' },
  'PL-011': { name: 'NAD+', slug: 'nad-plus' },
  'PL-012': { name: 'GHK-Cu', slug: 'ghk-cu' },
  'PL-013': { name: 'Glutathione', slug: 'glutathione' },
  'PL-014': { name: 'BAC Water', slug: 'bac-water' },
  'PL-015': { name: 'Research Starter Kit', slug: 'research-starter-kit' },
});

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS pl_restock_alerts (
  email text NOT NULL,
  sku text NOT NULL REFERENCES pl_inventory(sku) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  provider_id text,
  PRIMARY KEY (email, sku),
  CHECK (email = lower(email) AND email = btrim(email))
)`;
const CREATE_PENDING_INDEX = 'CREATE INDEX IF NOT EXISTS pl_restock_alerts_pending ON pl_restock_alerts (sku, requested_at) WHERE notified_at IS NULL';

let tableReady;

function productForSku(sku) {
  return typeof sku === 'string' && Object.hasOwn(PRODUCTS, sku) ? PRODUCTS[sku] : null;
}

async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await store.query(CREATE_TABLE);
      await store.query(CREATE_PENDING_INDEX);
    })().catch(error => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

async function subscribe(email, sku) {
  const address = String(email).trim().toLowerCase();
  if (!productForSku(sku)) throw new Error('UNKNOWN_RESTOCK_SKU');
  await ensureTable();
  const [alert] = await store.query(`INSERT INTO pl_restock_alerts (email, sku)
    VALUES ($1, $2)
    ON CONFLICT (email, sku) DO UPDATE SET
      requested_at = CASE
        WHEN pl_restock_alerts.notified_at IS NULL THEN pl_restock_alerts.requested_at
        ELSE now()
      END,
      notified_at = NULL,
      provider_id = NULL
    RETURNING email, sku, requested_at, notified_at`, [address, sku]);
  return alert;
}

function isAvailable(inventory) {
  if (!inventory || inventory.restocking === true) return false;
  return Number(inventory.on_hand) - Number(inventory.reserved || 0) > 0;
}

function providerKey(alert) {
  if (typeof alert.request_revision !== 'string' || !alert.request_revision) throw new Error('INVALID_RESTOCK_REQUEST_REVISION');
  const fingerprint = createHash('sha256')
    .update(`${alert.sku}\n${alert.email}\n${alert.request_revision}`)
    .digest('hex');
  return `restock-${fingerprint}`;
}

async function sendAlert(apiKey, product, alert) {
  const productUrl = `https://www.aupeptidelab.com/products/${product.slug}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': providerKey(alert),
    },
    body: JSON.stringify({
      from: 'PeptideLab <orders@aupeptidelab.com>',
      to: alert.email,
      reply_to: 'support@aupeptidelab.com',
      subject: `${product.name} is back in stock`,
      html: `<p>Good news — <strong>${product.name}</strong> is available again.</p><p><a href="${productUrl}">View ${product.name}</a></p><p style="color:#667085;font-size:13px">For laboratory research use only. Not for human consumption.</p>`,
      text: `Good news — ${product.name} is available again.\n\nView it here: ${productUrl}\n\nFor laboratory research use only. Not for human consumption.`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const result = await response.json();
  return typeof result.id === 'string' && result.id.length > 0 ? result.id : null;
}

async function notifyAvailable(sku) {
  const product = productForSku(sku);
  if (!product) throw new Error('UNKNOWN_RESTOCK_SKU');
  await ensureTable();
  const pending = await store.query(`SELECT email, sku, requested_at::text AS request_revision
    FROM pl_restock_alerts
    WHERE sku = $1 AND notified_at IS NULL
    ORDER BY requested_at`, [sku]);
  if (!pending.length) return { status: 'no_subscribers', attempted: 0, accepted: 0, failed: 0 };

  const apiKey = (process.env.RESEND_API_KEY || process.env.resend_api_key || '').trim();
  if (!apiKey) return { status: 'failed', attempted: pending.length, accepted: 0, failed: pending.length };

  const results = await Promise.all(pending.map(async alert => {
    try {
      const providerId = await sendAlert(apiKey, product, alert);
      if (!providerId) return false;
      const updated = await store.query(`UPDATE pl_restock_alerts
        SET notified_at = now(), provider_id = $3
        WHERE email = $1 AND sku = $2 AND requested_at = $4::timestamptz AND notified_at IS NULL
        RETURNING email`, [alert.email, sku, providerId, alert.request_revision]);
      return updated.length === 1;
    } catch (error) {
      console.error('Restock notification failed', error.name || 'provider_unavailable');
      return false;
    }
  }));

  const accepted = results.filter(Boolean).length;
  const failed = pending.length - accepted;
  return {
    status: failed === 0 ? 'sent' : accepted > 0 ? 'partial_failure' : 'failed',
    attempted: pending.length,
    accepted,
    failed,
  };
}

module.exports = { productForSku, subscribe, notifyAvailable, isAvailable };
if (process.env.NODE_ENV === 'test') module.exports._resetForTest = () => { tableReady = null; };
