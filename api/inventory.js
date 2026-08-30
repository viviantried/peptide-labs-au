const fs   = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const file = path.join(process.cwd(), 'inventory.json');
    const raw  = JSON.parse(fs.readFileSync(file, 'utf8'));

    const stock      = {};
    const restocking = {};

    for (const [id, val] of Object.entries(raw)) {
      if (typeof val === 'number') {
        stock[id]      = val;
        restocking[id] = false;
      } else {
        stock[id]      = val.stock      ?? 0;
        restocking[id] = val.restocking ?? false;
      }
    }

    return res.status(200).json({ stock, restocking });
  } catch (err) {
    return res.status(500).json({ error: 'Could not read inventory', stock: {}, restocking: {} });
  }
};
