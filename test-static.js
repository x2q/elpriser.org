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

// The pages folded into others and where they now go: five blog posts (2026-10-17 cleanup) and the
// eleven foreign zone pages that became /no/strompris, /sv/elpris, /fi/sahkon-hinta, /nl/stroomprijs and /norden. This is the ONE copy
// of the expectation: functions/[[path]].js and server.js must agree with it, and nothing else in the
// site may mention the retired paths.
const LEGACY = {
  '/blog/v2g-v2h-bidirektional-opladning': '/blog',
  '/blog/biler-ladere-v2h-v2g': '/blog',
  '/blog/shelly-elpris-automation': '/automation#shelly',
  '/blog/home-assistant-elpriser': '/automation#home-assistant',
  '/blog/forsta-din-elpris': '/om-elpriser',
  '/no1': '/no/strompris#no1', '/no2': '/no/strompris#no2', '/no3': '/no/strompris#no3', '/no4': '/no/strompris#no4', '/no5': '/no/strompris#no5',
  '/se1': '/sv/elpris#se1', '/se2': '/sv/elpris#se2', '/se3': '/sv/elpris#se3', '/se4': '/sv/elpris#se4',
  '/fi': '/fi/sahkon-hinta', '/nl': '/nl/stroomprijs',
  // the first spelling of the three country pages, live for a day: straight to the final URL, no chain
  '/norge': '/no/strompris', '/sverige': '/sv/elpris', '/finland': '/fi/sahkon-hinta',
};
// The pilot city table. functions/_cities.js is an ES module and this file is CommonJS, but the array is plain data.
const CITIES_SRC = fs.readFileSync(path.join(ROOT, 'functions', '_cities.js'), 'utf8');
const CITY_TABLE = JSON.parse(JSON.stringify(require('node:vm').runInNewContext('(' + CITIES_SRC.match(/export const CITIES = (\[[\s\S]*?\n\]);/)[1] + ')')));   // through JSON: a vm object has another realm's prototypes
const LEGACY_SLUGS = Object.keys(LEGACY).filter(k => k.startsWith('/blog/')).map(k => k.replace('/blog/', ''));
const LEGACY_ZONES = Object.keys(LEGACY).filter(k => !k.startsWith('/blog/'));

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
  // Design A: the phone bar has the two destinations, Pris and Smart hjem.
  const bar = INDEX.match(/<nav class="tabbar" id="tabBar"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...bar.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]), ['/', '/automation'],
    'the phone bar is not exactly Pris and Smart hjem');
  assert.ok(/>Pris<\/a>/.test(bar) && />Smart hjem<\/a>/.test(bar), 'the phone bar labels are not Pris / Smart hjem');
});

