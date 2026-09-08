#!/usr/bin/env node
/**
 * Live URL health check for elpriser.org.
 * Run: npm run test:urls            (against production)
 *      BASE_URL=http://localhost:8788 npm run test:urls
 *
 * The other suites check the source. This one checks what is actually being
 * served, which is where a whole class of problem lives: a page can be built
 * correctly and still be routed wrong, canonicalised at the homepage, served
 * with every section of the SPA attached, or quietly published alongside the
 * repository it was built from. None of that is visible in the source.
 *
 * URLs are discovered, not listed: the sitemap plus every internal link found
 * on the pages it names. A page that stops being linked, or one that appears
 * without being added here, is then still covered.
 */
'use strict';

const BASE = (process.env.BASE_URL || 'https://elpriser.org').replace(/\/$/, '');
// Canonical tags name the production origin whatever host serves the page —
// that is the point of a canonical — so they are checked against this, not
// against BASE. Otherwise every page "fails" when run against a preview
// deployment or localhost, and the check becomes noise you learn to ignore.
const CANONICAL_ORIGIN = 'https://elpriser.org';
const UA = 'elpriser-urltest/1.0 (+https://elpriser.org)';
const CONCURRENCY = 6;

let passed = 0;
const failures = [];

function check(ok, name, detail) {
  if (ok) { passed++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
}

async function get(path, redirect = 'manual') {
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await fetch(url, { redirect, headers: { 'User-Agent': UA } });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('text') || type.includes('json') || type.includes('xml')
    ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), type, body, url };
}

/** Run `fn` over `items` with a small pool, so a 60-URL sweep is not 60 round trips. */
async function pool(items, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) out.push(await fn(items[i++]));
  }));
  return out;
}

const one = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const all = (html, re) => [...html.matchAll(re)].map(m => m[1]);

// ── discovery ───────────────────────────────────────────────────────────────

async function discover() {
  const sm = await get('/sitemap.xml');
  if (sm.status !== 200) throw new Error(`sitemap.xml returned ${sm.status}`);
  const sitemap = all(sm.body, /<loc>([^<]+)<\/loc>/g)
    .map(u => u.replace(/^https?:\/\/[^/]+/, '') || '/');

  // Follow the links the pages actually carry, so an unlisted page still gets
  // checked and a link to a page that no longer exists is caught.
  const linked = new Set();
  await pool(sitemap, async p => {
    const r = await get(p);
    if (r.status !== 200) return;
    for (const href of all(r.body, /href="(\/[^"#?]*)"/g)) {
      if (/\.(css|png|ico|svg|json|xml|txt)$/.test(href)) continue;
      if (href.startsWith('/api/')) continue;          // covered explicitly below
      if (href.includes('${')) continue;               // template literal in inline JS
      linked.add(href);
    }
  });
  const extra = [...linked].filter(p => !sitemap.includes(p));
  return { sitemap, extra };
}

// ── checks ──────────────────────────────────────────────────────────────────

async function checkPage(path, { expectStart = false } = {}) {
  const r = await get(path);
  const label = `page ${path}`;
  if (!check(r.status === 200, label, `status ${r.status}`)) return null;

  const canonical = one(r.body, /<link rel="canonical" href="([^"]*)"/);
  const wantCanonical = CANONICAL_ORIGIN + (path === '/' ? '/' : path);
  check(canonical === wantCanonical, label,
        `canonical is ${canonical}, expected ${wantCanonical}`);

  const title = one(r.body, /<title>([^<]*)<\/title>/);
  check(!!title && title.trim().length > 0, label, 'empty <title>');

  const h1s = (r.body.match(/<h1[\s>]/g) || []).length;
  check(h1s === 1, label, `${h1s} <h1> elements, expected 1`);

  // The server keeps only the section the URL belongs to. More than one main
  // means the page ships every other page's body too — which Google reads as
  // near-identical duplicates across the site.
  const mains = all(r.body, /<main[^>]*data-page="([^"]+)"/g);
  check(mains.length === 1, label, `${mains.length} <main> sections: ${mains.join(', ')}`);

  // A page rendering the start section under its own title is the signature of
  // a missing HASH_TO_DATA_PAGE entry: URL right, canonical right, body wrong.
  if (!expectStart) {
    check(mains[0] !== 'start', label, 'serves the start section instead of its own');
  }
  return { title, mains, body: r.body };
}

