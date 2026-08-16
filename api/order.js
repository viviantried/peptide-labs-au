// Vercel serverless function — POST /api/order
// CommonJS — no vercel.json or package.json required

const BSB          = process.env.BSB_NUMBER      || process.env.bsb_number;
const ACCOUNT      = process.env.ACCOUNT_NUMBER  || process.env.account_number;
const RESEND_KEY   = process.env.RESEND_API_KEY  || process.env.resend_api_key;
const ACCOUNT_NAME = 'Australian Peptide Labs Store';
const OWNER_EMAIL  = 'support@aupeptidelab.com';
const FROM_EMAIL   = 'orders@aupeptidelab.com';

function generateOrderId() {
  const n = Math.floor((Date.now() / 1000) % 100000).toString().padStart(5, '0');
  return `PL-${n}`;
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `PeptideLab <${FROM_EMAIL}>`, to, subject, html }),
  });
  if (!res.ok) console.error('Resend error:', await res.text());
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    email, firstName, lastName,
    address1, address2, suburb, state, postcode, country, phone,
    items, subtotal, shipping, discount, total,
    promoCode, paymentMethod, paymentLabel,
  } = req.body;

  if (!email || !firstName || !lastName || !address1 || !suburb || !postcode || !items?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const orderName = generateOrderId();

  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadlineStr = deadline.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${i.name}${i.size ? ` — ${i.size}` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:14px">x${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px">A$${(i.price * i.qty).toFixed(2)}</td>
    </tr>`).join('');

  const customerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#000;padding:24px 32px">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
    <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 6px">Order Received — Payment Required</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px">Hi ${firstName}, thank you for your order. Please transfer within 24 hours to confirm it.</p>

    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 16px;margin:0 0 24px">
      <div style="font-size:13px;font-weight:700;color:#b45309">PAYMENT DUE BY ${deadlineStr.toUpperCase()} (AEST)</div>
      <div style="font-size:13px;color:#92400e;margin-top:4px">Your order will be cancelled if payment is not received in time.</div>
    </div>

    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;background:#fafafa">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Order Reference</div>
      <div style="font-size:28px;font-weight:800;color:#111;letter-spacing:-1px">${orderName}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin:0 0 8px">${itemsHtml}</table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 28px">
      <tr><td style="padding:6px 0;color:#666;font-size:14px">Subtotal</td><td style="padding:6px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td></tr>
      ${Number(discount) > 0 ? `<tr><td style="padding:6px 0;color:#16a34a;font-size:14px">Discount${promoCode ? ` (${promoCode})` : ''}</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#16a34a">−A$${Number(discount).toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#666;font-size:14px">Shipping</td><td style="padding:6px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : 'A$' + Number(shipping).toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700;font-size:16px;border-top:2px solid #111">Total Due</td><td style="padding:10px 0;text-align:right;font-weight:800;font-size:18px;color:#111;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td></tr>
    </table>

    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:22px;margin:0 0 24px">
      <h2 style="font-size:16px;font-weight:700;color:#111;margin:0 0 16px">Bank Transfer Details</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#555;font-size:14px;width:44%">Account Name</td><td style="padding:6px 0;font-weight:700;font-size:14px">${ACCOUNT_NAME}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">BSB</td><td style="padding:6px 0;font-weight:700;font-size:14px">${BSB}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Account Number</td><td style="padding:6px 0;font-weight:700;font-size:14px">${ACCOUNT}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Amount</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#16a34a">A$${Number(total).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;font-size:14px">Reference</td><td style="padding:6px 0;font-weight:800;font-size:15px;color:#dc2626">${orderName}</td></tr>
      </table>
      <div style="margin-top:14px;padding:10px 12px;background:#dcfce7;border-radius:6px;font-size:13px;color:#166534">Always use <strong>${orderName}</strong> as your payment reference.</div>
    </div>

    <p style="color:#666;font-size:13px;margin:0 0 8px">Once your payment clears, your order will be dispatched within 1-2 business days. A <strong>dispatch confirmation email</strong> with your tracking number will be sent when your order ships.</p>
    <div style="margin:0 0 16px;padding:12px 16px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;font-size:13px;color:#3730a3">
      📦 <strong>To track your order:</strong> Visit <a href="https://www.aupeptidelab.com" style="color:#3730a3">aupeptidelab.com</a> → Track Order, and enter your tracking number from the dispatch email.
    </div>
    <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">PeptideLab — For research use only. Not for human consumption.</p>
  </div>
</div>
</body></html>`;

  const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#111;padding:20px 32px">
    <div style="color:#fff;font-size:17px;font-weight:700">New Order — ${orderName}</div>
    <div style="color:#aaa;font-size:13px;margin-top:2px">A$${Number(total).toFixed(2)} — Awaiting BSB Transfer</div>
  </div>
  <div style="padding:28px 32px">
    <div style="margin-bottom:20px">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Customer</div>
      <div style="font-size:14px;font-weight:700">${firstName} ${lastName}</div>
      <div style="font-size:13px;color:#555">${email}${phone ? ' · ' + phone : ''}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">${address1}${address2 ? ', ' + address2 : ''}, ${suburb} ${state || ''} ${postcode}, ${country}</div>
    </div>

    <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Items</div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">${itemsHtml}
      <tr><td style="padding:8px 0;color:#666;font-size:14px">Subtotal</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td></tr>
      ${Number(discount) > 0 ? `<tr><td style="padding:8px 0;color:#16a34a;font-size:14px">Discount${promoCode ? ` (${promoCode})` : ''}</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px;color:#16a34a">−A$${Number(discount).toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666;font-size:14px">Shipping${Number(shipping) === 0 ? ' (free)' : ''}</td><td></td><td style="padding:8px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : 'A$' + Number(shipping).toFixed(2)}</td></tr>
      <tr><td style="padding:12px 0;font-weight:800;font-size:16px;border-top:2px solid #111">TOTAL</td><td style="border-top:2px solid #111"></td><td style="padding:12px 0;text-align:right;font-weight:800;font-size:18px;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td></tr>
    </table>

    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:14px 16px">
      <div style="font-size:13px;font-weight:700;color:#92400e">Expires: ${deadlineStr} AEST</div>
      <div style="font-size:13px;color:#78350f;margin-top:4px">Watch for a transfer with reference <strong>${orderName}</strong>. Once confirmed, dispatch the order.</div>
    </div>
  </div>
</div>
</body></html>`;

  try {
    await Promise.all([
      sendEmail(email, `Order ${orderName} — Complete Your Bank Transfer`, customerHtml),
      sendEmail(OWNER_EMAIL, `New Order ${orderName} — A$${Number(total).toFixed(2)} (BSB pending)`, ownerHtml),
    ]);
  } catch (err) {
    console.error('Email error:', err);
  }

  return res.status(200).json({ orderName, bsb: BSB, acct: ACCOUNT });
};
