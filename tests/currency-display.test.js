const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const section = html.slice(html.indexOf('// CURRENCY\n'), html.indexOf('// SUBSCRIPTION TOGGLE'));

function currencyPage(fetch, savedCurrency = null) {
  const elements = {
    currencySelect: { value: 'AUD', disabled: false },
    mobileCurrencySelect: { value: 'AUD', disabled: false },
    currencyDisplayNote: { hidden: true, textContent: '' },
    coOverlay: { classList: { contains() { return false; } } },
  };
  const storage = new Map(savedCurrency ? [['pl-display-currency', savedCurrency]] : []);
  const context = vm.createContext({
    fetch,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
    document: { getElementById(id) { return elements[id]; } },
    renderFeatured() {}, renderShop() {}, renderReconSupplies() {},
    updatePdpPrices() {}, renderCart() {},
  });
  vm.runInContext(section, context);
  return { context, elements, storage };
}

function rates(date = new Date().toISOString().slice(0, 10)) {
  return ['USD', 'EUR', 'GBP', 'NZD', 'CAD'].map((quote, index) => ({
    date, base: 'AUD', quote, rate: [0.7, 0.6, 0.5, 1.2, 0.9][index],
  }));
}

test('currency selector converts display prices and persists the selected currency', async () => {
  let requests = 0;
  const { context, elements, storage } = currencyPage(async url => {
    requests++;
    assert.match(url, /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?base=AUD&quotes=/);
    return { ok: true, json: async () => rates() };
  });
  await context.setCurrency('USD');
  assert.equal(context.fmtPrice(100), 'US$70.00');
  assert.equal(elements.mobileCurrencySelect.value, 'USD');
  assert.equal(storage.get('pl-display-currency'), 'USD');
  assert.match(elements.currencyDisplayNote.textContent, /Bank-transfer payment is completed in AUD/);
  await context.setCurrency('EUR');
  assert.equal(context.fmtPrice(100), '€60.00');
  assert.equal(requests, 1);
  await context.setCurrency('AUD');
  assert.equal(context.fmtPrice(100), 'A$100.00');
  assert.equal(elements.currencyDisplayNote.hidden, true);
  assert.match(html, /coSumTotal'\)\.textContent\s*=\s*fmtPrice\(total\)/);
  assert.match(html, /coSumShipping'\)\.textContent\s*=\s*shippingReady[\s\S]*?fmtPrice\(ship\)/);
  assert.match(html, /co-pay-amt-inline'[\s\S]*?`A\$\$\{total\.toFixed\(2\)\}`/);
});

test('saved display currency is restored across navigation or reloads', async () => {
  const { context, elements } = currencyPage(async () => ({ ok: true, json: async () => rates() }), 'CAD');
  await context.restoreCurrencyPreference();
  assert.equal(context.fmtPrice(100), 'C$90.00');
  assert.equal(elements.currencySelect.value, 'CAD');
  assert.equal(elements.mobileCurrencySelect.value, 'CAD');
});

test('unavailable or stale rates never show invented converted prices', async () => {
  for (const fetch of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => rates('2020-01-01') }),
    async () => ({ ok: true, json: async () => rates().slice(0, 4) }),
  ]) {
    const { context, elements } = currencyPage(fetch);
    await context.setCurrency('GBP');
    assert.equal(context.fmtPrice(100), 'A$100.00');
    assert.equal(elements.currencySelect.value, 'AUD');
    assert.equal(elements.currencySelect.disabled, false);
    assert.match(elements.currencyDisplayNote.textContent, /unavailable/);
  }
});

test('all six display options and the mobile selector are present', () => {
  const selector = html.match(/<select class="nav__currency"[\s\S]*?<\/select>/)?.[0] || '';
  for (const code of ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD']) assert.match(selector, new RegExp(`value="${code}"`));
  assert.match(selector, /onchange="setCurrency\(this\.value\)"/);
  assert.match(html, /id="mobileCurrencySelect"[\s\S]*onchange="setCurrency\(this\.value\)"/);
  assert.doesNotMatch(html, /cartCurrencyNote|Prices in/);
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  assert.doesNotMatch(css, /@media\(max-width:768px\)\{\.nav__currency\{display:none\}\}/);
});
