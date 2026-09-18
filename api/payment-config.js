module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ stripeAvailable: process.env.STRIPE_ENABLED === 'true' && process.env.STRIPE_PRODUCT_ELIGIBLE === 'true' && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET });
};
