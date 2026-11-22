const routes = require('../lib/public-routes');

const ROUTE_HANDLERS = Object.freeze({
  'bank-details': routes.bankDetails,
  inventory: routes.inventory,
  'commas-status': routes.commasStatus,
  'commas-checkout': routes.commasCheckout,
});

module.exports = async function handler(req, res) {
  const route = String(req.query?.route || '');
  if (!Object.hasOwn(ROUTE_HANDLERS, route)) return res.status(404).json({ error:'Not found' });
  return ROUTE_HANDLERS[route](req, res);
};
