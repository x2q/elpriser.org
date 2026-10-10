#!/usr/bin/env node
/**
 * Regression suite — guards against the bug classes fixed in the last few
 * weeks. Each test cites the commit it would have caught.
 *
 *   1. Static source checks   — fast, no server needed (grep-based)
 *   2. Browser flow tests     — needs wrangler + Playwright (GPS detect)
 *
 * The /api/* endpoint tests live in test-api.mjs (hermetic, no server).
 *
 * Run: npm run test:regressions
 *
 * Auto-starts `wrangler pages dev` on :8788 for the duration of the run, or
 * reuses an existing one if already running.
 */

'use strict';

const { spawn }    = require('node:child_process');
const fs           = require('node:fs');
const http         = require('node:http');
const path         = require('node:path');
const assert       = require('node:assert/strict');
const { chromium } = require('playwright');

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;
const ROOT = __dirname;

let _passed = 0, _failed = 0;
async function test(name, fn) {
  try {
    await fn();
    _passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    _failed++;
    const msg = (e.message || String(e)).split('\n')[0];
    console.log(`  ❌ ${name}\n     └─ ${msg}`);
  }
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── Server boot ──────────────────────────────────────────────────────────────

function isUp() {
  return new Promise(r => {
    const req = http.get(BASE, () => r(true)).on('error', () => r(false));
    req.setTimeout(500, () => { req.destroy(); r(false); });
  });
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${label || 'condition'}`);
}

async function startWrangler() {
  if (await isUp()) {
    console.log(`ℹ Reusing existing server on :${PORT}`);
    return null;
  }
  console.log(`ℹ Starting wrangler pages dev on :${PORT} (≈10s)…`);
  const child = spawn('npx',
    ['wrangler', 'pages', 'dev', '.', `--port=${PORT}`,
     '--compatibility-date=2024-01-01'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', e => { console.error('wrangler spawn failed:', e); process.exit(1); });
  await waitFor(isUp, 60_000, 'wrangler ready');
  return child;
}

// ── 1. STATIC SOURCE CHECKS ──────────────────────────────────────────────────
//
// These don't need a server — they grep the source for the patterns that
// caused the original bugs. They run instantly and give precise pointers.

async function staticChecks() {
  section('Static source checks');

  const indexHtml      = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const apiCatchall    = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const detectFn       = (() => {
    const m = indexHtml.match(/async function detectLocation\(\)\{[\s\S]+?\n\}/);
    if (!m) throw new Error('detectLocation() not found in index.html');
    return m[0];
  })();

  // ── e194eaf: GPS detect must use watchPosition, not getCurrentPosition ────
  await test('detectLocation uses watchPosition (not getCurrentPosition) — guards e194eaf',
    () => {
      assert.ok(/navigator\.geolocation\.watchPosition/.test(detectFn),
        'detectLocation must call navigator.geolocation.watchPosition');
      assert.ok(!/navigator\.geolocation\.getCurrentPosition/.test(detectFn),
        'detectLocation must NOT call getCurrentPosition — it aborts on transient ' +
        'kCLErrorLocationUnknown errors. Use watchPosition + outer timeout instead.');
    });

  // ── 75fd5c9: Browser must not call CORS-blocked upstreams directly ───────
  await test('detectLocation does not fetch upstream APIs directly — guards 75fd5c9 (CORS)',
    () => {
      const directCalls = [
        ['greenpowerdenmark.dk', 'GreenPowerDenmark supplier API has no CORS headers'],
        ['nominatim.openstreetmap.org', 'OpenStreetMap reverse-geocode (Nominatim) is done server-side'],
        ['dawa.aws.dk',          'DAWA was shut down on 2026-07-01 and must not be called at all'],
      ];
      for (const [host, why] of directCalls) {
        assert.ok(!new RegExp(host.replace('.', '\\.')).test(detectFn),
          `detectLocation must not fetch ${host} directly — ${why}. ` +
          `Route through /api/supplierlookup instead.`);
      }
      assert.ok(/\/api\/supplierlookup/.test(detectFn),
        'detectLocation must call /api/supplierlookup');
    });

  // ── No browser-side fetches to api.energidataservice.dk (guards "Fejl ved hentning af data") ─
  // EDS returns empty 200 with no CORS headers when an Origin header is sent.
  // All EDS access must go through /api/raw/* on our origin instead.
  await test('no inline scripts fetch api.energidataservice.dk directly — guards EDS-CORS',
    () => {
      // Only inspect <script>…</script> blocks (the live HTML body has prose
      // mentions of energidataservice.dk in <a href="…"> which are fine).
      const scriptBlocks = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1]).join('\n');
      const offending = [...scriptBlocks.matchAll(/api\.energidataservice\.dk[^\s"'`)]*/g)]
        .map(m => m[0]);
      assert.deepEqual(offending, [],
        `Inline script(s) still call api.energidataservice.dk directly — EDS returns ` +
        `empty 200 with no CORS headers when Origin is sent, surfacing as ` +
        `"Fejl ved hentning af data". Route through /api/raw/* instead.\n` +
        `Found: ${offending.slice(0, 3).join(', ')}`);
    });

  // ── 75fd5c9: Server-side address normalisation guard ─────────────────────
  await test('buildGpdAddress replaces dots with spaces (not strips) — guards 75fd5c9',
    () => {
      const fn = apiCatchall.match(/function buildGpdAddress\([\s\S]+?\n\}/);
      assert.ok(fn, 'buildGpdAddress() not found');
      // Replacing with empty string is the bug we just fixed: "P.O." → "PO"
      // returns 500/404 from GPD; "P.O." → "P O" returns 200.
      assert.ok(!/replace\(\/\\\.\/g,\s*['"]['"]\)/.test(fn[0]),
        'buildGpdAddress strips dots — must REPLACE them with spaces ' +
        '(GPD returns 500 for "PO Pedersens Vej" but 200 for "P O Pedersens Vej").');
      assert.ok(/replace\(\/\\\.\/g,\s*['"] ['"]\)/.test(fn[0]),
        'buildGpdAddress must replace dots with " " (space)');
    });

  // ── 54646d5: All "Startside" home icons href to "/" not "#" ──────────────
  await test('every home icon href="/" (not href="#") — guards 54646d5',
    () => {
      const links = [...indexHtml.matchAll(/<a\s+href="([^"]+)"\s+title="Startside"/g)];
      assert.ok(links.length > 0, 'no <a title="Startside"> links found at all — markup changed?');
      const broken = links.filter(m => m[1] !== '/');
      assert.equal(broken.length, 0,
        `${broken.length} home icon(s) still href="${broken[0]?.[1]}" instead of "/" — ` +
        `breaks return-to-start from clean-URL pages like /dk1/n1.`);
    });

  // ── 12c1057: SEO renderer must NOT inject the legacy hash-redirect ───────
  await test('functions/[[path]].js has no /#hash redirect script — guards 12c1057',
    () => {
      const seoPath = path.join(ROOT, 'functions/[[path]].js');
      if (!fs.existsSync(seoPath)) return; // optional
      const src = fs.readFileSync(seoPath, 'utf8');
      assert.ok(!/location\.replace\(['"`]\/#/.test(src),
        'functions/[[path]].js still injects location.replace("/#…") — ' +
        'this clobbers crawlable URLs (bug 12c1057). Derive route from pathname instead.');
    });

  // ── e194eaf: detectLocation must have outer timeout (not just per-attempt) ─
  await test('detectLocation has outer setTimeout for runaway watchPosition — guards e194eaf',
    () => {
      // Match setTimeout(<callback>, <delay>) where delay is 4+ digits. The
      // callback may include parens, so we use a lazy [\s\S] across them.
      assert.ok(/setTimeout\([\s\S]+?,\s*\d{4,}/.test(detectFn),
        'detectLocation must include an outer setTimeout (≥1000ms) so a stuck ' +
        'watchPosition does not hang forever.');
    });

  // ── 75fd5c9: catchall function must declare CORS headers ─────────────────
  await test('/api/* responses include Access-Control-Allow-Origin: * — guards 75fd5c9',
    () => {
      assert.ok(/Access-Control-Allow-Origin['"]\s*:\s*['"]\*/.test(apiCatchall),
        'catchall must set Access-Control-Allow-Origin: * for cross-origin proxy use.');
    });
}

// ── 2. API ENDPOINT TESTS — moved to test-api.mjs ────────────────────────────
//
// They ran here against `wrangler pages dev`, so their result depended on the
// network and on what Energi Data Service happened to answer. test-api.mjs runs
// the same handler in-process with its upstreams faked, which is what makes a
// red result mean something.

// ── 3. BROWSER FLOW TESTS (GPS detect) ───────────────────────────────────────

async function browserTests() {
  section('Browser flow — GPS detect with stubbed geolocation');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r =>
    /googletagmanager|google-analytics/.test(r.request().url())
      ? r.abort() : r.continue());
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);

  // Helper: install stubs in the page, run detectLocation, return state.
  async function runWithStubs(stubScript) {
    // The previous test leaves the page mid-navigation (detectLocation ends by
    // setting location.hash/href). Going straight to '/' from there aborts with
    // net::ERR_ABORTED, so start each test from a blank page.
    await page.goto('about:blank');
    await page.goto(BASE + '/');
    return await page.evaluate(async (script) => {
      // eslint-disable-next-line no-new-func
      const setup = new Function(script);
      const ctx = setup();
      const t0 = Date.now();
      try { await window.detectLocation(); } catch (e) { ctx.error = String(e); }
      ctx.elapsed = Date.now() - t0;
      ctx.finalText = document.getElementById('gpsText').textContent;
      ctx.btnDisabled = document.getElementById('gpsBtn').disabled;
      ctx.hash = location.hash;
      return ctx;
    }, stubScript);
  }

  // ── e194eaf: transient kCLErrorLocationUnknown must not abort ────────────
  await test('survives 3× transient POSITION_UNAVAILABLE → succeeds — guards e194eaf',
    async () => {
      const r = await runWithStubs(`
        const ctx = { wpCalls: 0, errors: 0 };
        navigator.geolocation.watchPosition = (ok, no) => {
          const id = setInterval(() => {
            ctx.wpCalls++;
            if (ctx.wpCalls < 4) { ctx.errors++; no({code:2, message:'Position unavailable'}); }
            else { clearInterval(id); ok({coords:{latitude:55.6761, longitude:12.5683}}); }
          }, 30);
          return id;
        };
        navigator.geolocation.clearWatch = id => clearInterval(id);
        const f = window.fetch;
        window.fetch = (u, i) => (typeof u === 'string' && u.startsWith('/api/'))
          ? Promise.resolve({ json: async () => ({ name: 'Radius Elnet A/S', address: 'X 1, 1000 København K' }) })
          : f(u, i);
        return ctx;
      `);
      assert.equal(r.errors, 3, `expected 3 transient errors before success, saw ${r.errors}`);
      assert.ok(r.hash.length > 0, `expected navigation, hash=${r.hash}`);
      assert.equal(r.btnDisabled, false, 'button must be re-enabled after success');
    });

  // ── e194eaf: PERMISSION_DENIED must fail fast (not wait 15s) ─────────────
  await test('PERMISSION_DENIED fails fast (<2s, not the 15s timeout) — guards e194eaf',
    async () => {
      const r = await runWithStubs(`
        const ctx = {};
        navigator.geolocation.watchPosition = (ok, no) => {
          setTimeout(() => no({code:1, message:'denied'}), 30);
          return 1;
        };
        navigator.geolocation.clearWatch = () => {};
        // detectLocation falls back to an IP-based position (/api/geo) when the
        // browser denies. Without a stub that answers depends on where the test
        // runs, so say explicitly that the IP lookup finds nothing.
        const f = window.fetch;
        window.fetch = (u, i) => (typeof u === 'string' && u.startsWith('/api/geo'))
          ? Promise.resolve({ json: async () => ({ lat: null, lng: null }) })
          : f(u, i);
        return ctx;
      `);
      assert.ok(r.elapsed < 2000,
        `PERMISSION_DENIED took ${r.elapsed}ms — should fail fast, not wait for the 15s timeout`);
      assert.match(r.finalText, /nægt/i, `expected "nægtet" message, got "${r.finalText}"`);
    });

  // ── the IP fallback that makes a denied permission non-fatal ─────────────
  await test('PERMISSION_DENIED with an IP position → approximate lookup instead of an error',
    async () => {
      const r = await runWithStubs(`
        const ctx = { geoCalls: 0, lookups: 0 };
        navigator.geolocation.watchPosition = (ok, no) => {
          setTimeout(() => no({code:1, message:'denied'}), 30);
          return 1;
        };
        navigator.geolocation.clearWatch = () => {};
        const f = window.fetch;
        window.fetch = (u, i) => {
          if (typeof u !== 'string') return f(u, i);
          if (u.startsWith('/api/geo')) { ctx.geoCalls++; return Promise.resolve({ json: async () => ({ lat: 55.676, lng: 12.568 }) }); }
          if (u.startsWith('/api/supplierlookup')) { ctx.lookups++; return Promise.resolve({ json: async () => ({ name: 'Radius Elnet A/S', address: 'X' }) }); }
          return f(u, i);
        };
        return ctx;
      `);
      assert.equal(r.geoCalls, 1, 'expected one IP-position request');
      assert.equal(r.lookups, 1, 'expected the approximate position to be looked up');
      assert.ok(r.hash.length > 0, `expected navigation, hash=${r.hash}`);
      assert.doesNotMatch(r.finalText, /nægt/i, 'a denied permission must not be a dead end when the IP position works');
    });

  // ── e194eaf: getCurrentPosition is not used (runtime check, complements static) ─
  await test('detectLocation never calls getCurrentPosition at runtime — guards e194eaf',
    async () => {
      const r = await runWithStubs(`
        const ctx = { gcp: 0, wp: 0 };
        const realGcp = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (...a) => { ctx.gcp++; return realGcp(...a); };
        navigator.geolocation.watchPosition = (ok) => { ctx.wp++; setTimeout(()=>ok({coords:{latitude:55.6,longitude:12.5}}),20); return 1; };
        navigator.geolocation.clearWatch = () => {};
        const f = window.fetch;
        window.fetch = (u, i) => (typeof u === 'string' && u.startsWith('/api/'))
          ? Promise.resolve({ json: async () => ({ name: 'Radius Elnet A/S', address: 'X' }) })
          : f(u, i);
        return ctx;
      `);
      assert.equal(r.gcp, 0, 'detectLocation must not call getCurrentPosition');
      assert.equal(r.wp, 1, 'detectLocation must call watchPosition exactly once');
    });

  // ── 75fd5c9: detectLocation routes via /api/* (no direct upstream calls) ─
  await test('detectLocation calls /api/supplierlookup, never upstream directly — guards 75fd5c9',
    async () => {
      const r = await runWithStubs(`
        const ctx = { calls: [] };
        navigator.geolocation.watchPosition = (ok) => { setTimeout(()=>ok({coords:{latitude:55.6,longitude:12.5}}),10); return 1; };
        navigator.geolocation.clearWatch = () => {};
        const f = window.fetch;
        window.fetch = (u, i) => {
          const url = typeof u === 'string' ? u : u.url;
          ctx.calls.push(url);
          if (url.startsWith('/api/'))
            return Promise.resolve({ json: async () => ({ name: 'Radius Elnet A/S', address: 'X' }) });
          return f(u, i);
        };
        return ctx;
      `);
      const direct = r.calls.filter(u => /greenpowerdenmark|nominatim\.openstreetmap|dawa\.aws/i.test(u));
      assert.deepEqual(direct, [],
        `detectLocation made ${direct.length} direct upstream call(s) — must proxy via /api/*: ${direct.join(', ')}`);
      const proxied = r.calls.filter(u => u.includes('/api/supplierlookup'));
      assert.equal(proxied.length, 1,
        `expected exactly 1 /api/supplierlookup call, saw ${proxied.length}`);
    });

  // ── 75fd5c9: when proxy returns name=null, fall back gracefully ──────────
  await test('upstream-error response (name=null) → area-only navigation, no crash — guards 75fd5c9',
    async () => {
      const r = await runWithStubs(`
        const ctx = {};
        navigator.geolocation.watchPosition = (ok) => { setTimeout(()=>ok({coords:{latitude:55.6,longitude:12.5}}),10); return 1; };
        navigator.geolocation.clearWatch = () => {};
        window.fetch = () => Promise.resolve({ json: async () => ({ name: null, error: 'gpd_404' }) });
        return ctx;
      `);
      assert.match(r.hash, /^#DK[12]\//, `expected fallback to #DK?/…, got "${r.hash}"`);
      assert.equal(r.btnDisabled, false, 'button must be re-enabled even on upstream error');
    });

  // Note: the dynamic home-icon click test is already covered in test-e2e.js
  // (which runs against server.js, where clean-URL routing is mirrored). The
  // static `href="/"` source check above catches the same bug class faster.

  await browser.close();
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n⚡ Regression suite — guards against bugs fixed in the last few weeks\n' +
    '─'.repeat(70));

  // Static checks first — fastest, fail loudly without needing a server
  await staticChecks();

  // Boot wrangler for the browser tests
  let wrangler = null;
  try {
    wrangler = await startWrangler();
    await browserTests();
  } finally {
    if (wrangler) wrangler.kill();
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`${_passed} passed, ${_failed} failed`);
  process.exit(_failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
