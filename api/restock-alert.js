const { subscribeToRestock } = require('../lib/restock-resend');

const PRODUCTS = new Set([
  'PL-001', 'PL-002', 'PL-003', 'PL-004', 'PL-005', 'PL-006', 'PL-007',
  'PL-008', 'PL-009', 'PL-011', 'PL-012', 'PL-013', 'PL-014',
]);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, productId } = req.body || {};
  const address = String(email || '').trim().toLowerCase();
  if (!PRODUCTS.has(productId) || !/^\S+@\S+\.\S+$/.test(address)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    await subscribeToRestock(address, productId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Restock signup failed:', error.message);
    return res.status(503).json({ error: 'We could not save your alert. Please try again later.' });
  }
};