test('mobile: phone styles are hand-written and scoped to small screens', () => {
  const style = INDEX.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(style.includes('.tabbar{display:none}'),
    'the tab bar must be hidden by default and shown only on phones');
  assert.ok(/@media \(max-width:640px\)\{[\s\S]*?\.tabbar\{display:flex/.test(style),
    'the tab bar is never shown at phone width');
  for (const cls of ['.pris-page', '.pris-hero', '.tabbar a', '.tabbar .on']) {
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
    'var ZONES', 'var PRIS_I18N', 'var PRIS_COUNTRIES', 'var PRIS_STD', 'var PRIS_FC', 'const ZONE_SSR_VERSION', 'const CITY_SSR_VERSION', 'const PROGNOSE_SSR_VERSION', 'function renderCachedPage(', 'function cityHTML(', 'function prisScreen(', 'function fetchNetForecast(',
    'function zoneToPrisDays(', 'function prisZoneTabs(', 'function prisZoneList(', 'function prisNordenHTML(',
    'function buildSitemap(',
    'const CONTENT_LASTMOD', 'const SITEMAP_URLS',
  ];
  const missing = required.filter(r => !SRC.includes(r));
  assert.deepEqual(missing, [], `functions/[[path]].js is missing: ${missing.join(', ')}`);

  // And nothing may be referenced that is no longer defined.
  for (const name of ['zoneToPrisDays', 'prisZoneTabs', 'prisZoneList', 'prisNordenHTML', 'renderCachedPage', 'cityHTML', 'prisScreen', 'fetchNetForecast', 'withNetChip']) {
    const called = new RegExp(`[^a-zA-Z.]${name}\\s*\\(`).test(
      SRC.slice(SRC.indexOf('async function renderHomepage')));
    const defined = SRC.includes(`function ${name}(`);
    assert.ok(!called || defined, `${name} is called but not defined`);
  }
});

test('price pages: the day-by-hour grid is gone — the data it shared with other features is not', () => {
  // The "Time for time · 4 dage tilbage, 3 døgn frem" grid (days as columns,
  // hours as rows, PROGNOSE columns, Forrige/Næste paging) was removed on the
  // owner's decision; the Pris screen replaced it. Nothing of it may come back
  // by accident: markup, the code that drew and paged it, or its state.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  for (const id of ['priceTable', 'tableWrapper', 'tableView', 'tableTitle', 'loadingIndicator', 'fcTableNote', 'weekLabel', 'nextWeekBtn'])
    assert.ok(!INDEX.includes(`id="${id}"`), `#${id} (the price grid) is back in index.html`);
  for (const fn of ['renderTable', 'tableWindow', 'changeWeek', 'updateWeekNav', 'reloadPrices', 'showPriceDetail'])
    assert.ok(!new RegExp(`\\b${fn}\\b`).test(INDEX), `${fn} (the price grid) is back in index.html`);
  assert.ok(!/weekOffset|fcDays|fcTableNote|change_week/.test(INDEX), 'state or tracking of the price grid is back');
  assert.ok(!/id="priceDetail"/.test(INDEX), 'the grid cell popup is back');
  assert.ok(!/4 dage tilbage|Forrige<|Næste →/.test(INDEX + SRV), 'copy promising the grid or its paging is back');
  assert.ok(!/fcTomorrow|showFc/.test(INDEX), 'leftovers of the single forecast column');

  // What stays: loadPriceData() still fills priceData, because the Smart hjem
  // page plans over its last seven days, updatePriceSentence() rewrites the
  // intro sentence from it and cvt() prices it. Lifted out of index.html and
  // run with synchronous stubs (this file's runner is synchronous, so `async`
  // and `await` are stripped from the lifted text and nothing else changes).
  const vm = require('vm');
  const a = INDEX.indexOf('async function loadPriceData('), b = INDEX.indexOf('// ═══ Pris lige nu, i ord ═══');
  assert.ok(a > 0 && b > a, 'loadPriceData not found');
  const calls = { urls: [], sentence: 0, enCharges: 0, tariff: [] };
  const ctx = {
    S: { area: 'DK2', mode: 'net_inkl_alt', gln: '123', _loadId: 7 },
    priceData: {}, console,
    fmt: eval(INDEX.match(/const fmt=(d=>[^\n]+)/)[1].replace(/;$/, '')),
    fetchEnCharges: () => { calls.enCharges++; },
    loadNetTariff: g => { calls.tariff.push(g); },
    fetchPricesWithRetry: u => { calls.urls.push(u); return { records: [{ TimeDK: '2026-01-01T10:00:00', DayAheadPriceDKK: 500 }] }; },
    processRecords: r => ({ '2026-01-01': { 10: r[0].DayAheadPriceDKK } }),
    updatePriceSentence: () => { calls.sentence++; },
  };
  vm.createContext(ctx);
  const loader = INDEX.slice(a, b).replace(/^async function/, 'function').replace(/\bawait\s+/g, '');
  vm.runInContext(loader + '\nglobalThis.load = loadPriceData;', ctx);
  {
    ctx.load(7);
    assert.equal(calls.urls.length, 1, 'one price request per load');
    const m = calls.urls[0].match(/^\/api\/raw\/prices\?area=DK2&start=(\d{4}-\d\d-\d\d)&end=(\d{4}-\d\d-\d\d)$/);
    assert.ok(m, `unexpected price request ${calls.urls[0]}`);
    const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ctx.fmt(d); };
    assert.equal(m[1], day(-7), 'the load no longer reaches seven days back (the automation page plans over them)');
    assert.equal(m[2], day(2), 'the load no longer reaches two days ahead');
    assert.deepEqual(Object.keys(ctx.priceData), ['2026-01-01'], 'priceData is not filled');
    assert.equal(calls.sentence, 1, 'the intro sentence is not rewritten from the loaded prices');
    assert.equal(calls.enCharges, 1, 'the Energinet charges are not loaded for a net_ mode');
    assert.deepEqual(calls.tariff, ['123'], 'the net tariff is not loaded for a net_ mode');
    // A load that has been superseded by a newer one must not overwrite anything.
    ctx.S._loadId = 8; ctx.priceData = {};
    ctx.load(7);
    assert.deepEqual(ctx.priceData, {}, 'a stale load overwrote priceData');
    // A failed request is not fatal: no grid to show an error in, and Smart hjem
    // fetches for itself when priceData is empty.
    ctx.fetchPricesWithRetry = () => { throw new Error('offline'); };
    ctx.console = { warn() {}, error() {}, log() {} };
    ctx.load(8);
    assert.deepEqual(ctx.priceData, {}, 'a failed load left priceData in a bad state');
  }
});

test('price pages: switch, sentence and unit describe the same price in every view', () => {
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
  }
  // Design A: the UI offers two views, Din pris and Spotpris — no dropdown of six
  // modes. Old links to the other four still open, on the nearest of the two.
  assert.ok(!/id="priceSelector"/.test(INDEX) && !/onPriceSelectorChange/.test(INDEX), 'the six-mode dropdown is back');
  // The two views live in the Pris screen's switch (the front-page area cards that used to
  // repeat them are gone), and that switch has exactly two buttons.
  const sw = INDEX.slice(INDEX.indexOf('function prisSwitch('), INDEX.indexOf('/** One chart card'));
  assert.equal((sw.match(/b\('/g) || []).length, 2, 'the Pris switch offers more than two views');
  assert.ok(!INDEX.includes('ZONE_BTNS') && !INDEX.includes('id="dk1-zone"'), 'the front-page area cards are back');
  const nr = INDEX.slice(INDEX.indexOf('function normaliseRoute(h){'), INDEX.indexOf('/** The route key for the page as it is right now. */'));
  assert.ok(nr.length > 100, 'normaliseRoute not found');
  const rctx = {}; vm.createContext(rctx);
  vm.runInContext(nr + '\nglobalThis.n = normaliseRoute;', rctx);
  for (const [from, to] of [
    ['DK1/inkl_alt', 'DK1/inkl_alt'], ['DK1/inkl_alt_minus', 'DK1/inkl_alt'],
    ['DK1/spot_inkl', 'DK1/spot_inkl'], ['DK2/spot_ex', 'DK2/spot_inkl'],
    ['DK1/net_inkl_alt/n1', 'DK1/net_inkl_alt/n1'], ['DK1/net_inkl_tarif/trefor', 'DK1/net_inkl_alt/trefor'],
    ['DK1/spot_inkl/n1', 'DK1/spot_inkl/n1'], ['DK1/spot_ex/n1', 'DK1/spot_inkl/n1'],
    ['DK1/net_inkl_alt', 'DK1/inkl_alt'], ['DK2/ukendt', 'DK2/inkl_alt'], ['tariffer', 'tariffer'], ['', ''],
  ]) assert.equal(rctx.n(from), to, `normaliseRoute(${from})`);
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
    const t = `Elpris ${w} (${a}) i dag — spotpris inkl. alt, time for time`;
    assert.ok(SRV.includes(`title: '${t}'`), `server title for ${a} is not "${t}"`);
  }
  assert.ok(INDEX.includes("document.title=`Elpris ${S.area==='DK1'?'Vest':'Øst'} (${S.area}) i dag — spotpris inkl. alt, time for time`"),
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
  assert.ok(/function goRoute\(h\)\{[\s\S]*?path===location\.pathname[\s\S]*?location\.href=u/.test(INDEX),
    'goRoute: same page stays in place, another page is a normal load');
  assert.ok(/function setPrisView\([\s\S]*?goRoute\(/.test(INDEX), 'the Din pris / Spotpris switch goes through goRoute');
  assert.ok(!/inkl\. nettarif, systemtarif, transmissionstarif, elafgift og moms er \$\{fmt\(dk1\.total\)\}/.test(SRV),
    'the homepage summary still says the no-company total includes the nettarif');
});

test('price pages: the Pris screen sits above the heading and is drawn for the view the URL and the switch imply', () => {
  const main = INDEX.slice(INDEX.indexOf('data-page="prices"'), INDEX.indexOf('<!-- ═══════ TARIFF PAGE'));
  // The mount comes first, then the server-written intro with the page's h1 —
  // and nothing above the h1 may be a heading element, or the outline starts at h2.
  assert.ok(/data-pris-mount><!--SSR_PRIS--><\/div>/.test(main), 'no server placeholder for the Pris screen on the price pages');
  assert.ok(main.indexOf('data-pris-mount') < main.indexOf('<!--SSR_PRICES_INTRO-->'), 'the Pris screen is not above the page intro');
  assert.ok(!/<h[1-6]/.test(main.slice(0, main.indexOf('<!--SSR_PRICES_INTRO-->'))), 'a heading element sits above the page h1');
  // Din pris on a net page is that net's all-in price; /api/forecast applies the
  // tariff in force on each day's own date, so it equals the table's figure.
  const q = INDEX.slice(INDEX.indexOf('function prisQuery(){'), INDEX.indexOf('function prisOpts(){'));
  assert.ok(/mode=spot_inkl/.test(q) && /mode=net_inkl_alt&gln=\$\{net\.gln\}/.test(q) && /mode=inkl_alt`/.test(q),
    'the Pris screen does not ask for Spotpris / the net\'s price / the area\'s price');
  assert.ok(/loadPriceData\(S\._loadId\);loadPris\(\);/.test(INDEX), 'a price page does not load the Pris screen');
  // The server draws the same screen for the URL's own view, with the net's gln.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  // The forecast request, the drawing and the chip are helpers (fetchNetForecast, prisScreen, withNetChip) since the
  // city pages use them too; the price pages must still call all three, with the page's own area and net.
  const sp = SRV.slice(SRV.indexOf('if (opts.pricesIntro) {'), SRV.indexOf('\n  if (opts.city) {'));
  const fetcher = SRV.slice(SRV.indexOf('function fetchNetForecast('), SRV.indexOf('function prisScreen('));
  assert.ok(/api\/forecast\?area=\$\{area\}&mode=\$\{net \? 'net_inkl_alt' : 'inkl_alt'\}\$\{net \? `&gln=\$\{net\.gln\}` : ''\}/.test(fetcher), 'server forecast is not the net\'s own');
  assert.ok(/fetchNetForecast\(context, area, net\)/.test(sp), 'the price pages do not fetch the net\'s own forecast');
  assert.ok(/html\.replace\('<!--SSR_PRIS-->', prisScreen\(fc, area, net\)\)/.test(sp), 'the server does not draw the Pris screen on price pages');
  const drawer = SRV.slice(SRV.indexOf('function prisScreen('), SRV.indexOf('function withNetChip('));
  assert.ok(/prisHTML\(fc\.days \|\| \[\], todayDk, nowH/.test(drawer) && /view: 'din'/.test(drawer) && /charges: fc\.charges/.test(drawer), 'the Pris screen is not drawn as Din pris from the response\'s days and charges');
  assert.ok(/withNetChip\(html, net \? net\.name : area, area\)/.test(sp), 'the net chip is not written for the page\'s net');
  const chip = SRV.slice(SRV.indexOf('function withNetChip('), SRV.indexOf('async function renderSPA('));
  assert.ok(/netChipLong/.test(chip) && /netChipShort/.test(chip), 'the net chip function does not write both chips');
});

test('seo: no heading tag written inside an HTML comment', () => {
  // Crawlers and the live h1 count read raw markup, comments included. A
  // comment explaining heading order that spelled out the tags made every
  // price page report two h1 elements.
  const bad = [...INDEX.matchAll(/<!--([\s\S]*?)-->/g)].filter(m => /<h[1-6]\b/i.test(m[1]))
    .map(m => m[1].trim().slice(0, 60));
  assert.deepEqual(bad, [], `heading tag inside a comment: ${bad.join(' | ')}`);
});

test('foreign-area pages: one section with tabs, the Pris screen and a text block — and none of the old zone page is left', () => {
  const main = INDEX.slice(INDEX.indexOf('<main style="display:none" data-page="zone"'), INDEX.indexOf('<!-- ═══════ NORDEN'));
  assert.ok(main.length > 100, 'the zone section is gone');
  const at = x => main.indexOf(x);
  assert.ok(at('<h1 class="vh" id="zH1">') > 0 && at('<!--SSR_ZONE_TABS-->') > at('id="zH1"') && at('<!--SSR_PRIS-->') > at('<!--SSR_ZONE_TABS-->') && at('<!--SSR_ZONE_LIST-->') > at('<!--SSR_PRIS-->'),
    'the section is not h1, tabs, Pris screen, text block in that order');
  assert.ok(/<div class="pris-page" data-pris-mount id="zPanel"><!--SSR_PRIS--><\/div>/.test(main), 'the screen is not the canonical Pris mount');
  assert.equal((main.match(/<h[1-6]/g) || []).length, 1, 'the zone section carries a heading of its own besides the h1');
  // NO second renderer and no per-language copies: the old page's code, markup and strings are gone.
  for (const gone of ['function loadZone(', 'function renderZone(', 'function renderZoneForecast(', 'const I18N=', 'function zoneLang(', 'function loadTariffs(', 'function pickNet(',
    'function openGlobe(', 'function buildGlobe(', 'globeOverlay', 'globe-grid', 'zoneForecast', 'id="zCur"', 'id="zNet"', 'id="zWrap"', 'zNoteModel', 'const LOCALE=', 'const ZONES='])
    assert.ok(!INDEX.includes(gone), `${gone} is still in index.html`);
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  for (const gone of ['SSR_ZONES', 'ZONE_T ', 'ZONE_CUR_RE', 'buildZoneCurrency', 'buildZoneIntro', 'SSR_ZONE_INTRO', 'opts.zone '])
    assert.ok(!SRV.includes(gone) && !INDEX.includes(gone), `${gone} is still in the code`);
  for (const [i, why] of [['id="zEyebrow"', 'the old eyebrow'], ['id="zTitle"', 'the old title']]) assert.ok(!INDEX.includes(i), why);
  // The page draws the canonical screen, spot only, from the adapter — and the server does the same.
  assert.ok(/prisHTML\(zoneToPrisDays\(raw,raw\.zoneInfo,today\),today,hour,\s*\{zone:k,/.test(INDEX), 'the client does not draw the zone through prisHTML + the adapter');
  assert.ok(/prisHTML\(zoneToPrisDays\(raw, raw\.zoneInfo, todayDk\), todayDk, nowH,\s*\{ zone: C\.def/.test(SRV), 'the server does not draw the zone through prisHTML + the adapter');
  // The 10-day horizon never gets this far: the adapter keeps five days.
  assert.ok(/out\.length<5/.test(INDEX.slice(INDEX.indexOf('function zoneToPrisDays('), INDEX.indexOf('function prisDays('))), 'the adapter does not stop at five days');
});

test('foreign-area pages: EUR is converted at the ECB rate the API returns; the fallbacks agree with the API', () => {
  // NOK sat at a fixed 11.7 while the ECB rate was 10.84: every Norwegian price in øre was ~8 % too high.
  // The API returns the ECB rate; the adapter uses it, and the ZONES constants are only its fallback.
  const API = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  assert.ok(/eurofxref-daily\.xml/.test(API) && /rate: fx\.rates\[info\.currency\]/.test(API), '/api/nordic does not return the ECB rate');
  const ad = INDEX.slice(INDEX.indexOf('function zoneToPrisDays('), INDEX.indexOf('function prisDays('));
  assert.ok(/info&&info\.rate>0&&info\.rate/.test(ad) && /p\.eur_mwh\*rate\/10/.test(ad), 'the adapter does not convert with the response\'s rate');
  const fb = API.match(/const FX_FALLBACK = \{ EUR: 1, DKK: ([\d.]+), NOK: ([\d.]+), SEK: ([\d.]+)/);
  assert.ok(fb, 'FX_FALLBACK not found');
  for (const [cur, v] of [['DKK', fb[1]], ['NOK', fb[2]], ['SEK', fb[3]]])
    assert.ok(INDEX.includes(`cur:'${cur}',rate:${v},`), `ZONES ${cur} fallback is not ${v}`);
  // ZONES lives in the canonical block, so the server and the browser cannot disagree (parity is tested).
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

test('/prognose: the canonical Pris screen with PRIS_FC, a head above it, two text blocks below — and none of the old page', () => {
  const main = INDEX.slice(INDEX.indexOf('<main style="display:none" data-page="prognose"'), INDEX.indexOf('<!-- ═══════ API DOCS PAGE'));
  const at = x => main.indexOf(x);
  // Order: eyebrow, the page's one h1, lead, the screen's mount, then the two text blocks.
  assert.ok(at('class="page-eyebrow"') > 0 && at('<h1 class="page-title">Elprisprognose</h1>') > at('class="page-eyebrow"') && at('id="fcPeriodDays"') > at('<h1 ')
    && at('data-pris-mount><!--SSR_PRIS--></div>') > at('id="fcPeriodDays"') && at('Sådan laves prognosen') > at('<!--SSR_PRIS-->') && at('Det kan prognosen ikke') > at('Sådan laves prognosen'),
    'the section is not head, Pris screen, "Sådan laves prognosen", "Det kan prognosen ikke" in that order');
  assert.equal((main.match(/<h1[\s>]/g) || []).length, 1, 'the /prognose section must carry exactly one h1');
  assert.ok(/Forventede elpriser · <span id="fcWhere">DK1 Vest<\/span>/.test(main), 'the eyebrow does not name the area (DK1 Vest is what the server draws)');
  assert.ok(/Nu og <span id="fcPeriodDays">7<\/span> døgn frem, time for time: faktiske børspriser, så langt de er afregnet, og en prognose for resten\. Jo længere frem, jo mere usikker er den\./.test(main), 'the lead has changed');
  // No second renderer, no selects, no old chart or table: the screen is the only thing that draws prices here.
  for (const gone of ['fcArea', 'fcMode', 'fcLoading', 'fcTableWrapper', 'prognoseForecast', 'prognoseWeek', 'SSR_PROGNOSE', 'fcweek', 'chartcard', '<select'])
    assert.ok(!main.includes(gone), `${gone} is back on the /prognose page`);
  for (const fn of ['fcChartHTML', 'fcWeekHTML', 'fcTicks', 'fcYaxis', 'renderPrognoseForecast', 'renderPrognoseWeek', 'loadForecastPage', 'renderForecastTable', 'setColorRange', 'lerpColor'])
    assert.ok(!INDEX.includes(fn) && !ROUTES.includes(fn), `${fn} (the old /prognose page) is back`);
  // The server draws DK1 with PRIS_FC through the same prisScreen the price pages use, under its own cache key.
  const blk = ROUTES.slice(ROUTES.indexOf('if (opts.prognose) {'), ROUTES.indexOf("// The foreign-area pages are served in their country's language"));
  assert.ok(/fetchNetForecast\(context, 'DK1', null\)/.test(blk) && /html\.replace\('<!--SSR_PRIS-->', \(\) => prisScreen\(fc, 'DK1', null, PRIS_FC\)\)/.test(blk) && /opts\.done\.full = !!fc/.test(blk), 'the server does not draw the /prognose screen with PRIS_FC for DK1');
  assert.ok(/url\.pathname === '\/prognose'\) opts\.prognose = true/.test(ROUTES) && /renderCachedPage\(context, url\.pathname, page, opts, PROGNOSE_SSR_VERSION\)/.test(ROUTES) && /PROGNOSE_SSR_VERSION = 'prognose-ssr-v\d+'/.test(ROUTES), '/prognose is not served through its own cached render');
  // The browser: the route loads the screen like the front page, the header chip's dialog changes the page instead of leaving it.
  assert.ok(/h==='prognose'\)\{[^\n]*syncFcHead\(\);loadPris\(\);return;\}/.test(INDEX), 'the /prognose route does not load the Pris screen');
  assert.ok(/#netDialog \.pd-links a\[data-net\]/.test(INDEX) && /\[data-page="prognose"\]\.active/.test(INDEX), 'the net dialog does not stay on /prognose');
  assert.ok(/function prisCfg\(\)\{[^}]*PRIS_FC:PRIS_STD/.test(INDEX) && /cfg:prisCfg\(\)/.test(INDEX), 'the client does not hand the page\'s config to prisHTML');
});

test('seo/llm: nothing claims what the page does not show', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  // /prognose shows seven days (the feed carries ten; the page keeps the first seven) from a daily-trained
  // model — not "historiske prismønstre", which its title, description and llms.txt once said.
  const APIF = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  // /api is rendered by the API function, not the page function — the first
  // version of this test missed its "7-dages prognose" for exactly that reason.
  assert.ok(!/7-dages prognose/.test(APIF), '/api still describes a 7-day forecast');
  // A seven-day claim is true on /prognose and nowhere else: it may sit in that page's own section, its SEO entry,
  // its llms.txt line, the screen's period word (p7), a code comment — or in a sentence that links to /prognose.
  const seoEntry = SRV.slice(SRV.indexOf("'/prognose': {"), SRV.indexOf('},', SRV.indexOf("'/prognose': {")));
  const section = INDEX.slice(INDEX.indexOf('<main style="display:none" data-page="prognose"'), INDEX.indexOf('<!-- ═══════ API DOCS PAGE'));
  for (const [where, txt] of [['functions/[[path]].js', SRV], ['index.html', INDEX]]) {
    // Every spelling: "7 dage", "7-dages", "7-døgns", "7-day", "7 days".
    const hit = [...txt.matchAll(/\b7[- ](?:dage|dages|døgn|døgns|day|days)\b[^\n]{0,40}|baseret på historiske prismønstre/g)]
      .find(m => {
        const ls = txt.lastIndexOf('\n', m.index) + 1, le = txt.indexOf('\n', m.index);
        const line = txt.slice(ls, le < 0 ? txt.length : le);
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;
        if (/\bp7:'7 /.test(line)) return false;   // the period word of the Pris screen's language table
        if (seoEntry.includes(line.trim()) || section.includes(line.trim())) return false;
        return !/\/prognose/.test(txt.slice(Math.max(0, m.index - 200), m.index + 200));
      });
    assert.ok(!hit, `${where} claims a 7-day forecast / historical patterns away from /prognose: "${hit && hit[0]}"`);
  }
  // The homepage figure is inkl alt, which excludes the local nettarif.
  const head = INDEX.slice(0, INDEX.indexOf('</head>'));
  assert.ok(!/name="description" content="[^"]*inkl\. nettariffer/.test(head) && !/og:description" content="[^"]*inkl\. nettariffer/.test(head),
    'the homepage description claims the price includes nettariffer');
  assert.ok(!/id="heroContext">[^<]*inkl\. nettariffer/.test(INDEX), 'the sentence under the homepage price claims nettariffer');
  assert.ok(!/mode=inkl_alt\\` — Current total price right now \(DKK\/kWh, incl\. all tariffs/.test(SRV), 'llms.txt says inkl_alt includes all tariffs');
  // llms.txt lists the four foreign-area pages — and none of the eleven retired ones.
  const llms = SRV.slice(SRV.indexOf('const LLMS_TXT = `'), SRV.indexOf('const LLMS_FULL_TXT'));
  for (const z of ['norden', 'no/strompris', 'sv/elpris', 'fi/sahkon-hinta', 'nl/stroomprijs'])
    assert.ok(llms.includes(`https://elpriser.org/${z})`), `llms.txt does not list /${z}`);
  for (const z of LEGACY_ZONES) assert.ok(!llms.includes(`https://elpriser.org${z})`), `llms.txt still lists ${z}`);
  assert.ok(/\/api\/nordic\?zone=/.test(llms), 'llms.txt does not list /api/nordic');
});

test('seo: the pages keep the words Search Console shows people typing', () => {
  // Evidence, not taste (Performance on Search, 3 months to 2026-10-04):
  //  - /prognose: "elpriser prognose 7 dage" is its biggest query, ~700 impressions
  //    with its variants. The title must carry "7 dage" — which is now the whole truth: the page shows seven days.
  //  - the elafgift post ranks 1.7-3.6 for "kommer elafgiften tilbage" and clicked
  //    at 1.6-2.4 %: the snippet has to say yes.
  //  - /dk1 and /dk2: people type "elpris vest" / "elpriser øst"; "spotpris" stays.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const entry = k => SRV.slice(SRV.indexOf(`'${k}': {`), SRV.indexOf('},', SRV.indexOf(`'${k}': {`)));
  const field = (k, f) => (entry(k).match(new RegExp(`${f}: '([^']*)'`)) || [])[1] || '';
  assert.ok(/7 dage/.test(field('/prognose', 'title')) && !/10/.test(field('/prognose', 'title')), '/prognose title lost "7 dage" or names ten days');
  assert.ok(/7 dage/.test(field('/prognose', 'description')) && !/10 (døgn|dage)/.test(field('/prognose', 'description')), '/prognose description lost "7 dage" or names ten days');
  assert.ok(/elafgiften/i.test(field('/blog/elafgift-2028', 'title')) && /stiger igen/.test(field('/blog/elafgift-2028', 'title')) && /^Elafgift 2028/.test(field('/blog/elafgift-2028', 'title')),
    'the elafgift title no longer leads with "Elafgift 2028" and answers');
  assert.ok(/^Kommer elafgiften tilbage\? Ja/.test(field('/blog/elafgift-2028', 'description')), 'the elafgift description does not answer the question first');
  assert.ok(/60,9 øre/.test(field('/blog/elafgift-2028', 'description')) && /2015-prisniveau/.test(field('/blog/elafgift-2028', 'description')),
    'the elafgift figure is not qualified as 2015 price level, which is what the post says');
  assert.ok(/^Elpris Vest/.test(field('/dk1', 'title')) && /^Elpris Øst/.test(field('/dk2', 'title')), '/dk1 or /dk2 title does not lead with "Elpris Vest/Øst"');
  for (const k of ['/prognose', '/dk1', '/dk2', '/blog/elafgift-2028'])
    assert.ok(field(k, 'title').length <= 62, `${k} title is ${field(k, 'title').length} characters; results cut it near 60`);
});

test('foreign-area pages: five SEO entries in the page\'s own language, with titles and descriptions that fit a result', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const entry = k => SRV.slice(SRV.indexOf(`'${k}': {`), SRV.indexOf('\n  },', SRV.indexOf(`'${k}': {`)));
  const field = (k, f) => (entry(k).match(new RegExp(`${f}: '([^']*)'`)) || [])[1] || '';
  for (const [k, lang, lead] of [['/no/strompris', 'nb', /^Strømpris prognose Norge/], ['/sv/elpris', 'sv', /^Elpris prognos Sverige/], ['/fi/sahkon-hinta', 'fi', /^Sähkön hinta ennuste/], ['/nl/stroomprijs', 'nl', /^Stroomprijs/], ['/norden', '', /^Elpriser i Norden/],
    ['/de/strompreis', 'de', /^Strompreis aktuell und morgen/], ['/fr/prix-electricite', 'fr', /^Prix de l’électricité aujourd’hui et demain/], ['/pl/ceny-pradu', 'pl', /^Cena prądu dziś i jutro/], ['/it/prezzo-luce', 'it', /^Prezzo dell’energia elettrica oggi e domani – Italia del Nord/]]) {
    assert.ok(lead.test(field(k, 'title')), `${k} title`);
    assert.ok(field(k, 'title').length <= 62, `${k} title is ${field(k, 'title').length} characters`);
    assert.ok(field(k, 'description').length >= 80 && field(k, 'description').length <= 155, `${k} description is ${field(k, 'description').length} characters`);
    assert.equal(field(k, 'lang'), lang, `${k} lang`);
    assert.ok(new RegExp(`'${k.slice(1)}': '(zone|norden)'`).test(SRV), `${k} has no data-page`);
    assert.ok(INDEX.includes(`'${k}':'${k.slice(1)}'`), `PATH_ROUTES lacks ${k}`);
    // 2 and 5 døgn only: none of the pages names the feed's longer horizon.
    assert.ok(!/\b10 (døgn|dager|dygn|vrk|vuorokautta)/i.test(entry(k)), `${k} names a 10-day horizon`);
    // The five EU pages show settled prices only: nothing in the entry may promise a forecast, and the source is named.
    if (/^\/(de|fr|pl|it)\//.test(k)) {
      assert.ok(!/prognos|vorhersage|prévision|previsi|prognoz|prediction|forecast/i.test(entry(k)), `${k} mentions a forecast`);
      assert.ok(/Bundesnetzagentur \| SMARD\.de/.test(field(k, 'description')) && !/ENTSO/i.test(entry(k)), `${k} description does not name its source (Bundesnetzagentur | SMARD.de), or names ENTSO-E`);
    }
  }
});

test('foreign-area pages: ONE path table; the first spelling (/norge, /sverige, /finland) is in no link, sitemap entry or route map', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const table = Object.fromEntries([...INDEX.slice(INDEX.indexOf('var PRIS_COUNTRIES={'), INDEX.indexOf('};', INDEX.indexOf('var PRIS_COUNTRIES={')))
    .matchAll(/'([a-z]{2}\/[a-z-]+)':\{lang:'(\w+)'/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(table, { 'no/strompris': 'nb', 'sv/elpris': 'sv', 'fi/sahkon-hinta': 'fi', 'nl/stroomprijs': 'nl', 'de/strompreis': 'de', 'fr/prix-electricite': 'fr', 'pl/ceny-pradu': 'pl', 'it/prezzo-luce': 'it' }, 'PRIS_COUNTRIES is the table of paths and languages');
  const OLD = ['/norge', '/sverige', '/finland'];
  for (const [p, lang] of Object.entries(table)) {
    // every place that needs the path spells it as the table does
    assert.ok(new RegExp(`'/${p}': \\{\\s*title:[^}]*hash: '#${p}',\\s*lang: '${lang}',\\s*zonePage: '${p}'`).test(SRV), `SEO_PAGES entry for /${p}`);
    assert.ok(SRV.includes(`'${p}': 'zone'`), `HASH_TO_DATA_PAGE for ${p}`);
    assert.ok(INDEX.includes(`'/${p}':'${p}'`), `PATH_ROUTES for /${p}`);
    assert.ok(SERVER.includes(`'/${p}': '#${p}'`), `server.js SPA_ROUTES for /${p}`);
    assert.ok(new RegExp(`SITEMAP_URLS = \\[[^\\]]*'/${p}'`).test(SRV), `sitemap lists /${p}`);
    assert.ok(INDEX.includes(`h==='${p}'`), `the client router has /${p}`);
  }
  const urls = SRV.match(/SITEMAP_URLS\s*=\s*\[([\s\S]*?)\n\];/)[1];
  for (const o of OLD) {
    assert.ok(!urls.includes(`'${o}'`), `${o} is in the sitemap`);
    assert.ok(!new RegExp(`href="${o}["#?]`).test(INDEX), `index.html links ${o}`);
    assert.ok(!INDEX.includes(`'${o}':`), `PATH_ROUTES or a route table in index.html still has ${o}`);
    assert.ok(!SRV.replace(/const LEGACY_REDIRECTS = \{[\s\S]*?\};/, '').includes(o), `functions/[[path]].js still mentions ${o} outside the redirect table`);
    assert.ok(!SERVER.replace(/const LEGACY_REDIRECTS = \{[\s\S]*?\};/, '').includes(o), `server.js still mentions ${o} outside the redirect table`);
  }
  // Redirects go straight to the final URL: no target is itself a redirect source.
  for (const [from, to] of Object.entries(LEGACY)) assert.ok(!(to.split('#')[0] in LEGACY), `${from} → ${to} is a chain`);
});

test('seo: the foreign-area pages carry no hreflang cluster', () => {
  // They are different markets, not translations of one page. Linking them as
  // alternates made five pages "the Norwegian version" and /se3 its own Danish one (and would make /no/strompris that of /sv/elpris).
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const branch = SRV.slice(SRV.indexOf('if (meta.lang) {'), SRV.indexOf('html = html.replace(\n    /<title>'));
  assert.ok(!/hreflang="\$\{m\.lang\}"/.test(branch) && !/x-default/.test(branch), 'the zone-page hreflang cluster is back');
  assert.ok(/hreflang="\[\^"\]\*" href="\[\^"\]\*">\/g, ''\)/.test(branch), 'zone pages do not strip the base hreflang');
});

test('country pages: ONE chrome builder (chromeHTML) feeds the server render and the browser; the Danish markup carries no hook for it', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  // The builder and its words are in the canonical Pris block (test-forecast-chart.mjs diffs the two copies).
  for (const src of [SRV, INDEX]) assert.ok(src.includes('var CHROME_I18N={') && src.includes('function chromeHTML(pg){'), 'CHROME_I18N / chromeHTML missing');
  // Server: only for a country page (inside the `if (C)` branch), after the zone list.
  assert.ok(/prisZoneList\(pg, raws, todayDk\)\);\s*html = withCountryChrome\(html, pg\);/.test(SRV), 'the server does not localise the chrome of a country page');
  assert.equal((SRV.match(/= withCountryChrome\(html/g) || []).length, 1, 'withCountryChrome is used once, for country pages only');
  // Browser: openZonePage localises, and nothing else does.
  assert.ok(/document\.documentElement\.lang=C\.lang;\s*localiseChrome\(pg\);/.test(INDEX) && (INDEX.match(/localiseChrome\(/g) || []).length === 2, 'the client localises in openZonePage only');
  // The Danish header and footer are plain markup: no xc class, no data-pg, no placeholder.
  const header = INDEX.slice(INDEX.indexOf('<header class="site-nav">'), INDEX.indexOf('</header>'));
  assert.ok(!/xc|data-pg|SSR_/.test(header) && !/data-pg|class="sf sf-x"/.test(INDEX.slice(INDEX.indexOf('<footer'), INDEX.indexOf('</footer>'))), 'the Danish chrome carries a hook for the country chrome');
  // No per-language markup: the four languages share one template — the tables hold words, not tags.
  const tbl = INDEX.slice(INDEX.indexOf('var CHROME_I18N={'), INDEX.indexOf('function chromeHTML(pg){'));
  assert.ok(!/<[a-z]/.test(tbl), 'CHROME_I18N holds markup');
  // The country pages' mobile chrome: no Danish bottom bar room, the navigation as a row of its own.
  assert.ok(/\.xc body\{padding-bottom:0\}/.test(INDEX) && /\.xc \.site-links\{display:flex;order:2;flex:1 0 100%/.test(INDEX), 'phone styles for html.xc');
  // /nl/stroomprijs is wired everywhere a country page is.
  assert.ok(SRV.includes("'nl/stroomprijs': 'zone'") && INDEX.includes("'/nl/stroomprijs':'nl/stroomprijs'") && SERVER.includes("'/nl/stroomprijs': '#nl/stroomprijs'") && INDEX.includes("h==='nl/stroomprijs'"), 'a route table lacks /nl/stroomprijs');
  assert.ok(/nl: 'nl_NL'/.test(SRV), 'og:locale for nl');
  // The four EU pages: wired in every route table, og:locale in the language's own country, and no hreflang is invented.
  for (const [p, loc] of [['de/strompreis', 'de: \'de_DE\''], ['fr/prix-electricite', 'fr: \'fr_FR\''], ['pl/ceny-pradu', 'pl: \'pl_PL\''], ['it/prezzo-luce', 'it: \'it_IT\'']]) {
    assert.ok(SRV.includes(`'${p}': 'zone'`) && INDEX.includes(`'/${p}':'${p}'`) && SERVER.includes(`'/${p}': '#${p}'`) && INDEX.includes(`h==='${p}'`), `a route table lacks /${p}`);
    assert.ok(SRV.includes(loc), `og:locale ${loc}`);
  }
});

test('EU price pages: actual prices only — one period, no forecast wording, the API zones, the licence attribution and the single source reader are wired as the tests below assume', () => {
  const API = fs.readFileSync(path.join(ROOT, 'functions', 'api', '[[catchall]].js'), 'utf8');
  const block = INDEX.slice(INDEX.indexOf('// ═══ Pris-skærmen (Design A'), INDEX.indexOf('// ═══ /Pris-skærmen ═══'));
  // One configuration drives them: PRIS_ACT has one period, and a single period draws no pill at all.
  assert.ok(/var PRIS_ACT=\{periods:\[2\],def:2,days:2,unc:false,act:true\};/.test(block), 'PRIS_ACT is not one period of two days');
  assert.ok(/var tabs=cfg\.periods\.length<2\?'':/.test(block), 'a one-period page still draws the period pill');
  // The four pages and only they are `act`; the Nordic ones keep the screen they have.
  const acts = [...block.matchAll(/'([a-z]{2}\/[a-z-]+)':\{lang:'\w+',cc:'\w+',zones:\[[^\]]*\],def:'[a-z-]+',act:1\}/g)].map(m => m[1]);
  assert.deepEqual(acts, ['de/strompreis', 'fr/prix-electricite', 'pl/ceny-pradu', 'it/prezzo-luce']);
  // Both runtimes draw the screen with the page's own configuration.
  assert.ok(/cfg:prisCountryCfg\(ZP\.page\)/.test(INDEX), 'the browser does not use the page\'s cfg');
  assert.ok(/cfg: prisCountryCfg\(pg\)/.test(ROUTES), 'the server does not use the page\'s cfg');
  // No leftover of the removed Ireland / Dublin clock and of the extra Italian zones.
  for (const gone of ['prisClockIn', 'shift:', 'it-cn', 'it-cs', 'it-cal', 'it-sic', 'it-sar', 'ie/electricity-price', 'en_IE', "L.hm", "L.dec"])
    assert.ok(!INDEX.includes(gone) && !ROUTES.includes(gone) && !SERVER.includes(gone), `${gone} is still in the code (Ireland and Italy's other zones are out of wave 1)`);
  // /norden stays Nordic: it asks for its thirteen zones, never for "all of ZONES".
  assert.ok(/zoneRaws\(NORDEN_ZONES\)/.test(INDEX) && /C \? C\.zones : NORDEN_ZONES/.test(ROUTES) && !/Object\.keys\(ZONES\)/.test(INDEX + ROUTES), '/norden no longer fetches only its own zones');
  // The zones of the pages are the zones the API serves, in the keys the job writes.
  const apiZones = (API.match(/const EU_ZONES = \[([^\]]*)\]/)[1].match(/'([a-z-]+)'/g) || []).map(x => x.replace(/'/g, ''));
  const pageZones = [...block.matchAll(/zones:\[([^\]]*)\],def:'[a-z-]+',act:1/g)].flatMap(m => m[1].match(/'([a-z-]+)'/g).map(x => x.replace(/'/g, '')));
  assert.deepEqual(pageZones, ['de', 'fr', 'pl', 'it-n'], 'the pages\' zones');
  assert.deepEqual([...pageZones].sort(), [...apiZones].sort(), 'the pages and /api/nordic disagree about the EU zones');
  for (const k of pageZones) assert.ok(new RegExp(`(^|[\\s,{])'?${k}'?:\\{name:'[^']+',city:'[^']+',lang:'(de|fr|pl|it)'`, 'm').test(block.slice(block.indexOf('var ZONES={'), block.indexOf('var NORDEN_ZONES'))), `ZONES lacks ${k}`);
  // Poland converts at the ECB's PLN rate: the API asks the ECB file for it and sanity-checks it; the page's fallback is the API's.
  assert.ok(/PLN: get\('PLN'\)/.test(API) && /rates\.PLN > 3 && rates\.PLN < 6/.test(API), 'the API does not read and check the ECB PLN rate');
  assert.equal((API.match(/PLN: ([\d.]+),/) || [])[1], (INDEX.match(/pl:\{name:'PL',city:'Polska',lang:'pl',cur:'PLN',rate:([\d.]+),/) || [])[1], 'the page\'s PLN fallback differs from the API\'s');
  // Sitemap and llms.txt: listed, below the Danish pages in priority; the text says "no forecast" and names the source and its licence.
  for (const p of ['/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce']) {
    assert.ok(ROUTES.includes(`'${p}'`) && new RegExp(`ZONE_ONLY = [^;]*${p.slice(1).replace('/', '\\\\/')}`).test(ROUTES), `${p} is not in the sitemap at foreign-page priority`);
    assert.ok(ROUTES.includes(`https://elpriser.org${p})`), `llms.txt does not list ${p}`);
  }
  const bullet = ROUTES.slice(ROUTES.indexOf('- [Elpriser i Europa]'), ROUTES.indexOf('- [Automation]'));
  assert.ok(/Kun faktiske børspriser — ingen prognose/.test(bullet) && /Bundesnetzagentur \| SMARD\.de via Energy-Charts\.info, licens CC BY 4\.0; vi har ændret dataene \(timegennemsnit/.test(bullet) && !/ENTSO|Irland|Ireland/.test(bullet), 'llms.txt does not say the EU pages are actual prices only, name the CC BY 4.0 source and say the data were changed');
  const apiLine = ROUTES.slice(ROUTES.indexOf('GET /api/nordic?zone=se3'), ROUTES.indexOf('GET /api/shelly/tariff'));
  assert.ok(/four EU zones/.test(apiLine) && /CC BY 4\.0/.test(apiLine) && /a change of the data/.test(apiLine) && !/ENTSO/.test(apiLine), 'the /api/nordic line in llms.txt');
  // THE LICENCE (CC BY 4.0, "Bundesnetzagentur | SMARD.de", Energy-Charts.info as the API's source; changes must be indicated):
  // the credit and the changed-note exist for every EU language, in the footer builder and the text block, and nothing names ENTSO-E for them.
  const credit = block.slice(block.indexOf('function prisCredit(){'), block.indexOf('\n}\n', block.indexOf('function prisCredit(){')));
  assert.ok(credit.includes("lk('https://www.smard.de','Bundesnetzagentur | SMARD.de')") && credit.includes("lk('https://www.energy-charts.info','Energy-Charts.info')") && credit.includes("lk('https://creativecommons.org/licenses/by/4.0/','CC BY 4.0')"), 'prisCredit() is not the CC BY 4.0 attribution');
  assert.ok(/PRIS_COUNTRIES\[pg\]\.act\?prisCredit\(\)\+' &mdash; '\+X\.chg/.test(block) && /C\.act\?prisCredit\(\)/.test(block), 'the footer and the text block do not both use prisCredit() and say the data were changed');
  const tableEU = INDEX.slice(INDEX.indexOf("  de:{wd:['Sonntag'"), INDEX.indexOf('var NORDEN_ZONES') < 0 ? undefined : INDEX.indexOf("/** The price areas: the single source"));
  assert.ok(!/ENTSO/i.test(tableEU), 'a PRIS_I18N table of the EU languages names ENTSO-E');
  // The source is read in ONE place (the Spark job); the site only names it. A swap of the source changes build_eu_prices.py / energy_charts_parse.py,
  // the attribution in prisCredit() and the `note` / `chg` words, the descriptions, llms.txt and the OpenAPI text.
  const readers = [];
  for (const dir of ['functions', 'scripts/eu_prices']) for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, String(f));
    if (fs.statSync(fp).isFile() && /\.(js|py|mjs)$/.test(fp) && !/test_energy_charts_parse/.test(fp) && /api\.energy-charts\.info/.test(fs.readFileSync(fp, 'utf8')) && /urlopen|fetch\(/.test(fs.readFileSync(fp, 'utf8'))) readers.push(path.relative(ROOT, fp));
  }
  assert.deepEqual(readers, ['scripts/eu_prices/build_eu_prices.py'], 'the Energy-Charts API is read somewhere else than the one job');
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
  // Search Console flagged 'Invalid object type for field "spatialCoverage"': Google accepts Place or text there, not Country.
  assert.ok(typeof api.spatialCoverage === 'string' || api.spatialCoverage?.['@type'] === 'Place',
    `spatialCoverage must be Text or Place, got ${JSON.stringify(api.spatialCoverage)}`);
  for (const slug of ['elafgift-2028', 'hvornaar-er-stroemmen-billigst', 'groennest-og-dyrest', 'elafgift-og-spotpris']) {
    const posts = blocksIn('blog-' + slug).filter(j => j['@type'] === 'BlogPosting');
    assert.equal(posts.length, 1, `blog-${slug} has ${posts.length} BlogPosting blocks`);
    assert.equal(posts[0].url, `https://elpriser.org/blog/${slug}`, `blog-${slug} describes another post`);
  }
  const listed = blocksIn('blog').find(j => j['@type'] === 'Blog')?.blogPost || [];
  assert.equal(listed.length, 4, '/blog does not list its four posts');
  assert.deepEqual(listed.map(j => j.url.replace('https://elpriser.org/blog/', '')).sort(),
    ['elafgift-2028', 'elafgift-og-spotpris', 'groennest-og-dyrest', 'hvornaar-er-stroemmen-billigst'], '/blog lists a post that is gone');
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
  // IndexNow is wrapped in (… || true) so its failure cannot fail the deploy;
  // the only thing allowed after it is the post-deploy smoke test.
  assert.ok(/wrangler pages deploy[^&]*&& \(node scripts\/indexnow\.mjs \|\| true\)( && npm run test:smoke)?$/.test(pj.scripts.deploy),
    'deploy does not submit to IndexNow, or lets an IndexNow failure fail the deploy');
  assert.ok(/^npm run test:gate && /.test(pj.scripts.deploy), 'deploy must run the test gate before building');
});


test('security: no credential is written into tracked code', () => {
  // The repository is public. A JAO API token sat as a default value in a
  // committed script from 2026-07 until it was found; once pushed it lives in
  // history, so the only real control is not to commit it in the first place.
  // Tokens come from the environment (~/.config/elpriser.env, Pages secrets).
  const { execSync } = require('child_process');
  const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => fs.existsSync(path.join(ROOT, f)) && /\.(py|js|mjs|sh|json|md|html|toml|yml|yaml)$/.test(f) && !/^(node_modules|dist)\//.test(f) && f !== 'test-static.js');
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

test('homepage: the bar chart has a zero-based price scale, a unit label and gridlines', () => {
  const src = INDEX.slice(INDEX.indexOf('function prisAxis('), INDEX.indexOf('/** The cheapest and the dearest hour among'));
  assert.ok(src.length > 200, 'prisAxis not found');
  const vm = require('vm'); const ctx = {}; vm.createContext(ctx);
  vm.runInContext(src + '\nglobalThis.ax = prisAxis;', ctx);
  const ax = (v, sc) => JSON.parse(JSON.stringify(ctx.ax(v, sc)));
  // The mock: highest 3,90 → 4,37 → 4,5; whole-krone steps from zero.
  assert.deepEqual(ax([1.2, 3.9, 2]).ticks, [0, 1, 2, 3, 4]);
  assert.equal(ax([1.2, 3.9, 2]).hi, 4.5);
  assert.equal(ax([1.2, 3.9, 2]).lo, 0);
  // The tallest bar never touches the top, also on an exact multiple.
  assert.ok(ax([4]).hi > 4 && ax([4.46]).hi === 5);
  // Halves only when the whole axis is two and a half kroner or less.
  assert.deepEqual(ax([0.6, 0.9]).ticks, [0, 0.5, 1, 1.5]);
  // A negative price extends the axis below zero instead of being clipped.
  assert.ok(ax([-0.7, 1.2]).lo < 0 && ax([-0.7, 1.2]).ticks.includes(0));
  const html = INDEX.slice(INDEX.indexOf('function prisChart('), INDEX.indexOf('function prisFlat('));
  assert.ok(/class="pris-unit">'\+C\.u\+'\/kWh</.test(html) && /class="pris-gl"/.test(html) && /pris-yl/.test(html), 'unit label, gridlines or axis labels are gone');
  // A zone's axis follows its unit: the same rule with a grain of 10/100 (øre, öre, snt run from 5 to 300).
  assert.deepEqual(ax([180], 100).ticks, [0, 50, 100, 150, 200, 250]);
  assert.deepEqual(ax([24], 10).ticks, [0, 10, 20, 30]);
  assert.deepEqual(ax([1.2, 3.9, 2], 1).ticks, [0, 1, 2, 3, 4], 'grain 1 is the Danish axis');
});

test('homepage: the Pris screen is server-rendered, not JS-only', () => {
  // The front page answers "elpriser lige nu" and "elpriser prognose": the price,
  // the sentence, every bar's number and the day list have to be in the HTML a
  // crawler is served, so the placeholder and the code that fills it both exist.
  assert.ok(/<div class="pris-page" data-pris-mount><!--SSR_PRIS--><\/div>/.test(INDEX), 'index.html lost the SSR_PRIS placeholder');
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(ROUTES_SRC.includes('function prisHTML('), 'functions/[[path]].js no longer builds the Pris screen');
  assert.ok(ROUTES_SRC.includes("html.replace('<!--SSR_PRIS-->', prisHTML("), 'the server never substitutes SSR_PRIS');
  assert.ok(!INDEX.includes('<!--SSR_FORECAST_CHART-->') && !ROUTES_SRC.includes('SSR_FORECAST_CHART'), 'the old forecast placeholder is back');
  // prisHTML must put the day list and the per-hour numbers in text.
  const fn = ROUTES_SRC.slice(ROUTES_SRC.indexOf('function prisDayRows('), ROUTES_SRC.indexOf('// ═══ /Pris-skærmen ═══'));
  assert.ok(/class="pris-week"/.test(fn) && /L\.actual/.test(fn) && /L\.fc/.test(fn) && /actual:'Børspris'/.test(ROUTES_SRC) && /fc:'Prognose'/.test(ROUTES_SRC), 'the day list is not text');
  assert.ok(/data-tip="/.test(ROUTES_SRC), 'the hourly figures are gone');
  // The homepage render is cached; a changed markup needs a new key.
  assert.ok(/homepage-ssr-v(\d+)/.test(ROUTES_SRC) && +ROUTES_SRC.match(/homepage-ssr-v(\d+)/)[1] >= 66,
    'the homepage cache key was not bumped for the cleaned-up start page (nøgletal, area cards and four FAQ items gone)');
});

test('header: the wordmark next to the bolt reads "Elpriser" with a capital E; the domain stays lowercase', () => {
  const logo = INDEX.match(/<a href="\/" class="site-logo"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(logo, 'the header logo link is gone');
  const label = logo[0].match(/aria-label="([^"]*)"/);
  assert.equal(logo[1].replace(/<[^>]*>/g, '').trim(), 'Elpriser', 'the visible wordmark is not "Elpriser"');
  assert.equal(label && label[1], 'elpriser.org forside', 'the accessible name should keep the domain in lowercase');
  assert.ok(/og:site_name" content="elpriser\.org"/.test(INDEX) || !/og:site_name/.test(INDEX), 'og:site_name must stay the lowercase domain');
});

test('breakdown: the caption is a native <details> drawn by the canonical prisHTML, fed with the same response\'s charges', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  // Both draw sites pass the response's own charges (the grid tariff rides in fc.days).
  assert.equal((SRV.match(/charges: fc\.charges/g) || []).length, 2, 'the homepage and the price pages must both hand prisHTML the forecast\'s charges');
  // Markup: the summary IS the caption; chevron decorative; closed unless the client says otherwise.
  const blk = INDEX.slice(INDEX.indexOf('function prisCapHTML('), INDEX.indexOf('function prisSwitch('));
  assert.ok(/<details class="pris-bd/.test(blk) && /<summary class="pris-cap">/.test(blk) && /aria-hidden="true"/.test(blk), 'the caption is not a details/summary');
  assert.ok(/\(open\?' open':''\)/.test(blk), 'the open state is not driven by the option (closed by default)');
  // CSS: a 44 px target, no UA marker, a visible focus ring, the dark ramp for the segments.
  assert.ok(/\.pris-bd>summary\{[^}]*min-height:44px/.test(INDEX), 'the summary is not a 44 px target');
  assert.ok(/\.pris-bd>summary:focus-visible\{outline:2px solid/.test(INDEX), 'the summary has no visible focus');
  assert.ok(/summary::-webkit-details-marker\{display:none\}/.test(INDEX) && /list-style:none/.test(INDEX), 'the browser\'s own triangle would show next to the chevron');
  assert.ok(/\.pris-bdback::after\{[^}]*inset:-1\d?px/.test(INDEX), 'Tilbage til nu is not a 44 px target');
  const dark = INDEX.slice(INDEX.indexOf('\n  .dark{'), INDEX.indexOf('/* body carries Tailwind'));
  for (const t of ['--p-c-spot', '--p-c-en', '--p-c-net', '--p-c-afg', '--p-c-vat'])
    assert.ok(dark.includes(t + ':'), `${t} has no colour on the dark ramp`);
  assert.ok(/\.pris-bd-card\{display:none\}|\.pris-bd-card,/.test(INDEX) || /\.pris-cap-card,\.pris-bd-card\{display:none\}/.test(INDEX), 'the card captions are not hidden on wide screens');
  // Wiring: a picked bar rewrites the panel and the highlight; a period change resets; Back resets;
  // the three disclosures open together; the data comes from the same response.
  assert.ok(/function prisSelect\(/.test(INDEX) && /pointerup/.test(INDEX) && /\[data-pris-back\]/.test(INDEX), 'bar selection / Tilbage til nu is not wired');
  assert.ok(/function setPrisPeriod\([\s\S]*?prisSelect\(null\)/.test(INDEX), 'a period change does not reset the picked bar');
  assert.ok(/PV\.charges=j\.charges/.test(INDEX) && /charges:PV\.charges/.test(INDEX), 'the client does not read charges from the forecast response');
  assert.ok(/addEventListener\('toggle'/.test(INDEX), 'the disclosures are not kept in step');
});

test('blog: the elafgift-og-spotpris headline numbers follow from the post\'s own tables', () => {
  // The post argues from a few figures (+36 % vs 2025, +68 % vs 2024, evening/midday ratio, household
  // cost). They are typed into prose, so a table edit could leave the prose telling another story.
  const sec = INDEX.slice(INDEX.indexOf('data-page="blog-elafgift-og-spotpris"'));
  const post = sec.slice(0, sec.indexOf('</main>'));
  const num = t => +t.replace(/<[^>]+>/g, '').trim().replace(',', '.');
  const rows = (html) => [...html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>((?:<td[^>]*>[^<]*<\/td>)+)/g)]
    .map(m => ({ k: m[1].trim(), c: [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(x => x[1]) }));
  const tables = [...post.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(m => rows(m[1]));
  assert.equal(tables.length, 2, 'expected the spot table and the shape table');
  const spot = Object.fromEntries(tables[0].map(r => [r.k, r.c.map(num)]));      // øre: [DK1 ytd, DK2 ytd, DK1 year]
  assert.deepEqual(Object.keys(spot), ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  const pct = (a, b) => Math.round((a / b - 1) * 100);
  const lead = post.slice(post.indexOf('<article'), post.indexOf('<section'));
  assert.ok(lead.includes(`${pct(spot[2026][0], spot[2025][0])} % højere end i 2025`), 'the lead\'s +x % vs 2025 does not match the table');
  assert.ok(lead.includes(`${pct(spot[2026][0], spot[2024][0])} % højere end i 2024`), 'the lead\'s +x % vs 2024 does not match the table');
  const shape = Object.fromEntries(tables[1].map(r => [r.k, r.c.map(num)]));       // øre: [night, midday, evening, spread]
  const ratio26 = (shape[2026][2] / shape[2026][1]).toFixed(1).replace('.', ',');
  const ratio19 = (shape[2019][2] / shape[2019][1]).toFixed(1).replace('.', ',');
  assert.ok(post.includes(`omkring ${ratio19} gange dyrere end middagen; i 2026 er den ${ratio26} gange dyrere`), 'the evening/midday ratios do not match the shape table');
  assert.ok(post.includes(`${Math.round(shape[2026][2] - shape[2026][1])} øre/kWh</strong> højere end middagens`), 'the evening-minus-midday figure does not match the table');
  assert.ok(post.includes(`fra ${Math.round(shape[2019][3])} øre i 2019 til ${Math.round(shape[2026][3])} øre i 2026`), 'the spread figures do not match the table');
  // Household example: 4,000 kWh x 75 øre = 3,000 kr; x 0,8 øre = 32 kr; incl. VAT x 1.25.
  assert.ok(/3\.000 kr ekskl\. moms<\/strong> \(3\.750 kr inkl\. moms\) — mod omkring 32 kr/.test(post), 'the household example changed');
  // The description and the llms.txt line quote the same +36 %.
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(/'\/blog\/elafgift-og-spotpris': \{[\s\S]*?description: 'Spotprisen er 36 % højere i år end i 2025/.test(SRV), 'the SEO description no longer says +36 %');
  // Every year of the chart's table of afgift appears with its source rate.
  for (const r of ['88,4', '89,2', '90,0', '72,0', '76,1', '0,8 i 1. halvår, 69,7 i 2. halvår']) assert.ok(post.includes(r), `afgift rate ${r} missing`);
});

test('clock: the Copenhagen hour and date never turn into NaN, whatever the engine\'s Intl returns', () => {
  // A phone showed "Elpris lige nu · lørdag kl. NaN" with no price and every bar counted as
  // future: the hour had been read with +new Intl.DateTimeFormat(...).format(), and an engine
  // that adds anything to the digits turns that into NaN. The helpers read formatToParts and
  // then the digits of a plain format, and always end in a number.
  const vm = require('vm');
  const SRV = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  for (const [name, src] of [['index.html', INDEX], ['functions/[[path]].js', SRV]])
    assert.ok(!/\+\s*new Intl\.DateTimeFormat\(/.test(src),
      `${name} coerces an Intl-formatted string with a unary plus — read the hour with cphHourOf()`);
  const clientSrc = INDEX.slice(INDEX.indexOf('// ═══ Copenhagen clock ═══'), INDEX.indexOf('// ═══ /Copenhagen clock ═══'));
  assert.ok(clientSrc.includes('function cphHourOf') && clientSrc.includes('function cphDateOf'), 'the clock block is gone from index.html');
  const serverSrc = SRV.slice(SRV.indexOf('function cphHourOf(d)'), SRV.indexOf('async function renderSPA('));
  assert.ok(serverSrc.includes('formatToParts'), 'the server has no cphHourOf');
  const load = (impl) => {
    const ctx = { Intl: impl, Date, String, Number, RegExp };
    vm.createContext(ctx);
    vm.runInContext(clientSrc + '\n' + serverSrc.replace('function cphHourOf(d)', 'function cphHourOfSrv(d)')
      + '\nglobalThis.H = cphHourOf; globalThis.D = cphDateOf; globalThis.HS = cphHourOfSrv;', ctx);
    return ctx;
  };
  // Real Intl, across winter, summer and both DST changes.
  const real = load(Intl);
  for (const [iso, hour, date] of [
    ['2026-10-17T05:37:00Z', 7, '2026-10-17'], ['2026-01-15T23:30:00Z', 0, '2026-01-16'],
    ['2026-07-01T21:59:00Z', 23, '2026-07-01'], ['2026-03-29T00:59:00Z', 1, '2026-03-29'],
    ['2026-03-29T01:00:00Z', 3, '2026-03-29'], ['2026-10-25T00:30:00Z', 2, '2026-10-25'],
    ['2026-10-25T01:30:00Z', 2, '2026-10-25'],
  ]) {
    const d = new Date(iso);
    assert.equal(real.H(d), hour, `cphHourOf(${iso})`);
    assert.equal(real.HS(d), hour, `server cphHourOf(${iso})`);
    assert.equal(real.D(d), date, `cphDateOf(${iso})`);
  }
  // Hostile engines: every one must still give a whole hour 0-23.
  const d = new Date('2026-10-17T05:37:00Z');
  const fake = (fmt, parts) => ({ DateTimeFormat: function (l, o) { return { format: x => fmt(x, o), formatToParts: parts }; } });
  const cases = {
    'suffix after the digits, no formatToParts': [fake(() => '07 h', undefined), 7],
    'direction mark before the digits': [fake(() => '‎07:37', x => [{ type: 'hour', value: '‎07' }]), 7],
    'midnight as 24': [fake(() => '24', x => [{ type: 'hour', value: '24' }]), 0],
    'parts without an hour': [fake(() => '07:37', () => [{ type: 'minute', value: '37' }]), 7],
    'non-Latin digits': [fake(() => '٠٧', () => [{ type: 'hour', value: '٠٧' }]), null],
    'throws': [{ DateTimeFormat: function () { throw new Error('no Intl'); } }, null],
  };
  for (const [name, [impl, want]] of Object.entries(cases)) {
    const c = load(impl);
    const h = c.H(d), hs = c.HS(d);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 23, `${name}: client hour is ${h}`);
    assert.ok(Number.isInteger(hs) && hs >= 0 && hs <= 23, `${name}: server hour is ${hs}`);
    if (want != null) { assert.equal(h, want, `${name}: client`); assert.equal(hs, want, `${name}: server`); }
    assert.match(c.D(d), /^\d{4}-\d{2}-\d{2}$/, `${name}: date is ${c.D(d)}`);
  }
});

test('Pris screen: the numbers stay as text, and every class its server-drawn markup uses is hand-written', () => {
  // A bar is unreadable to a crawler and to a screen reader. The tooltip text of every hour, the day list with its
  // columns, and the chart's accessible name have to leave prisHTML as text — on /prognose too (PRIS_FC adds a column).
  const fn = ROUTES.slice(ROUTES.indexOf('function prisChart('), ROUTES.indexOf('// ═══ /Pris-skærmen ═══'));
  assert.ok(/data-tip="/.test(fn) && /aria-label="/.test(fn) && /class="pris-week"/.test(fn) && /cfg\.unc\?'<th scope="col">Usikkerhed<\/th>'/.test(fn), 'the per-hour or per-day figures are gone from the screen\'s output');
  // Tailwind does not scan JS- or server-generated markup, so a utility class used only there is purged out of
  // style.css and silently does nothing. The screen has its own classes, hand-written in the <style> block —
  // including the seven-day card, its tiles and its day rows.
  const style = INDEX.slice(INDEX.indexOf('<style>'), INDEX.indexOf('</style>'));
  for (const cls of ['.pp7 .pris-cols', '.pp7 .pb', '.pp7 .pd', '[data-period="7"] .pp2', '[data-period="7"] .pp5', '[data-period="2"] .pp7', '[data-period="5"] .pp7', '.r7', '.r10', '.pris-week', '.pris-tiles'])
    assert.ok(style.includes(cls), `${cls} is not hand-written in the <style> block`);
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
   '/apple-touch-icon.png', '/manrope.woff2'].forEach(p => {
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

test('css: heading-binding rule — .prose-article section gap ≥ 2rem', () => {
  // Headings inside these containers need visibly more space ABOVE than BELOW
  // so they bind with the following content. If this rule disappears, section
  // headings look orphaned.
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
// Design system — classes the markup relies on
// ─────────────────────────────────────────────────────────────────────────────

['net-chip', 'nav-pill', 'card', 'faq', 'area-row', 'area-links', 'anchor-sec']
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

test('gps: the position is asked for once, by the front page, with every guard in place', () => {
  // A permission prompt on load is a decision with a cost: Chrome demotes origins
  // that ask without a gesture, and an unguarded one would nag. So the only
  // unprompted request is maybeAutoDetect(), from the start page, and it must
  // keep each of the guards below.
  assert.equal(INDEX.match(/^\s*detectLocation\(\);/m), null, 'detectLocation is called unconditionally');
  assert.ok(!/(DOMContentLoaded|window\.onload)[\s\S]{0,400}?detectLocation\(/.test(INDEX), 'detectLocation is wired to page load');
  const calls = [...INDEX.matchAll(/detectLocation\(\{auto:true\}\)/g)];
  assert.equal(calls.length, 1, 'exactly one automatic call site');
  const fn = INDEX.slice(INDEX.indexOf('async function maybeAutoDetect'), INDEX.indexOf('detectLocation({auto:true})'));
  for (const [what, re] of [
    ['skip when a net is already remembered', /if\(readNetPick\(\)\)return/],
    ['skip crawlers and test drivers', /navigator\.webdriver\|\|\/bot\|crawl/],
    ['once per visit', /sessionStorage\.getItem\(AUTO_TRIED_KEY\)/],
    ['not again for 30 days after a no', /AUTO_RETRY_DAYS\*864e5/],
    ['never re-prompt a denied permission', /st\.state==='denied'/],
    ['not when storage is unavailable', /catch\(_\)\{return;\}/],
    ['not after the visitor has navigated', /location\.hash&&location\.hash!==/],
  ]) assert.ok(re.test(fn), `maybeAutoDetect lost a guard: ${what}`);
  assert.ok(/pv\('Start','\/'\);restoreNetPick\(\);maybeAutoDetect\(\)/.test(INDEX), 'only the start page asks');
  assert.ok(/id="gpsBtn" onclick="detectLocation\(\)"/.test(INDEX), 'the button still starts the lookup');
});

test('gps: an automatic lookup never falls back to the IP position and fails silently', () => {
  const body = INDEX.slice(INDEX.indexOf('async function detectLocation'), INDEX.indexOf('function matchNet'));
  assert.ok(/if\(auto\)\{[\s\S]{0,200}?giveUp\(\);return;\}\s*\/\/ Browser geolocation failed/.test(body),
    'the auto path must leave before the IP-position fallback');
  assert.ok(/function markAutoDeclined/.test(INDEX) && /const giveUp=\(\)=>\{[\s\S]{0,300}?markAutoDeclined\(\)/.test(body), 'a failure is remembered');
});

test('gps: a net chosen by any route is remembered (GPS, menu, chip, link)', () => {
  assert.ok(/function rememberNetFromHash/.test(INDEX), 'helper exists');
  assert.ok(/let h=routeFromLocation\(\);\s*rememberNetFromHash\(h\);/.test(INDEX), 'route() records the pick');
  assert.ok(/localStorage\.setItem\(NET_PICK_KEY/.test(INDEX), 'stored in localStorage');
  assert.ok(!/document\.cookie[^;]*dk_net_pick/.test(INDEX), 'not in a cookie');
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

test('app: the front page carries the iOS smart app banner and an App Store link', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(/<meta name="apple-itunes-app" content="app-id=6820474476">/.test(html), 'smart app banner meta tag');
  assert.ok(html.includes('https://apps.apple.com/dk/app/id6820474476'), 'App Store link');
  assert.ok(html.includes('https://play.google.com/store/apps/details?id=org.elpriser.app'), 'Google Play link');
});

test('seo: every net-company page is linked from the footer and the tariff page, so Google can discover it', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const fn = fs.readFileSync(path.join(__dirname, 'functions', '[[path]].js'), 'utf8');
  const slugs = [...fn.matchAll(/slug: '([a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(slugs.length >= 16, 'found the net slugs');
  const footer = html.slice(html.indexOf('aria-label="Netselskaber"'));
  const tariff = html.slice(html.indexOf('data-page="tariffer"'), html.indexOf('data-page="tariffer"') + 20000);
  for (const area of ['dk1', 'dk2']) {
    for (const m of fn.matchAll(new RegExp(`${area.toUpperCase()}: \\[([\\s\\S]*?)\\],`, 'g'))) {
      for (const s of m[1].matchAll(/slug: '([a-z0-9-]+)'/g)) {
        assert.ok(footer.includes(`href="/${area}/${s[1]}"`), `footer links /${area}/${s[1]}`);
        assert.ok(tariff.includes(`href="/${area}/${s[1]}"`), `tariff page links /${area}/${s[1]}`);
      }
    }
  }
});

// The net companies added after the first fourteen: found in the city lookups (_cities.js, 2026-10-24), each with a household
// Nettarif C in DatahubPricelist and in the KV archive dk-nettarif-<gln>. `lookup` is the name Green Power Denmark answers with.
const ADDED_NETS = [
  { slug: 'dinel', name: 'Dinel', gln: '5790000610099', lookup: 'Dinel A/S', after: 'konstant', city: ['aarhus', 'dinel', 0.4] },
  { slug: 'ravdex', name: 'Ravdex', gln: '5790000836727', lookup: 'Ravdex', after: 'vores-elnet', city: ['odense', 'ravdex', 0.1] },
];

test('nets: sixteen net companies, one GLN and one slug each, the same in index.html, functions/[[path]].js, server.js and the footer', () => {
  const vm = require('node:vm');
  const web = vm.runInNewContext('(' + INDEX.match(/const NETS=(\{[\s\S]*?\]\});/)[1] + ')');
  const all = [...web.DK1, ...web.DK2];
  assert.equal(all.length, 16, 'sixteen net companies in index.html NETS');
  assert.equal(new Set(all.map(n => n.gln)).size, 16, 'every GLN once');
  assert.equal(new Set(all.map(n => n.slug)).size, 16, 'every slug once');
  // The server's own table (functions/[[path]].js NETS) has the same names and GLNs, area by area, in the same order.
  const fnBlock = (area, next) => ROUTES.match(new RegExp(area + ':\\s*\\[([\\s\\S]*?)\\],\\s*' + next))[1];
  for (const [area, next] of [['DK1', 'DK2:'], ['DK2', '\\}']]) {
    const fn = [...fnBlock(area, next).matchAll(/\{ name: '([^']+)',\s*slug: '([^']+)',\s*gln: '(\d{13})' \}/g)].map(m => ({ name: m[1], slug: m[2], gln: m[3] }));
    assert.deepEqual(fn, JSON.parse(JSON.stringify(web[area].map(n => ({ name: n.name, slug: n.slug, gln: n.gln })))), `functions/[[path]].js NETS.${area} equals index.html NETS.${area} (name, slug, GLN, order)`);
  }
  assert.deepEqual(SERVER.match(/NET_SLUGS\s*=\s*\{\s*DK1: \[([^\]]*)\]/)[1].replace(/'/g, '').split(','), JSON.parse(JSON.stringify(web.DK1.map(n => n.slug))), 'server.js NET_SLUGS.DK1 is index.html DK1, in order');
  const title = ROUTES.match(/'\/tariffer': \{\s*title: '([^']+)'/)[1];
  assert.ok(/for alle 16 netselskaber/.test(title) && title.length <= 62, `the tariff page title counts 16 net companies and fits (${title.length})`);
  assert.ok(INDEX.includes(`document.title='${title}'`), 'the router sets the same /tariffer title');
  // The new names overlap with no other net's match string, so neither can be taken for the other.
  const strs = all.flatMap(n => n.match.map(m => [n.slug, m.toLowerCase()]));
  for (const [sa, a] of strs.filter(([sl]) => ['dinel', 'ravdex'].includes(sl))) for (const [sb, b] of strs) if (sa !== sb) assert.ok(!a.includes(b) && !b.includes(a), `"${a}" (${sa}) and "${b}" (${sb}) overlap`);
});

for (const N of ADDED_NETS) {
  test(`${N.slug}: ${N.name} is in every list a net lives in, with its GLN, in DK1, after ${N.after}, and the lookup's "${N.lookup}" resolves to it`, () => {
    const vm = require('node:vm');
    const web = vm.runInNewContext('(' + INDEX.match(/const NETS=(\{[\s\S]*?\]\});/)[1] + ')');
    const all = [...web.DK1, ...web.DK2];
    const d = web.DK1.find(n => n.slug === N.slug);   // tariff archive key dk-nettarif-<gln>
    assert.ok(d && d.name === N.name && d.gln === N.gln && JSON.stringify(d.match) === JSON.stringify([N.name]), `index.html NETS: ${N.name}, DK1, the GLN, match "${N.name}"`);
    assert.ok(!web.DK2.some(n => n.slug === N.slug), 'not in DK2');
    const order = web.DK1.map(n => n.slug);
    assert.equal(order[order.indexOf(N.slug) - 1], N.after, `listed right after ${N.after}`);
    assert.ok(SERVER.match(/NET_SLUGS\s*=\s*\{\s*DK1: \[([^\]]*)\]/)[1].includes(`'${N.slug}'`), 'server.js NET_SLUGS.DK1');
    assert.ok(ROUTES.includes(`| ${N.name} | DK1 | \\\`${N.slug}\\\` | ${N.gln} |`), 'llms-full.txt GLN table has the row');
    assert.ok(new RegExp(`Understøttede netselskaber i DK1: [^\\n]*${N.name}`).test(ROUTES), 'llms-full.txt lists it among the supported net companies');
    assert.ok(ROUTES.includes(`'${N.slug}': '${N.name} er `), 'NET_COVERAGE has a sentence');
    assert.ok(INDEX.slice(INDEX.indexOf('<footer'), INDEX.indexOf('</footer>')).includes(`<li><a href="/dk1/${N.slug}">${N.name}</a></li>`), `footer links /dk1/${N.slug}`);
    assert.ok(INDEX.includes(`<a href="/dk1/${N.slug}" class="text-brand-500 underline">${N.name}</a>`), 'tariff page prose links it');
    // The name Green Power Denmark answers with — matched like the apps match it (longest match wins).
    const matchNet = (name) => { let best = null; for (const n of all) for (const m of n.match) if (name.toLowerCase().includes(m.toLowerCase()) && (!best || m.length > best.len)) best = { n, len: m.length }; return best && best.n.slug; };
    assert.equal(matchNet(N.lookup), N.slug, `the lookup name "${N.lookup}" is ${N.name}`);
    assert.equal(matchNet('KONSTANT Net A/S'), 'konstant', 'and Konstant is still Konstant');
    // The city table: a net we price, no longer an "other".
    const [city, slug, share] = N.city, row = CITY_TABLE.find(c => c.slug === city);
    const mine = row.nets.find(n => n.slug === slug);
    assert.ok(mine && mine.gln === N.gln && mine.name === N.name && mine.share === share, `${city}: ${N.name} ${share * 100} % in nets`);
    assert.ok(!(row.other || []).some(o => o.name.toLowerCase().includes(N.slug)), `${N.name} is not "other" any more`);
  });
}

test('nets: Aarhus keeps Konstant as main net company, Odense keeps Vores Elnet; Hjerting (no Nettarif C in the archive) is still "other"', () => {
  assert.deepEqual(CITY_TABLE.find(c => c.slug === 'aarhus').nets.map(n => [n.slug, n.share]), [['konstant', 0.6], ['dinel', 0.4]]);
  assert.deepEqual(CITY_TABLE.find(c => c.slug === 'odense').nets.map(n => [n.slug, n.share]), [['vores-elnet', 0.9], ['ravdex', 0.1]]);
  assert.equal(CITY_TABLE.find(c => c.slug === 'odense').other, undefined, 'Odense: nothing left without tariffs');
  assert.deepEqual(CITY_TABLE.find(c => c.slug === 'esbjerg').other.map(o => o.name), ['Hjerting Transformatorforening'], 'Esbjerg: Hjerting publishes its household tariff as "C-Kunde Nettarif", which the archive does not read');
});

test('seo: /api/<endpoint> answers carry X-Robots-Tag noindex, the /api docs page does not', () => {
  const src = fs.readFileSync(path.join(__dirname, 'functions', 'api', '[[catchall]].js'), 'utf8');
  assert.ok(/X-Robots-Tag', 'noindex, nofollow'/.test(src), 'sets X-Robots-Tag noindex');
  assert.ok(/hasSubPath/.test(src), 'only for paths below /api');
});

test('meta: no test is registered after the summary line, where it would silently never run', () => {
  // The file ends with the summary and process.exit(). A test() appended below
  // that is parsed but never executed, and nothing reports it.
  const src = fs.readFileSync(__filename, 'utf8');
  const cut = src.lastIndexOf('console.log(`\\n${_passed} passed');
  assert.ok(cut > 0, 'could not find the summary line');
  const after = src.slice(cut);
  assert.ok(!/^test\(/m.test(after), 'a test() call sits after the summary line and will never run');
});

test('urls: the address bar never carries a route hash — views are paths and ?pris=', () => {
  // The route key (DK1/net_inkl_tarif/trefor) is internal. Writing it to
  // location.hash put the same state in the address twice and made shared links
  // look broken; navigation goes through goRoute(), which writes a clean URL.
  assert.ok(!/location\.hash\s*=[^=]/.test(INDEX), 'something assigns location.hash');
  assert.ok(!/href="#(DK[12]|\$\{)/.test(INDEX) && !/href=`#/.test(INDEX), 'a link still points at a route hash');
  assert.ok(/function syncUrl\(h\)/.test(INDEX) && /history\.replaceState\(null,'',next(\+keep)?\)/.test(INDEX), 'old hash links are rewritten');
  assert.ok(/addEventListener\('popstate',route\)/.test(INDEX), 'back/forward works between views');
  assert.ok(/syncUrl\(h\);/.test(INDEX.slice(INDEX.indexOf('function route()'))), 'route() syncs the address');
});

test('urls: every view a user can pick has one clean URL and maps back to the same route', () => {
  const m = INDEX.match(/const PRIS_PARAM=(\{[^}]*\});/);
  assert.ok(m, 'PRIS_PARAM table');
  const PRIS = JSON.parse(m[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.deepEqual(Object.keys(PRIS).sort(), ['inkl_alt_minus', 'net_inkl_tarif', 'spot_ex', 'spot_inkl']);
  // Parameters are readable Danish-ish words, never the internal mode names.
  for (const v of Object.values(PRIS)) assert.ok(/^[a-z-]+$/.test(v) && !v.includes('_'), `pris value ${v}`);
  assert.equal(new Set(Object.values(PRIS)).size, 4, 'values are unique');
});

test('seo: descriptions are trimmed to what a results page shows, titles stay short', () => {
  const SRV2 = fs.readFileSync(path.join(__dirname, 'functions', '[[path]].js'), 'utf8');
  assert.ok(/const DESC_MAX = 155;/.test(SRV2) && /function tidyDescription/.test(SRV2), 'tidyDescription exists');
  assert.ok(/meta = \{ \.\.\.meta, description: tidyDescription\(meta\.description\) \}/.test(SRV2), 'renderSPA applies it');
  // The per-net title template, with the longest net name, must stay under ~66.
  const t = SRV2.match(/title:\s+`(Elpris \$\{net\.name\} i dag \(\$\{area\}\)[^`]*)`/);
  assert.ok(t, 'net title template');
  assert.ok(t[1].replace('${net.name}', 'Nord Energi').replace('${area}', 'DK1').length <= 66, 'net title too long');
  for (const m of SRV2.matchAll(/'(\/[^']*)': \{\s*\n\s*title: '((?:[^'\\]|\\.)*)'/g)) {
    assert.ok(m[2].length <= 66, `title for ${m[1]} is ${m[2].length} characters`);
  }
});

test('api etiquette: generated snippets poll rarely — Shelly fetches the day plan once', () => {
  // Prices change on the hour. The generated Home Assistant YAML used to say
  // scan_interval: 60 and the Shelly script asked /api/now every minute — most
  // of the site's 70-80 thousand function invocations a day, against a free-plan
  // limit of 100,000. Shelly now fetches the day's schedule once and decides
  // locally; Home Assistant keeps a floor of 5 minutes.
  for (const m of INDEX.matchAll(/scan_interval:\s*(\d+)/g)) {
    assert.ok(+m[1] >= 300, `scan_interval: ${m[1]} is faster than every 5 minutes`);
  }
  const num = name => { const m = INDEX.match(new RegExp(`var ${name} = ([0-9* ]+);`)); assert.ok(m, `${name} missing`); return eval(m[1]); };
  assert.ok(/var API = "\$\{scheduleUrl\}";/.test(INDEX), 'the Shelly script must fetch /api/schedule, not /api/now');
  assert.ok(/const scheduleUrl=apiUrl\.replace\('\/api\/now\?','\/api\/schedule\?'\)/.test(INDEX), 'schedule URL derivation');
  assert.ok(num('PLAN_MAX_AGE_MS') >= 20 * 3600 * 1000, 'plan is re-fetched more often than daily');
  // Home Assistant: the REST sensor reads the day's plan on a long interval; the
  // hourly decision is a template on the plan, not another request.
  const ha = INDEX.slice(INDEX.indexOf('const haCode='), INDEX.indexOf('// Option 2') > 0 ? INDEX.indexOf('# ── Option 2') : INDEX.indexOf('const flexHaId'));
  assert.ok(/resource: "\$\{scheduleUrl\}"/.test(ha), 'HA sensor must read /api/schedule');
  const interval = ha.match(/scan_interval:\s*(\d+)/);
  assert.ok(interval && +interval[1] >= 21600, `HA plan sensor polls every ${interval && interval[1]} s`);
  assert.ok(/binary_sensor:/.test(ha) && /s\[now\(\)\.hour\]\.on/.test(ha), 'the hourly state is a template on the plan');
  assert.ok(/homeassistant\.update_entity/.test(ha) && /range\(0, 300\) \| random/.test(ha), 'a jittered refresh after midnight');
  assert.ok(/service: "switch\.turn_\{\{ trigger\.to_state\.state \}\}"/.test(ha) && /binary_sensor\.\$\{entityId\}_on/.test(ha),
    'the automation follows the on/off binary sensor (its states are literally on/off)');
  assert.ok(num('RETRY_MS') >= 5 * 60 * 1000, 'failed fetches are retried too eagerly');
  assert.ok(num('FALLBACK_POLL_MS') >= 15 * 60 * 1000, 'the no-clock fallback polls too eagerly');
  assert.ok(!/Shelly\.call\("HTTP\.GET"[\s\S]{0,120}\}\s*\n\s*Timer\.set\(\w+, true, check\)/.test(INDEX), 'a periodic HTTP check came back');
});

// ─────────────────────────────────────────────────────────────────────────────
// Footer: four short groups, the net companies behind one disclosure
// ─────────────────────────────────────────────────────────────────────────────

const FOOTER = INDEX.slice(INDEX.indexOf('<footer'), INDEX.indexOf('</footer>') + 9);
const footerHrefs = (html) => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]);
const NET_SLUGS = {
  dk1: ['n1', 'trefor', 'konstant', 'dinel', 'vores-elnet', 'rah-net', 'elvaerk', 'nord-energi', 'noe-net', 'elnet-midt', 'flow-elnet', 'lnet'],
  dk2: ['cerius', 'trefor-ost', 'radius'],
};

test('footer: four labelled groups, each a nav with a visible heading', () => {
  assert.ok(FOOTER.startsWith('<footer'), 'footer found');
  // One <footer> in the markup. The country pages' footer is built by chromeHTML() inside the script (one more
  // `<footer` in the text of the file, and none in the Danish markup); the script is cut away before counting.
  const markup = INDEX.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.equal((markup.match(/<footer\b/g) || []).length, 1, 'exactly one footer');
  assert.equal((INDEX.match(/<footer\b/g) || []).length, 2, 'the Danish footer plus the country footer chromeHTML() builds');
  const heads = [...FOOTER.matchAll(/<nav class="sf-col" aria-labelledby="(\w+)">\s*<p class="sf-h" id="\1">([^<]+)<\/p>/g)].map(m => m[2]);
  assert.deepEqual(heads, ['Priser', 'Smart hjem', 'Viden', 'Elpriser']);
  // The grouped columns, in the owner's order and with the owner's links.
  const col = (id) => { const i = FOOTER.indexOf(`id="${id}"`); return FOOTER.slice(i, FOOTER.indexOf('</nav>', i)); };
  assert.deepEqual(footerHrefs(col('sfPriser')), ['/', '/dk1', '/dk2', '/prognose', '/tariffer']);
  assert.deepEqual(footerHrefs(col('sfHjem')), ['/automation', '/shelly-tariff', '/api']);
  const viden = footerHrefs(col('sfViden'));
  assert.deepEqual(viden, ['/om-elpriser', '/blog/elafgift-2028', '/blog/elafgift-og-spotpris',
    '/blog/hvornaar-er-stroemmen-billigst', '/blog/groennest-og-dyrest', '/blog']);
  assert.ok(footerHrefs(col('sfOm'))[0] === '/privatliv', 'Privatliv leads the Elpriser group (the explainer moved to Viden)');
  assert.deepEqual(footerHrefs(col('sfOm')), ['/privatliv', '/download', 'https://apps.apple.com/dk/app/id6820474476', 'https://play.google.com/store/apps/details?id=org.elpriser.app'],
    'the Elpriser group: Privatliv, the text link "Hent appen" → /download, then the two store buttons');
});

test('footer: ONE link to the explainer, labelled "Forstå din elpris" in Viden — no second "Om Elpriser", no "Flere guides"', () => {
  const links = [...FOOTER.matchAll(/<a\b[^>]*\bhref="\/om-elpriser"[^>]*>([^<]*)<\/a>/g)].map(m => m[1].trim());
  assert.deepEqual(links, ['Forstå din elpris'], 'exactly one /om-elpriser link, with that label');
  const col = (id) => { const i = FOOTER.indexOf(`id="${id}"`); return FOOTER.slice(i, FOOTER.indexOf('</nav>', i)); };
  assert.ok(footerHrefs(col('sfViden')).includes('/om-elpriser'), 'it sits in the Viden group');
  assert.ok(!footerHrefs(col('sfOm')).includes('/om-elpriser'), 'and not in the Elpriser group');
  assert.ok(!/Om Elpriser/i.test(FOOTER), 'the old "Om Elpriser" label is gone');
  assert.ok(!/Flere guides/.test(FOOTER) && !/class="sf-more"/.test(FOOTER), 'the emptied "Flere guides" disclosure is gone');
  // Every remaining post is a plain link; the five retired URLs are not linked.
  for (const slug of ['hvornaar-er-stroemmen-billigst', 'groennest-og-dyrest', 'elafgift-2028', 'elafgift-og-spotpris']) {
    assert.ok(FOOTER.includes(`href="/blog/${slug}"`), `footer links /blog/${slug}`);
  }
  for (const gone of Object.keys(LEGACY)) assert.ok(!FOOTER.includes(`href="${gone}"`), `footer still links ${gone}`);
});

test('footer: all 16 net companies and the four foreign-area pages sit inside ONE collapsed details, as real links', () => {
  const m = FOOTER.match(/<details class="sf-all">\s*<summary>[^]*?Alle netselskaber og prisområder[^]*?<\/summary>([^]*?)<\/details>/);
  assert.ok(m, 'details "Alle netselskaber og prisområder"');
  assert.ok(!/<details[^>]*\bopen\b/.test(m[0]), 'collapsed by default');
  assert.equal((FOOTER.match(/<details\b/g) || []).length, 1, 'one disclosure in the footer: the net list');
  assert.ok(/aria-label="Netselskaber"/.test(m[1]), 'the net list is a labelled nav');
  const inside = footerHrefs(m[1]);
  for (const [area, slugs] of Object.entries(NET_SLUGS)) {
    for (const s of slugs) assert.ok(inside.includes(`/${area}/${s}`), `/${area}/${s} is inside the details`);
  }
  // The ten pilot cities sit between the nets and the foreign areas, in the order of the table (the table is the pilot's list).
  assert.deepEqual(inside.slice(16, 26), CITY_TABLE.map(c => '/elpris/' + c.slug), 'Byer: the ten cities, in the table\'s order, after the 16 nets');
  assert.deepEqual(inside.slice(26), ['/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce'], 'Andre prisområder: Norden, Norge, Sverige, Finland, Nederland, Tyskland, Frankrig, Polen, Italien — in that order, after the cities');
  assert.equal(inside.length, 35, 'nothing else in there');
  assert.equal(new Set(inside).size, inside.length, 'no duplicate href in the details');
  for (const h of ['Vestdanmark (DK1)', 'Østdanmark (DK2)', 'Byer', 'Andre prisområder']) assert.ok(m[1].includes(h), `heading ${h}`);
  // Nothing outside the details links a net page: the visible footer stays short.
  const outside = footerHrefs(FOOTER.replace(m[0], ''));
  assert.deepEqual(outside.filter(h => /^\/(dk[12]\/|elpris\/|norden|no\/strompris|sv\/elpris|fi\/sahkon-hinta|nl\/stroomprijs|de\/strompreis|fr\/prix-electricite|pl\/ceny-pradu|it\/prezzo-luce)/.test(h)), [], 'net pages, city pages and foreign-area pages only behind the disclosure');
});

test('footer: both app stores are linked, rel=noopener, with the Danish button wording', () => {
  for (const [url, text] of [
    ['https://apps.apple.com/dk/app/id6820474476', 'Hent til iPhone og iPad'],
    ['https://play.google.com/store/apps/details?id=org.elpriser.app', 'Hent til Android'],
  ]) {
    const a = FOOTER.match(new RegExp(`<a href="${url.replace(/[.?]/g, '\\$&')}"([^>]*)>([^]*?)</a>`));
    assert.ok(a, `footer links ${url}`);
    assert.ok(/rel="noopener"/.test(a[1]), `${url} has rel=noopener`);
    assert.ok(a[2].startsWith(text), `${url} reads "${text}"`);
  }
  assert.equal((FOOTER.match(/apps\.apple\.com/g) || []).length, 1, 'App Store linked once');
  assert.equal((FOOTER.match(/play\.google\.com/g) || []).length, 1, 'Google Play linked once');
});

test('footer: no link list is repeated, and the credits line keeps both external links', () => {
  const hrefs = footerHrefs(FOOTER);
  const dup = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
  assert.deepEqual(dup, [], 'a link appears twice in the footer');
  // 38 since /download joined the Elpriser group ("Hent appen"); the two store buttons below it still point straight at the stores.
  // 48 since the ten city pages joined the disclosure ("Byer"); 49 since Dinel became the 15th net company; 50 with Ravdex.
  // 51 with Nederland (/nl/stroomprijs) among the other price areas.
  // 55 with Tyskland, Frankrig, Polen and Italien (the EU price pages).
  assert.equal(hrefs.length, 55, `footer has ${hrefs.length} links: 18 in the groups and the apps, 16 nets, 10 cities, Norden and eight countries, and the two credits`);
  const legal = FOOTER.match(/<p class="sf-legal">([^]*?)<\/p>/);
  assert.ok(legal, 'credits line');
  assert.ok(/&copy; Elpriser\.org &mdash; Data fra <a href="https:\/\/www\.energidataservice\.dk"[^>]*rel="noopener">Energi Data Service<\/a> \(Energinet\)\. Åbne datasæt på <a href="https:\/\/huggingface\.co\/Elpriser"[^>]*rel="noopener">Hugging Face<\/a>\./.test(legal[1]), 'credits wording and links');
  // Brand wordmark: capital E in visible text.
  assert.ok(!/>\s*elpriser[ <]/.test(FOOTER) && !/Om elpriser/.test(FOOTER), 'visible brand text is "Elpriser"');
});

test('footer: summaries are 44 px targets, links 44 px on phones, focus rings, no horizontal overflow, no emoji', () => {
  assert.ok(/\.sf details>summary\{[^}]*min-height:44px/.test(INDEX), 'summary min-height 44px');
  assert.ok(/\.sf-l a\{[^}]*min-height:44px/.test(INDEX) && /\.sf-chips a\{[^}]*min-height:44px/.test(INDEX) && /\.sf-apps a\{[^}]*min-height:44px/.test(INDEX), 'link targets 44px');
  assert.ok(/\.sf a:focus-visible,\.sf summary:focus-visible\{outline:2px solid var\(--p-brand\)/.test(INDEX), 'visible focus ring');
  assert.ok(/\.sf-cols\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(INDEX) && /@media \(min-width:900px\)\{\.sf-cols\{grid-template-columns:repeat\(4,/.test(INDEX), '2 columns on phones, 4 from 900 px');
  assert.ok(/\.sf-h\{[^}]*font-size:12px[^}]*text-transform:uppercase/.test(INDEX), '12 px uppercase headings');
  assert.ok(!/\.sf[\w-]*\{[^}]*#[0-9a-f]{3,6}/i.test(INDEX.slice(INDEX.indexOf('.sf{'), INDEX.indexOf('.sf-legal a:hover') + 60)), 'footer colours come from the --p-* roles (light and dark)');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(FOOTER), 'no emoji in the footer');
});

test('crawl hygiene: no templated href literal anywhere a crawler can read it', () => {
  // Google once crawled https://elpriser.org/${k}: an unevaluated template
  // string in an href attribute ships as literal text in the served HTML and is
  // read as a relative link. Build such hrefs by concatenation or set el.href.
  const bad = /href=\\?["'](?:\/)?\$\{/;
  for (const [name, src] of [['index.html', INDEX], ['functions/[[path]].js', ROUTES]]) {
    const lines = src.split('\n');
    lines.forEach((l, i) => assert.ok(!bad.test(l), `${name}:${i + 1} has a templated href: ${l.trim().slice(0, 100)}`));
  }
  assert.ok(!INDEX.includes('href="${') && !INDEX.includes("href='${") && !INDEX.includes('href=\\"/${'), 'index.html literal');
  assert.ok(!ROUTES.includes('href="${') && !ROUTES.includes("href='${") && !ROUTES.includes('href=\\"/${'), 'functions literal');
});

test('footer: the homepage render cache key was bumped with the shared markup', () => {
  // v69 and earlier: see git. v68: header "Hent appen" became a link to /download and the footer gained "Hent appen"; the app dialog is gone.
  // (v67: the footer's Andre prisområder links moved to the localised paths.)
  // v70: the footer gained the "Byer" group (ten city links).
  // v71: Dinel, the 15th net company, joined the footer's net list and NETS.
  // v72: Ravdex, the 16th.
  // v73: the Pris screen gained the PRIS_FC configuration (7 døgn, Usikkerhed) and /prognose draws it; three sentences that linked to /prognose say 7 døgn.
  // v74: the footer and the net dialog list Nederland (/nl/stroomprijs); the country pages swap the chrome for their own (CHROME_I18N).
  // v75: the footer and the net dialog list Tyskland, Frankrig, Polen and Italien.
  assert.ok(/homepage-ssr-v76/.test(ROUTES), 'homepage-ssr-v76');
  // The zone pages share the header and footer and are cached under their own key; it moved with them.
  // (v8: the shared Pris block changed with PRIS_FC.)
  // (v9: the country pages got their own header and footer, and /nl/stroomprijs joined.)
  // (v10: the four EU price pages joined, the Pris block gained PRIS_ACT and the footer the four links.)
  assert.ok(/ZONE_SSR_VERSION = 'zone-ssr-v11'/.test(ROUTES), 'zone-ssr-v11');
  // The city pages share them too, under a key of their own that starts at v1 (v2: Dinel in the footer and in Aarhus' text; v3: Ravdex, Odense).
  // (v5: Nederland in the footer and the net dialog.)
  // (v6: the four EU country links.)
  assert.ok(/CITY_SSR_VERSION = 'city-ssr-v7'/.test(ROUTES), 'city-ssr-v7');
  // /prognose shares the header and footer too (v4: the four EU country links).
  assert.ok(/PROGNOSE_SSR_VERSION = 'prognose-ssr-v5'/.test(ROUTES), 'prognose-ssr-v5');
});


// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-17 cleanup: five pages merged away, start page slimmed
// ─────────────────────────────────────────────────────────────────────────────

const mainOf = (page) => {
  const a = INDEX.search(new RegExp(`<main[^>]*data-page="${page}"`));
  assert.ok(a >= 0, `<main data-page="${page}"> not found`);
  return INDEX.slice(a, INDEX.indexOf('</main>', a));
};
const textOf = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<\/?(?:a|strong|em|span|code|b|i)\b[^>]*>/g, '')   // inline tags leave no gap before punctuation
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const words = (html) => textOf(html).split(' ').filter(Boolean).length;
const tableOf = (src, name, re) => {
  const m = src.match(re);
  assert.ok(m, `${name}: LEGACY_REDIRECTS not found`);
  return Object.fromEntries([...m[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map(x => [x[1], x[2]]));
};

test('legacy redirects: functions/[[path]].js and server.js carry the same table, and it is the expected one', () => {
  const prod = tableOf(ROUTES, 'functions/[[path]].js', /const LEGACY_REDIRECTS = \{([\s\S]*?)\};/);
  const dev = tableOf(SERVER, 'server.js', /const LEGACY_REDIRECTS = \{([\s\S]*?)\};/);
  assert.deepEqual(prod, LEGACY, 'production table differs from the expected redirects (5 posts + 11 zone pages, /nl straight to its own page)');
  assert.deepEqual(dev, prod, 'server.js (local dev) differs from production');
  // The handler answers 301 with a one-hour cache header, before any rendering.
  const i = ROUTES.indexOf('const legacyTo = LEGACY_REDIRECTS[url.pathname]');
  assert.ok(i > 0, 'handler does not consult LEGACY_REDIRECTS');
  assert.ok(i < ROUTES.indexOf('const staticRoute = STATIC_ROUTES') && i < ROUTES.indexOf('SEO_PAGES[url.pathname]'), 'redirects must run before page rendering');
  const branch = ROUTES.slice(i, i + 500);
  assert.ok(/status: 301/.test(branch) && /'Cache-Control': 'public, max-age=3600'/.test(branch), '301 + max-age=3600');
});

test('legacy redirects: the retired paths are mentioned nowhere else — sitemap, SEO_PAGES, route maps, mains, links, llms text', () => {
  const rest = {
    'functions/[[path]].js': ROUTES.replace(/const LEGACY_REDIRECTS = \{[\s\S]*?\};/, ''),
    'server.js': SERVER.replace(/const LEGACY_REDIRECTS = \{[\s\S]*?\};/, ''),
    'index.html': INDEX.replace(/const LEGACY_HASH=\{[\s\S]*?\};/, ''),
  };
  for (const [name, src] of Object.entries(rest)) {
    for (const slug of LEGACY_SLUGS) assert.ok(!src.includes(slug), `${name} still mentions ${slug}`);
  }
  for (const slug of LEGACY_SLUGS) assert.ok(!INDEX.includes(`data-page="blog-${slug}"`), `a <main> for ${slug} is still in index.html`);
  // The eleven zone paths, as quoted strings or hrefs (not as prefixes of /no/strompris or /fi/sahkon-hinta).
  for (const [name, src] of Object.entries(rest)) {
    for (const z of LEGACY_ZONES) assert.ok(!new RegExp(`['"\`]${z}(['"\`#?]|$)`).test(src.replace(/\/\/[^\n]*/g, '')), `${name} still mentions ${z}`);
  }
  assert.ok(!/HASH_TO_DATA_PAGE[^}]*'(no[1-5]|se[1-4]|fi|nl)':/.test(ROUTES), 'HASH_TO_DATA_PAGE still maps a retired zone');
  // And the sitemap that is actually served.
  const urls = ROUTES.match(/SITEMAP_URLS\s*=\s*\[([\s\S]*?)\n\];/)[1];
  for (const k of Object.keys(LEGACY)) assert.ok(!urls.includes(`'${k}'`), `${k} is in the sitemap`);
  // No internal link points at a redirected URL (with or without a fragment).
  for (const m of INDEX.matchAll(/href="(\/[^"#?]*)/g)) assert.ok(!(m[1] in LEGACY), `index.html links ${m[1]}, which redirects`);
});

test('legacy redirects: the client maps the old #blog/… hashes to the same targets', () => {
  const m = INDEX.match(/const LEGACY_HASH=\{([\s\S]*?)\};/);
  assert.ok(m, 'LEGACY_HASH not found in index.html');
  const hashes = Object.fromEntries([...m[1].matchAll(/'([^']+)':'([^']+)'/g)].map(x => ['/' + x[1], x[2]]));
  assert.deepEqual(hashes, LEGACY, 'LEGACY_HASH differs from the server-side table');
  const route = INDEX.slice(INDEX.indexOf('function route(){'), INDEX.indexOf('function route(){') + 700);
  assert.ok(/LEGACY_HASH\[hashText\(\)\]/.test(route) && /location\.replace\(legacy\)/.test(route) && /history\.replaceState\(null,'',legacy\)/.test(route),
    'route() does not redirect the old hashes');
  // The anchors are places in the page: they must not be taken for routes or rewritten away.
  assert.ok(/PAGE_ANCHORS=new Set\(\['shelly','home-assistant'\]\)/.test(INDEX), 'PAGE_ANCHORS');
  // The zone tabs of /no/strompris and /sv/elpris (#no2, #se3) are places in the page too, not routes.
  assert.ok(/const isAnchor=a=>PAGE_ANCHORS\.has\(a\)\|\|ZONES\.hasOwnProperty\(a\);/.test(INDEX), 'isAnchor');
  assert.ok(/if\(hash&&!isAnchor\(hash\)\)return hash;/.test(INDEX), 'rawRouteFromLocation lets an anchor pick the page');
  assert.ok(!/PAGE_ANCHORS\.has\(hash/.test(INDEX.slice(INDEX.indexOf('function rawRouteFromLocation'), INDEX.indexOf('function urlForRoute'))), 'a raw PAGE_ANCHORS check is back in the router');
});

test('blog index lists only the four remaining posts, as cards and in the Blog markup', () => {
  const blog = mainOf('blog');
  const cards = [...blog.matchAll(/<a href="(\/blog\/[^"]+)" class="card/g)].map(m => m[1]).sort();
  assert.deepEqual(cards, ['/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst']);
  const blogHrefs = [...blog.matchAll(/href="(\/blog\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(blogHrefs)].sort(), cards, 'the page links a blog URL that is not a card');
  // Each remaining post still exists as a section.
  for (const slug of ['elafgift-2028', 'elafgift-og-spotpris', 'groennest-og-dyrest', 'hvornaar-er-stroemmen-billigst'])
    assert.ok(INDEX.includes(`data-page="blog-${slug}"`), `blog-${slug} section`);
});

test('/automation: #shelly and #home-assistant sections with their own headings, below the generator, essentials only', () => {
  const m = mainOf('automation');
  const gen = m.indexOf('id="exportShellyCode"');
  for (const [id, h2, must] of [
    ['shelly', /Shelly/, [/Scripts → Create Script/, /Run on startup/, /\/api\/schedule/, /én gang/, /5\. minut/]],
    ['home-assistant', /Home Assistant/, [/configuration\.yaml/, /\/api\/schedule/, /scan_interval/, /300 sekunder/, /5\. minut/]],
  ]) {
    const a = m.indexOf(`<section id="${id}"`);
    assert.ok(a > gen && gen > 0, `#${id} must exist and sit below the generator and its exports`);
    const sec = m.slice(a, m.indexOf('</section>', a));
    const head = sec.match(/<h2[^>]*>([^<]+)<\/h2>/);
    assert.ok(head && h2.test(head[1]), `#${id} has no h2 naming it`);
    const w = words(sec);
    assert.ok(w >= 250 && w <= 450, `#${id} is ${w} words, aimed at 250-450`);
    for (const re of must) assert.ok(re.test(sec), `#${id} lacks ${re}`);
    assert.ok(/class="[^"]*anchor-sec/.test(sec.slice(0, 120)), `#${id} has no scroll margin for the sticky header`);
  }
  assert.equal((m.match(/ id="shelly"/g) || []).length, 1, 'id="shelly" must be unique');
  assert.equal((m.match(/ id="home-assistant"/g) || []).length, 1, 'id="home-assistant" must be unique');
  // SEO title and description were tuned for search: unchanged.
  assert.ok(ROUTES.includes("title: 'Elpriser API til Home Assistant og Shelly — gratis, med kode'"), '/automation title changed');
  assert.ok(ROUTES.includes("description: 'Gratis elpriser-API (JSON, ingen nøgle) og færdig kode til Home Assistant og Shelly. Styr varmepumpe, elbil og vandvarmer efter de billigste timer.'"), '/automation description changed');
  // No BlogPosting block can be left behind for the removed posts.
  assert.ok(!/BlogPosting/.test(m), '/automation carries blog markup');
});

test('/om-elpriser is the single explainer: "Forstå din elpris", the merged topics, SEO title and URL kept', () => {
  const m = mainOf('om-elpriser');
  assert.equal(m.match(/<h2 class="page-title">([^<]+)<\/h2>/)[1], 'Forstå din elpris', 'visible H1');
  const body = textOf(m);
  for (const [topic, re] of [
    ['spotpris', /Spotprisen/], ['nettarif', /Nettarif/], ['systemtarif og transmission', /Systemtarif og transmissionstarif/],
    ['elafgift', /Elafgift/], ['moms', /Moms/], ['DK1 vs DK2', /DK1 og DK2/], ['negative priser', /Negative elpriser/],
    ['sådan sparer du', /Sådan sparer du/], ['hvornår billigst', /Hvornår er strømmen billigst/],
    ['netselskab', /Find dit netselskab/], ['datakilder', /Datakilder/],
  ]) assert.ok(re.test(body), `/om-elpriser lost "${topic}"`);
  assert.ok(ROUTES.includes("title: 'Om elpriser i Danmark — Spotpris, tariffer og afgifter'"), 'SEO title changed');
  assert.ok(ROUTES.includes("description: 'Forstå din elpris: spotpris, nettarif, systemtarif, elafgift og moms. Sådan fungerer prisområderne DK1 og DK2, og sådan finder du dit netselskab.'"), 'SEO description changed');
  assert.ok(SERVER.includes("'/om-elpriser': '#om-elpriser'"), 'dev route');
  // The retired guide's stale claims must not come back with the merge: the elafgift is not 76 øre in
  // 2026, and the cheapest hours are not "kl. 00-06" any more.
  assert.ok(!/76,1 øre/.test(m) && !/Billigst[^.]{0,40}Kl\. 00-06/.test(body), 'a stale figure from the retired guide came back');
  assert.ok(/0,8 øre/.test(body) && /68 %/.test(body), 'the current elafgift and the 68 % midday figure are stated');
  const w = words(m);
  assert.ok(w >= 450 && w <= 800, `/om-elpriser is ${w} words`);
});

test('start page: no nøgletal block, no 14-button area cards — one compact row opens the net dialog', () => {
  const start = mainOf('start');
  const body = textOf(start);
  assert.ok(!/nøgletal/i.test(start) && !/stats-section/.test(start), 'the nøgletal block is back');
  for (const h of ['Hvad koster el i Danmark', 'Prisrekorder', 'Prisfordeling', 'Billigste og dyreste netselskab', 'Hvornår er elpriser billigst og dyrest', 'Spar penge på elpriser'])
    assert.ok(!body.includes(h), `"${h}" is back on the start page`);
  assert.ok(!/id="dk[12]-(zone|nets)"/.test(start) && !/net-row|net-list|zone-stack/.test(start), 'the DK1/DK2 area cards are back');
  const row = start.match(/<div class="area-row" data-area-row>([\s\S]*?)<\/p>\s*<\/div>/);
  assert.ok(row, 'the compact area row is missing');
  assert.ok(/<button type="button" class="gps-light" onclick="openNetDialog\(\)"[^>]*>Find dit netselskab<\/button>/.test(row[1]), 'the button must open the net dialog');
  assert.deepEqual([...row[1].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(m => [m[1], m[2]]), [['/dk1', 'DK1 Vest'], ['/dk2', 'DK2 Øst']]);
  assert.ok(/<\/a> · <a/.test(row[1]), 'the two links read "DK1 Vest · DK2 Øst"');
  assert.equal((start.match(/<a href="\/(dk[12])\/[a-z0-9-]+"/g) || []).length, 0, 'net pages are linked from the footer and the dialog, not from the start page body');
  // The dialog the button opens keeps every net page reachable (built by buildNetDialog; the footer holds the static list).
  assert.ok(/id="netDlgDK1"/.test(INDEX) && /id="netDlgDK2"/.test(INDEX) && /function openNetDialog\(\)/.test(INDEX) && /function buildNetDialog\(\)/.test(INDEX), 'the net dialog');
  // What the page points at instead of the removed block:
  for (const href of ['/tariffer', '/om-elpriser', '/blog/hvornaar-er-stroemmen-billigst'])
    assert.ok(start.includes(`href="${href}"`), `start page lost its pointer to ${href}`);
  // Kept as the owner asked: the overview, the intro paragraph and the Pris placeholder.
  assert.ok(start.includes('Dagens overblik') && start.includes('<!--SSR_PRIS-->') && start.includes('id="readerLive"'));
  assert.ok(/Elpriser — også kaldet energipriser/.test(start), 'intro paragraph');
});

test('start page: exactly 5 FAQ items, and the FAQPage markup mirrors them word for word', () => {
  const start = mainOf('start');
  const items = [...start.matchAll(/<details class="group faq">\s*<summary[^>]*>([\s\S]*?)<svg[\s\S]*?<\/summary>\s*<div[^>]*>\s*<div>([\s\S]*?)<\/div>\s*<\/div>\s*<\/details>/g)]
    .map(m => ({ q: textOf(m[1]), a: textOf(m[2]) }));
  assert.equal((start.match(/<details\b/g) || []).length, 5, 'the start page must have exactly 5 <details>');
  assert.equal(items.length, 5, 'could not read 5 FAQ items');
  const ld = JSON.parse(start.match(/<script type="application\/ld\+json">(\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "FAQPage"[\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.mainEntity.length, 5, 'FAQPage lists a different number of questions');
  ld.mainEntity.forEach((e, i) => {
    assert.equal(e.name, items[i].q, `FAQ question ${i + 1}: markup differs from the visible question`);
    assert.equal(e.acceptedAnswer.text.replace(/\s+/g, ' ').trim(), items[i].a, `FAQ answer ${i + 1}: markup differs from the visible answer`);
  });
  const names = ld.mainEntity.map(e => e.name);
  for (const q of ['Hvad er elprisen i dag?', 'Hvornår er strømmen billigst?', 'Hvad indgår i den samlede elpris?', 'Hvad er forskellen på DK1 og DK2?'])
    assert.ok(names.includes(q), `FAQ lost "${q}"`);
  assert.ok(!names.includes('Hvad koster strøm lige nu?'), 'the duplicate "Hvad koster strøm lige nu?" is back');
  // "Hvornår er strømmen billigst?" must agree with the post it links to (midday, not night).
  const cheap = items.find(i => i.q === 'Hvornår er strømmen billigst?').a;
  assert.ok(/68 %/.test(cheap) && !/typisk billigst om natten/.test(cheap), 'the cheapest-hour answer contradicts the blog analysis');
});

// ─────────────────────────────────────────────────────────────────────────────
// /download: the "Hent appen" dialog became a page with the two store badges
// ─────────────────────────────────────────────────────────────────────────────

const APPLE_URL = 'https://apps.apple.com/dk/app/id6820474476';
const PLAY_URL  = 'https://play.google.com/store/apps/details?id=org.elpriser.app';

test('/download: one path through the SEO entry, sitemap, route maps, router and llms.txt', () => {
  const entry = ROUTES.slice(ROUTES.indexOf(`'/download': {`), ROUTES.indexOf('\n  },', ROUTES.indexOf(`'/download': {`)));
  const field = f => (entry.match(new RegExp(`${f}: '([^']*)'`)) || [])[1] || '';
  assert.ok(/^Hent Elpriser-appen/.test(field('title')), 'the title leads with the action');
  assert.ok(field('title').length <= 62, `title is ${field('title').length} characters`);
  assert.ok(field('description').length >= 80 && field('description').length <= 155, `description is ${field('description').length} characters`);
  assert.ok(/5 døgn/.test(field('description')) && !/10 døgn/.test(entry), 'the apps show 2 and 5 døgn, never 10');
  assert.equal(field('hash'), '#download');
  assert.ok(/SITEMAP_URLS = \[[^\]]*'\/download'/.test(ROUTES), 'sitemap lists /download');
  assert.ok(/'\/download': '2026-10-23'/.test(ROUTES), 'a real lastmod (a static page, not daily)');
  assert.ok(/'download': 'download'/.test(ROUTES), 'HASH_TO_DATA_PAGE');
  assert.ok(SERVER.includes("'/download': '#download'"), 'dev-server route');
  assert.ok(INDEX.includes("'/download':'download'"), 'client PATH_ROUTES');
  assert.ok(/h==='download'\)\{[^\n]*document\.title='Hent Elpriser-appen/.test(INDEX), 'the router sets the same title');
  const llms = ROUTES.slice(ROUTES.indexOf('const LLMS_TXT = `'), ROUTES.indexOf('const LLMS_FULL_TXT'));
  assert.ok(llms.includes('https://elpriser.org/download)'), 'llms.txt links /download');
  assert.ok(llms.includes(APPLE_URL) && llms.includes(PLAY_URL), 'and names both stores (llms-full.txt is llms.txt plus more)');
  assert.ok(/LLMS_FULL_TXT = LLMS_TXT \+/.test(ROUTES), 'llms-full.txt contains llms.txt');
});

test('/download: H1, honest copy, two identical store badges with the exact links and Danish accessible names', () => {
  const m = mainOf('download');
  assert.ok(/<h2 class="page-title">Hent Elpriser-appen<\/h2>/.test(m), 'the title the server promotes to the page\'s h1');
  const text = textOf(m);
  assert.ok(/i morgen og de næste 5 døgn/.test(text) && /med dit netselskab/.test(text), 'the lead says what the apps show');
  assert.ok(!/10 døgn|3.10 døgn|10 dage/.test(text), 'no 10-day claim: the apps show 2 døgn | 5 døgn');
  for (const claim of ['2 døgn', '5 døgn', 'Din pris', 'Spotpris', 'DK1', 'DK2', 'nettarif', 'moms', 'gratis', 'ingen konto'])
    assert.ok(new RegExp(claim, 'i').test(text), `copy lost "${claim}"`);
  assert.ok(!/prognose|CO₂|usikkerhed|aflæs|styr|automatis/i.test(text), 'copy names a feature the apps no longer have or never had');
  const badges = [...m.matchAll(/<a class="dl-badge ([\w-]+)" href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(badges.length, 2, 'two badges');
  const [apple, play] = badges;
  assert.equal(apple[2], APPLE_URL); assert.equal(play[2], PLAY_URL);
  assert.ok(/aria-label="Hent i App Store — iPhone og iPad"/.test(apple[3]), 'App Store accessible name');
  assert.ok(/aria-label="Hent på Google Play — Android"/.test(play[3]), 'Google Play accessible name');
  for (const b of badges) {
    assert.ok(/rel="noopener"/.test(b[3]), 'rel=noopener');
    assert.ok(/<svg viewBox="0 0 190 54" width="183" height="52" aria-hidden="true"/.test(b[4]), 'drawn inline, same size, hidden from the accessibility tree (the link carries the name)');
    assert.ok(/<rect[^>]*fill="#000"/.test(b[4]), 'black rounded badge');
  }
  assert.ok(/Hent i<\/text>[\s\S]*App Store<\/text>/.test(apple[4]) && /Hent på<\/text>[\s\S]*Google Play<\/text>/.test(play[4]), 'the visible words are inside the accessible names');
  const css = INDEX.match(/\.dl-badge\{([^}]*)\}/)[1];
  assert.ok(/height:5\d px|height:52px/.test(css) && parseInt(css.match(/height:(\d+)px/)[1], 10) >= 44, 'badge target is at least 44 px high');
  assert.ok(/\.dl-badge:focus-visible\{outline:2px solid var\(--p-brand\)/.test(INDEX), 'visible focus ring');
  // Device order: App Store first in the markup and by default; Android swaps with a class set by an inline script after the badges.
  assert.ok(m.indexOf('dl-apple') < m.indexOf('dl-play'), 'App Store badge first without JS');
  assert.ok(/\.dl-stores\.is-android \.dl-play\{order:-1\}/.test(INDEX), 'Android puts Google Play first');
  assert.ok(/\/Android\/i\.test\(u\)\)b\.className\+=' is-android'/.test(m) && /iPhone\|iPad\|iPod/.test(m), 'the inline script picks the order from the user agent');
  assert.ok(!/display:none|\shidden[\s>]/.test(m.match(/<div class="dl-stores">[\s\S]*?<\/div>/)[0]), 'nothing is hidden: both badges stay on every device');
});

test('/download: MobileApplication JSON-LD lives on this page only — free, iOS and Android, both stores, no invented rating', () => {
  const m = mainOf('download');
  const ld = JSON.parse(m.match(/<script type="application\/ld\+json">(\{[\s\S]*?\})<\/script>/)[1]);
  assert.equal(ld['@type'], 'MobileApplication');
  assert.equal(ld.url, 'https://elpriser.org/download');
  assert.ok(/iOS/.test(ld.operatingSystem) && /Android/.test(ld.operatingSystem));
  assert.equal(ld.offers.price, '0'); assert.equal(ld.isAccessibleForFree, true);
  assert.deepEqual(ld.downloadUrl, [APPLE_URL, PLAY_URL]);
  assert.ok(!/aggregateRating|ratingValue|reviewCount|review"/i.test(m), 'no rating: there is none to quote');
  assert.ok(!INDEX.slice(0, INDEX.indexOf('<body')).includes('MobileApplication'), 'not in the shared <head>');
  assert.equal((INDEX.match(/"@type": "MobileApplication"/g) || []).length, 1, 'one block, in this main');
});

test('header: "Hent appen" is a plain link to /download — the dialog, its script and its event are gone; the smart banner stays', () => {
  assert.ok(/<a href="\/download" class="app-btn">Hent appen<\/a>/.test(INDEX), 'a link, same class and label as the old button');
  assert.ok(!/<button[^>]*app-btn/.test(INDEX), 'no button with the app-btn class');
  for (const gone of ['appDialog', 'openAppDialog', 'closeAppDialog', 'app_dialog_open', 'appDialogTitle'])
    assert.ok(!INDEX.includes(gone), `${gone} is still in index.html`);
  assert.ok(INDEX.indexOf('class="app-btn"') < INDEX.indexOf('</header>'), 'it sits in the header');
  // The net dialog uses the same helpers and the same .pris-dialog CSS: both must survive.
  assert.ok(/function openDlg\(/.test(INDEX) && /<dialog id="netDialog"/.test(INDEX) && /\.pris-dialog\{/.test(INDEX), 'the net dialog is untouched');
  assert.deepEqual([...INDEX.matchAll(/<dialog id="(\w+)"/g)].map(x => x[1]), ['infoModal', 'netDialog'], 'the app dialog is gone; the info modal and the net dialog remain');
  assert.ok(/<meta name="apple-itunes-app" content="app-id=6820474476">/.test(INDEX.slice(0, INDEX.indexOf('</head>'))), 'the Smart App Banner meta is in the shared head, so every page — /download too — carries it');
  // Page views follow the other pages' convention: a GA page_view with the clean path, no bespoke event.
  assert.ok(/pv\('Hent appen','\/download'\)/.test(INDEX), 'page_view for /download');
});



// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-24 pilot: ten city pages, /elpris/<by>
// ─────────────────────────────────────────────────────────────────────────────

const CITY_SLUGS = ['silkeborg', 'svendborg', 'viborg', 'aarhus', 'odense', 'aalborg', 'esbjerg', 'kolding', 'koebenhavn', 'roskilde'];
const cityBlock = () => ROUTES.slice(ROUTES.indexOf('function cityNet('), ROUTES.indexOf('/** The Danish calendar date and clock hour'));

test('cities: the table has the ten pilot cities, ASCII slugs, and every row points at net companies the site prices', () => {
  assert.deepEqual(CITY_TABLE.map(c => c.slug), CITY_SLUGS, 'the ten cities, in the order of the footer');
  const nets = {};
  for (const m of INDEX.matchAll(/\{name:'([^']+)',slug:'([^']+)',gln:'(\d{13})'/g)) nets[m[2]] = { name: m[1], gln: m[3] };
  const dk1 = getNetsFromIndex().DK1, fnGln = new Set([...ROUTES.matchAll(/gln: '(\d{13})'/g)].map(m => m[1]));
  const ALLOWED = { city: ['slug', 'name', 'area', 'samples', 'nets', 'other'], net: ['name', 'gln', 'slug', 'share'], other: ['name', 'share'] };
  for (const c of CITY_TABLE) {
    assert.deepEqual(Object.keys(c).filter(k => !ALLOWED.city.includes(k)), [], `${c.slug}: only slug, name, area, samples, nets, other — nothing personal`);
    assert.ok(/^[a-z]+$/.test(c.slug), `${c.slug}: ASCII letters only`);
    assert.ok(typeof c.name === 'string' && c.name.length >= 3, `${c.slug}: display name`);
    assert.ok(c.area === 'DK1' || c.area === 'DK2', `${c.slug}: price area`);
    assert.ok(Number.isInteger(c.samples) && c.samples >= 8, `${c.slug}: at least 8 addresses were sampled`);
    assert.ok(c.nets.length >= 1, `${c.slug}: a main net company`);
    let sum = 0, prev = 1.0001;
    for (const n of c.nets) {
      assert.deepEqual(Object.keys(n).filter(k => !ALLOWED.net.includes(k)), [], `${c.slug}/${n.slug}: only name, gln, slug, share`);
      assert.deepEqual(nets[n.slug], { name: n.name, gln: n.gln }, `${c.slug}: ${n.slug} is a net company in NETS (index.html) with that name and GLN`);
      assert.ok(fnGln.has(n.gln), `${c.slug}: the server knows GLN ${n.gln}`);
      assert.equal(dk1.includes(n.slug), c.area === 'DK1', `${c.slug}: ${n.slug} belongs to ${c.area}`);
      assert.ok(n.share > 0 && n.share <= prev, `${c.slug}: shares are positive and in descending order`);
      prev = n.share; sum += n.share;
      assert.ok(Math.abs(n.share * c.samples - Math.round(n.share * c.samples)) < 0.11, `${c.slug}/${n.slug}: share ${n.share} is a whole number of the ${c.samples} samples`);
    }
    for (const o of c.other || []) {
      assert.deepEqual(Object.keys(o).filter(k => !ALLOWED.other.includes(k)), [], `${c.slug}/${o.name}: only name and share`);
      assert.ok(!nets[o.name.toLowerCase()] && !Object.values(nets).some(n => n.name === o.name), `${c.slug}: ${o.name} is "other" and so must not be a net we price`);
      sum += o.share;
    }
    assert.ok(Math.abs(sum - 1) < 0.011, `${c.slug}: shares add up to 1 (got ${sum.toFixed(3)})`);
    assert.equal(new Set(c.nets.map(n => n.slug)).size, c.nets.length, `${c.slug}: no net listed twice`);
  }
  assert.equal(new Set(CITY_TABLE.map(c => c.name)).size, 10, 'distinct names');
});

test('cities: the table says where the numbers come from, how few they are, and how to reproduce them', () => {
  const head = CITIES_SRC.slice(0, CITIES_SRC.indexOf('export const'));
  assert.ok(/Green Power Denmark/.test(head) && /supplierlookup/.test(head), 'the source of the answers');
  assert.ok(/2026-10-24/.test(head), 'the date of the lookups');
  assert.ok(/node scripts\/city-nets\.mjs/.test(head), 'how to reproduce');
  assert.ok(/SMALL SAMPLE/.test(head) && /never printed or stored/.test(head), 'honest about the sample size, and about addresses');
});

test('cities: the sampling script prints counts only — no address is printed, written or kept', () => {
  const S = fs.readFileSync(path.join(ROOT, 'scripts', 'city-nets.mjs'), 'utf8');
  const logs = [...S.matchAll(/console\.(log|error|warn|info)\(([^\n]*)\)/g)].map(m => m[2]);
  assert.deepEqual(logs, ['JSON.stringify({ slug, samples: n, noAnswer: unknown, nets })'], 'the one thing it prints');
  assert.ok(!/writeFile|appendFile|createWriteStream/.test(S), 'it writes no file');
  assert.ok(/'User-Agent': 'elpriser\.org\/1\.0 \(\+https:\/\/elpriser\.org; hello@elpriser\.org\)'/.test(S), 'Nominatim sees the site\'s User-Agent');
  assert.ok(/Date\.now\(\) \+ 1100|last \+ 1100/.test(S), 'at most one Nominatim request per second');
});

test('cities: one path through SEO entries, sitemap, llms.txt, server.js, the router and the net pages — and no /elpris hub', () => {
  assert.ok(/import \{ CITIES \} from '\.\/_cities\.js'/.test(ROUTES), 'the function imports the table');
  assert.ok(/for \(const c of CITIES\) SEO_PAGES\['\/elpris\/' \+ c\.slug\] = \{ \.\.\.cityMeta\(c\), city: c \}/.test(ROUTES), 'SEO_PAGES entries are generated from the table');
  assert.ok(/\.\.\.CITY_URLS,?\s*\]/.test(ROUTES) && /CITY_URLS = CITIES\.map\(c => '\/elpris\/' \+ c\.slug\)/.test(ROUTES), 'the sitemap spreads the generated URLs');
  assert.ok(/CITY_PATH\.test\(p\)\) return '0\.5'/.test(ROUTES), 'priority 0.5');
  assert.ok(/CITIES\.map\(c => `\[\$\{c\.name\}\]\(https:\/\/elpriser\.org\/elpris\/\$\{c\.slug\}\)`\)/.test(ROUTES), 'llms.txt links every city, generated from the table');
  assert.ok(!/'\/elpris'\s*[:\]]/.test(ROUTES) && !/'\/elpris',/.test(ROUTES), 'there is no /elpris hub: no SEO entry, sitemap URL or static route');
  assert.ok(/CITY_SLUGS/.test(SERVER) && /functions\/_cities\.js/.test(SERVER) && /pathname\.startsWith\('\/elpris\/'\)/.test(SERVER), 'server.js routes /elpris/<by> from the same table');
  // The browser: one route key per city ('elpris/<by>'), one section for all of them, nothing to remember.
  assert.ok(/\^\\\/elpris\\\/\[a-z0-9-\]\+\$\/\.test\(p\)\)return p\.slice\(1\)/.test(INDEX), 'pathToHash maps /elpris/<by> to the key elpris/<by>');
  assert.ok(/\/\^elpris\\\/\/\.test\(h\)\)return 'city'/.test(INDEX), 'dataPageFor maps the key to the shared city section');
  assert.ok(/\(dk\[12\]\|elpris\)/.test(INDEX), 'a city path counts as a path this site serves');
  assert.equal((INDEX.match(/<main[^>]*data-page="city"/g) || []).length, 1, 'ONE <main data-page="city"> for all ten cities');
  const main = mainOf('city');
  assert.ok(main.indexOf('<!--SSR_CITY_HEAD-->') < main.indexOf('data-pris-mount') && main.indexOf('data-pris-mount') < main.indexOf('<!--SSR_CITY-->'), 'heading, then the Pris screen, then the text');
  assert.ok(!/<h[1-6]/.test(main) && !CITY_TABLE.some(c => main.includes(c.name)) && !/\d/.test(textOf(main)), 'the shared section carries no heading, no city name, no number: all of it is written per city');
  const router = INDEX.slice(INDEX.indexOf("if(/^elpris\\//.test(h)){"), INDEX.indexOf("const p=h.split('/'),area=p[0]"));
  assert.ok(router.length > 50 && !/document\.title\s*=/.test(router) && !/rememberNet|saveNetPick/.test(router), 'the city route keeps the server\'s title and does not save the city\'s net as the visitor\'s own');
  assert.ok(/const city=\/\^elpris\\\/\/\.test\(h\|\|''\)\?document\.querySelector\('\[data-page="city"\]'\):null;/.test(INDEX) && /city\.dataset\.area/.test(INDEX) && /city\.dataset\.net/.test(INDEX), 'the chip and the Pris screen take the city\'s net from the section the server wrote');
  assert.ok(/function rememberNetFromHash\(h\)\{\s*const m=\/\^\(DK\[12\]\)/.test(INDEX), 'rememberNetFromHash only accepts DK routes, so visiting a city page never changes the remembered net');
  // The net pages link back: "Byer i området".
  assert.ok(/CITIES\.filter\(c => c\.area === area && c\.nets\.some\(\(x, i\) => x\.slug === net\.slug && \(i === 0 \|\| x\.share >= CITY_LINK_SHARE\)\)\)/.test(ROUTES) && /const CITY_LINK_SHARE = 0\.25;/.test(ROUTES) && /Byer i området: /.test(ROUTES), 'net pages list the cities whose main net company they are, and those where they have at least a quarter of the sampled addresses');
});

test('cities: the footer\'s Byer links carry the display names of the table', () => {
  const m = FOOTER.match(/<p class="sf-h">Byer<\/p>\s*<ul class="sf-chips">([\s\S]*?)<\/ul>/);
  assert.ok(m, 'Byer group in the collapsed footer list');
  const links = [...m[1].matchAll(/<li><a href="\/elpris\/([a-z]+)">([^<]+)<\/a><\/li>/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(links, CITY_TABLE.map(c => [c.slug, c.name]));
});

test('cities: the generator writes data and API figures only — no ten-day horizon, no Dataset/spatialCoverage/FAQ, no invented numbers', () => {
  const gen = cityBlock(), meta = ROUTES.slice(ROUTES.indexOf('function cityMeta('), ROUTES.indexOf('for (const c of CITIES) SEO_PAGES'));
  const render = ROUTES.slice(ROUTES.indexOf('\n  if (opts.city) {'), ROUTES.indexOf('\n  if (opts.zonePage || opts.norden) {'));
  for (const [name, src] of [['cityHTML', gen], ['cityMeta', meta], ['the city block of renderSPA', render]]) {
    assert.ok(src.length > 200 || name === 'cityMeta', `${name} found`);
    assert.ok(!/10 døgn|10 dage|10-dag|ti døgn|slice\(0, 10\)|Math\.min\(10/.test(src), `${name}: no ten-day horizon`);
    assert.ok(!/Dataset|spatialCoverage|FAQPage|"Question"|'Question'|PriceSpecification|areaServed/.test(src), `${name}: no Dataset, spatialCoverage, FAQPage or PriceSpecification`);
    assert.ok(!/indbygger|befolkning|population|husstande|kommune/i.test(src), `${name}: no population or municipality claims`);
    assert.ok(!/\b\d{4,}\b/.test(src.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d*\.\d+/g, '')), `${name}: no number of four digits or more written into the prose`);
  }
  assert.ok(/main\.share < 0\.75/.test(gen), 'the net-varies-by-address threshold is 0.75');
  assert.ok(/Math\.min\(5, all\.length\)/.test(gen), 'the outlook is at most five days');
  assert.ok(/'@type': 'City'/.test(render) && /containedInPlace: \{ '@type': 'Country', name: 'Danmark' \}/.test(render) && /inLanguage: 'da'/.test(render), 'WebPage about a City in Danmark, in Danish');
  assert.ok(/onclick="openNetDialog\(\)"/.test(gen) && /Er dit netselskab et andet\? Skift/.test(gen), 'the button that opens the existing net chooser');
  assert.ok(/href="\/om-elpriser"|'\/om-elpriser'/.test(gen), 'links the explainer');
  assert.ok(/<h1 class="page-title">Elpris i \$\{c\.name\} i dag — time for time<\/h1>/.test(gen), 'the h1');
});



console.log('\n⚡ Static integrity tests\n' + '─'.repeat(50));
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '\n   └─ ' + r.msg}`);
}
console.log('─'.repeat(50));

console.log(`\n${_passed} passed, ${_failed} failed\n`);
process.exit(_failed > 0 ? 1 : 0);