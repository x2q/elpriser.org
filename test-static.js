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

test('homepage: the 7-day forecast section is server-rendered, not JS-only', () => {
  // The section exists to answer "elpriser prognose" searches that land on the
  // homepage. Rows that appear only after JS runs would not do that, so the
  // placeholder and the code that fills it both have to be present.
  assert.ok(INDEX.includes('<!--SSR_FORECAST_ROWS-->'),
    'index.html lost the SSR_FORECAST_ROWS placeholder');
  assert.ok(/<div class="fc" id="homeForecast">/.test(INDEX),
    'the forecast container is missing from the homepage');
  assert.ok(INDEX.includes('Næste 7 døgn'), 'the section heading is missing');
  const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  assert.ok(ROUTES_SRC.includes('function buildForecastRows('),
    'functions/[[path]].js no longer builds the forecast rows');
  assert.ok(ROUTES_SRC.includes("html.replace('<!--SSR_FORECAST_ROWS-->'"),
    'the server never substitutes SSR_FORECAST_ROWS');
});

test('homepage: forecast-row styles are hand-written, not Tailwind utilities', () => {
  // These classes only ever appear in JS-generated and server-generated markup,
  // which Tailwind does not scan — utilities would be purged out of style.css
  // and the section would render unstyled.
  const style = INDEX.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style, 'no <style> block in index.html');
  for (const cls of ['.fc-row', '.fc-day', '.fc-tag', '.fc-min', '.fc-max',
                     '.fc-bar', '.fc-badge', '.fc-spacer', '.fc-wrap', '.fc-head']) {
    assert.ok(style[1].includes(cls + '{') || style[1].includes(cls + ','),
      `${cls} is not defined in the hand-written style block`);
  }
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

console.log('\n⚡ Static integrity tests\n' + '─'.repeat(50));
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '\n   └─ ' + r.msg}`);
}
console.log('─'.repeat(50));
console.log(`\n${_passed} passed, ${_failed} failed\n`);
process.exit(_failed > 0 ? 1 : 0);
