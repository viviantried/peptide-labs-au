// Vercel serverless function — POST /api/order
// No Shopify. Generates order number, sends customer + owner emails via Resend.

const RESEND_KEY   = process.env.RESEND_API_KEY;
const BSB          = process.env.BSB_NUMBER;      // e.g. "063-000"
const ACCOUNT      = process.env.ACCOUNT_NUMBER;  // e.g. "12345678"
const ACCOUNT_NAME = 'Australian Peptide Labs Store';
const OWNER_EMAIL  = 'support@aupeptidelab.com';
const FROM_EMAIL   = 'orders@aupeptidelab.com';   // must be verified in Resend

function generateOrderId() {
  // PL-XXXXX — timestamp-based, looks sequential
  const n = Math.floor((Date.now() / 1000) % 100000).toString().padStart(5, '0');
  return `PL-${n}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    email, firstName, lastName,
    address1, address2, suburb, state, postcode, country, phone,
    items, subtotal, shipping, total,
  } = req.body;

  if (!email || !firstName || !lastName || !address1 || !suburb || !postcode || !items?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const orderName = generateOrderId();

  // 24-hour deadline (AEST)
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadlineStr = deadline.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${i.name}${i.size ? ` — ${i.size}` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:14px">×${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;white-space:nowrap">A$${(i.price * i.qty).toFixed(2)}</td>
    </tr>`).join('');

  const itemsText = items.map(i =>
    `  ${i.name}${i.size ? ` (${i.size})` : ''} × ${i.qty} — A$${(i.price * i.qty).toFixed(2)}`
  ).join('\n');

  // ── Customer confirmation email ──────────────────────────────
  const customerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
    <div style="background:#000;padding:24px 32px">
      <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px">PeptideLab</div>
      <div style="color:#888;font-size:12px;margin-top:2px">aupeptidelab.com</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 6px">Order Received — Payment Required</h1>
      <p style="color:#666;margin:0 0 24px;font-size:15px">Hi ${firstName}, thank you for your order. Transfer within 24 hours to confirm it.</p>

      <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 16px;margin:0 0 24px">
        <div style="font-size:13px;font-weight:700;color:#b45309">⏰ PAYMENT DUE BY ${deadlineStr.toUpperCase()} (AEST)</div>
        <div style="font-size:13px;color:#92400e;margin-top:4px">Your order will be automatically cancelled if payment is not received.</div>
      </div>

      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;background:#fafafa">
        <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Order Reference</div>
        <div style="font-size:28px;font-weight:800;color:#111;letter-spacing:-1px">${orderName}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin:0 0 8px">${itemsHtml}</table>
      <table style="width:100%;border-collapse:collapse;margin:0 0 28px">
        <tr>
          <td style="padding:6px 0;color:#666;font-size:14px">Subtotal</td>
          <td style="padding:6px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;font-size:14px">Shipping</td>
          <td style="padding:6px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : `A$${Number(shipping).toFixed(2)}`}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-weight:700;font-size:16px;border-top:2px solid #111">Total Due</td>
          <td style="padding:10px 0;text-align:right;font-weight:800;font-size:18px;color:#111;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td>
        </tr>
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
        <div style="margin-top:14px;padding:10px 12px;background:#dcfce7;border-radius:6px;font-size:13px;color:#166534;line-height:1.5">
          ⚠ Always use <strong>${orderName}</strong> as your payment reference so we can identify your transfer.
        </div>
      </div>

      <p style="color:#666;font-size:13px;margin:0 0 6px">Once your payment clears (usually same business day), your order will be dispatched within 1–2 business days.</p>
      <p style="color:#666;font-size:13px;margin:0">Questions? <a href="mailto:support@aupeptidelab.com" style="color:#111;font-weight:600">support@aupeptidelab.com</a></p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
      <p style="margin:0;font-size:12px;color:#aaa">PeptideLab · For research use only · Not for human consumption</p>
    </div>
  </div>
</body></html>`;

  // ── Owner notification email ─────────────────────────────────
  const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
    <div style="background:#111;padding:20px 32px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:#fff;font-size:17px;font-weight:700">New Order — ${orderName}</div>
        <div style="color:#aaa;font-size:13px;margin-top:2px">Awaiting BSB transfer · A$${Number(total).toFixed(2)}</div>
      </div>
      <div style="background:#fef08a;color:#713f12;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">PENDING PAYMENT</div>
    </div>
    <div style="padding:28px 32px">
      <div style="display:flex;gap:24px;margin-bottom:24px">
        <div style="flex:1">
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Customer</div>
          <div style="font-size:14px;font-weight:700;color:#111">${firstName} ${lastName}</div>
          <div style="font-size:13px;color:#555;margin-top:2px">${email}</div>
          ${phone ? `<div style="font-size:13px;color:#555">${phone}</div>` : ''}
        </div>
        <div style="flex:1">
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Ship To</div>
          <div style="font-size:13px;color:#555;line-height:1.7">${address1}${address2 ? '<br/>' + address2 : ''}<br/>${suburb} ${state || ''} ${postcode}<br/>${country}</div>
        </div>
      </div>

      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Items Ordered</div>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px">${itemsHtml}
        <tr>
          <td style="padding:8px 0;color:#666;font-size:14px">Subtotal</td>
          <td></td>
          <td style="padding:8px 0;text-align:right;font-size:14px">A$${Number(subtotal).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#666;font-size:14px">Shipping</td>
          <td></td>
          <td style="padding:8px 0;text-align:right;font-size:14px">${Number(shipping) === 0 ? 'FREE' : `A$${Number(shipping).toFixed(2)}`}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;font-weight:800;font-size:16px;border-top:2px solid #111">TOTAL</td>
          <td style="border-top:2px solid #111"></td>
          <td style="padding:12px 0;text-align:right;font-weight:800;font-size:18px;border-top:2px solid #111">A$${Number(total).toFixed(2)}</td>
        </tr>
      </table>

      <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:#92400e">Order expires: ${deadlineStr} AEST</div>
        <div style="font-size:13px;color:#78350f;margin-top:4px">Check your bank for a transfer with reference <strong>${orderName}</strong>. Once confirmed, fulfil and dispatch.</div>
      </div>
    </div>
  </div>
</body></html>`;

  // ── Send both emails ─────────────────────────────────────────
  try {
    const [r1, r2] = await Promise.all([
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `PeptideLab <${FROM_EMAIL}>`,
          to: email,
          subject: `Order ${orderName} — Complete Your Bank Transfer`,
          html: customerHtml,
        }),
      }),
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `PeptideLab Orders <${FROM_EMAIL}>`,
          to: OWNER_EMAIL,
          subject: `New Order ${orderName} — A$${Number(total).toFixed(2)} (awaiting BSB)`,
          html: ownerHtml,
        }),
      }),
    ]);

    if (!r1.ok || !r2.ok) {
      console.error('Resend error:', await r1.text(), await r2.text());
    }
  } catch (err) {
    console.error('Email send error:', err);
    // Still return success — order number was generated, owner was notified if first email sent
  }

  return res.status(200).json({ orderName, bsb: BSB, acct: ACCOUNT });
}
