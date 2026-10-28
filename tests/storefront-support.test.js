const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let requests;
beforeEach(() => {
  requests = [];
  for (const key of ['RESEND_API_KEY', 'resend_api_key', 'AIRTABLE_TOKEN', 'airtable_token']) delete process.env[key];
  process.env.CONFIRM_SECRET = 'local-test-secret';
  global.fetch = async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request'); };
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function load(name) {
  const path = require.resolve(`../api/${name}`);
  delete require.cache[path];
  return require(path);
}
async function invoke(name, body, overrides = {}) {
  const res = {
    headers: {}, code: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
  await load(name)({ method: 'POST', body, headers: { host: 'localhost:4187', origin: 'http://localhost:4187' }, ...overrides }, res);
  return res;
}
function provider(status, body) {
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}
const contact = { name: 'Test researcher', email: 'researcher@example.com', topic: 'Order Support', orderNumber: '', message: 'Please check my order.', requestId: 'a6e6942e-5414-4bed-8b01-3be2248f7b39' };

test('contact fails honestly without a configured email service', async () => {
  const result = await invoke('contact', contact);
  assert.equal(result.code, 503);
  assert.match(result.body.error, /could not send/i);
  assert.equal(requests.length, 0);
});
test('contact rejects invalid fields and cross-origin submissions without sending', async () => {
  for (const invalid of [{ email: 'bad' }, { topic: 'Spam' }, { message: ' '.repeat(20) }, { message: 'x'.repeat(5001) }, { website: 'spam.test' }, { requestId: '../../bad' }]) {
    assert.equal((await invoke('contact', { ...contact, ...invalid })).code, 400);
  }
  assert.equal((await invoke('contact', contact, { headers: { host: 'localhost:4187', origin: 'https://unrelated.example' } })).code, 403);
  assert.equal((await invoke('contact', contact, { method: 'GET' })).code, 405);
  assert.equal(requests.length, 0);
});
test('contact requires provider acceptance with an email ID', async () => {
  process.env.RESEND_API_KEY = 'local-fake';
  for (const [status, body] of [[429, {}], [500, {}], [200, {}]]) {
    provider(status, body);
    assert.equal((await invoke('contact', contact)).code, 503);
  }
  provider(200, { id: 'test-email-id' });
  assert.equal((await invoke('contact', contact)).body.ok, true);
});
test('contact escapes submitted content and uses stable payload-specific retry keys', async () => {
  process.env.RESEND_API_KEY = 'local-fake';
  provider(200, { id: 'test-email-id' });
  const body = { ...contact, name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>\nNext line' };
  await invoke('contact', body);
  await invoke('contact', body);
  await invoke('contact', { ...body, message: 'Edited message' });
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.to, 'support@aupeptidelab.com');
  assert.equal(sent.reply_to, contact.email);
  assert.doesNotMatch(sent.html, /<script>|<img/);
  assert.match(sent.html, /&lt;img/);
  assert.match(sent.html, /<br>Next line/);
  assert.equal(requests[0].options.headers['Idempotency-Key'], requests[1].options.headers['Idempotency-Key']);
  assert.notEqual(requests[1].options.headers['Idempotency-Key'], requests[2].options.headers['Idempotency-Key']);
});
test('restock fails when neither storage nor email is available', async () => {
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).code, 503);
  assert.equal(requests.length, 0);
});
test('restock rejects inherited property names and malformed addresses', async () => {
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'constructor' })).code, 400);
  assert.equal((await invoke('restock-alert', { email: '<img>@example.com', productId: 'PL-001' })).code, 400);
});
test('restock reports a stored request only after successful storage', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  provider(200, {});
  const result = await invoke('restock-alert', { email: ' Researcher@EXAMPLE.com ', productId: 'PL-001' });
  assert.deepEqual(result.body, { ok: true, delivery: 'stored' });
  assert.equal(JSON.parse(requests[0].options.body).records[0].fields.Email, 'researcher@example.com');
  assert.equal(requests.length, 1);
});
test('restock distinguishes an accepted support fallback from a saved alert', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  process.env.RESEND_API_KEY = 'local-fake';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: url.includes('resend.com'), status: url.includes('resend.com') ? 200 : 500, json: async () => ({ id: 'test-email-id' }) };
  };
  assert.deepEqual((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).body, { ok: true, delivery: 'support' });
  provider(500, {});
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).code, 503);
});
test('restock retries storage after successfully creating a missing table', async () => {
  process.env.AIRTABLE_TOKEN = 'local-fake';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: requests.length > 1, status: requests.length === 1 ? 404 : 200 };
  };
  assert.equal((await invoke('restock-alert', { email: contact.email, productId: 'PL-001' })).body.delivery, 'stored');
  assert.equal(requests.length, 3);
});
function feedback(extra = {}) {
  const order = 'PL-TEST';
  const email = contact.email;
  const token = crypto.createHmac('sha256', process.env.CONFIRM_SECRET).update(`${order}:${email}:feedback`).digest('hex').slice(0, 20);
  return { order, email, token, rating: 5, comment: 'Good packaging', ...extra };
}
test('feedback rejects malformed ratings instead of accepting empty star counts', async () => {
  for (const rating of ['nope', 0, 6, 2.5]) assert.equal((await invoke('feedback', feedback({ rating }))).code, 400);
  assert.equal(requests.length, 0);
});
test('feedback preserves escaped text after provider failure and only thanks after acceptance', async () => {
  const result = await invoke('feedback', feedback({ comment: '</textarea><script>alert(1)</script>' }));
  assert.equal(result.code, 503);
  assert.match(result.body, /could not submit/);
  assert.match(result.body, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.doesNotMatch(result.body, /<script>/);
  process.env.RESEND_API_KEY = 'local-fake';
  provider(200, { id: 'test-email-id' });
  assert.match((await invoke('feedback', feedback())).body, /Thank you/);
});
test('all inline storefront scripts parse after edits', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(require.resolve('../storefront-support.js'), 'utf8'));
});
test('storefront keeps removed sections out and presents a compact bundle selector', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  for (const removed of [
    'id="page-quality"',
    "showPage('quality')",
    "switchTab(this,'specs')",
    'id="tab-specs"',
    'id="pdpSpecTable"',
    'class="pdp-delivery-estimate"',
    'class="pdp-payment-note"',
    'class="bundle-savings-banner"',
    '${p.tags[0]}',
  ]) assert.equal(html.includes(removed), false, `${removed} should remain removed`);
  assert.doesNotMatch(html, /<section class="hero hero--catalog">/);
  const trustStrip = html.match(/<div class="trust-strip">[\s\S]*?<section class="orders-proof"/)?.[0] || '';
  assert.doesNotMatch(trustStrip, /Australian Bank Transfer/);
  assert.match(css, /\.hero\s*\{[^}]*background:#171F33/s);
  const productOrder = [...html.matchAll(/\{ id:'PL-\d+', name:'([^']+)'/g)].map(match => match[1]);
  assert.equal(productOrder.indexOf('Retatrutide') + 1, productOrder.indexOf('GHK-Cu'));
  assert.match(html, /Storage before and after reconstitution/);
  assert.match(html, /Before reconstitution:<\/strong> Keep the sealed lyophilised vial dry/);
  assert.match(html, /After reconstitution:<\/strong> Follow the product and lot instructions/);
  assert.doesNotMatch(html, /This page does not establish a preparation protocol or expiry date/);
  assert.match(css, /\.pdp-bundle-box\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.pdp-bundle-box__tiers\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,1fr\)\)/s);
  assert.match(html, /class="pdp-bundle-option pdp-bundle-option--mix"[^>]*onclick="openMixBundleBuilder\(\)"/);
  assert.match(html, /<strong class="pdp-bundle-option__qty">Mix 10<\/strong>[\s\S]*?−25%/);
  assert.match(html, /id="pdpAddon"[\s\S]*?id="pdpAddWater"[\s\S]*?Add BAC Water/);
  assert.match(html, /function addPdpSelection\(destination\)[\s\S]*?const lines = \[\{ product: currentProduct, quantity: pdpBundleQuantity \}\]/);
  assert.match(html, /<strong>Nationwide Australian delivery is available<\/strong>, with international shipping to New Zealand and selected destinations across North America, Europe and Asia/);
  assert.doesNotMatch(html, /Australian customers can choose <strong>standard shipping/);
  assert.match(css, /\.product-page-grid\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*390px\)\s*minmax\(0,\s*620px\)/s);
  assert.match(css, /\.product-page-img\s*\{[^}]*aspect-ratio:\s*auto;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.pdp-product-photo,\s*\n\.pdp-product-photo--kit\s*\{[^}]*width:\s*100%;[^}]*max-height:\s*480px;[^}]*object-fit:\s*contain;/s);
});

