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
  const m = INDEX.match(/<h1[^>]*>([^<]+)<\/h1>/);
  assert.ok(m, 'missing <h1>');
  assert.equal(m[1].trim(), 'Elpriser i dag',
    `h1 is "${m[1]}" — a short/ambiguous H1 causes Google to use it as SERP title`);
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

test('crawlable: net-URL pattern in functions matches /dk[12]/slug', () => {
  assert.ok(/\/\^\\\/\(dk\[12\]\)\\\/\(\[a-z0-9-\]\+\)\$\//.test(ROUTES),
    'functions/[[path]].js must match /dk[12]/<slug> for per-net crawlable URLs');
});

test('crawlable: renderSPA helper injects title + canonical + hash redirect', () => {
  // renderSPA must (a) rewrite <title>, <meta description>, canonical,
  // (b) inject the hash-redirect <script>. Without these, crawlers see the
  // generic home meta for every net page and search engines dedupe them.
  const body = ROUTES.match(/async function renderSPA[\s\S]*?^}/m);
  assert.ok(body, 'renderSPA function not found');
  ['<title>', 'description', 'canonical', 'og:title', 'og:description',
   'location.replace'].forEach(needle => {
    assert.ok(body[0].includes(needle),
      `renderSPA missing "${needle}" — crawlers will see stale metadata`);
  });
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
    assert.ok(new RegExp(`<main\\s+data-page="${slug}"`).test(INDEX),
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
  // GPS bar and "Find mig" were merged into one button (gpsBtn carries gps-bar class)
  const gpsBtn = INDEX.match(/id="gpsBtn"[^>]*class="gps-bar\s+mt-(\d+)/);
  assert.ok(gpsBtn, 'gpsBtn not found or gps-bar class/top margin removed');
  assert.ok(parseInt(gpsBtn[1], 10) >= 10,
    `gpsBtn uses mt-${gpsBtn[1]} — should be mt-10 or larger for breathing room`);
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
