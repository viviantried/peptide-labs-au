import pricing from '../checkout-pricing.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Generate from the current storefront on every deployment, so shared content
// and metadata do not drift into separately maintained copies.
const origin = 'https://aupeptidelab.com';
const source = readFileSync('index.html', 'utf8');
const meta = JSON.parse(source.match(/const PAGE_META = (\{[\s\S]*?\});\n/)[1]);
const paths = runInNewContext('(' + source.match(/const PAGE_PATHS = (\{[^\n]+\});/)[1] + ')');
const products = runInNewContext(source.match(/const PRODUCTS = ([\s\S]*?);\n\n\/\//)[1], {CheckoutPricing:pricing});
const slugs = runInNewContext('(' + source.match(/const PRODUCT_SLUGS = (\{[\s\S]*?\});/)[1] + ')');
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const routes = Object.entries(paths).map(([id, path]) => ({id, path, ...meta[id]}));
for (const [id, slug] of Object.entries(slugs)) {
  const path = '/products/' + slug;
  if (routes.some(route => route.path === path)) continue;
  const product = products.find(item => item.id === id);
  const label = product.kind === 'syringes' ? product.name + ' ' + product.size : product.name;
  routes.push({id:'product', path, product, title:label + ' | Product Information | PeptideLab', description:'View listed specifications and documentation information for ' + label + '. Contact PeptideLab for product and lot enquiries.'});
}
function head(route) {
  const url = origin + route.path;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'Organization','@id':origin+'/#organization',name:'PeptideLab',url:origin+'/',logo:origin+'/images/logo.jpg',email:'support@aupeptidelab.com'},
    {'@type':'WebSite','@id':origin+'/#website',name:'PeptideLab',url:origin+'/',publisher:{'@id':origin+'/#organization'}},
    {'@type':'WebPage','@id':url+'#webpage',url,name:route.title,description:route.description,isPartOf:{'@id':origin+'/#website'},inLanguage:'en-AU'}
  ]};
  return `<title>${escape(route.title)}</title>\n  <meta name="description" content="${escape(route.description)}" />\n  <!-- SEO:START -->\n  <link rel="canonical" href="${url}" />\n  <meta name="robots" content="${route.noindex ? 'noindex, follow' : 'index, follow'}" />\n  <meta property="og:type" content="website" />\n  <meta property="og:site_name" content="PeptideLab" />\n  <meta property="og:locale" content="en_AU" />\n  <meta property="og:title" content="${escape(route.title)}" />\n  <meta property="og:description" content="${escape(route.description)}" />\n  <meta property="og:url" content="${url}" />\n  <meta property="og:image" content="${origin}/images/logo.jpg" />\n  <meta name="twitter:card" content="summary" />\n  <meta name="twitter:title" content="${escape(route.title)}" />\n  <meta name="twitter:description" content="${escape(route.description)}" />\n  <script id="pageStructuredData" type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>\n  <!-- SEO:END -->`;
}
rmSync('seo-pages', {recursive:true, force:true});
mkdirSync('seo-pages', {recursive:true});
const config = JSON.parse(readFileSync('vercel.json','utf8'));
config.rewrites = config.rewrites.filter(rule => rule.destination !== '/index.html' && !rule.destination.startsWith('/seo-pages/'));
for (const [index, route] of routes.entries()) {
  let html = source.replace(/\s*<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, '');
  html = html.replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*\/>/, head(route));
  html = html.replace(/<div class="page(?: active)?" id="page-([^"<>]+)">/g, (_, id) => `<div class="page${id === route.id ? ' active' : ''}" id="page-${id}">`);
  if (route.product) {
    html = html.replace(/(<h1[^>]*id="pdpName"[^>]*>)[\s\S]*?<\/h1>/, '$1' + escape(route.product.name) + '</h1>');
    html = html.replace(/(<[^>]+id="pdpDesc"[^>]*>)[\s\S]*?(<\/p>)/, '$1' + escape(route.product.desc) + '$2');
    html = html.replace('<body>', '<body class="product-page-active">');
  }
  const file = route.path === '/' ? 'index.html' : `seo-pages/page-${index}.html`;
  writeFileSync(file, html);
  if (route.path !== '/') config.rewrites.push({source:route.path,destination:'/'+file});
}
config.redirects = config.redirects.filter(rule => rule.source !== '/collections/all');
config.redirects.push({source:'/collections/all',destination:'/shop',permanent:true});
writeFileSync('vercel.json', JSON.stringify(config,null,2)+'\n');
writeFileSync('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+routes.filter(route=>!route.noindex).map(route=>`  <url><loc>${origin}${route.path}</loc></url>`).join('\n')+'\n</urlset>\n');
writeFileSync('robots.txt',`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
// Publish only browser assets. Server functions remain in the root api folder.
rmSync('public', {recursive:true, force:true});
mkdirSync('public', {recursive:true});
for (const file of ['checkout-pricing.js','index.html','admin.html','card-checkout.html','styles.css','giveaway.css','giveaway.js','storefront-support.js','inventory.json','data','images','seo-pages','robots.txt','sitemap.xml']) {
  if (existsSync(file)) cpSync(file, 'public/'+file, {recursive:true});
}
console.log(`Generated ${routes.length} routes and ${routes.filter(route=>!route.noindex).length} sitemap URLs.`);
