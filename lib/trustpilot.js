const crypto = require('crypto');
const { validEmail } = require('./support-requests');

function invitationAddress() {
  const address = (process.env.TRUSTPILOT_AFS_EMAIL
    || process.env.trustpilot_afs_email
    || '').trim().toLowerCase();
  return validEmail(address) && address.endsWith('@invite.trustpilot.com') ? address : '';
}

function structuredData(value) {
  return JSON.stringify(value).replace(/[<>&]/g, char => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
  }[char]));
}

async function queueTrustpilotInvite({ order, email, name = '' }) {
  const apiKey = (process.env.RESEND_API_KEY || process.env.resend_api_key || '').trim();
  const to = invitationAddress();
  if (!apiKey || !to) return { status: 'disabled' };
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (typeof order !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(order) || !validEmail(normalizedEmail)) {
    return { status: 'failed' };
  }

  const payload = {
    recipientEmail: normalizedEmail,
    recipientName: typeof name === 'string' ? name.trim().slice(0, 160) : '',
    referenceId: order,
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="application/json+trustpilot">${structuredData(payload)}</script>
<p>PeptideLab order ${String(order).replace(/[&<>"']/g, '')} was dispatched.</p>
</body></html>`;
  const fingerprint = crypto.createHash('sha256')
    .update(`${order}:${payload.recipientEmail}:trustpilot-dispatch`)
    .digest('hex');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `trustpilot-dispatch-${fingerprint}`,
      },
      body: JSON.stringify({
        from: 'PeptideLab <orders@aupeptidelab.com>',
        to,
        subject: `PeptideLab order ${order} dispatched`,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok || typeof result.id !== 'string' || !result.id) throw new Error('Provider unavailable');
    return { status: 'accepted', id: result.id };
  } catch {
    console.error('Trustpilot invitation trigger unavailable');
    return { status: 'failed' };
  }
}

module.exports = { queueTrustpilotInvite };
if (process.env.NODE_ENV === 'test') module.exports._private = { invitationAddress, structuredData };
