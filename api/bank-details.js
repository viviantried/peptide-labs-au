// Returns configured bank accounts — options with missing env vars are excluded
// Frontend fetches this on checkout open to show only available payment methods

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const methods = [];

  const BSB     = process.env.BSB_NUMBER     || process.env.bsb_number;
  const ACCOUNT = process.env.ACCOUNT_NUMBER || process.env.account_number;
  if (BSB && ACCOUNT) {
    methods.push({
      id: 'aud',
      label: 'Australian Bank Transfer',
      currency: 'AUD',
      fields: [
        { label: 'Account Name', value: 'Australian Peptide Labs Store' },
        { label: 'BSB',          value: BSB },
        { label: 'Account No.',  value: ACCOUNT },
      ],
    });
  }

  return res.status(200).json({ methods });
};
