const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('storefront uses the supported Australia Post tracking URL', () => {
  const storefront = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(
    storefront,
    /auspost:\s*`https:\/\/auspost\.com\.au\/track\/\$\{encodeURIComponent\(num\)\}`/
  );
  assert.doesNotMatch(storefront, /auspost\.com\.au\/mypost\/tracking/);
});

test('dispatch emails use the supported Australia Post tracking URL', () => {
  const handler = fs.readFileSync(path.join(root, 'api', 'send-tracking.js'), 'utf8');

  assert.match(handler, /'Australia Post': 'https:\/\/auspost\.com\.au\/track\/'/);
  assert.doesNotMatch(handler, /auspost\.com\.au\/mypost\/track/);
});
