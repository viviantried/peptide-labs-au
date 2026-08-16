// GET /api/test-email — sends a test email and returns the result
// Remove or protect this endpoint after debugging

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const RESEND_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const FROM_EMAIL = 'orders@aupeptidelab.com';
  const TO_EMAIL   = 'support@aupeptidelab.com';

  if (!RESEND_KEY) {
    return res.status(200).json({
      ok: false,
      error: 'RESEND_API_KEY env var is not set',
      hint: 'Add resend_api_key to your Vercel environment variables',
    });
  }

  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `PeptideLab <${FROM_EMAIL}>`,
        to: TO_EMAIL,
        subject: 'PeptideLab — Email test',
        html: '<p>This is a test email from your PeptideLab store. If you received this, email sending is working correctly.</p>',
      }),
    });

    const body = await result.json();

    return res.status(200).json({
      ok: result.ok,
      status: result.status,
      resend_response: body,
      from: FROM_EMAIL,
      to: TO_EMAIL,
      key_prefix: RESEND_KEY.slice(0, 8) + '...',
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