async function main() {
  console.log(`URL-tjek mod ${BASE}\n`);
  const { sitemap, extra } = await discover();

  console.log(`1. SIDER I SITEMAP (${sitemap.length})`);
  const pages = await pool(sitemap, p => checkPage(p, { expectStart: p === '/' }));

  const titles = new Map();
  pages.forEach((r, i) => {
    if (!r) return;
    const prev = titles.get(r.title);
    // Two URLs with one title is how duplicate content starts.
    check(!prev, `title ${sitemap[i]}`, `same <title> as ${prev}`);
    titles.set(r.title, sitemap[i]);
  });

  console.log(`\n2. SIDER LINKET, MEN IKKE I SITEMAP (${extra.length})`);
  if (extra.length) {
    // Not automatically wrong — but a linked page missing from the sitemap is
    // usually an oversight, and a link to a dead page is always a bug.
    for (const p of extra) {
      const r = await get(p);
      check(r.status === 200, `linket side ${p}`, `status ${r.status}`);
    }
    console.log(`   ${extra.join(', ')}`);
  }

  console.log('\n3. STATISKE FILER');
  const assets = [
    ['/style.css', 'text/css'], ['/favicon.ico', 'image'], ['/favicon.svg', 'image/svg'],
    ['/favicon-32.png', 'image/png'], ['/favicon-192.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'], ['/og-image.png', 'image/png'],
    ['/og-image', 'image/svg'], ['/sitemap.xml', 'xml'], ['/robots.txt', 'text/plain'],
    ['/llms.txt', 'text/plain'], ['/llms-full.txt', 'text/plain'],
  ];
  await pool(assets, async ([p, type]) => {
    const r = await get(p);
    check(r.status === 200 && r.type.includes(type), `asset ${p}`,
          `status ${r.status}, type ${r.type}`);
  });

  console.log('\n4. API');
  const apis = [
    '/api/now?area=DK1', '/api/prices?area=DK1', '/api/prices?area=DK2&date=2025-01-15',
    '/api/schedule?area=DK1&hours=6', '/api/forecast?area=DK1',
    '/api/shelly/tariff?area=DK1', '/api/openapi.json',
    '/api/nordic?zone=se3', '/api/tariffs?country=no', '/api/tariffs?country=se',
  ];
  await pool(apis, async p => {
    const r = await get(p);
    if (!check(r.status === 200, `api ${p}`, `status ${r.status}`)) return;
    try { JSON.parse(r.body); } catch { check(false, `api ${p}`, 'ugyldig JSON'); }
  });

  console.log('\n5. NORMALISERING — dubletter må ikke svare 200');
  const redirects = [
    ['/dk1/', '/dk1'], ['/se1/', '/se1'], ['/tariffer/', '/tariffer'],
    ['/dk1/n1/', '/dk1/n1'], ['/DK1', '/dk1'], ['/blog/', '/blog'],
  ];
  await pool(redirects, async ([from, to]) => {
    const r = await get(from);
    check(r.status === 301 && r.location === BASE + to, `redirect ${from}`,
          `status ${r.status} -> ${r.location}`);
  });

  console.log('\n6. UKENDTE STIER SKAL 404');
  const gone = ['/norden', '/findes-ikke', '/dk1/ukendt-net', '/blog/ukendt-indlaeg'];
  await pool(gone, async p => {
    const r = await get(p);
    check(r.status === 404, `404 ${p}`, `status ${r.status}`);
  });

  console.log('\n7. REPO-FILER MÅ IKKE VÆRE PÅ SITET');
  // `wrangler pages deploy .` once uploaded the whole working directory, which
  // served the iOS app's sources, every script and wrangler.toml over HTTPS.
  const secret = [
    '/package.json', '/server.js', '/wrangler.toml', '/DESIGN.md',
    '/test-static.js', '/package-lock.json', '/tailwind.config.cjs',
    '/scripts/forecast_model/train_and_score.py',
    '/scripts/forecast_model/nordic/fetch_prices.py',
    '/ElpriserApp/ElpriserApp/ElpriserApp.swift',
  ];
  await pool(secret, async p => {
    const r = await get(p);
    check(r.status === 404, `ikke publiceret ${p}`, `status ${r.status}`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`${passed} beståede, ${failures.length} fejl`);
  if (failures.length) {
    console.log('\nFEJL:');
    failures.forEach(f => console.log(`  ✗ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
