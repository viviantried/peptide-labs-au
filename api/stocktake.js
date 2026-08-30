// GET  /api/stocktake?key=ADMIN_KEY  — serve admin stocktake page
// POST /api/stocktake                — save updated inventory to GitHub

const ADMIN_KEY    = process.env.admin_key || process.env.ADMIN_KEY;
const GITHUB_TOKEN = process.env.github_inventory_token || process.env.GITHUB_TOKEN;
const REPO         = 'viviantried/peptide-labs-au';
const FILE_PATH    = 'inventory.json';

const PRODUCTS = {
  'PL-001': 'Retatrutide 10mg',
  'PL-002': 'BPC-157 10mg',
  'PL-003': 'TB-500 5mg',
  'PL-004': 'Tesamorelin 5mg',
  'PL-005': 'Semax 10mg',
  'PL-006': 'Selank 10mg',
  'PL-007': 'DSIP 5mg',
  'PL-008': 'Melanotan-2 10mg',
  'PL-009': 'Melanotan-1 10mg',
  'PL-011': 'NAD+ 500mg',
  'PL-012': 'GHK-Cu 50mg',
  'PL-013': 'Glutathione 1500mg',
  'PL-014': 'BAC Water 10ml',
};

async function getInventoryFromGitHub() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('Could not fetch inventory from GitHub');
  const json = await r.json();
  const content = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
  return { content, sha: json.sha };
}

async function saveInventoryToGitHub(newContent, sha) {
  const encoded = Buffer.from(JSON.stringify(newContent, null, 2)).toString('base64');
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Stocktake update via admin panel',
      content: encoded,
      sha,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const { key } = req.query;
    if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).send(errorPage('Unauthorised'));

    let content, sha;
    try {
      ({ content, sha } = await getInventoryFromGitHub());
    } catch (err) {
      return res.status(500).send(errorPage('Could not load inventory: ' + err.message));
    }

    return res.status(200).send(adminPage(content, sha));
  }

  if (req.method === 'POST') {
    const { key, sha, inventory } = req.body || {};
    if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorised' });
    if (!inventory || !sha) return res.status(400).json({ error: 'Missing data' });

    try {
      await saveInventoryToGitHub(inventory, sha);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).send('Method not allowed');
};

function adminPage(inv, sha) {
  const rows = Object.entries(PRODUCTS).map(([id, name]) => {
    const entry = inv[id] || { stock: 0, weekly_sold: 0, restocking: false };
    const stock  = typeof entry === 'number' ? entry : (entry.stock ?? 0);
    const weekly = typeof entry === 'number' ? 0 : (entry.weekly_sold ?? 0);
    const restock = typeof entry === 'number' ? false : (entry.restocking ?? false);
    const need   = weekly * 2;
    const urgent = stock < need && need > 0;
    return `<tr>
      <td style="padding:12px 14px;font-weight:600;color:#111">${name}</td>
      <td style="padding:12px 14px;text-align:center">
        <input type="number" min="0" data-id="${id}" data-field="stock"
          value="${stock}" style="width:72px;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:14px;text-align:center;outline:none">
      </td>
      <td style="padding:12px 14px;text-align:center">
        <input type="number" min="0" data-id="${id}" data-field="weekly_sold"
          value="${weekly}" style="width:72px;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:14px;text-align:center;outline:none">
      </td>
      <td style="padding:12px 14px;text-align:center;font-weight:700;color:${urgent ? '#dc2626' : need === 0 ? '#9ca3af' : '#16a34a'}">
        ${need === 0 ? '—' : `${need} units${urgent ? ' ⚠️' : ''}`}
      </td>
      <td style="padding:12px 14px;text-align:center">
        <input type="checkbox" data-id="${id}" data-field="restocking"
          ${restock ? 'checked' : ''}
          style="width:18px;height:18px;accent-color:#111;cursor:pointer">
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PeptideLab Stocktake</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif}
  table{width:100%;border-collapse:collapse}
  thead th{background:#111;color:#fff;padding:12px 14px;text-align:left;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
  thead th:not(:first-child){text-align:center}
  tbody tr:nth-child(even){background:#f9fafb}
  tbody tr:hover{background:#f0f4ff}
  input[type=number]:focus{border-color:#111;box-shadow:0 0 0 2px rgba(0,0,0,.1)}
  #toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:#111;color:#fff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;transition:transform .3s;z-index:100}
  #toast.show{transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div style="background:#111;padding:18px 28px;display:flex;align-items:center;justify-content:space-between">
  <div style="color:#fff;font-size:18px;font-weight:800">PeptideLab — Stocktake</div>
  <div style="color:#888;font-size:12px">Updates go live in ~1 min after save</div>
</div>

<div style="max-width:900px;margin:28px auto;padding:0 16px">

  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:20px">
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:16px;font-weight:700;color:#111">Inventory Count</div>
        <div style="font-size:13px;color:#888;margin-top:2px">Enter actual counted stock. Weekly sold = units shipped in last 7 days.</div>
      </div>
      <button id="saveBtn" onclick="save()"
        style="background:#111;color:#fff;border:none;border-radius:8px;padding:11px 28px;font-size:14px;font-weight:700;cursor:pointer">
        Save Changes
      </button>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Stock on Hand</th>
            <th>Sold Last 7 Days</th>
            <th>Reorder Suggestion<br><span style="font-size:11px;font-weight:400;opacity:.7">(14-day supply needed)</span></th>
            <th>Restocking Soon</th>
          </tr>
        </thead>
        <tbody id="inventoryBody">${rows}</tbody>
      </table>
    </div>
  </div>

  <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px 20px">
    <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px">How reorder suggestions work</div>
    <div style="font-size:13px;color:#78350f;line-height:1.7">
      <strong>Reorder suggestion</strong> = Weekly sold × 2 (covers your 14-day supplier lead time).<br>
      Items shown in <span style="color:#dc2626;font-weight:700">red</span> have less stock than the suggestion — order more now.<br>
      Tick <strong>Restocking Soon</strong> to show a badge on the website while you wait for stock to arrive.
    </div>
  </div>
</div>

<div id="toast">✓ Inventory saved — site updating</div>

<script>
const SHA = ${JSON.stringify(sha)};
const KEY = new URLSearchParams(location.search).get('key');

function collectInventory() {
  const inv = {};
  document.querySelectorAll('[data-id]').forEach(el => {
    const id    = el.dataset.id;
    const field = el.dataset.field;
    if (!inv[id]) inv[id] = { stock: 0, weekly_sold: 0, restocking: false };
    if (field === 'restocking') inv[id].restocking = el.checked;
    else inv[id][field] = parseInt(el.value) || 0;
  });
  return inv;
}

async function save() {
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;
  const inventory = collectInventory();
  try {
    const r = await fetch('/api/stocktake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: KEY, sha: SHA, inventory }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  } catch (err) {
    alert('Error: ' + err.message);
  }
  btn.textContent = 'Save Changes';
  btn.disabled = false;
}
</script>
</body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head>
<body style="margin:0;padding:60px 20px;background:#f5f5f5;font-family:Arial,sans-serif;text-align:center">
<div style="max-width:400px;margin:0 auto;background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:32px">
  <h2 style="color:#dc2626;margin:0 0 8px">Access Denied</h2>
  <p style="color:#555;margin:0">${msg}</p>
</div></body></html>`;
}
