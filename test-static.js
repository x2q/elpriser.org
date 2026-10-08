#!/usr/bin/env node
/**
 * Static integrity tests for elpriser.org
 * Run: node test-static.js (or `npm run test:static`)
 *
 * These are fast, synchronous checks that read source files and verify
 * regression-prone invariants. They require no server or network, so they
 * are safe to run as a pre-commit hook.
 */

'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = __dirname;
const INDEX  = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STYLE  = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'functions', '[[path]].js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let _passed = 0, _failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); _passed++; results.push({ ok: true, name }); }
  catch (e) { _failed++; results.push({ ok: false, name, msg: e.message }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEO / Google SERP regression guards
// ─────────────────────────────────────────────────────────────────────────────

test('seo: <title> contains "Elpriser i dag"', () => {
  const m = INDEX.match(/<title>([^<]+)<\/title>/);
  assert.ok(m, '<title> tag missing');
  assert.ok(m[1].includes('Elpriser i dag'),
    `title is "${m[1]}" — must include "Elpriser i dag"`);
});

test('seo: <h1> on start page is "Elpriser i dag" (not "Elpris")', () => {
  // Fixed in commit ef47a0b — Google was picking up the one-word H1
  // The h1 carries a <span> for the live area, so match across tags and strip
  // them rather than requiring text-only content.
  const m = INDEX.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(m, 'missing <h1>');
  const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.ok(text.startsWith('Elpriser i dag'),
    `h1 is "${text}" — a short/ambiguous H1 causes Google to use it as SERP title`);
});

test('seo: meta description present and non-trivial', () => {
  const m = INDEX.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  assert.ok(m, 'meta description missing');
  assert.ok(m[1].length >= 80, `meta description too short (${m[1].length} chars)`);
});

test('seo: canonical link present', () => {
  assert.ok(/<link\s+rel="canonical"\s+href="https:\/\/elpriser\.org/.test(INDEX),
    'canonical link missing or incorrect');
});

test('seo: Open Graph image present', () => {
  assert.ok(/property="og:image"/.test(INDEX), 'og:image missing');
});

test('seo: every SEO_PAGES entry has distinct title', () => {
  // functions/[[path]].js serves unique <title>/<meta> per path
  const titles = [...ROUTES.matchAll(/title:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(titles.length >= 5, 'expected multiple SEO_PAGES entries');
  const dup = titles.find((t, i) => titles.indexOf(t) !== i);
  assert.ok(!dup, `duplicate title in SEO_PAGES: "${dup}"`);
});

test('seo: sitemap includes all SEO pages', () => {
  const urls = ROUTES.match(/SITEMAP_URLS\s*=\s*\[([^\]]+)\]/);
  assert.ok(urls, 'SITEMAP_URLS not found');
  ['/', '/dk1', '/dk2', '/tariffer', '/automation', '/prognose']
    .forEach(p => assert.ok(urls[1].includes(`'${p}'`), `sitemap missing ${p}`));
});

test('dev-server: SPA_ROUTES covers every production SEO_PAGES entry', () => {
  // server.js must mirror functions/[[path]].js so `npm start` behaves like
  // Cloudflare Pages for clean URLs (e.g. /prognose).
  const seoPaths = [...ROUTES.matchAll(/'(\/[\w\-\/]+)':\s*{[^}]*hash:/g)].map(m => m[1]);
  assert.ok(seoPaths.length >= 6, `expected ≥6 SEO paths, got ${seoPaths.length}`);
  const spaBlock = SERVER.match(/SPA_ROUTES\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(spaBlock, 'SPA_ROUTES not found in server.js');
  seoPaths.forEach(p => {
    assert.ok(spaBlock[1].includes(`'${p}'`),
      `server.js SPA_ROUTES missing "${p}" — visiting http://localhost:8080${p} will silently fall back to the start page`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-netselskab crawlable URLs — Google can't follow hash fragments, so
// each net must have its own clean URL (/dk1/<slug>, /dk2/<slug>) baked into
// functions/[[path]].js + mirrored in server.js + listed in the sitemap.
// ─────────────────────────────────────────────────────────────────────────────

function getNetsFromIndex() {
  // Pull NETS object from index.html source
  const m = INDEX.match(/const NETS=\{DK1:\[([\s\S]*?)\],DK2:\[([\s\S]*?)\]\};/);
  assert.ok(m, 'NETS object not found in index.html');
  const slugs = s => [...s.matchAll(/slug:'([^']+)'/g)].map(x => x[1]);
  return { DK1: slugs(m[1]), DK2: slugs(m[2]) };
}

test('crawlable: functions/[[path]].js NETS list matches index.html', () => {
  const indexNets = getNetsFromIndex();
  const routesNets = {
    DK1: [...ROUTES.matchAll(/slug:\s*'([^']+)'\s*}/g)].map(m => m[1]),
  };
  // Both DK1 and DK2 nets appear in that single slug regex; split by section
  const dk1Block = ROUTES.match(/DK1:\s*\[([\s\S]*?)\],\s*DK2:/);
  const dk2Block = ROUTES.match(/DK2:\s*\[([\s\S]*?)\],?\s*\}/);
  assert.ok(dk1Block && dk2Block, 'NETS DK1/DK2 blocks not found in functions/[[path]].js');
  const fnSlugs = s => [...s.matchAll(/slug:\s*'([^']+)'/g)].map(x => x[1]);
  const fnNets = { DK1: fnSlugs(dk1Block[1]), DK2: fnSlugs(dk2Block[1]) };
  ['DK1','DK2'].forEach(area => {
    indexNets[area].forEach(slug => {
      assert.ok(fnNets[area].includes(slug),
        `functions/[[path]].js NETS.${area} missing "${slug}" — /${area.toLowerCase()}/${slug} will 404`);
    });
  });
});

test('crawlable: server.js NET_SLUGS matches index.html', () => {
  const indexNets = getNetsFromIndex();
  const match = SERVER.match(/NET_SLUGS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(match, 'NET_SLUGS not found in server.js');
  ['DK1','DK2'].forEach(area => {
    indexNets[area].forEach(slug => {
      assert.ok(match[1].includes(`'${slug}'`),
        `server.js NET_SLUGS.${area} missing "${slug}"`);
    });
  });
});

test('crawlable: sitemap includes per-net URLs with reduced priority', () => {
  const indexNets = getNetsFromIndex();
  // NET_URLS is computed from NETS in functions/[[path]].js, so we just
  // assert the generator logic exists (NET_URLS + ...NET_URLS in SITEMAP_URLS).
  assert.ok(/NET_URLS\.push\(/.test(ROUTES),
    'functions/[[path]].js must populate NET_URLS for sitemap');
  assert.ok(/\.\.\.NET_URLS/.test(ROUTES),
    'SITEMAP_URLS must spread NET_URLS');
  assert.ok(/priority>0\.6/.test(ROUTES) || /'0\.6'/.test(ROUTES),
    'per-net URLs should get <priority>0.6</priority> (less than area/root)');
  // Sanity: at least one DK1 net + one DK2 net appear in the source
  assert.ok(indexNets.DK1.length > 0 && indexNets.DK2.length > 0);
});

// Cloudflare Pages only runs the function for paths matched by _routes.json.
// A path that misses it is served straight from static assets, which for this
// project means index.html with HTTP 200 and the homepage's canonical tag —
// the function never gets to redirect it, 404 it, or give it its own metadata.
// Assert coverage of the paths that matter rather than the literal patterns,
// so this keeps holding whether the include list is enumerated or a catch-all.
function routeMatches(pattern, p) {
  return pattern.endsWith('/*')
    ? p === pattern.slice(0, -2) || p.startsWith(pattern.slice(0, -1))
    : pattern === p;
}

function routedByFunction(routes, p) {
  if ((routes.exclude || []).some(x => routeMatches(x, p))) return false;
  return routes.include.some(x => routeMatches(x, p));
}

test('seo: client-side titles match the ones the server sends', () => {
  // The router rewrites document.title on navigation. Where that string drifts
  // from SEO_PAGES, one page has two titles — the one in the HTML and the one
  // Google's rendering pass sees. The homepage had three.
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const block = ROUTES_SRC.match(/const SEO_PAGES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'SEO_PAGES not found');
  const seo = {};
  for (const m of block[1].matchAll(/'(\/[^']*)': \{\s*\n\s*title: '((?:[^'\\]|\\.)*)'/g)) seo[m[1]] = m[2];
  seo['/'] = INDEX.match(/<title>([^<]*)<\/title>/)[1];

  const checked = [];
  for (const m of INDEX.matchAll(/h==='([^']*)'\)\{[^\n]*?document\.title='((?:[^'\\]|\\.)*)'/g)) {
    const want = seo['/' + m[1]];
    if (!want) continue;
    checked.push(m[1]);
    assert.equal(m[2], want,
      `router title for /${m[1]} is "${m[2]}" but the server sends "${want}"`);
  }
  const start = INDEX.match(/\[data-page="start"\]'\)\.classList\.add\('active'\);document\.title='((?:[^'\\]|\\.)*)'/);
  assert.ok(start, 'start route no longer sets a title');
  assert.equal(start[1], seo['/'],
    `router title for / is "${start[1]}" but the page ships "${seo['/']}"`);
  assert.ok(checked.length >= 8, `expected many routed titles, checked ${checked.length}`);
});

test('mobile: the tab bar lives outside every <main>', () => {
  // The server strips the sections a URL does not own. A fixed tab bar placed
  // inside one would vanish on every page that is not that section.
  assert.ok(/<nav class="tabbar" id="tabBar"/.test(INDEX), 'the mobile tab bar is missing');
  // Match the tag, not the word: a comment above the nav mentions "<main".
  const firstMain = INDEX.search(/<main[^>]*\sdata-page=/);
  assert.ok(firstMain > 0, 'no <main data-page> found');
  assert.ok(INDEX.indexOf('id="tabBar"') < firstMain,
    'the tab bar sits inside the <main> region and will be stripped on subpages');
  for (const href of ['/prognose', '/automation']) {
    assert.ok(new RegExp(`data-tab="${href}"`).test(INDEX), `tab for ${href} is missing`);
  }
});

test('mobile: phone styles are hand-written and scoped to small screens', () => {
  const style = INDEX.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(style.includes('.tabbar{display:none}'),
    'the tab bar must be hidden by default and shown only on phones');
  assert.ok(/@media \(max-width:640px\)\{[\s\S]*?\.tabbar\{display:flex/.test(style),
    'the tab bar is never shown at phone width');
  for (const cls of ['.answer-col', '.tabbar a', '.tabbar .on']) {
    assert.ok(style.includes(cls), `${cls} is not defined in the hand-written style block`);
  }
  assert.ok(/body\{padding-bottom:/.test(style),
    'without bottom padding the floating bar covers the last row of content');
});

test('tariffer: the page answers the tariff searches it was ranking for', () => {
  const start = INDEX.indexOf('data-page="tariffer"');
  const end = INDEX.indexOf('data-page="automation"');
  assert.ok(start > 0 && end > start, 'tariffer section not found');
  const page = INDEX.slice(start, end);
  // Each of these matched a query cluster that drew impressions and no clicks.
  for (const term of ['Transmissions', 'Systemtarif', 'Elafgift',
                      'lavlast', 'spidslast', 'effekt', 'Nettarif C']) {
    assert.ok(new RegExp(term, 'i').test(page),
      `the tariff page no longer covers "${term}"`);
  }
  assert.ok(page.includes('id="tariffNetLinks"'),
    'the per-company links are gone — those pages rank 25th and need the internal links');
  assert.ok(INDEX.includes('function renderTariffNetLinks()'),
    'the per-company chips are no longer built from NETS');
});

test('server: every top-level piece the renderer calls still exists', () => {
  // Editing this file by matching a start and an end anchor is how a whole
  // unrelated block gets swallowed: an end anchor further down the file than
  // you think takes everything in between with it. That deleted the zone SSR
  // once and put /se3 and /no1 into a 500 in production. A missing definition
  // is a ReferenceError at request time, which no other test here would catch,
  // so the presence of each one is asserted directly.
  const SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const required = [
    'const SSR_ZONES', 'const ZONE_T', 'const ZONE_CUR_RE',
    'function buildZoneCurrency(', 'function buildZoneIntro(',
    'function fcChartHTML(', 'function buildSitemap(',
    'const CONTENT_LASTMOD', 'const SITEMAP_URLS',
  ];
  const missing = required.filter(r => !SRC.includes(r));
  assert.deepEqual(missing, [], `functions/[[path]].js is missing: ${missing.join(', ')}`);

  // And nothing may be referenced that is no longer defined.
  for (const name of ['buildZoneIntro', 'buildZoneCurrency', 'fcChartHTML']) {
    const called = new RegExp(`[^a-zA-Z.]${name}\\s*\\(`).test(
      SRC.slice(SRC.indexOf('async function renderHomepage')));
    const defined = SRC.includes(`function ${name}(`);
    assert.ok(!called || defined, `${name} is called but not defined`);
  }
});

test('price table: 4 days back, today, 3 ahead — and paging neither skips nor repeats', () => {
  // Lifted out of index.html and run as-is, so what is tested is what ships.
  const vm = require('vm');
  const fmtSrc = INDEX.match(/const fmt=d=>[^\n]+/)[0];
  const winSrc = INDEX.slice(INDEX.indexOf('function tableWindow(){'),
                             INDEX.indexOf('function renderTable(){'));
  assert.ok(winSrc.length > 50, 'tableWindow not found');
  const ctx = { S: { weekOffset: 0 } };
  vm.createContext(ctx);
  vm.runInContext(fmtSrc + '\n' + winSrc + '\nglobalThis.tw = tableWindow; globalThis.f = fmt;', ctx);
  const at = k => { ctx.S.weekOffset = k; return [...ctx.tw()]; };
  const day = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ctx.f(d); };
  const w0 = at(0), today = ctx.f(new Date());
  assert.equal(w0.length, 8, 'the window is not eight days');
  assert.equal(w0[4], today, `today is not the fifth column: ${w0.join(' ')}`);
  assert.equal(w0[0], day(today, -4), 'the window does not start four days back');
  assert.equal(w0[7], day(today, 3), 'the window does not end three days ahead');
  for (let k = 0; k > -5; k--) {
    const cur = at(k), prev = at(k - 1);
    cur.forEach((d, i) => { if (i) assert.equal(d, day(cur[i - 1], 1), `gap inside window ${k}: ${cur.join(' ')}`); });
    assert.equal(prev[7], day(cur[0], -1), `paging from ${k} to ${k - 1} skips or repeats a day`);
  }
  // The automation page reuses priceData and plans over its last seven days,
  // so the current window's fetch must still reach seven days back.
  const loader = INDEX.slice(INDEX.indexOf('async function loadPriceData('), INDEX.indexOf('function tableWindow(){'));
  assert.ok(/if\(S\.weekOffset===0\)\{[^\n]*s\.setDate\(s\.getDate\(\)-7\)/.test(loader),
    'the current window no longer fetches seven days back');
  assert.ok(!/fcTomorrow|showFc/.test(INDEX), 'leftovers of the single forecast column');
  // PROGNOSE once across the forecast columns — repeated under each weekday it
  // was wider than any price and stretched those columns.
  const render = INDEX.slice(INDEX.indexOf('function renderTable(){'), INDEX.indexOf('// Answer block above the table'));
  assert.equal((render.match(/>PROGNOSE</g) || []).length, 1, 'PROGNOSE is written more than once per table');
  assert.ok(/colspan="\$\{j-i\}"[^>]*>PROGNOSE</.test(render), 'PROGNOSE does not span the forecast columns');
});

test('price pages: dropdown, sentence and unit describe the same price in every view', () => {
  const vm = require('vm');
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const MARK = '// ═══ Pris lige nu, i ord ═══';
  const lift = src => { const a = src.indexOf(MARK), b = src.indexOf('\n}', src.indexOf('function priceNowText(', a)); return a < 0 || b < 0 ? '' : src.slice(a, b + 2); };
  const cli = lift(INDEX), srv = lift(SRV);
  assert.ok(cli.length > 500, 'priceNowText not found in index.html');
  assert.equal(cli, srv, 'the server and browser copies of priceNowText differ');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(cli + '\nglobalThis.t = priceNowText;', ctx);
  const modes = ['spot_ex', 'spot_inkl', 'inkl_alt', 'inkl_alt_minus', 'net_inkl_alt', 'net_inkl_tarif'];
  for (const m of modes) {
    const txt = ctx.t(m, '15', 0.3149, 'DK1', 'N1');
    assert.ok(txt.includes('0,31 kr/kWh'), `${m}: the sentence does not carry the price`);
    // A view without a grid company must never claim to include the nettarif.
    if (!m.startsWith('net_')) assert.ok(!/0,31 kr\/kWh inkl\.[^.]*nettarif/.test(txt), `${m} claims the local nettarif: ${txt}`);
    if (m.endsWith('_minus') || m === 'net_inkl_tarif') assert.ok(/uden elafgift/.test(txt), `${m} does not say it excludes elafgift`);
    // Every view has its own option, or the dropdown goes blank on it.
    if (!m.startsWith('net_')) assert.ok(INDEX.includes('value="${area}/' + m + '"'), `no dropdown option for ${m}`);
  }
  // The server writes the sentence for the view the URL opens in, which is
  // what pathToHash sends /dk1 and /dk2 to.
  assert.ok(/const mode = net \? 'net_inkl_alt' : 'inkl_alt';/.test(SRV), 'server sentence is not for the URL\'s own view');
  assert.ok(INDEX.includes("'/dk1':'DK1/inkl_alt','/dk2':'DK2/inkl_alt'") &&
            INDEX.includes("m[1].toUpperCase()+'/net_inkl_alt/'"),
    'pathToHash no longer opens /dk1 in inkl alt and net pages in net inkl alt — update the server sentence to match');
  // And the server's own record of that view must agree with the browser's.
  assert.ok(/'\/dk1': \{[\s\S]*?hash: '#DK1\/inkl_alt'/.test(SRV) && /'\/dk2': \{[\s\S]*?hash: '#DK2\/inkl_alt'/.test(SRV),
    'SEO_PAGES opens /dk1 or /dk2 in a different view than pathToHash');
  // The title the browser sets for that view must be the one the server sent.
  for (const [a, w] of [['DK1', 'Vest'], ['DK2', 'Øst']]) {
    const t = `Elpris ${w} (${a}) i dag — spotpris og afgifter time for time`;
    assert.ok(SRV.includes(`title: '${t}'`), `server title for ${a} is not "${t}"`);
  }
  assert.ok(INDEX.includes("document.title=`Elpris ${S.area==='DK1'?'Vest':'Øst'} (${S.area}) i dag — spotpris og afgifter time for time`"),
    'the browser sets a different title for the inkl alt view than the server sends');
  assert.ok(!/nettariffer, elafgift og moms\./.test(SRV.slice(SRV.indexOf("'/dk1': {"), SRV.indexOf("'/tariffer': {"))),
    '/dk1 or /dk2 description claims the nettarif is included');
  // "spotpris" is a query these pages rank for; opening on inkl alt must not
  // cost them the word. Title and description both keep it.
  for (const k of ["'/dk1': {", "'/dk2': {"]) {
    const blk = SRV.slice(SRV.indexOf(k), SRV.indexOf('},', SRV.indexOf(k)));
    assert.ok(/title: '[^']*spotpris/.test(blk), `${k} title lost "spotpris"`);
    assert.ok(/description: '[^']*spotpris/.test(blk), `${k} description lost "spotpris"`);
  }
  assert.ok(/id="priceNowText"/.test(SRV) && /getElementById\('priceNowText'\)/.test(INDEX), 'the sentence is not rewritten when the view changes');
  // Another area or grid company is another page; only views of the same URL stay in-page.
  assert.ok(/hashToPath\(val\)!==location\.pathname/.test(INDEX), 'the dropdown can switch company without reloading the page');
  assert.ok(!/inkl\. nettarif, systemtarif, transmissionstarif, elafgift og moms er \$\{fmt\(dk1\.total\)\}/.test(SRV),
    'the homepage summary still says the no-company total includes the nettarif');
});

test('price pages: the curve is drawn from the table\'s own data and conversion', () => {
  // The chart sits between the big number and the table. If it fetched its own
  // prices (say the front page's inkl_alt feed) it would disagree with both on
  // /dk1/n1 or in "Inkl tarif". It must use priceData/fcDays through cvt().
  const main = INDEX.slice(INDEX.indexOf('data-page="prices"'), INDEX.indexOf('<!-- ═══════ TARIFF PAGE'));
  assert.ok(/id="pricesForecast"/.test(main), 'no chart container on the price pages');
  assert.ok(main.indexOf('id="pricesForecastWrap"') < main.indexOf('<!--SSR_PRICES_INTRO-->'),
    'the chart is not above the page heading');
  // Above the h1, its title must not be a heading, or the outline starts at h2.
  const wrapHtml = main.slice(main.indexOf('id="pricesForecastWrap"'), main.indexOf('<!--SSR_PRICES_INTRO-->'));
  assert.ok(!/<h[1-6]/.test(wrapHtml), 'a heading element sits above the page h1');
  const fn = INDEX.slice(INDEX.indexOf('function pricesChartDays(){'), INDEX.indexOf('function renderPricesForecast(){'));
  assert.ok(/priceData\[ds\]\|\|fcDays\[ds\]/.test(fn) && /cvt\(src\[h\],h,ds\)/.test(fn),
    'pricesChartDays does not use the table\'s data through cvt()');
  assert.ok(!/fetch\(/.test(fn), 'pricesChartDays fetches its own prices');
  assert.ok(/if\(S\.weekOffset===0\)renderPricesForecast\(\);/.test(INDEX), 'the chart is not redrawn with the table');
  // Above the heading the box must be reserved before the data arrives, or
  // the h1 jumps down under the reader when it does.
  const style = INDEX.slice(INDEX.indexOf('<style>'), INDEX.indexOf('</style>'));
  assert.ok(/#pricesForecast[^{]*\{min-height:\d+px\}/.test(style), 'no reserved height for the chart');
  assert.ok(!/id="pricesForecastWrap" style="display:none"/.test(INDEX), 'the chart box starts collapsed and will shift the page');
});

test('seo: no heading tag written inside an HTML comment', () => {
  // Crawlers and the live h1 count read raw markup, comments included. A
  // comment explaining heading order that spelled out the tags made every
  // price page report two h1 elements.
  const bad = [...INDEX.matchAll(/<!--([\s\S]*?)-->/g)].filter(m => /<h[1-6]\b/i.test(m[1]))
    .map(m => m[1].trim().slice(0, 60));
  assert.deepEqual(bad, [], `heading tag inside a comment: ${bad.join(' | ')}`);
});

test('zone pages: curve above the heading, from the table\'s own conversion', () => {
  const main = INDEX.slice(INDEX.indexOf('data-page="zone"'), INDEX.indexOf('<!-- ═══════ BLOG: Elafgift 2028'));
  assert.ok(main.indexOf('id="zoneForecastWrap"') > 0 && main.indexOf('id="zoneForecastWrap"') < main.indexOf('id="zTitle"'),
    'the zone chart is not above the zone heading');
  const style = INDEX.slice(INDEX.indexOf('<style>'), INDEX.indexOf('</style>'));
  assert.ok(/#zoneForecast\{min-height:\d+px\}|,#zoneForecast\{min-height:\d+px\}/.test(style), 'no reserved height for the zone chart');
  // Drawn with renderZone's own cvt, so it follows currency and grid company.
  assert.ok(/renderZoneForecast\(j,z,t,loc,cvt,dec,local\);/.test(INDEX), 'renderZone does not hand its conversion to the chart');
  const fn = INDEX.slice(INDEX.indexOf('function renderZoneForecast('), INDEX.indexOf('function renderZone(){'));
  assert.ok(/price:cvt\(p\.eur_mwh\)/.test(fn) && !/fetch\(/.test(fn), 'the zone chart does not use the table\'s numbers');
});

test('zone pages: EUR is converted at the ECB rate, not a stale constant', () => {
  // NOK sat at a fixed 11.7 while the ECB rate was 10.84: every Norwegian
  // price in øre was ~8 % too high. The API now returns the ECB rate, and both
  // the server page and the browser must use it rather than their constants.
  const API = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(/eurofxref-daily\.xml/.test(API) && /rate: fx\.rates\[info\.currency\]/.test(API), '/api/nordic does not return the ECB rate');
  assert.ok(/const rate=\(j\.zoneInfo&&j\.zoneInfo\.rate\)\|\|z\.rate;/.test(INDEX) && /base=v\/1000\*rate\*100/.test(INDEX),
    'the browser converts with its constant instead of the API rate');
  assert.ok(/data\.zoneInfo && data\.zoneInfo\.rate\) \|\| z\.rate/.test(SRV), 'the server page converts with its constant instead of the API rate');
  // The fallbacks must agree across the three files, or a failed ECB fetch
  // would show different numbers on the page and in its first paint.
  const fb = API.match(/const FX_FALLBACK = \{ EUR: 1, DKK: ([\d.]+), NOK: ([\d.]+), SEK: ([\d.]+)/);
  assert.ok(fb, 'FX_FALLBACK not found');
  for (const [cur, v] of [['NOK', fb[2]], ['SEK', fb[3]]]) {
    assert.ok(INDEX.includes(`cur:'${cur}',rate:${v},`), `index.html ZONES ${cur} fallback is not ${v}`);
    assert.ok(new RegExp(`rate: ${v.replace('.', '\\.')}, sub:`).test(SRV), `SSR_ZONES ${cur} fallback is not ${v}`);
  }
  // And the pages must no longer say the rate is fixed.
  assert.ok(!/fast kurs|fixed rate|kiinteää kurssia|vaste koers/.test(INDEX), 'a note still says the conversion uses a fixed rate');
});

test('prices: nothing prints a minus in front of a zero', () => {
  // NO2 and NL each had an hour a fraction below zero, so the new curve read
  // "-0–179" and the table "-0". Every price goes through num() or the same
  // inline rule in the two shared functions; no raw toFixed().replace remains.
  const raw = [...INDEX.matchAll(/\.toFixed\((?:2|dec|d)\)\.replace\('\.',','\)/g)].length;
  assert.equal(raw, 0, `${raw} price(s) still formatted without the negative-zero rule`);
  const vm = require('vm'); const ctx = {}; vm.createContext(ctx);
  vm.runInContext(INDEX.match(/function num\(v,d\)\{[^\n]+/)[0] + '\nglobalThis.n=num;', ctx);
  assert.equal(ctx.n(-0.004, 2), '0,00'); assert.equal(ctx.n(-0.3, 0), '0');
  assert.equal(ctx.n(-0.6, 0), '-1'); assert.equal(ctx.n(-1.25, 2), '-1,25'); assert.equal(ctx.n(3.456, 1), '3,5');
});

test('/prognose: curve above the heading, server-drawn, redrawn from the table\'s data', () => {
  const main = INDEX.slice(INDEX.indexOf('data-page="prognose"'), INDEX.indexOf('id="fcTableWrapper"'));
  assert.ok(main.indexOf('id="prognoseForecastWrap"') > 0 && main.indexOf('id="prognoseForecastWrap"') < main.indexOf('class="page-title"'),
    'the /prognose chart is not above the page heading');
  assert.ok(/<div id="prognoseForecast"><!--SSR_PROGNOSE_CHART--><\/div>/.test(INDEX), 'no server placeholder for the chart');
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(/'\/prognose'\) opts\.forecastChart = true/.test(SRV) &&
            /html\.replace\('<!--SSR_PROGNOSE_CHART-->', fcChartHTML\(/.test(SRV), 'the server does not draw the /prognose chart');
  // The server draws the page's default view; it must be what the dropdowns default to.
  assert.ok(/<option value="DK1">DK1 Vest<\/option>/.test(INDEX.slice(INDEX.indexOf('id="fcArea"'))) &&
            /<option value="inkl_alt" selected>/.test(INDEX.slice(INDEX.indexOf('id="fcMode"'))),
    '/prognose no longer defaults to DK1 inkl alt — update the server-drawn chart to match');
  assert.ok(/api\/forecast\?area=DK1&mode=inkl_alt/.test(SRV.slice(SRV.indexOf('if (opts.forecastChart)'))), 'server chart is not DK1 inkl alt');
  assert.ok(/if\(!days\.length\)return;\n  renderPrognoseForecast\(days\);/.test(INDEX), 'the chart is not redrawn from the table\'s data');
  const style = INDEX.slice(INDEX.indexOf('<style>'), INDEX.indexOf('</style>'));
  assert.ok(/#prognoseForecast\{min-height|,#prognoseForecast\{min-height/.test(style), 'no reserved height for the /prognose chart');
});

test('seo/llm: nothing claims what the page does not show', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  // /prognose shows ten days from a daily-trained model — not "7 dage" from
  // "historiske prismønstre", which its title, description and llms.txt said.
  const APIF = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  // /api is rendered by the API function, not the page function — the first
  // version of this test missed its "7-dages prognose" for exactly that reason.
  assert.ok(!/7-dages prognose/.test(APIF), '/api still describes a 7-day forecast');
  for (const [where, txt] of [['functions/[[path]].js', SRV], ['index.html', INDEX]]) {
    // Every spelling: "7 dage", "7-dages", "7-døgns", "7-day", "7 days".
    // "7 dage" is the biggest query /prognose ranks for, so it may appear — but
    // only beside the truth ("op til 10 døgn"), or in a code comment. On its
    // own it claims the forecast is a week long, which it is not.
    const hit = [...txt.matchAll(/\b7[- ](?:dage|dages|døgn|døgns|day|days)\b[^\n]{0,40}|baseret på historiske prismønstre/g)]
      .find(m => {
        const ls = txt.lastIndexOf('\n', m.index) + 1, le = txt.indexOf('\n', m.index);
        const line = txt.slice(ls, le < 0 ? txt.length : le);
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;
        if (m[0].startsWith('7 dage, dag for dag')) return false;   // the week list's own heading: it is seven days
        return !/10 (døgn|dage)/.test(txt.slice(Math.max(0, m.index - 140), m.index + 160));
      });
    assert.ok(!hit, `${where} still describes the forecast as 7 days / historical patterns: "${hit && hit[0]}"`);
  }
  // The homepage figure is inkl alt, which excludes the local nettarif.
  const head = INDEX.slice(0, INDEX.indexOf('</head>'));
  assert.ok(!/name="description" content="[^"]*inkl\. nettariffer/.test(head) && !/og:description" content="[^"]*inkl\. nettariffer/.test(head),
    'the homepage description claims the price includes nettariffer');
  assert.ok(!/id="heroContext">[^<]*inkl\. nettariffer/.test(INDEX), 'the sentence under the homepage price claims nettariffer');
  assert.ok(!/mode=inkl_alt\\` — Current total price right now \(DKK\/kWh, incl\. all tariffs/.test(SRV), 'llms.txt says inkl_alt includes all tariffs');
  // llms.txt lists every zone page.
  const llms = SRV.slice(SRV.indexOf('const LLMS_TXT = `'), SRV.indexOf('const LLMS_FULL_TXT'));
  for (const z of ['no1','no2','no3','no4','no5','se1','se2','se3','se4','fi','nl'])
    assert.ok(llms.includes(`https://elpriser.org/${z})`), `llms.txt does not list /${z}`);
  assert.ok(/\/api\/nordic\?zone=/.test(llms), 'llms.txt does not list /api/nordic');
});

test('seo: the pages keep the words Search Console shows people typing', () => {
  // Evidence, not taste (Performance on Search, 3 months to 2026-10-04):
  //  - /prognose: "elpriser prognose 7 dage" is its biggest query, ~700 impressions
  //    with its variants. The title must carry "7 dage" — beside the true "10 døgn".
  //  - the elafgift post ranks 1.7-3.6 for "kommer elafgiften tilbage" and clicked
  //    at 1.6-2.4 %: the snippet has to say yes.
  //  - /dk1 and /dk2: people type "elpris vest" / "elpriser øst"; "spotpris" stays.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const entry = k => SRV.slice(SRV.indexOf(`'${k}': {`), SRV.indexOf('},', SRV.indexOf(`'${k}': {`)));
  const field = (k, f) => (entry(k).match(new RegExp(`${f}: '([^']*)'`)) || [])[1] || '';
  assert.ok(/7 dage/.test(field('/prognose', 'title')) && /10 døgn/.test(field('/prognose', 'title')), '/prognose title lost "7 dage" or the true "10 døgn"');
  assert.ok(/7 dage/.test(field('/prognose', 'description')) && /10 døgn/.test(field('/prognose', 'description')), '/prognose description lost "7 dage" or "10 døgn"');
  assert.ok(/elafgiften/i.test(field('/blog/elafgift-2028', 'title')) && /stiger igen/.test(field('/blog/elafgift-2028', 'title')) && /^Elafgift 2028/.test(field('/blog/elafgift-2028', 'title')),
    'the elafgift title no longer leads with "Elafgift 2028" and answers');
  assert.ok(/^Kommer elafgiften tilbage\? Ja/.test(field('/blog/elafgift-2028', 'description')), 'the elafgift description does not answer the question first');
  assert.ok(/60,9 øre/.test(field('/blog/elafgift-2028', 'description')) && /2015-prisniveau/.test(field('/blog/elafgift-2028', 'description')),
    'the elafgift figure is not qualified as 2015 price level, which is what the post says');
  assert.ok(/^Elpris Vest/.test(field('/dk1', 'title')) && /^Elpris Øst/.test(field('/dk2', 'title')), '/dk1 or /dk2 title does not lead with "Elpris Vest/Øst"');
  for (const k of ['/prognose', '/dk1', '/dk2', '/blog/elafgift-2028'])
    assert.ok(field(k, 'title').length <= 62, `${k} title is ${field(k, 'title').length} characters; results cut it near 60`);
});

test('seo: zone pages carry no hreflang cluster', () => {
  // They are different markets, not translations of one page. Linking them as
  // alternates made five pages "the Norwegian version" and /se3 its own Danish one.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const branch = SRV.slice(SRV.indexOf('if (meta.lang) {'), SRV.indexOf('html = html.replace(\n    /<title>'));
  assert.ok(!/hreflang="\$\{m\.lang\}"/.test(branch) && !/x-default/.test(branch), 'the zone-page hreflang cluster is back');
  assert.ok(/hreflang="\[\^"\]\*" href="\[\^"\]\*">\/g, ''\)/.test(branch), 'zone pages do not strip the base hreflang');
});

test('structured data: each block is served only on the page it describes', () => {
  // <head> goes to every URL, so FAQ, article and dataset markup there made
  // /se3 and every blog post claim content they do not have. Only the
  // genuinely sitewide blocks may stay in <head>.
  const head = INDEX.slice(0, INDEX.indexOf('</head>'));
  const headTypes = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap(m => [...m[1].matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map(x => x[1]));
  for (const t of ['FAQPage', 'Article', 'BlogPosting', 'Dataset', 'Service'])
    assert.ok(!headTypes.includes(t), `${t} is in <head> and so on every page`);
  const blocksIn = page => {
    const a = INDEX.search(new RegExp(`<main[^>]*data-page="${page}"`));
    const b = INDEX.indexOf('</main>', a);
    return [...INDEX.slice(a, b).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  };
  assert.ok(blocksIn('start').some(j => j['@type'] === 'FAQPage'), 'the homepage FAQ markup is gone');
  const api = blocksIn('api').find(j => j['@type'] === 'Dataset');
  assert.ok(api && api.url === 'https://elpriser.org/api', 'the dataset is not on /api with its own URL');
  for (const slug of ['forsta-din-elpris', 'shelly-elpris-automation', 'home-assistant-elpriser', 'v2g-v2h-bidirektional-opladning',
                      'biler-ladere-v2h-v2g', 'elafgift-2028', 'hvornaar-er-stroemmen-billigst', 'groennest-og-dyrest']) {
    const posts = blocksIn('blog-' + slug).filter(j => j['@type'] === 'BlogPosting');
    assert.equal(posts.length, 1, `blog-${slug} has ${posts.length} BlogPosting blocks`);
    assert.equal(posts[0].url, `https://elpriser.org/blog/${slug}`, `blog-${slug} describes another post`);
  }
  assert.equal(blocksIn('blog').find(j => j['@type'] === 'Blog')?.blogPost?.length, 8, '/blog does not list its eight posts');
  // Every block must parse; a stray quote silently voids the whole block.
  for (const m of INDEX.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(/html\.replace\('<\/head>', `  \$\{breadcrumbLd\(pathname, meta, opts\)\}/.test(SRV), 'sub-pages get no breadcrumbs');
  assert.ok(/body: async context => LLMS_FULL_TXT \+ await llmsNowSection\(context\)/.test(SRV), 'llms-full.txt carries no dated figures');
});

test('indexnow: the served key and the submitting script agree', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const SCR = fs.readFileSync(path.join(ROOT, 'scripts/indexnow.mjs'), 'utf8');
  const served = (SRV.match(/const INDEXNOW_KEY = '([0-9a-f]{32})'/) || [])[1];
  const sent = (SCR.match(/const KEY = '([0-9a-f]{32})'/) || [])[1];
  assert.ok(served && sent, 'IndexNow key missing');
  assert.equal(served, sent, 'the key the site serves is not the key the script submits');
  assert.ok(SRV.includes(`'/${served}.txt': {`), 'the key file route does not match the key');
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(/wrangler pages deploy[^&]*&& \(node scripts\/indexnow\.mjs \|\| true\)$/.test(pj.scripts.deploy),
    'deploy does not submit to IndexNow, or lets an IndexNow failure fail the deploy');
});

test('/prognose: the week is text in the HTML and follows the table', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(/<div id="prognoseWeek"><!--SSR_PROGNOSE_WEEK--><\/div>/.test(INDEX), 'no placeholder for the week list');
  assert.ok(/html\.replace\('<!--SSR_PROGNOSE_WEEK-->', fcWeekHTML\(fc\.days \|\| \[\], todayDk, 7\)\)/.test(SRV), 'the server does not draw the week list');
  assert.ok(/renderPrognoseForecast\(days\);\n  renderPrognoseWeek\(days\);/.test(INDEX), 'the week list is not redrawn with the table');
  assert.ok(INDEX.includes('Næste 7 dage, dag for dag'), 'the week list has no "næste 7 dage" heading');
});

test('security: no credential is written into tracked code', () => {
  // The repository is public. A JAO API token sat as a default value in a
  // committed script from 2026-07 until it was found; once pushed it lives in
  // history, so the only real control is not to commit it in the first place.
  // Tokens come from the environment (~/.config/elpriser.env, Pages secrets).
  const { execSync } = require('child_process');
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => /\.(py|js|mjs|sh|json|md|html|toml|yml|yaml)$/.test(f) && !/^(node_modules|dist)\//.test(f) && f !== 'test-static.js');
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const rules = [
    [new RegExp(`(token|secret|api[_-]?key|password|bearer)[^\\n]{0,60}["']${uuid}["']`, 'i'), 'a UUID assigned to something token-like'],
    [/["'](?:hf_|ghp_|gho_|github_pat_|sk-ant-|sk-|cfut_|xox[bp]-)[A-Za-z0-9_-]{20,}["']/, 'a provider-prefixed secret'],
    [/(?:TOKEN|SECRET|API_KEY)\w*\s*=\s*os\.environ\.get\([^)]*,\s*["'][^"']{12,}["']\)/, 'a secret given as a default value'],
  ];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    src.split('\n').forEach((line, i) => rules.forEach(([re, why]) => { if (re.test(line)) hits.push(`${f}:${i + 1} (${why})`); }));
  }
  assert.deepEqual(hits, [], `credential-like literal in tracked code: ${hits.join(', ')}`);
});

test('homepage: the hero curve has a price scale that lines up', () => {
  // The scale sits in a gutter left of the curve. The CO2 strip below takes the
  // same gutter, or its hours stop lining up with the price curve's.
  assert.ok(/<div class="yplot"><svg id="heroCurve"[^>]*><\/svg><div class="yax" id="heroYax"><\/div><\/div>/.test(INDEX),
    'heroCurve is not wrapped with its axis');
  assert.ok(/<svg id="heroCo2" class="ygut"/.test(INDEX), 'the CO2 strip does not share the gutter');
  // renderHero hides the CO2 header through previousElementSibling, so the
  // strip must stay the header's next sibling rather than gain a wrapper.
  assert.ok(/<div class="chd co2">[^\n]*<\/div>\s*<svg id="heroCo2"/.test(INDEX),
    'heroCo2 is no longer directly after its header');
  assert.ok(/const ticks=fcTicks\(pMin,pMax\)/.test(INDEX) && /heroYax'\)\.innerHTML=fcYaxis\(ticks,Y,H\)/.test(INDEX),
    'renderHero does not draw the scale');
});

test('homepage: the forecast curve is server-rendered, not JS-only', () => {
  // The section exists to answer "elpriser prognose" searches that land on the
  // homepage. A chart that appears only after JS runs would not do that, so the
  // placeholder and the code that fills it both have to be present.
  assert.ok(INDEX.includes('<!--SSR_FORECAST_CHART-->'),
    'index.html lost the SSR_FORECAST_CHART placeholder');
  assert.ok(/<div id="homeForecast">/.test(INDEX),
    'the forecast container is missing from the homepage');
  assert.ok(INDEX.includes('Nu og 2 døgn frem'), 'the section heading is missing');
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(ROUTES_SRC.includes('function fcChartHTML('),
    'functions/[[path]].js no longer builds the forecast chart');
  assert.ok(ROUTES_SRC.includes("html.replace('<!--SSR_FORECAST_CHART-->'"),
    'the server never substitutes SSR_FORECAST_CHART');
});

test('homepage: the forecast numbers stay as text, not just path data', () => {
  // A polyline is unreadable to a crawler and to a screen reader. The whole
  // point of server-rendering this section is the numbers, so the per-day
  // figures have to leave the function as text.
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const fn = ROUTES_SRC.slice(ROUTES_SRC.indexOf('function fcChartHTML('),
                              ROUTES_SRC.indexOf('/** Build the live-price JSON-LD block'));
  assert.ok(/class="minirow"/.test(fn), 'the per-day figures are gone from the chart output');
  assert.ok(/aria-label=/.test(fn), 'the svg has no accessible name');
});

test('homepage: the chart reuses the hero card styles, which are hand-written', () => {
  // Tailwind does not scan JS- or server-generated markup, so a utility class
  // used only there is purged out of style.css and silently does nothing.
  // The chart deliberately reuses .chartcard/.minirow/.mini rather than
  // inventing new classes, and those must stay in the hand-written block.
  const style = INDEX.slice(INDEX.indexOf('<style>'), INDEX.indexOf('</style>'));
  for (const cls of ['.chartcard', '.minirow', '.mini{', '.mini .v', '.mini.best', '.fc-days', '.fc-hours', '.yplot', '.yax', '.ygut', '.fcweek']) {
    assert.ok(style.includes(cls), `${cls} is not hand-written in the <style> block`);
  }
});

test('structure: index.html begins with the doctype', () => {
  // A tbody once landed at byte 0 because a replacement searched for its
  // closing tag from the start of the file. Every page then opened with a
  // block of unstyled table text above <!DOCTYPE html>.
  assert.ok(INDEX.startsWith('<!DOCTYPE html>'),
    `index.html starts with ${JSON.stringify(INDEX.slice(0, 60))} — markup landed outside the document`);
});

test('sitemap: foreign-zone pages rank below the Danish ones in priority', () => {
  // 21 of 43 URLs are discovered but not indexed. The eleven non-Danish zone
  // pages are the least likely to earn it and must not outrank the per-net
  // pages for crawl budget.
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const fn = ROUTES_SRC.match(/const priorityFor = p => \{([\s\S]*?)\n  \};/);
  assert.ok(fn, 'priorityFor not found');
  const zone = fn[1].match(/ZONE_ONLY\.test\(p\)\) return '([\d.]+)'/);
  const net = fn[1].match(/dk\[12\].*?return '([\d.]+)'/);
  assert.ok(zone && net, 'zone or per-net priority missing');
  assert.ok(parseFloat(zone[1]) < parseFloat(net[1]),
    `zone pages at ${zone[1]} are not below per-net pages at ${net[1]}`);
});

test('seo: no JS expression is written into an href', () => {
  // Google crawled and indexed /${k} — 55 impressions — because a template
  // literal sat inside an href in the served HTML. Concatenation does the same:
  // href="/'+a.toLowerCase()+' ships as literal text and gets crawled too.
  // Build the markup, then assign the href from JS.
  const bad = [...INDEX.matchAll(/href="\/[^"]*(\$\{|'\s*\+)/g)].map(m => m[0]);
  assert.equal(bad.length, 0,
    `a JS expression is written into an href: ${bad.join(', ')}`);
});

test('flex: appliance types in the UI match what the API accepts and refuses', () => {
  // The UI decides which appliances get a switching script; the API decides
  // which count as flexible capacity. If the two lists drift, the page can
  // hand out a script whose reports the API rejects — or the API can start
  // counting an appliance the page warns must never be switched.
  const API = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const reg = INDEX.match(/const FLEX_DEVICE_TYPES=\{([\s\S]*?)\n\};/);
  assert.ok(reg, 'FLEX_DEVICE_TYPES not found in index.html');
  const types = [...reg[1].matchAll(/^\s*(\w+):\{label:'[^']*',flex:'(\w+)'/gm)].map(m => [m[1], m[2]]);
  assert.ok(types.length >= 10, `expected at least 10 appliance types, found ${types.length}`);
  const uiAccepted = types.filter(([, f]) => f !== 'no').map(([k]) => k).sort();
  const uiRefused = types.filter(([, f]) => f === 'no').map(([k]) => k).sort();

  const acc = API.match(/const FLEX_CATEGORIES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(acc, 'FLEX_CATEGORIES not found in the API');
  const apiAccepted = [...acc[1].matchAll(/'(\w+)'/g)].map(m => m[1]).sort();
  const ref = API.match(/const FLEX_UNSUITABLE = \{([\s\S]*?)\};/);
  assert.ok(ref, 'FLEX_UNSUITABLE not found in the API');
  const apiRefused = [...ref[1].matchAll(/^\s*(\w+):\s+'/gm)].map(m => m[1]).sort();

  assert.deepEqual(apiAccepted, uiAccepted, 'API FLEX_CATEGORIES differs from the UI types that get a script');
  assert.deepEqual(apiRefused, uiRefused, 'API FLEX_UNSUITABLE differs from the UI types marked flex:no');

  // Every option in the <select> must be a known type, and vice versa.
  const opts = [...INDEX.matchAll(/<select id="autoDevice"[\s\S]*?<\/select>/g)][0][0];
  const optKeys = [...opts.matchAll(/value="(\w+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(optKeys, types.map(([k]) => k).sort(), 'appliance <select> options differ from FLEX_DEVICE_TYPES');
});

test('crawlable: every SEO_PAGES hash maps to a data-page section', () => {
  // A page whose hash is missing from HASH_TO_DATA_PAGE silently renders the
  // homepage section under its own title — the URL is right, the canonical is
  // right, and the body is the wrong page. /blog shipped that way for one
  // deploy, so assert the mapping rather than trusting it.
  const hashes = [...ROUTES.matchAll(/hash:\s*'#([^']+)'/g)].map(m => m[1]);
  const mapBlock = ROUTES.match(/const HASH_TO_DATA_PAGE = \{([\s\S]*?)\n\};/);
  assert.ok(mapBlock, 'HASH_TO_DATA_PAGE not found in functions/[[path]].js');
  hashes.forEach(h => {
    // DK1/DK2 price hashes are resolved by pattern, not by the map.
    if (/^DK[12]\//.test(h)) return;
    assert.ok(mapBlock[1].includes(`'${h}':`),
      `HASH_TO_DATA_PAGE missing "${h}" — that page will serve the start section`);
  });
});

test('crawlable: _routes.json routes every page through the function', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '_routes.json'), 'utf8'));
  const indexNets = getNetsFromIndex();
  const paths = [
    '/', '/dk1', '/dk2', '/tariffer', '/automation', '/api', '/prognose',
    '/om-elpriser', '/shelly-tariff', '/sitemap.xml', '/robots.txt',
    '/no1', '/se1', '/fi', '/nl',
    ...indexNets.DK1.map(s => `/dk1/${s}`),
    ...indexNets.DK2.map(s => `/dk2/${s}`),
    // Variants that must reach the function so it can normalise them; served
    // statically they answer 200 and point their canonical at the homepage,
    // which is what Search Console reports as "Alternate page with proper
    // canonical tag".
    '/dk1/', '/se1/', '/tariffer/', '/dk1/n1/', '/DK1', '/findes-ikke',
  ];
  paths.forEach(p => {
    assert.ok(routedByFunction(routes, p),
      `_routes.json does not route "${p}" through the function`);
  });
});

test('crawlable: _routes.json keeps static assets off the function', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '_routes.json'), 'utf8'));
  ['/style.css', '/favicon.ico', '/favicon.svg', '/og-image.png',
   '/apple-touch-icon.png'].forEach(p => {
    assert.ok(!routedByFunction(routes, p),
      `_routes.json sends "${p}" through the function — it should be served directly`);
  });
});

test('crawlable: net-URL pattern in functions matches /dk[12]/slug', () => {
  assert.ok(/\/\^\\\/\(dk\[12\]\)\\\/\(\[a-z0-9-\]\+\)\$\//.test(ROUTES),
    'functions/[[path]].js must match /dk[12]/<slug> for per-net crawlable URLs');
});

test('crawlable: renderSPA helper rewrites title + canonical + OG metadata', () => {
  // renderSPA must rewrite the SEO-critical meta so each clean URL ships with
  // its own metadata. Hash-redirects are NOT injected (that clobbered the
  // clean URL to /#hash); pathname routing is handled client-side by route().
  const body = ROUTES.match(/async function renderSPA[\s\S]*?^}/m);
  assert.ok(body, 'renderSPA function not found');
  ['<title>', 'description', 'canonical', 'og:title', 'og:description']
    .forEach(needle => {
      assert.ok(body[0].includes(needle),
        `renderSPA missing "${needle}" — crawlers will see stale metadata`);
    });
  assert.ok(!body[0].includes('location.replace'),
    'renderSPA must NOT inject location.replace — it clobbers the clean URL to /#hash');
});

test('router: pathToHash maps every SEO clean URL to a hash route', () => {
  // The crawlable URLs (/dk1, /blog/*, etc.) load without a hash. route() falls
  // back to pathname routing via pathToHash — so every SEO_PAGES entry must
  // have a corresponding pathToHash mapping, or the page renders as Start.
  const seoBlock = ROUTES.match(/const SEO_PAGES = \{[\s\S]*?^\};/m);
  assert.ok(seoBlock, 'SEO_PAGES block not found in functions/[[path]].js');
  const seoPaths = [...seoBlock[0].matchAll(/^  '(\/[^']+)':\s*\{/gm)].map(m => m[1]);
  assert.ok(seoPaths.length >= 9, `expected 9+ SEO_PAGES entries, got ${seoPaths.length}`);
  for (const p of seoPaths) {
    const needle = `'${p}':`;
    assert.ok(INDEX.includes(needle),
      `PATH_ROUTES in index.html missing "${p}" — clean URL ${p} will render Start page`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routing — localStorage redirect regression
// ─────────────────────────────────────────────────────────────────────────────

test('router: empty hash lands on start page, does NOT redirect to lastHash', () => {
  // Fixed in commit 37262b9 (follow-up): user reported that after clicking
  // "Find dit netselskab automatisk", the router always redirected them back
  // to the detected netselskab page. Home link must always show /.
  const routeFn = INDEX.match(/function route\(\)\{[\s\S]*?^\}/m);
  assert.ok(routeFn, 'route() function not found');
  assert.ok(!/localStorage\.getItem\(['"]lastHash['"]\)/.test(routeFn[0]),
    'router must not auto-redirect from / to localStorage.lastHash');
});

test('router: all data-page slugs in the router have a matching <main>', () => {
  const routed = [...INDEX.matchAll(/data-page="([^"]+)"\]'\)\.classList\.add/g)]
    .map(m => m[1]);
  assert.ok(routed.length >= 7, `expected multiple routed pages, got ${routed.length}`);
  routed.forEach(slug => {
    assert.ok(new RegExp(`<main[^>]*\\sdata-page="${slug}"`).test(INDEX),
      `no <main data-page="${slug}"> found for router slug`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Design system — spacing utilities must exist (either in compiled Tailwind
// or in the <style> block). Missing classes silently collapse to 0, which
// is how the hero top-padding bug shipped.
// ─────────────────────────────────────────────────────────────────────────────

function classDefined(cls) {
  // Check for .cls in style.css OR in the inline <style> block. Matches
  // both plain `.cls{` and compound selectors like `.cls > :not(...)`.
  const esc = cls.replace(/\./g, '\\.');
  const pattern = new RegExp(`\\.${esc}(?=[\\s>{:,])`);
  return pattern.test(STYLE) || pattern.test(INDEX);
}

const REQUIRED_SPACING = [
  'mt-12', 'mt-14',       // used on nav pills / FAQ / stats spacing
  'mb-5', 'mb-6', 'mb-7', // heading → body spacing
  'gap-4', 'py-14',
  'space-y-5', 'space-y-8', 'space-y-10',
];

REQUIRED_SPACING.forEach(cls => {
  test(`css: class .${cls} is defined (missing → silent 0 padding)`, () => {
    assert.ok(classDefined(cls), `.${cls} is used in HTML but not defined in style.css or inline <style>`);
  });
});

test('css: .hero has padding-top (regression: pt-14 class did not exist in compiled Tailwind)', () => {
  const hero = INDEX.match(/\.hero\{([^}]+)\}/);
  assert.ok(hero, '.hero class not found');
  assert.ok(/padding-top:\s*[0-9.]+rem/.test(hero[1]),
    '.hero must set padding-top explicitly (do not rely on Tailwind utility classes)');
});

test('css: heading-binding rule — .stats-section and .prose-article gap ≥ 2rem', () => {
  // Headings inside these containers need visibly more space ABOVE than BELOW
  // so they bind with the following content. If this rule disappears, section
  // headings look orphaned.
  const stats = INDEX.match(/\.stats-section\s*>\s*div\s*\+\s*div\{margin-top:\s*([0-9.]+)rem/);
  assert.ok(stats, '.stats-section sibling gap rule missing');
  assert.ok(parseFloat(stats[1]) >= 2, `stats-section gap is ${stats[1]}rem, should be ≥ 2rem`);
  const article = INDEX.match(/\.prose-article\s*>\s*section\s*\+\s*section\{margin-top:\s*([0-9.]+)rem/);
  assert.ok(article, '.prose-article sibling gap rule missing');
  assert.ok(parseFloat(article[1]) >= 2, `prose-article gap is ${article[1]}rem, should be ≥ 2rem`);
});

test('design: GPS button has generous top margin (regression: was mt-7 = cramped)', () => {
  // The button now sits in a centred wrapper that carries the spacing, so the
  // margin is asserted on the wrapper rather than on the button itself.
  const wrap = INDEX.match(/<div class="text-center mt-(\d+)">\s*<button id="gpsBtn"/);
  assert.ok(wrap, 'gpsBtn is no longer inside a centred wrapper with a top margin');
  assert.ok(parseInt(wrap[1], 10) >= 8,
    `the GPS wrapper uses mt-${wrap[1]} — should be mt-8 or larger for breathing room`);
});

test('design: GPS button is a single <button> (not a bar + separate button)', () => {
  // Previously was <div id="gpsBar"> wrapping a small "Find mig" button.
  // Merged for clarity — one clickable affordance.
  assert.ok(/<button\s+id="gpsBtn"[^>]*onclick="detectLocation\(\)"/.test(INDEX),
    'gpsBtn must be a <button> with onclick=detectLocation');
  assert.ok(!/id="gpsBar"/.test(INDEX),
    'gpsBar wrapper should be removed — button carries the gps-bar class directly');
  assert.ok(!/Find mig<\/button>/.test(INDEX),
    '"Find mig" child button should be removed (merged into the parent)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Design system — zone button classes
// ─────────────────────────────────────────────────────────────────────────────

['zone-btn', 'zone-btn-primary', 'zone-btn-soft', 'zone-btn-ghost',
 'net-row', 'net-chip', 'nav-pill', 'card', 'faq']
  .forEach(cls => {
    test(`css: .${cls} (design system) is defined`, () => {
      assert.ok(classDefined(cls), `.${cls} used but not defined`);
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility / fundamentals
// ─────────────────────────────────────────────────────────────────────────────

test('a11y: <html lang="da"> set for Danish content', () => {
  assert.ok(/<html\s+lang="da"/.test(INDEX), '<html> missing lang="da"');
});

test('a11y: each <main data-page> contains at most one <h1>', () => {
  // Multiple H1s in source are OK because only one <main> is active at a time
  // (SPA pattern). But each page block should still have ≤1 H1.
  const pages = [...INDEX.matchAll(/<main\s+data-page="[^"]+"[^>]*>([\s\S]*?)<\/main>/g)];
  assert.ok(pages.length > 0, 'no <main data-page> blocks found');
  pages.forEach((m, i) => {
    const h1s = m[1].match(/<h1[^>]*>/g) || [];
    assert.ok(h1s.length <= 1, `page #${i} has ${h1s.length} <h1> tags (max 1)`);
  });
});

test('a11y: buttons with onclick also have readable text', () => {
  // A button with `onclick` but empty/icon-only text fails screen readers
  const buttons = [...INDEX.matchAll(/<button[^>]*onclick="[^"]+"[^>]*>([\s\S]*?)<\/button>/g)];
  buttons.forEach((m, i) => {
    const inner = m[1].replace(/<[^>]*>/g, '').trim();
    assert.ok(inner.length > 0 || /aria-label="/.test(m[0]),
      `button #${i} has onclick but no visible text or aria-label`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Run & report
// ─────────────────────────────────────────────────────────────────────────────


test('gps: the remembered pick is the answer, never the coordinates', () => {
  // A geolocation grant is not permanent and the site cannot make it so —
  // Safari drops it after about a day. What makes the lookup stick is
  // remembering the netselskab it resolved to. Coordinates must not be what
  // gets stored: they are a location log the site has no use for, and the
  // grid company is settled by address anyway.
  const fn = INDEX.slice(INDEX.indexOf('function saveNetPick'),
                         INDEX.indexOf('async function detectLocation'));
  assert.ok(fn.length > 100, 'saveNetPick/readNetPick not found');
  assert.ok(!/\b(lat|lng|latitude|longitude|coords)\b/.test(fn),
    `the remembered value must not carry coordinates: ${fn.slice(0, 200)}`);
  assert.ok(/localStorage\.setItem\(NET_PICK_KEY/.test(fn), 'the pick is not persisted');
});

test('gps: an approximate IP position is not remembered', () => {
  // The IP fallback is city-level and routinely lands Danish users in Lund or
  // Flensburg because of ISP peering. Persisting that would pin the wrong
  // grid company indefinitely — far worse than asking again.
  const save = INDEX.match(/if\(!approx\)saveNetPick\(pick\);/);
  assert.ok(save, 'the save is not guarded by the approx flag');
});

test('gps: a remembered pick is validated before it is used', () => {
  // Slugs get renamed. A stored value that is read back unchecked would route
  // to a netselskab page that no longer exists.
  const read = INDEX.slice(INDEX.indexOf('function readNetPick'),
                           INDEX.indexOf('function forgetNetPick'));
  assert.ok(/netBySlug/.test(read) && /DK1.*DK2/.test(read),
    `readNetPick does not validate what it read back: ${read.slice(0, 200)}`);
});

test('gps: the remembered pick can be cleared by the user', () => {
  assert.ok(/function forgetNetPick/.test(INDEX), 'no way to forget the pick');
  assert.ok(/removeItem\(NET_PICK_KEY\)/.test(INDEX), 'forgetNetPick does not remove the key');
  assert.ok(/id="gpsForget"/.test(INDEX), 'no control offering to forget it');
});

test('gps: location is only ever requested from a click, never on load', () => {
  // An unprompted permission request on load is both rude and
  // counter-productive: Chrome demotes origins that ask without a user
  // gesture, so it lowers the grant rate it was meant to raise.
  const calls = [...INDEX.matchAll(/(\w+)\s*\(\s*\)\s*;?\s*(?=\n)/g)];
  assert.ok(!/(DOMContentLoaded|window\.onload)[\s\S]{0,400}?detectLocation\(/.test(INDEX),
    'detectLocation is wired to page load');
  const auto = INDEX.match(/^\s*detectLocation\(\);/m);
  assert.equal(auto, null, `detectLocation is called unconditionally: ${auto && auto[0]}`);
  assert.ok(/id="gpsBtn" onclick="detectLocation\(\)"/.test(INDEX),
    'the GPS lookup should be reached from the button');
});

test('privacy: /privatliv is a shipped static page that states what happens to the position', () => {
  const page = fs.readFileSync(path.join(__dirname, 'privatliv.html'), 'utf8');
  assert.ok(/gemmes aldrig/i.test(page), 'the policy must say the position is never stored');
  assert.ok(/<title>Privatlivspolitik/.test(page), 'page title');
  const build = fs.readFileSync(path.join(__dirname, 'scripts', 'build-dist.sh'), 'utf8');
  assert.ok(/^\s*privatliv\.html$/m.test(build), 'privatliv.html is in the dist manifest');
  const fn = fs.readFileSync(path.join(__dirname, 'functions', '[[path]].js'), 'utf8');
  assert.ok(/STATIC_ASSETS = new Set\(\[[^\]]*'\/privatliv'/.test(fn), 'the catch-all lets /privatliv through to the static file');
});

test('supplierlookup: reverse-geocodes with Nominatim, not the retired DAWA', () => {
  const api = fs.readFileSync(path.join(__dirname, 'functions', 'api', '[[catchall]].js'), 'utf8');
  assert.ok(!/fetch\(\s*`https:\/\/dawa\.aws\.dk/.test(api), 'DAWA was shut down on 2026-07-01 (410 Gone)');
  assert.ok(/nominatim\.openstreetmap\.org\/reverse/.test(api), 'reverse lookup goes to Nominatim');
  assert.ok(/User-Agent/.test(api), 'Nominatim requires an identifying User-Agent');
  assert.ok(/outside_denmark/.test(api), 'positions outside Denmark are reported, not looked up at GPD');
});

console.log('\n⚡ Static integrity tests\n' + '─'.repeat(50));
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '\n   └─ ' + r.msg}`);
}
console.log('─'.repeat(50));
console.log(`\n${_passed} passed, ${_failed} failed\n`);
process.exit(_failed > 0 ? 1 : 0);