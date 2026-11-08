#!/usr/bin/env node
/**
 * The share images (og:image / twitter:image): one 1200 x 630 picture per page that has its own, in the page's language.
 * Run: node test-og-images.mjs   (hermetic: the real Pages Function and index.html, the files in og/; no browser, no network)
 *
 * What this guards:
 *  - COVERAGE: the app page in all 26 languages, every one of the 32 price pages of the countries and the Danish pages listed in scripts/og-cards.mjs have
 *    an image; the manifest (functions/_og_manifest.js) has nothing else, and no file in og/ is unreferenced;
 *  - THE FILES: PNG, exactly 1200 x 630, each under 250 KB (WhatsApp and Telegram drop heavier previews), and every page has a picture of its OWN
 *    (no two pages share a file, so no language shows another language's headline);
 *  - FRESH: the hash the manifest keeps is the hash of what the picture is drawn from now (the text of DL_TEXT or PRIS_COUNTRIES, the screenshots,
 *    scripts/og-cards.mjs), so a changed headline or screenshot fails here until `npm run og` is run;
 *  - THE PAGES: every page the Function serves writes og:image, og:image:width/height/type/alt, twitter:card and twitter:image for its own file, the alt in
 *    its language; the net company pages take their area's picture; anything without a picture (the city pages) keeps the generic /og-image.png;
 *  - THE SITE: _routes.json keeps /og/* off the Function, scripts/build-dist.sh ships og/, index.html (the front page and every page's template) names its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async () => new Response('{}', { status: 503 });   // no feed: the pages are drawn without prices, their head is what is tested
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);
const { OG } = await import(pathToFileURL(path.join(ROOT, 'functions/_og_manifest.js')).href);
const { ogFor } = await import(pathToFileURL(path.join(ROOT, 'functions/_og.js')).href);
const { cardSpecs, specHash } = await import(pathToFileURL(path.join(ROOT, 'scripts/og-cards.mjs')).href);
const { DL_TEXT } = await import(pathToFileURL(path.join(ROOT, 'functions/_download_i18n.js')).href);
const D = await import(pathToFileURL(path.join(ROOT, 'functions/_download.js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };
const LIMIT = 250 * 1024;

const specs = await cardSpecs();
const keys = specs.map(s => s.key);

// ── Coverage ─────────────────────────────────────────────────────────────
{
  const dl = D.DL_LANGS.map(l => D.dlPath(l.code));
  ok(dl.length === 26 && dl.every(k => keys.includes(k)), 'coverage: the app page has an image in all 26 languages', dl.filter(k => !keys.includes(k)).join());
  const src = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const countries = [...src.matchAll(/^  '([a-z]{2}\/[a-z-]+)':\{lang:/gm)].map(m => '/' + m[1]);
  ok(countries.length === 32 && countries.every(k => keys.includes(k)), 'coverage: every price page of a country has an image', `${countries.length} pages; missing ${countries.filter(k => !keys.includes(k))}`);
  ok(['/', '/dk1', '/dk2', '/prognose', '/tariffer', '/automation', '/integrationer', '/norden'].every(k => keys.includes(k)), 'coverage: the main Danish pages have an image');
  ok(new Set(keys).size === keys.length, 'coverage: one card per page');
  ok(Object.keys(OG).sort().join() === [...keys].sort().join(), 'manifest: exactly the pages of the cards (run npm run og)', `only in manifest: ${Object.keys(OG).filter(k => !keys.includes(k))}; only in cards: ${keys.filter(k => !(k in OG))}`);
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push('/' + path.relative(ROOT, path.join(d, e.name)))));
  walk(path.join(ROOT, 'og'));
  const used = new Set(Object.values(OG).map(o => o.f));
  ok(files.every(f => used.has(f)), 'og/: no file that no page uses', files.filter(f => !used.has(f)).join());
  ok(files.every(f => f.endsWith('.png')), 'og/: only PNG files');
}

// ── The files ────────────────────────────────────────────────────────────
{
  const seen = new Map(); let total = 0, max = 0, maxKey = '';
  for (const s of specs) {
    const m = OG[s.key]; if (!m) continue;
    const fp = path.join(ROOT, m.f);
    if (!fs.existsSync(fp)) { ok(false, `${s.key}: ${m.f} exists`); continue; }
    const b = fs.readFileSync(fp);
    const png = b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR';
    ok(png, `${s.key}: a PNG`);
    ok(png && b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630, `${s.key}: 1200 x 630`, png ? `${b.readUInt32BE(16)} x ${b.readUInt32BE(20)}` : '');
    ok(b.length <= LIMIT, `${s.key}: under 250 KB`, `${Math.round(b.length / 1024)} KB`);
    total += b.length; if (b.length > max) { max = b.length; maxKey = s.key; }
    const h = crypto.createHash('sha1').update(b).digest('hex');
    ok(!seen.has(h), `${s.key}: its own picture`, `same as ${seen.get(h)}`);
    seen.set(h, s.key);
    ok(m.f === s.file && m.f === `/og${s.key === '/' ? '/index' : s.key}.png`, `${s.key}: the file is named for the page`, m.f);
    ok(m.v === specHash(s), `${s.key}: the picture is fresh (its hash is the hash of the text and screenshots it is drawn from)`, 'run `npm run og`');
    ok(m.alt === s.alt && m.alt.length > 10, `${s.key}: alt text`, m.alt);
  }
  console.log(`og: ${specs.length} images, ${Math.round(total / 1024)} KB in all, the largest ${Math.round(max / 1024)} KB (${maxKey})`);
}

// ── In its language ──────────────────────────────────────────────────────
{
  for (const l of D.DL_LANGS) {
    const s = specs.find(x => x.key === D.dlPath(l.code));
    ok(s && s.lang === l.html && s.head.a === DL_TEXT[l.code].h1 && s.sub === DL_TEXT[l.code].eyebrow && s.alt.startsWith(DL_TEXT[l.code].h1), `${l.code}/download: the headline and the line under it are the page's own (h1, eyebrow)`);
    ok(l.code === 'da' ? s.shots.every(x => /\/(iphone|android)-nu-720\.webp$/.test(x.file)) : s.shots.every(x => new RegExp(`download/img/(${l.code}|en)/hero[12]-720\\.webp$`).test(x.file)), `${l.code}/download: the app's own screenshots`);
  }
  const des = ['/de/strompreis', '/at/strompreis', '/ch/strompreis'].map(k => specs.find(x => x.key === k));
  ok(des.every(s => s.lang === 'de') && new Set(des.map(s => s.head.a)).size === 3, 'one language, three countries: three headlines (Deutschland, Österreich, Schweiz)');
  ok(specs.every(s => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s.alt + s.head.a + s.head.b + s.sub + (s.chips || []).join())), 'no emoji on any card');
}

// ── The pages ────────────────────────────────────────────────────────────
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = await res.text();
  return { status: res.status, head: body.slice(0, body.indexOf('</head>')) };
};
const tag = (head, re) => (head.match(re) || [])[1];
const decode = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const head = async (p, key = p) => {
  const r = await get(p), m = OG[key];
  return { r, h: r.head, m };
};
{
  for (const s of specs) {
    const { r, h, m } = await head(s.key);
    const url = `https://elpriser.org${m.f}?v=${m.v}`;
    ok(r.status === 200, `${s.key}: 200`);
    ok(tag(h, /<meta property="og:image" content="([^"]*)">/) === url, `${s.key}: og:image is its own file`, tag(h, /<meta property="og:image" content="([^"]*)">/));
    ok(tag(h, /<meta name="twitter:image" content="([^"]*)">/) === url, `${s.key}: twitter:image is the same`);
    ok(decode(tag(h, /<meta property="og:image:alt" content="([^"]*)">/)) === m.alt && decode(tag(h, /<meta name="twitter:image:alt" content="([^"]*)">/)) === m.alt, `${s.key}: og:image:alt and twitter:image:alt say what the image says`);
    ok(tag(h, /<meta property="og:image:width" content="(\d+)">/) === '1200' && tag(h, /<meta property="og:image:height" content="(\d+)">/) === '630' && tag(h, /<meta property="og:image:type" content="([^"]+)">/) === 'image/png', `${s.key}: width, height and type`);
    ok(/<meta name="twitter:card" content="summary_large_image">/.test(h), `${s.key}: twitter:card summary_large_image`);
    ok((h.match(/property="og:image"/g) || []).length === 1 && (h.match(/name="twitter:image"/g) || []).length === 1, `${s.key}: each tag once`);
  }
  // A net company's page takes its price area's picture; a city page and an unknown path have none of their own: the generic one stays.
  const net = await head('/dk1/n1', '/dk1'), net2 = await head('/dk2/radius', '/dk2');
  ok(tag(net.h, /<meta property="og:image" content="([^"]*)">/) === `https://elpriser.org${OG['/dk1'].f}?v=${OG['/dk1'].v}`, '/dk1/n1: the picture of DK1');
  ok(tag(net2.h, /<meta property="og:image" content="([^"]*)">/) === `https://elpriser.org${OG['/dk2'].f}?v=${OG['/dk2'].v}`, '/dk2/radius: the picture of DK2');
  const city = await get('/elpris/aarhus');
  ok(tag(city.head, /<meta property="og:image" content="([^"]*)">/) === 'https://elpriser.org/og-image.png' && tag(city.head, /<meta name="twitter:image" content="([^"]*)">/) === 'https://elpriser.org/og-image.png'
    && /<meta property="og:image:alt" content="[^"]{10,}">/.test(city.head), '/elpris/aarhus: the generic /og-image.png, with an alt text');
  ok(ogFor('/nowhere').own === false && ogFor('/nowhere').url === 'https://elpriser.org/og-image.png' && ogFor('/de/download').own === true, 'ogFor: the generic image for a page without one');
  ok(fs.existsSync(path.join(ROOT, 'og-image.png')), 'the generic /og-image.png is still there');
}

// ── The site ─────────────────────────────────────────────────────────────
{
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '_routes.json'), 'utf8'));
  ok(routes.exclude.includes('/og/*') && routes.exclude.includes('/og-image.png'), '_routes.json: /og/* is served as a static file, not by the Function');
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build-dist.sh'), 'utf8');
  ok(/cp -R og "\$DIST\/og"/.test(build), 'build-dist.sh: og/ is shipped');
  const self = OG['/'];
  ok(tag(INDEX, /<meta property="og:image" content="([^"]*)">/) === `https://elpriser.org${self.f}` && tag(INDEX, /<meta name="twitter:image" content="([^"]*)">/) === `https://elpriser.org${self.f}`, 'index.html: the front page names its own picture');
  ok(decode(tag(INDEX, /<meta property="og:image:alt" content="([^"]*)">/)) === self.alt && decode(tag(INDEX, /<meta name="twitter:image:alt" content="([^"]*)">/)) === self.alt, 'index.html: the alt text is the picture\'s');
  ok(/<meta property="og:image:width" content="1200">/.test(INDEX) && /<meta property="og:image:height" content="630">/.test(INDEX) && /<meta name="twitter:card" content="summary_large_image">/.test(INDEX), 'index.html: 1200 x 630 and the large card');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(pkg.scripts.og && /make-og-images/.test(pkg.scripts.og) && /test-og-images\.mjs/.test(pkg.scripts['test:unit']), 'package.json: npm run og, and this test is in the gate');
}

console.log(fails.length ? fails.map(f => '  ✗ ' + f).join('\n') + '\n' : '');
console.log(`og-images: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
