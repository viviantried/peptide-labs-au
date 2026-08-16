// Returns configured bank accounts — options with missing env vars are excluded
// Frontend fetches this on checkout open to show only available payment methods

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const methods = [];

  if (process.env.BSB_NUMBER && process.env.ACCOUNT_NUMBER) {
    methods.push({
      id: 'aud',
      label: 'Bank Transfer (AUS, NZ)',
      currency: 'AUD',
      fields: [
        { label: 'Account Name', value: 'Australian Peptide Labs Store' },
        { label: 'BSB',          value: process.env.BSB_NUMBER },
        { label: 'Account No.',  value: process.env.ACCOUNT_NUMBER },
      ],
    });
  }

  if (process.env.EUR_IBAN) {
    methods.push({
      id: 'eur',
      label: 'Bank Transfer (EUR)',
      currency: 'EUR',
      fields: [
        { label: 'Account Name', value: process.env.EUR_ACCOUNT_NAME || 'Australian Peptide Labs Store' },
        { label: 'IBAN',         value: process.env.EUR_IBAN },
        { label: 'BIC / SWIFT',  value: process.env.EUR_BIC || '' },
        { label: 'Bank',         value: process.env.EUR_BANK_NAME || '' },
      ].filter(f => f.value),
    });
  }

  if (process.env.USD_ACCOUNT) {
    methods.push({
      id: 'usd',
      label: 'Bank Transfer (USD)',
      currency: 'USD',
      fields: [
        { label: 'Account Name',   value: process.env.USD_ACCOUNT_NAME || 'Australian Peptide Labs Store' },
        { label: 'Routing Number', value: process.env.USD_ROUTING || '' },
        { label: 'Account No.',    value: process.env.USD_ACCOUNT },
        { label: 'Bank',           value: process.env.USD_BANK_NAME || '' },
      ].filter(f => f.value),
    });
  }

  if (process.env.CAD_ACCOUNT) {
    methods.push({
      id: 'cad',
      label: 'Bank Transfer (CAD)',
      currency: 'CAD',
      fields: [
        { label: 'Account Name',   value: process.env.CAD_ACCOUNT_NAME || 'Australian Peptide Labs Store' },
        { label: 'Transit No.',    value: process.env.CAD_TRANSIT || '' },
        { label: 'Account No.',    value: process.env.CAD_ACCOUNT },
        { label: 'Bank',           value: process.env.CAD_BANK_NAME || '' },
      ].filter(f => f.value),
    });
  }

  if (process.env.GBP_ACCOUNT) {
    methods.push({
      id: 'gbp',
      label: 'Bank Transfer (UK / GBP)',
      currency: 'GBP',
      fields: [
        { label: 'Account Name', value: process.env.GBP_ACCOUNT_NAME || 'Australian Peptide Labs Store' },
        { label: 'Sort Code',    value: process.env.GBP_SORT || '' },
        { label: 'Account No.',  value: process.env.GBP_ACCOUNT },
        { label: 'Bank',         value: process.env.GBP_BANK_NAME || '' },
      ].filter(f => f.value),
    });
  }

  return res.status(200).json({ methods });
};
