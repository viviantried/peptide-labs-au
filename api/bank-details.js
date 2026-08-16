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
      label: 'Bank Transfer (AUS, NZ)',
      currency: 'AUD',
      fields: [
        { label: 'Account Name', value: 'Australian Peptide Labs Store' },
        { label: 'BSB',          value: BSB },
        { label: 'Account No.',  value: ACCOUNT },
      ],
    });
  }

  const EUR_IBAN    = process.env.EUR_IBAN        || process.env.eur_iban;
  const EUR_BIC     = process.env.EUR_BIC         || process.env.eur_bic        || '';
  const EUR_NAME    = process.env.EUR_ACCOUNT_NAME|| process.env.eur_account_name || 'Australian Peptide Labs Store';
  const EUR_BANK    = process.env.EUR_BANK_NAME   || process.env.eur_bank_name  || '';

  if (EUR_IBAN) {
    methods.push({
      id: 'eur', label: 'Bank Transfer (EUR)', currency: 'EUR',
      fields: [
        { label: 'Account Name', value: EUR_NAME },
        { label: 'IBAN',         value: EUR_IBAN },
        { label: 'BIC / SWIFT',  value: EUR_BIC },
        { label: 'Bank',         value: EUR_BANK },
      ].filter(f => f.value),
    });
  }

  const USD_ACCOUNT  = process.env.USD_ACCOUNT  || process.env.usd_account;
  const USD_ROUTING  = process.env.USD_ROUTING  || process.env.usd_routing  || '';
  const USD_NAME     = process.env.USD_ACCOUNT_NAME || process.env.usd_account_name || 'Australian Peptide Labs Store';
  const USD_BANK     = process.env.USD_BANK_NAME || process.env.usd_bank_name || '';

  if (USD_ACCOUNT) {
    methods.push({
      id: 'usd', label: 'Bank Transfer (USD)', currency: 'USD',
      fields: [
        { label: 'Account Name',   value: USD_NAME },
        { label: 'Routing Number', value: USD_ROUTING },
        { label: 'Account No.',    value: USD_ACCOUNT },
        { label: 'Bank',           value: USD_BANK },
      ].filter(f => f.value),
    });
  }

  const CAD_ACCOUNT  = process.env.CAD_ACCOUNT  || process.env.cad_account;
  const CAD_TRANSIT  = process.env.CAD_TRANSIT  || process.env.cad_transit  || '';
  const CAD_NAME     = process.env.CAD_ACCOUNT_NAME || process.env.cad_account_name || 'Australian Peptide Labs Store';
  const CAD_BANK     = process.env.CAD_BANK_NAME || process.env.cad_bank_name || '';

  if (CAD_ACCOUNT) {
    methods.push({
      id: 'cad', label: 'Bank Transfer (CAD)', currency: 'CAD',
      fields: [
        { label: 'Account Name', value: CAD_NAME },
        { label: 'Transit No.',  value: CAD_TRANSIT },
        { label: 'Account No.', value: CAD_ACCOUNT },
        { label: 'Bank',        value: CAD_BANK },
      ].filter(f => f.value),
    });
  }

  const GBP_ACCOUNT  = process.env.GBP_ACCOUNT  || process.env.gbp_account;
  const GBP_SORT     = process.env.GBP_SORT      || process.env.gbp_sort     || '';
  const GBP_NAME     = process.env.GBP_ACCOUNT_NAME || process.env.gbp_account_name || 'Australian Peptide Labs Store';
  const GBP_BANK     = process.env.GBP_BANK_NAME || process.env.gbp_bank_name || '';

  if (GBP_ACCOUNT) {
    methods.push({
      id: 'gbp', label: 'Bank Transfer (UK / GBP)', currency: 'GBP',
      fields: [
        { label: 'Account Name', value: GBP_NAME },
        { label: 'Sort Code',    value: GBP_SORT },
        { label: 'Account No.',  value: GBP_ACCOUNT },
        { label: 'Bank',         value: GBP_BANK },
      ].filter(f => f.value),
    });
  }

  return res.status(200).json({ methods });
};
