const fs   = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const file  = path.join(process.cwd(), 'inventory.json');
    const stock = JSON.parse(fs.readFileSync(file, 'utf8'));
    return res.status(200).json({ stock });
  } catch (err) {
    return res.status(500).json({ error: 'Could not read inventory', stock: {} });
  }
};