test('home landing keeps responsive heroes, four featured products, and accessible navigation', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  const offerController = fs.readFileSync(require.resolve('../giveaway.js'), 'utf8');
  const home = html.match(/<div class="page active" id="page-home">[\s\S]*?<div class="page" id="page-reconstitution">/)?.[0] || '';
  const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const mobileHero = home.match(/<section class="mobile-hero"[\s\S]*?<\/section>/)?.[0] || '';
  const featuredRenderer = html.match(/function renderFeatured\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(home, /hero--catalog/);
  assert.match(home, /class="desktop-hero"/);
  assert.match(home, /class="desktop-hero__eyebrow">Research Peptides<\/div>/);
  assert.match(home, /id="desktopHeroTitle">The Standard for Research-Grade Peptide Supply<\/h2>/);
  assert.match(home, /Research compounds with straightforward ordering and local support\./);
  assert.match(home, /id="heroSearch"[^>]*placeholder="Search compounds"/);
  assert.match(home, /class="hero-finder__button"[^>]*>Shop Peptides<\/button>/);
  for (const compound of ['Retatrutide', 'BPC-157', 'TB-500', 'GHK-Cu', 'Tesamorelin', 'All compounds']) {
    assert.match(home, new RegExp(`>${compound}(?: <span[^>]*>→<\\/span>)?<\\/button>`));
  }
  assert.match(home, /class="desktop-hero__visual"[\s\S]*src="\/images\/hero-peptide-vials-navy\.webp"/);
  assert.match(mobileHero, /aria-labelledby="mobileHeroTitle"/);
  assert.match(mobileHero, /id="mobileHeroTitle"><span>Laboratory Grade<\/span>\s*<span>Research Peptides<\/span><\/h2>/);
  assert.doesNotMatch(mobileHero, /mobile-hero__(?:search|shop|chips|trust)/);
  assert.doesNotMatch(mobileHero, /≥98%|independent lab reports|COA per batch/i);
  assert.match(home, /class="section-label">Popular compounds<\/div>/);
  assert.match(home, /<h1 id="popularPeptidesTitle">Popular compounds<\/h1>/);
  assert.doesNotMatch(home, /Popular research products/);
  assert.match(home, /aria-label="View all compounds"[^>]*>View all <span aria-hidden="true">→<\/span>/);
  assert.match(nav, /id="mobileToggle"[\s\S]*aria-controls="mobileMenu"/);
  assert.match(nav, /class="nav__icon-btn nav__mobile-search"/);
  assert.match(html, /id="siteSearch"[\s\S]*placeholder="Search products"/);
  assert.match(html, /id="mobileMenu"[\s\S]*Shop by research area/);
  assert.doesNotMatch(home, /id="verification-standard"/);
  assert.doesNotMatch(home, /Proof over promises/);
  assert.doesNotMatch(home, /Start with the product information/);
  assert.doesNotMatch(home, /class="final-cta"/);
  assert.ok(home.indexOf('class="desktop-hero"') < home.indexOf('class="section featured-products"'));
  assert.ok(home.indexOf('class="desktop-hero"') < home.indexOf('class="mobile-hero"'));
  assert.ok(home.indexOf('class="mobile-hero"') < home.indexOf('class="section featured-products"'));
  assert.ok(home.indexOf('class="trust-strip"') < home.indexOf('class="section featured-products"'));
  assert.ok(home.indexOf('class="section featured-products"') < home.indexOf('class="orders-proof"'));
  assert.ok(home.indexOf('class="orders-proof"') < home.indexOf('class="discreet-packaging"'));
  assert.ok(home.indexOf('class="discreet-packaging"') < home.indexOf('id="homeReconstitutionMount"'));
  assert.match(featuredRenderer, /makeMixBundleCard\(true\) \+ featured\.map/);
  assert.match(featuredRenderer, /\['PL-001', 'PL-015', 'PL-012'\]/);
  assert.doesNotMatch(featuredRenderer, /PL-002/);
  assert.equal([...html.matchAll(/\{ id:'PL-\d+', name:'([^']+)'/g)][0]?.[1], 'Retatrutide');
  assert.match(html, /class="product-card__name product-card__open"/);
  assert.match(offerController, /window\.openPopup/);
  assert.doesNotMatch(offerController, /setTimeout\(openIfEligible|addEventListener\('scroll'/);
  assert.match(css, /\.nav__mobile-menu\.open\s*\{[^}]*transform:\s*translateX\(0\)/s);
  assert.match(css, /\.nav__inner\s*\{[^}]*grid-template-columns:\s*48px minmax\(0, 1fr\) 48px/s);
  assert.match(css, /#homeReconstitutionSource\s*\{\s*display:\s*none/);
  assert.match(css, /\.desktop-hero\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(min-width:\s*901px\)[\s\S]*\.desktop-hero\s*\{[\s\S]*display:\s*block/s);
  assert.match(css, /\.mobile-hero\s*\{[\s\S]*?display:\s*block/s);
  assert.match(css, /\.mobile-hero__main\s*\{[^}]*text-align:\s*center/s);
  assert.match(css, /\.mobile-hero h2\s*\{[^}]*font-size:\s*clamp\(28px,\s*6vw,\s*32px\)/s);
  assert.match(css, /\.mobile-hero h2 span\s*\{\s*display:\s*block/);
  assert.match(css, /@media \(min-width:\s*901px\)[\s\S]*?\.mobile-hero\s*\{\s*display:\s*none/s);
  assert.match(css, /\.desktop-hero__finder\s*\{[^}]*max-width:\s*700px/s);
  assert.match(css, /\.desktop-hero__visual img\s*\{[^}]*height:\s*auto[^}]*object-fit:\s*contain/s);
  assert.match(css, /#page-home > \.trust-strip \.trust-strip__inner\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?#page-home \.featured-products__heading h1\s*\{\s*display:\s*none/s);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?#page-home \.featured-products\s*\{\s*padding:\s*12px 0 36px/s);
  assert.match(css, /#page-home \.featured-products \.products-grid\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(min-width:\s*901px\)[\s\S]*?#page-home \.featured-products__heading \.section-label\s*\{\s*display:\s*none/s);
  assert.doesNotMatch(html, /checkout-payment-note|Bank transfer in AUD/);
});

test('restock dialog preserves retry identity and distinguishes automatic storage from manual fallback', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  assert.match(html, /let restockRequestId = '';/);
  assert.match(html, /restockRequestId = newRestockRequestId\(\);/);
  assert.match(html, /JSON\.stringify\(\{ email:[^}]*productId:[^}]*requestId:restockRequestId \}\)/);
  assert.match(html, /const responseText = await res\.text\(\);/);
  assert.match(html, /try \{ data = responseText \? JSON\.parse\(responseText\) : \{\}; \} catch \{\}/);
  assert.match(html, /data\.delivery === 'stored'[\s\S]*automatic restock alert has been saved[\s\S]*submit\.style\.display = 'none'/);
  assert.match(html, /data\.delivery === 'support'[\s\S]*manual follow-up[\s\S]*Retry automatic alert/);
  assert.match(html, /restock-message--warning/);
  assert.match(css, /\.restock-message--warning\s*\{[^}]*background:\s*#FFF8E3[^}]*color:\s*#744F05/s);
  assert.match(css, /\.restock-message--success\s*\{/);
  assert.match(css, /\.restock-message--error\s*\{/);
});

test('checkout uses a compact cart-aligned light layout', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');

  assert.doesNotMatch(html, /class="co-back"|Back to cart/);
  assert.match(html, /class="co-close"[^>]*aria-label="Close checkout"/);
  assert.match(html, /event\.key === 'Escape'[^\n]*coOverlay[^\n]*closeCheckout/);
  assert.doesNotMatch(html, /id="coMarketingConsent"|Stay in the loop/);
  assert.match(html, /marketingConsent:\s*document\.getElementById\('coMarketingConsent'\)\?\.checked \|\| false/);
  assert.match(html, /function coHasDeliveryDetails\(\)/);
  assert.match(html, /'Calculated after address'/);
  assert.match(html, /class="co-section co-section--shipping"[\s\S]*?<div class="co-section-title">Shipping information<\/div>/);
  assert.doesNotMatch(html, /<div class="co-section-title">(?:Contact|Delivery)<\/div>/);
  assert.match(html, /id="coContinuePayment"[^>]*onclick="coContinueToPayment\(\)"/);
  assert.match(html, /class="co-form-secondary" hidden/);
  assert.match(html, /function coShowCheckoutStep\(step, focus = true\)/);
  assert.match(html, /function coContinueToPayment\(\)/);
  assert.match(css, /\.co-overlay\s*\{[^}]*background:\s*#F5F7FA[^}]*color:\s*#1B273C/s);
  assert.match(css, /\.co-body\s*\{[^}]*width:\s*min\(100%,\s*1180px\)[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*360px\)/s);
  assert.match(css, /\.co-place-order\s*\{[^}]*background:\s*#1875AC[^}]*color:\s*#FFFFFF/s);
  assert.match(css, /\.co-ship-opt--on,[\s\S]*?\.co-pay-opt--on\s*\{[^}]*border-color:\s*#1875AC[^}]*background:\s*#EDF7FD/s);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?\.co-body\s*\{[^}]*width:\s*100%[^}]*min-height:\s*0[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?\.co-summary-col\s*\{[^}]*order:\s*2/s);
  assert.match(css, /\.co-success__block\s*\{[^}]*background:\s*#FFFFFF/s);
});

test('homepage newsletter is explicit-consent only and keeps the dedicated FAQ page', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  const home = html.match(/<div class="page active" id="page-home">[\s\S]*?<div class="page" id="page-reconstitution">/)?.[0] || '';
  assert.match(home, /class="section home-newsletter"/);
  assert.match(home, /subscriber-only discounts, restock alerts and new-product releases/);
  assert.match(home, /id="newsletterConsent" type="checkbox" required/);
  assert.match(html, /JSON\.stringify\(\{ email: email\.value, consent: consent\.checked, website:/);
  assert.doesNotMatch(home, /class="section home-faq-preview"/);
  assert.match(html, /<div class="page" id="page-faq">/);
  const faq = html.match(/<div class="page" id="page-faq">[\s\S]*?<div class="page" id="page-contact">/)?.[0] || '';
  assert.match(faq, />Shipping &amp; Orders<\/div>/);
  assert.match(faq, />How fast is delivery\?</);
  assert.match(faq, /We ship worldwide to supported destinations shown at checkout/);
  assert.doesNotMatch(faq, /Australia|Australian/);
  assert.match(css, /\.newsletter-panel\s*\{/);
});

test('every generated product card exposes add-to-cart and buy-now actions', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  const makeCard = html.match(/function makeCard\(p, mini\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(makeCard, /product-card__action--cart/);
  assert.match(makeCard, /product-card__action--buy/);
  assert.match(makeCard, /openRestockAlertById/);
  assert.match(makeCard, /addToCart\('\$\{p\.id\}',1,'checkout'\)/);
  assert.match(css, /\.product-card__actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
});

test('reconstitution supplies stay compact from wide screens through mobile', () => {
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  assert.match(css, /#page-reconstitution \.recon-supplies > \.container\s*\{[^}]*max-width:\s*1040px/s);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?#page-reconstitution \.recon-supplies > \.container\s*\{[^}]*max-width:\s*640px[^}]*\}[\s\S]*?#page-reconstitution \.recon-supplies__grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?#page-reconstitution \.recon-supply-card\s*\{[^}]*grid-template-columns:\s*64px minmax\(0,1fr\)/s);
  assert.match(css, /#page-reconstitution \.recon-supply-card__price\s*\{[^}]*grid-column:\s*2[^}]*margin-left:\s*0/s);
});

test('cart keeps the established layout while Mix 10 uses the accessible popup', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  const cart = html.match(/<!-- CART PAGE -->[\s\S]*?<!--  PAGE: HOME/)?.[0] || '';
  const suggestions = html.match(/function renderCartSuggestions\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  const mixBuilder = html.match(/function openMixBundleBuilder\(checkoutAfterAdd = false\) \{[\s\S]*?\n\}/)?.[0] || '';
  const addToCart = html.match(/function addToCart\(productId, quantity = 1, destination = 'cart'\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(cart, />Continue shopping<\/a>/);
  assert.match(cart, />Proceed to Checkout<\/button>/);
  assert.match(cart, />Continue Shopping<\/button>/);
  assert.doesNotMatch(cart, /cart-progress|cart-mix-builder|cart-checkout__next/);
  assert.match(html, /class="mix-bundle-overlay" id="mixBundleDialog" hidden/);
  assert.match(css, /\.mix-bundle-overlay\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/s);
  assert.match(mixBuilder, /mixBundleTrigger = document\.activeElement/);
  assert.match(mixBuilder, /mixBundleCheckoutAfterAdd = checkoutAfterAdd/);
  assert.match(mixBuilder, /getElementById\('mixBundleDialog'\)\.hidden = false/);
  assert.match(addToCart, /if \(destination === 'checkout'\) openCheckout\(\)/);
  assert.match(suggestions, /Add \$\{water\.size\} · \$\{fmtPrice\(water\.price\)\}/);
  assert.doesNotMatch(suggestions, /cart-upsell-actions|cart-rec-card__actions|,'checkout'/);
  assert.doesNotMatch(css, /\.cart-page-active|#page-cart #cartSuggestionsEl/);
  assert.match(css, /\.checkout-progress\s*\{/);
});
