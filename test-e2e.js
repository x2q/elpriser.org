#!/usr/bin/env node
/**
 * End-to-end interaction tests for elpriser.org
 * Run: npm run test:e2e
 *
 * Exercises every interactive element on the site — navigation, zone buttons,
 * net chips, FAQ accordions, dropdowns on prices/automation/forecast/shelly
 * pages, week navigation, export tabs — and asserts the UI responds as
 * expected.
 *
 * Auto-starts server.js on :8080 for the duration of the run.
 */

'use strict';

const { spawn }   = require('node:child_process');
const { chromium } = require('playwright');
const assert      = require('node:assert/strict');
const http        = require('node:http');

const BASE = 'http://localhost:8080';
let _passed = 0, _failed = 0;
const results = [];

// ── test runner ──────────────────────────────────────────────────────────────

async function test(name, fn) {
  try { await fn(); _passed++; results.push({ ok: true, name }); }
  catch (e) {
    _failed++;
    results.push({ ok: false, name, msg: e.message || String(e) });
  }
}

// ── server management ────────────────────────────────────────────────────────

async function serverUp() {
  return new Promise(resolve => {
    http.get(BASE, () => resolve(true)).on('error', () => resolve(false));
  });
}

async function startServer() {
  if (await serverUp()) {
    console.log('ℹ server already running on :8080 — reusing');
    return null;
  }
  const server = spawn('node', ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: __dirname,
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('server did not start within 5s')), 5000);
    server.stdout.on('data', d => {
      if (d.toString().includes('Elpris server')) { clearTimeout(t); ok(); }
    });
    server.on('exit', code => {
      clearTimeout(t);
      if (code !== 0) no(new Error(`server exited with code ${code}`));
    });
  });
  return server;
}

// ── tests ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n⚡ E2E interaction tests\n' + '─'.repeat(50));

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    // Block GA + external APIs to keep tests deterministic — we test UI wiring,
    // not upstream data. Real price fetches still work server-side via cache.
    bypassCSP: true,
  });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('googletagmanager') || url.includes('google-analytics')) {
      return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);

  // ── 1. Clean-URL routing (mirrors functions/[[path]].js + server.js) ───────

  for (const [url, dataPage] of [
    ['/',                              'start'],
    ['/prognose',                      'prognose'],
    ['/tariffer',                      'tariffer'],
    ['/automation',                    'automation'],
    ['/om-elpriser',                   'om-elpriser'],
    ['/dk1',                           'prices'],
    ['/dk2',                           'prices'],
    ['/blog/forsta-din-elpris',        'blog-forsta-din-elpris'],
    ['/blog/shelly-elpris-automation', 'blog-shelly-elpris-automation'],
    ['/blog/home-assistant-elpriser',  'blog-home-assistant-elpriser'],
  ]) {
    await test(`nav: ${url} → data-page="${dataPage}" is active`, async () => {
      await page.goto(BASE + url);
      await page.waitForSelector(`main[data-page="${dataPage}"].active`);
    });
  }

  // Per-netselskab crawlable URLs — /dk1/<slug>, /dk2/<slug> must land on
  // the prices page with the correct net pre-selected. URL must stay clean
  // (no /#hash redirect) and state must be derived from the pathname.
  for (const [url, expectedArea, expectedSlug] of [
    ['/dk1/n1',       'DK1', 'n1'],
    ['/dk1/trefor',   'DK1', 'trefor'],
    ['/dk2/radius',   'DK2', 'radius'],
    ['/dk2/cerius',   'DK2', 'cerius'],
  ]) {
    await test(`crawlable: ${url} keeps clean URL + activates correct net`, async () => {
      await page.goto(BASE + url);
      await page.waitForSelector('main[data-page="prices"].active');
      const state = await page.evaluate(() => ({
        pathname: location.pathname,
        hash: location.hash,
        area: typeof S !== 'undefined' ? S.area : undefined,
        mode: typeof S !== 'undefined' ? S.mode : undefined,
        netName: typeof S !== 'undefined' ? S.netName : undefined,
      }));
      assert.equal(state.pathname, url, `pathname must stay ${url}, got ${state.pathname}`);
      assert.equal(state.hash, '', `hash must be empty (clean URL), got ${state.hash}`);
      assert.equal(state.area, expectedArea);
      assert.equal(state.mode, 'net_inkl_alt');
      assert.ok(state.netName, `expected netName to be set for ${expectedSlug}, got "${state.netName}"`);
    });
  }

  // Clean-URL SEO pages must stay clean (regression: hash-redirect previously
  // clobbered /blog/shelly-elpris-automation → /#blog/shelly-elpris-automation)
  for (const url of ['/blog/shelly-elpris-automation', '/blog/forsta-din-elpris',
                     '/blog/home-assistant-elpriser', '/tariffer', '/automation',
                     '/om-elpriser', '/prognose', '/dk1', '/dk2']) {
    await test(`clean-URL: ${url} does NOT redirect to /#hash`, async () => {
      await page.goto(BASE + url);
      const state = await page.evaluate(() => ({
        pathname: location.pathname, hash: location.hash,
      }));
      assert.equal(state.pathname, url, `${url} pathname must persist, got ${state.pathname}`);
      assert.equal(state.hash, '', `${url} must not add hash, got ${state.hash}`);
    });
  }

  // ── 2. Start page — GPS button, zone anchors, net chips, nav pills, FAQ ────

  await page.goto(BASE + '/');

  await test('start: GPS button is a <button>, enabled, clickable', async () => {
    const btn = page.locator('#gpsBtn');
    assert.equal(await btn.evaluate(el => el.tagName), 'BUTTON');
    assert.equal(await btn.isEnabled(), true);
    // Grab click handler — we don't actually click because geolocation can't
    // be auto-granted in headless Chrome without fake coords. But make sure
    // the handler is wired.
    const onclick = await btn.getAttribute('onclick');
    assert.ok(onclick && onclick.includes('detectLocation'),
      'onclick missing detectLocation()');
  });

  await test('start: GPS button label reads "Find dit netselskab automatisk"', async () => {
    const txt = (await page.locator('#gpsText').textContent()).trim();
    assert.equal(txt, 'Find dit netselskab automatisk');
  });

  await test('start: both DK1 and DK2 zone cards render 4 mode anchors each', async () => {
    const dk1 = await page.locator('#dk1-zone a').count();
    const dk2 = await page.locator('#dk2-zone a').count();
    assert.equal(dk1, 4, `DK1 should have 4 mode buttons, got ${dk1}`);
    assert.equal(dk2, 4, `DK2 should have 4 mode buttons, got ${dk2}`);
  });

  for (const [selector, expectedHash] of [
    ['#dk1-zone a:has-text("Inkl alt")',               '#DK1/inkl_alt'],
    ['#dk1-zone a:has-text("Elspot inkl moms")',       '#DK1/spot_inkl'],
    ['#dk1-zone a:has-text("Elspot ex moms")',         '#DK1/spot_ex'],
    ['#dk1-zone a:has-text("Inkl alt minus afgift")',  '#DK1/inkl_alt_minus'],
    ['#dk2-zone a:has-text("Inkl alt")',               '#DK2/inkl_alt'],
    ['#dk2-zone a:has-text("Elspot ex moms")',         '#DK2/spot_ex'],
  ]) {
    await test(`zone: clicking "${selector.split('"')[1]}" navigates to ${expectedHash}`, async () => {
      await page.goto(BASE + '/');
      await page.locator(selector).first().click();
      await page.waitForURL(u => u.hash === expectedHash);
      await page.waitForSelector('main[data-page="prices"].active');
    });
  }

  await test('start: net chips — every net has "Inkl alt" + "Inkl tarif" chips', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#dk1-nets .net-row');
    const rows = await page.locator('#dk1-nets .net-row').count();
    assert.ok(rows >= 10, `DK1 has ${rows} nets, expected ≥10`);
    // Each row has exactly 2 chips
    for (let i = 0; i < rows; i++) {
      const chips = await page.locator('#dk1-nets .net-row').nth(i).locator('.net-chip').count();
      assert.equal(chips, 2, `DK1 row ${i} has ${chips} chips, expected 2`);
    }
  });

  await test('start: clicking a net chip navigates to net_inkl_alt path', async () => {
    await page.goto(BASE + '/');
    await page.locator('#dk1-nets .net-row').first().locator('.net-chip').first().click();
    await page.waitForURL(u => /^#DK1\/net_inkl_alt\//.test(u.hash));
  });

  // Nav pills
  for (const [label, dataPage] of [
    ['Prognose',             'prognose'],
    ['Tariffer',             'tariffer'],
    ['Automation',           'automation'],
    ['Shelly Live Tariff',   'shelly-tariff'],
  ]) {
    await test(`nav pill: "${label}" activates data-page="${dataPage}"`, async () => {
      await page.goto(BASE + '/');
      await page.locator(`.nav-pill:has-text("${label}")`).click();
      await page.waitForSelector(`main[data-page="${dataPage}"].active`);
    });
  }

  // FAQ accordions
  await test('faq: every <details> opens when summary is clicked', async () => {
    await page.goto(BASE + '/');
    const count = await page.locator('details.faq').count();
    assert.ok(count >= 5, `expected ≥5 FAQ items, got ${count}`);
    for (let i = 0; i < count; i++) {
      const d = page.locator('details.faq').nth(i);
      assert.equal(await d.evaluate(el => el.open), false, `faq #${i} starts closed`);
      await d.locator('summary').click();
      assert.equal(await d.evaluate(el => el.open), true, `faq #${i} did not open on click`);
    }
  });

  // ── 3. Prices page — priceSelector dropdown, week nav ──────────────────────

  await test('prices: #priceSelector renders options for every area/mode/net', async () => {
    await page.goto(BASE + '/#DK1/inkl_alt');
    await page.waitForSelector('#priceSelector');
    await page.waitForFunction(() =>
      document.querySelectorAll('#priceSelector option').length >= 20);
    const opts = await page.locator('#priceSelector option').count();
    assert.ok(opts >= 20, `#priceSelector has ${opts} options, expected ≥20`);
  });

  await test('prices: changing #priceSelector updates the URL hash', async () => {
    await page.goto(BASE + '/#DK1/inkl_alt');
    await page.waitForSelector('#priceSelector');
    await page.waitForFunction(() =>
      document.querySelectorAll('#priceSelector option').length >= 20);
    await page.selectOption('#priceSelector', 'DK2/inkl_alt');
    await page.waitForURL(u => u.hash === '#DK2/inkl_alt');
  });

  await test('prices: "Forrige" button changes week and enables "Næste"', async () => {
    await page.goto(BASE + '/#DK1/inkl_alt');
    await page.waitForSelector('button:has-text("Forrige")');
    const labelBefore = await page.locator('#weekLabel').textContent();
    await page.locator('button:has-text("Forrige")').click();
    // waitForFunction until label changes or next button becomes enabled
    await page.waitForFunction(prev => document.getElementById('weekLabel').textContent !== prev, labelBefore);
    const nextDisabled = await page.locator('#nextWeekBtn').isDisabled();
    assert.equal(nextDisabled, false, 'Next button should be enabled after going back a week');
  });

  // ── 4. Automation page — every dropdown + input + button ───────────────────

  await test('automation: #autoArea select exposes DK1 and DK2', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForSelector('#autoArea');
    const vals = await page.locator('#autoArea option').evaluateAll(opts => opts.map(o => o.value));
    assert.deepEqual(vals.sort(), ['DK1', 'DK2']);
    await page.selectOption('#autoArea', 'DK2');
    assert.equal(await page.locator('#autoArea').inputValue(), 'DK2');
  });

  await test('automation: #autoMode exposes 5 pricing modes', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForSelector('#autoMode');
    const vals = await page.locator('#autoMode option').evaluateAll(opts => opts.map(o => o.value));
    ['spot_inkl','inkl_alt','inkl_alt_minus','net_inkl_alt','net_inkl_tarif']
      .forEach(m => assert.ok(vals.includes(m), `#autoMode missing "${m}"`));
  });

  await test('automation: selecting a net_ mode reveals #autoNetRow + populates all nets from DK1+DK2', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForSelector('#autoMode');
    await page.selectOption('#autoMode', 'net_inkl_alt');
    await page.waitForFunction(() =>
      getComputedStyle(document.getElementById('autoNetRow')).display !== 'none');
    // Dropdown should have every net across DK1+DK2 (13 + 3 = 16+)
    await page.waitForFunction(() =>
      document.querySelectorAll('#autoNet option').length >= 14);
    const netCount = await page.locator('#autoNet option').count();
    assert.ok(netCount >= 14, `#autoNet has ${netCount} options, expected ≥14 (all DK1+DK2 nets)`);
  });

  await test('automation: picking a DK2 net auto-switches priszone to DK2', async () => {
    await page.goto(BASE + '/#automation');
    await page.selectOption('#autoMode', 'net_inkl_alt');
    await page.waitForFunction(() =>
      document.querySelectorAll('#autoNet option[data-area="DK2"]').length > 0);
    const dk2Gln = await page.locator('#autoNet option[data-area="DK2"]').first().getAttribute('value');
    await page.selectOption('#autoNet', dk2Gln);
    await page.waitForFunction(() => document.getElementById('autoArea').value === 'DK2');
  });

  await test('automation: #autoDevice dropdown is removed', async () => {
    await page.goto(BASE + '/#automation');
    const count = await page.locator('#autoDevice').count();
    assert.equal(count, 0, 'Enhed dropdown should be gone');
  });

  await test('automation: code examples are syntax-highlighted (hl-* spans present)', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForFunction(() =>
      document.querySelectorAll('#exportHACode .hl-attr').length > 0);
    const haSpans = await page.locator('#exportHACode .hl-attr, #exportHACode .hl-str, #exportHACode .hl-com').count();
    assert.ok(haSpans > 10, `HA code should have many highlighted tokens, got ${haSpans}`);
  });

  await test('automation: Copy preserves raw text (no span markup in clipboard)', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForFunction(() =>
      document.getElementById('exportHACode').dataset.raw);
    const raw = await page.locator('#exportHACode').evaluate(el => el.dataset.raw);
    assert.ok(!raw.includes('<span'), 'raw text should NOT contain span markup');
    assert.ok(raw.includes('sensor:'), 'raw YAML should include sensor:');
  });

  // Helper: set the custom strategy dropdown's value (replaces page.selectOption,
  // which only works on native <select>). The visible label is bound via JS so
  // we drive csPick() directly to mirror a real user click.
  const pickStrategy = async (value) => {
    await page.evaluate(v => {
      const el = document.querySelector(`#autoStrategyMenu .cs-opt[data-value="${v}"]`);
      if (!el) throw new Error(`strategy option ${v} not found`);
      el.click();
    }, value);
  };

  await test('automation: #autoStrategy exposes all 7 strategies (with use-case text)', async () => {
    await page.goto(BASE + '/#automation');
    const opts = await page.locator('#autoStrategyMenu .cs-opt').evaluateAll(els =>
      els.map(e => ({
        value: e.dataset.value,
        label: e.querySelector('.cs-l')?.textContent,
        useCase: e.querySelector('.cs-r')?.textContent,
      })));
    const vals = opts.map(o => o.value);
    ['cheapest_n','cheapest_pct','avoid_expensive_n','avoid_expensive_pct','avoid_peak','night_cheap','fridge']
      .forEach(s => assert.ok(vals.includes(s), `#autoStrategy missing "${s}"`));
    // Every option must have non-empty use-case text on the right side
    opts.forEach(o => assert.ok(o.useCase && o.useCase.trim().length > 0,
      `strategy "${o.value}" missing use-case text on the right`));
  });

  await test('automation: changing #autoStrategy updates label/help text', async () => {
    await page.goto(BASE + '/#automation');
    await pickStrategy('night_cheap');
    assert.equal(await page.locator('#autoStrategy').inputValue(), 'night_cheap');
    // Visible button label reflects selection
    const display = (await page.locator('#autoStrategyDisplay').textContent()).trim();
    assert.match(display, /natkører/i);
  });

  await test('automation: #autoParam accepts numeric input', async () => {
    await page.goto(BASE + '/#automation');
    // autoParam is only visible for strategies that need a number. cheapest_n is
    // the default; make sure we reset to it so the param field is shown.
    await pickStrategy('cheapest_n');
    await page.waitForSelector('#autoParam:visible');
    await page.fill('#autoParam', '12');
    assert.equal(await page.locator('#autoParam').inputValue(), '12');
  });

  await test('automation: changing inputs updates #apiUrlDisplay', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForSelector('#apiUrlDisplay');
    await pickStrategy('cheapest_n');
    await page.waitForSelector('#autoParam:visible');
    await page.selectOption('#autoArea', 'DK2');
    await page.fill('#autoParam', '4');
    await page.waitForFunction(() => {
      const url = document.getElementById('apiUrlDisplay').textContent;
      return url.includes('area=DK2') && url.includes('hours=4');
    });
  });

  await test('automation: export tabs switch between Home Assistant and Shelly', async () => {
    await page.goto(BASE + '/#automation');
    await page.locator('#exportBtnShelly').click();
    await page.waitForSelector('#exportShelly:visible');
    assert.equal(await page.locator('#exportHA').isHidden(), true);
    await page.locator('#exportBtnHA').click();
    await page.waitForSelector('#exportHA:visible');
  });

  // ── 5. Shelly Live Tariff page ─────────────────────────────────────────────

  await test('shelly-tariff: #shellySelect populated', async () => {
    await page.goto(BASE + '/#shelly-tariff');
    await page.waitForSelector('#shellySelect');
    await page.waitForFunction(() =>
      document.querySelectorAll('#shellySelect option').length >= 3);
    const count = await page.locator('#shellySelect option').count();
    assert.ok(count >= 3, `#shellySelect has ${count} options, expected ≥3`);
  });

  await test('shelly-tariff: #shellyCloudUrl accepts input + triggers script update', async () => {
    await page.goto(BASE + '/#shelly-tariff');
    await page.fill('#shellyCloudUrl', 'https://shelly-test.example/v2/abc');
    assert.equal(await page.locator('#shellyCloudUrl').inputValue(),
      'https://shelly-test.example/v2/abc');
  });

  // ── 6. Forecast page — area + mode selects ─────────────────────────────────

  await test('prognose: #fcArea and #fcMode selects render', async () => {
    await page.goto(BASE + '/#prognose');
    await page.waitForSelector('#fcArea');
    await page.waitForSelector('#fcMode');
    const areas = await page.locator('#fcArea option').evaluateAll(o => o.map(x => x.value));
    assert.ok(areas.includes('DK1') && areas.includes('DK2'), '#fcArea needs DK1+DK2');
  });

  await test('prognose: changing #fcArea triggers loadForecastPage()', async () => {
    await page.goto(BASE + '/#prognose');
    await page.waitForSelector('#fcArea');
    await page.selectOption('#fcArea', 'DK2');
    assert.equal(await page.locator('#fcArea').inputValue(), 'DK2');
  });

  // ── 7. Page-level home-link regression ─────────────────────────────────────

  // Regression: href="#" sat pathname-routed pages to nowhere, because
  // clicking `#` on /blog/... didn't fire hashchange, and even if it had,
  // the pathname-fallback in route() mapped it right back to the same page.
  // Home icon must navigate to /.
  for (const url of ['/automation', '/blog/shelly-elpris-automation', '/dk1/n1']) {
    await test(`routing: home-icon on ${url} returns to start page`, async () => {
      await page.goto(BASE + url);
      const dp = await page.evaluate(() =>
        document.querySelector('main.active')?.dataset.page);
      await page.locator(`[data-page="${dp}"] a[title="Startside"]`).first().click();
      await page.waitForSelector('main[data-page="start"].active');
      assert.equal(await page.evaluate(() => location.pathname), '/',
        'home icon must land on / (not keep sub-page pathname)');
    });
  }

  await test('routing: visiting / does NOT redirect away (no localStorage bounce)', async () => {
    // Simulate the reported bug: trigger a save-like state then go home
    await page.goto(BASE + '/#DK1/inkl_alt');
    await page.waitForSelector('main[data-page="prices"].active');
    await page.goto(BASE + '/');
    await page.waitForSelector('main[data-page="start"].active');
    assert.equal(await page.evaluate(() => location.hash), '',
      'going home should land on /, not redirect');
  });

  // ── report & cleanup ────────────────────────────────────────────────────────

  await browser.close();
  if (server) server.kill();

  console.log('');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '\n   └─ ' + r.msg}`);
  }
  console.log('─'.repeat(50));
  console.log(`\n${_passed} passed, ${_failed} failed\n`);
  process.exit(_failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
