#!/usr/bin/env node
/**
 * End-to-end interaction tests for elpriser.org
 * Run: npm run test:e2e
 *
 * Exercises every interactive element on the site — navigation, the net chip
 * and its dialog, the Din pris / Spotpris switch and the period pill on the
 * Pris screen, FAQ accordions, dropdowns on automation/forecast/shelly pages,
 * week navigation, export tabs — and asserts the UI responds as expected.
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
  // server.js has no /api/forecast, which the Pris screen is drawn from. Answer it
  // with a deterministic ten days so the tests are about the UI, not the feed.
  // The mode and the gln are echoed in the price so each view can be told apart.
  const forecastRequests = [];
  const cph = { timeZone: 'Europe/Copenhagen' };
  const todayDk = () => new Intl.DateTimeFormat('en-CA', cph).format(new Date());
  const hourDk = () => +new Intl.DateTimeFormat('en-GB', { ...cph, hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  const fixturePrice = (mode, gln, h) => {
    const k = mode === 'spot_inkl' ? 0.4 : gln ? 1.3 : 1;
    return +((1.5 + Math.sin(h / 24 * 6.28) * 0.8 + (h >= 17 && h <= 20 ? 1 : 0)) * k).toFixed(4);
  };
  const fixtureTariff = h => +(0.2 + (h >= 17 && h <= 20 ? 0.3 : 0)).toFixed(4);
  let fixtureCharges = true;
  // The response body for one request; the city pages' server render (below) is fed the very same days.
  const forecastBody = (area, mode, gln) => {
    const base = Date.parse(todayDk() + 'T12:00:00Z');
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(base + i * 86400000).toISOString().slice(0, 10),
      type: i < 2 ? 'actual' : 'forecast',
      // The nettarif per hour rides on the net modes only, like the real response.
      ...(gln ? { grid_tariff: Array.from({ length: 24 }, (_, h) => fixtureTariff(h)) } : {}),
      prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: fixturePrice(mode, gln, h) })),
    }));
    // `charges` is what lets the caption fold out into the parts of the price; a test can
    // switch it off to see an older response (no charges) degrade to a plain caption.
    return { area, mode, ...(gln ? { gln } : {}), ...(fixtureCharges ? { charges: { sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25 } } : {}), days };
  };
  const forecastRoute = route => {
    const u = new URL(route.request().url());
    const mode = u.searchParams.get('mode'), gln = u.searchParams.get('gln'), area = u.searchParams.get('area');
    forecastRequests.push(`${area}|${mode}|${gln || ''}`);
    route.fulfill({ json: forecastBody(area, mode, gln) });
  };
  await ctx.route('**/api/forecast*', forecastRoute);

  // The ten city pages (/elpris/<by>) are written by the Pages Function, which server.js does not run. So the
  // browser is handed what the REAL function renders for the address — index.html, the table in functions/_cities.js
  // and the fixture above standing in for /api/forecast — and everything after that (the scripts, the router, the
  // net dialog, the Pris screen's own requests) is the site's own code against server.js.
  const { pathToFileURL } = require('node:url');
  const INDEX_HTML = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  const { CITIES } = await import(pathToFileURL(require('node:path').join(__dirname, 'functions/_cities.js')).href);
  const cityFn = (await import(pathToFileURL(require('node:path').join(__dirname, 'functions/[[path]].js')).href)).onRequest;
  const ssrCity = async pathname => {
    const real = { fetch: globalThis.fetch, caches: globalThis.caches };
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
    globalThis.fetch = async u => {
      const url = new URL(String(u));
      return url.pathname === '/api/forecast'
        ? new Response(JSON.stringify(forecastBody(url.searchParams.get('area'), url.searchParams.get('mode'), url.searchParams.get('gln'))), { headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404 });
    };
    try {
      const res = await cityFn({ request: new Request(BASE + pathname), env: { ASSETS: { fetch: async () => new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }) } } });
      return { status: res.status, body: await res.text() };
    } finally { globalThis.fetch = real.fetch; globalThis.caches = real.caches; }
  };
  const cityRoute = async route => {
    const u = new URL(route.request().url());
    if (route.request().resourceType() !== 'document' || !/^\/elpris\/[a-z]+$/.test(u.pathname)) return route.fallback();
    const r = await ssrCity(u.pathname);
    route.fulfill({ status: r.status, contentType: 'text/html; charset=utf-8', body: r.body });
  };
  await ctx.route('**/elpris/*', cityRoute);

  // server.js has no /api/nordic either. The foreign-area pages draw from it, so answer it for all thirteen
  // zones with ten days from yesterday (like the live feed). The price encodes the zone, so a tab switch is visible:
  // EUR/MWh = 10 × (zone number) + the day's swing, at rate 10 → øre/kWh = EUR/MWh.
  const ZN = ['dk1', 'dk2', 'no1', 'no2', 'no3', 'no4', 'no5', 'se1', 'se2', 'se3', 'se4', 'fi', 'nl'];
  const nordicRequests = [];
  await ctx.route('**/api/nordic*', route => {
    const zone = new URL(route.request().url()).searchParams.get('zone');
    nordicRequests.push(zone);
    const k = ZN.indexOf(zone);
    if (k < 0) return route.fulfill({ status: 400, json: { error: 'zone' } });
    const base = Date.parse(todayDk() + 'T12:00:00Z');
    route.fulfill({ json: { zone, unit: 'EUR/MWh', zoneInfo: { rate: 10, currency: 'X' },
      days: Array.from({ length: 10 }, (_, i) => ({
        date: new Date(base + (i - 1) * 86400000).toISOString().slice(0, 10), type: i < 3 ? 'actual' : 'forecast',
        prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(60 + k * 10 + Math.sin(h / 24 * 6.28) * 25 + i).toFixed(2) })) })) } });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const pris = n => String(n.toFixed(2)).replace('.', ',');

  // ── 1. Clean-URL routing (mirrors functions/[[path]].js + server.js) ───────

  for (const [url, dataPage] of [
    ['/',                              'start'],
    ['/prognose',                      'prognose'],
    ['/tariffer',                      'tariffer'],
    ['/automation',                    'automation'],
    ['/api',                           'api'],
    ['/om-elpriser',                   'om-elpriser'],
    ['/download',                      'download'],
    ['/dk1',                           'prices'],
    ['/dk2',                           'prices'],
    ['/no/strompris',                         'zone'],
    ['/sv/elpris',                       'zone'],
    ['/fi/sahkon-hinta',                       'zone'],
    ['/norden',                        'norden'],
    ['/blog',                                    'blog'],
    ['/blog/elafgift-2028',                      'blog-elafgift-2028'],
    ['/blog/elafgift-og-spotpris',               'blog-elafgift-og-spotpris'],
    ['/blog/hvornaar-er-stroemmen-billigst',     'blog-hvornaar-er-stroemmen-billigst'],
    ['/blog/groennest-og-dyrest',                'blog-groennest-og-dyrest'],
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
  // clobbered /blog/elafgift-2028 → /#blog/elafgift-2028)
  for (const url of ['/blog/elafgift-2028', '/blog/hvornaar-er-stroemmen-billigst',
                     '/blog/groennest-og-dyrest', '/blog/elafgift-og-spotpris', '/blog',
                     '/tariffer', '/automation', '/api',
                     '/om-elpriser', '/download', '/prognose', '/dk1', '/dk2', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/norden']) {
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
    // A net chosen earlier in the run is remembered (that is the point), so the
    // button would offer it instead. Start from a visitor who has chosen nothing.
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/');
    const txt = (await page.locator('#gpsText').textContent()).trim();
    assert.equal(txt, 'Find dit netselskab automatisk');
  });

  await test('start: after visiting a net page the button offers that net', async () => {
    await page.goto(BASE + '/dk1/n1');
    await page.waitForFunction(() => localStorage.getItem('dk_net_pick') === 'DK1/net_inkl_alt/n1');
    await page.goto(BASE + '/');
    await page.waitForFunction(() => /Vis priser for N1/.test(document.getElementById('gpsText').textContent));
    await page.evaluate(() => localStorage.clear());
  });

  await test('start: no area cards and no 15-button net list — one compact row instead', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('main[data-page="start"].active [data-area-row]');
    for (const sel of ['#dk1-zone', '#dk2-zone', '#dk1-nets', '#dk2-nets', '.net-row', '.zone-btn'])
      assert.equal(await page.locator(`main[data-page="start"] ${sel}`).count(), 0, `${sel} is back on the start page`);
    assert.equal((await page.locator('main[data-page="start"] [data-area-row] .gps-light').textContent()).trim(), 'Find dit netselskab');
    assert.deepEqual(await page.locator('main[data-page="start"] [data-area-row] a').allTextContents(), ['DK1 Vest', 'DK2 Øst']);
    assert.equal(await page.locator('main[data-page="start"] a[href^="/dk1/"], main[data-page="start"] a[href^="/dk2/"]').count(), 0,
      'net pages are reached through the dialog and the footer, not the start page body');
  });

  for (const [text, expectedUrl] of [['DK1 Vest', '/dk1'], ['DK2 Øst', '/dk2']]) {
    await test(`start: the "${text}" link in the compact row navigates to ${expectedUrl}`, async () => {
      await page.goto(BASE + '/');
      await page.locator(`main[data-page="start"] [data-area-row] a:has-text("${text}")`).click();
      await page.waitForURL(u => u.pathname + u.search === expectedUrl && u.hash === '');
      await page.waitForSelector('main[data-page="prices"].active');
    });
  }

  await test('start: "Find dit netselskab" opens the net dialog, which lists all 15 nets; choosing one opens its page', async () => {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.clear());
    await page.locator('main[data-page="start"] [data-area-row] button').click();
    await page.waitForSelector('#netDialog[open]');
    assert.equal((await page.locator('#netDialogTitle').textContent()).trim(), 'Netselskab og indstillinger');
    // 15 nets plus one "Uden netselskab" per area.
    assert.equal(await page.locator('#netDialog .pd-links a[data-net]:not([data-net=""])').count(), 15, 'the dialog lists every net');
    await page.locator('#netDlgDK1 a:has-text("Trefor")').first().click();
    await page.waitForURL(u => u.pathname === '/dk1/trefor');
    await page.evaluate(() => localStorage.clear());
  });

  // Nav pills
  for (const [label, dataPage] of [
    ['Prognose',             'prognose'],
    ['Tariffer',             'tariffer'],
    ['Smart hjem',           'automation'],
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
    // Hidden sections (other pages of the SPA) carry <details class="faq"> too;
    // a user can only open the ones on the page that is showing.
    const faqs = page.locator('main.active details.faq');
    const count = await faqs.count();
    assert.equal(count, 5, `expected exactly 5 FAQ items on the start page, got ${count}`);
    for (let i = 0; i < count; i++) {
      const d = faqs.nth(i);
      assert.equal(await d.evaluate(el => el.open), false, `faq #${i} starts closed`);
      await d.locator('summary').click();
      assert.equal(await d.evaluate(el => el.open), true, `faq #${i} did not open on click`);
    }
  });

  // ── 3. Prices page — the Pris screen (Din pris / Spotpris, period pill, tooltip), week nav ──

  await test('prices: the Pris screen is drawn from /api/forecast for the page\'s own view', async () => {
    forecastRequests.length = 0;
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('main[data-page="prices"].active .pris .pris-now');
    const shown = (await page.locator('.pris-now').textContent()).trim();
    assert.equal(shown, pris(fixturePrice('inkl_alt', null, hourDk())), 'the big number is the area\'s Din pris');
    assert.ok(forecastRequests.includes('DK1|inkl_alt|'), `asked for ${forecastRequests.join(', ')}`);
    assert.match(await page.locator('.pris-label').first().textContent(), /^Elpris lige nu · \S+ kl\. \d\d$/);
    assert.equal((await page.locator('.pris-cap').first().textContent()).trim(), 'Inkl. Energinets tariffer, afgifter og moms');
  });

  await test('prices: on a net page Din pris is that net\'s all-in price, and the chip says so', async () => {
    forecastRequests.length = 0;
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pris .pris-now');
    assert.ok(forecastRequests.includes('DK1|net_inkl_alt|5790001089030'), `asked for ${forecastRequests.join(', ')}`);
    assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('net_inkl_alt', '5790001089030', hourDk())));
    assert.equal((await page.locator('.pris-cap').first().textContent()).trim(), 'Inkl. nettarif, afgifter og moms');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'N1 · Vestdanmark');
    assert.equal((await page.locator('#netChipShort').textContent()).trim(), 'N1 · Vest');
  });

  await test('prices: the switch has exactly Din pris and Spotpris, and no dropdown of six modes', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pris-seg-hero');
    const labels = await page.locator('.pris-seg-hero button').allTextContents();
    assert.deepEqual(labels, ['Din pris', 'Kun spotpris']);
    assert.equal(await page.locator('#priceSelector').count(), 0, 'the six-mode dropdown is back');
  });

  await test('prices: Spotpris is a query on the same page — and back returns', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pris-seg-hero');
    await page.locator('.pris-seg-hero [data-pris-view="spot"]').click();
    await page.waitForURL(u => u.pathname === '/dk1' && u.search === '?pris=spot' && u.hash === '');
    await page.waitForFunction(() => document.querySelector('.pris')?.dataset.view === 'spot');
    assert.equal(await page.locator('.pris-seg-hero [data-pris-view="spot"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await page.locator('.pris-cap').first().textContent()).trim(), 'Spotpris inkl. moms');
    assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('spot_inkl', null, hourDk())));
    await page.goBack();
    await page.waitForURL(u => u.pathname === '/dk1' && u.search === '' && u.hash === '');
    await page.waitForFunction(() => document.querySelector('.pris')?.dataset.view === 'din');
    assert.equal(await page.locator('.pris-seg-hero [data-pris-view="din"]').getAttribute('aria-pressed'), 'true');
  });

  await test('prices: Spotpris on a net page keeps the net', async () => {
    await page.goto(BASE + '/dk1/trefor');
    await page.waitForSelector('.pris-seg-hero');
    await page.locator('.pris-seg-hero [data-pris-view="spot"]').click();
    await page.waitForURL(u => u.pathname === '/dk1/trefor' && u.search === '?pris=spot');
    await page.waitForFunction(() => document.querySelector('.pris')?.dataset.key === 'DK1|spot|trefor');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'Trefor · Vestdanmark');
  });

  for (const [from, to, view] of [
    ['/dk1/trefor?pris=tarif', '/dk1/trefor', 'din'],
    ['/dk1?pris=alt-uden-afgift', '/dk1', 'din'],
    ['/dk1?pris=spot-ex', '/dk1?pris=spot', 'spot'],
    ['/dk2?pris=spot', '/dk2?pris=spot', 'spot'],
  ]) {
    await test(`prices: an old ${from} lands on the nearest of the two views (${to})`, async () => {
      await page.goto(BASE + from);
      await page.waitForURL(u => u.pathname + u.search === to && u.hash === '');
      await page.waitForFunction(v => document.querySelector('.pris')?.dataset.view === v, view);
    });
  }

  // The day `n` days after today in Danish short form, the way the screen writes it.
  const WD = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const WS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'], MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const dayAfter = n => { const d = new Date(Date.parse(todayDk() + 'T12:00:00Z') + n * 86400000); return { wd: WD[d.getUTCDay()], ws: WS[d.getUTCDay()], d: d.getUTCDate(), m: MON[d.getUTCMonth()] }; };

  // ── What the price is made of: the caption folds out ──
  const ore = t => Math.round(parseFloat(t.replace(/[^\d,-]/g, '').replace(',', '.')) * 10);   // "85,3 øre" -> 853
  const panelRows = async (scope = '') => {
    const lis = page.locator(`${scope} .pris-bdp:visible .pris-bdrows li`);
    const out = [];
    for (let i = 0; i < await lis.count(); i++) out.push([(await lis.nth(i).locator('.l').textContent()).trim(), (await lis.nth(i).locator('b').textContent()).trim()]);
    return out;
  };

  await test('breakdown: the wordmark is Elpriser with a capital E', async () => {
    await page.goto(BASE + '/dk1');
    assert.equal((await page.locator('header.site-nav a.site-logo').textContent()).trim(), 'Elpriser');
  });

  await test('breakdown: the caption is a closed <details>; opening it shows the six parts of the net price and a total equal to the hero', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pris .pris-now');
    const d = page.locator('.pris-modebox details.pris-bd');
    assert.equal(await d.evaluate(el => el.open), false, 'closed by default');
    assert.equal((await d.locator('summary').textContent()).trim(), 'Inkl. nettarif, afgifter og moms');
    await d.locator('summary').click();
    assert.equal(await d.evaluate(el => el.open), true);
    const h = String(hourDk()).padStart(2, '0');
    assert.equal((await d.locator('.pris-bdh').textContent()).trim(), `Sådan er prisen kl. ${h} sammensat`);
    const rows = await panelRows('.pris-modebox');
    assert.deepEqual(rows.map(r => r[0]), ['Spotpris (Nord Pool)', 'Systemtarif (Energinet)', 'Transmissionstarif (Energinet)', `Nettarif (N1, kl. ${h})`, 'Elafgift', 'Moms (25 %)', 'I alt']);
    assert.ok(rows.slice(0, -1).every(r => /^-?\d+,\d øre$/.test(r[1])), `one decimal and øre: ${JSON.stringify(rows)}`);
    const hero = (await page.locator('.pris-now').textContent()).trim();
    assert.equal(rows[rows.length - 1][1], `${hero} kr/kWh`, 'the total is the hero\'s number');
    const sum = rows.slice(0, -1).reduce((a, [, v]) => a + ore(v), 0);
    assert.equal(sum, Math.round(fixturePrice('net_inkl_alt', '5790001089030', hourDk()) * 1000), 'the rows add up exactly to the price (to 0,1 øre)');
    assert.equal(rows[3][1], `${(fixtureTariff(hourDk()) * 100).toFixed(1).replace('.', ',')} øre`, 'the nettarif row is the hour\'s tariff');
    assert.ok(await page.locator('.pris-modebox .pris-bdbar i').count() >= 5, 'a stacked bar with a segment per row');
    assert.equal(await d.locator('.pris-bdback').count(), 0, 'no way back while it shows now');
    await d.locator('summary').click();
    assert.equal(await d.evaluate(el => el.open), false, 'tap again folds it in');
  });

  await test('breakdown: summary is a 44 px target, keyboard operable, with a visible focus ring', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pris .pris-now');
    const sum = page.locator('.pris-modebox details.pris-bd > summary');
    assert.ok((await sum.boundingBox()).height >= 44, 'summary is shorter than 44 px');
    await sum.focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');   // a keyboard focus, so :focus-visible applies
    const ring = await sum.evaluate(el => { const c = getComputedStyle(el); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2; });
    assert.equal(ring, true, 'no visible focus ring');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.pris-modebox details.pris-bd').evaluate(el => el.open), true, 'Enter opens it');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.pris-modebox details.pris-bd').evaluate(el => el.open), false, 'Space closes it');
  });

  await test('breakdown: clicking a bar switches the panel to that hour; the hero stays; Tilbage til nu returns', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pp2 .pris-plot');
    await page.locator('.pris-modebox details.pris-bd > summary').click();
    const hero = (await page.locator('.pris-now').textContent()).trim();
    const label = (await page.locator('.pris-label').first().textContent()).trim();
    const nowHeading = (await page.locator('.pris-modebox .pris-bdh').textContent()).trim();
    const nowRows = await panelRows('.pris-modebox');
    const box = await page.locator('.pp2 .pris-plot').boundingBox();
    await page.mouse.click(box.x + box.width * (24 + 13.5) / 48, box.y + box.height * 0.7);
    assert.equal((await page.locator('.pris-modebox .pris-bdh').textContent()).trim(), 'Sådan er prisen i morgen kl. 13 sammensat');
    const rows = await panelRows('.pris-modebox');
    assert.equal(rows[3][0], 'Nettarif (N1, kl. 13)');
    assert.equal(rows[rows.length - 1][1], `${pris(fixturePrice('net_inkl_alt', '5790001089030', 13))} kr/kWh`, 'the total is that bar\'s price, as the tooltip says');
    assert.equal(rows.slice(0, -1).reduce((a, [, v]) => a + ore(v), 0), Math.round(fixturePrice('net_inkl_alt', '5790001089030', 13) * 1000));
    assert.equal(await page.locator('.pp2 .pc.sel').count(), 1, 'the picked bar is highlighted');
    assert.equal((await page.locator('.pris-now').textContent()).trim(), hero, 'the hero price does not change');
    assert.equal((await page.locator('.pris-label').first().textContent()).trim(), label, 'nor does its label');
    await page.locator('.pris-modebox .pris-bdback').click();
    assert.equal((await page.locator('.pris-modebox .pris-bdh').textContent()).trim(), nowHeading);
    assert.deepEqual(await panelRows('.pris-modebox'), nowRows);
    assert.equal(await page.locator('.pris-bdback').count(), 0, 'Tilbage til nu is gone');
    assert.equal(await page.locator('.pc.sel').count(), 0, 'and so is the highlight');
  });

  await test('breakdown: a later day in 5 døgn is named like the tooltip and its spot price is a prognose; changing the period resets', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pp2 .pris-plot');
    await page.locator('.pris-period [data-pris-period="5"]').click();
    await page.locator('.pris-modebox details.pris-bd > summary').click();
    const box = await page.locator('.pp5 .pris-plot').boundingBox();
    await page.mouse.click(box.x + box.width * (3 * 24 + 13.5) / 120, box.y + box.height * 0.7);
    const x = dayAfter(3);
    assert.equal((await page.locator('.pris-modebox .pris-bdh').textContent()).trim(), `Sådan er prisen ${x.ws} ${x.d}. ${x.m} kl. 13 sammensat`);
    assert.equal((await panelRows('.pris-modebox'))[0][0], 'Spotpris (prognose)');
    await page.locator('.pris-period [data-pris-period="2"]').click();
    assert.equal(await page.locator('.pris-bdback').count(), 0, 'the period change resets the panel');
    assert.match((await page.locator('.pris-modebox .pris-bdh').textContent()).trim(), /^Sådan er prisen kl\. \d\d sammensat$/);
  });

  await test('breakdown: without a net there is no Nettarif row; Spotpris has spot and moms only', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pris .pris-now');
    await page.locator('.pris-modebox details.pris-bd > summary').click();
    const rows = await panelRows('.pris-modebox');
    assert.deepEqual(rows.map(r => r[0]), ['Spotpris (Nord Pool)', 'Systemtarif (Energinet)', 'Transmissionstarif (Energinet)', 'Elafgift', 'Moms (25 %)', 'I alt']);
    assert.equal(rows.slice(0, -1).reduce((a, [, v]) => a + ore(v), 0), Math.round(fixturePrice('inkl_alt', null, hourDk()) * 1000));
    await page.locator('.pris-seg-hero [data-pris-view="spot"]').click();
    await page.waitForFunction(() => document.querySelector('.pris')?.dataset.view === 'spot');
    assert.equal(await page.locator('.pris-modebox details.pris-bd').evaluate(el => el.open), true, 'an open breakdown stays open when the view changes');
    const sp = await panelRows('.pris-modebox');
    assert.deepEqual(sp.map(r => r[0]), ['Spotpris (Nord Pool)', 'Moms (25 %)', 'I alt']);
    assert.equal(sp[2][1], `${(await page.locator('.pris-now').textContent()).trim()} kr/kWh`);
  });

  await test('breakdown: on a phone the card captions carry it, and the three disclosures open together', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('.pp2 .pris-plot');
    assert.equal(await page.locator('.pp2 details.pris-bd').isVisible(), true);
    assert.equal(await page.locator('.pris-modebox details.pris-bd').isVisible(), false);
    await page.locator('.pp2 details.pris-bd > summary').click();
    // `toggle` is delivered a task later, so wait for the siblings to follow.
    await page.waitForFunction(() => [...document.querySelectorAll('.pris details.pris-bd')].every(d => d.open));
    await page.locator('.pris-period [data-pris-period="5"]').click();
    assert.equal(await page.locator('.pp5 details.pris-bd').evaluate(el => el.open), true, 'the other card is open too');
    assert.equal((await page.locator('.pp5 .pris-bdp:visible .pris-bdh').textContent()).trim().startsWith('Sådan er prisen kl.'), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    } finally { await page.setViewportSize({ width: 1280, height: 720 }); }
  });

  await test('breakdown: an older response without charges leaves a plain caption — no chevron, no NaN', async () => {
    fixtureCharges = false;
    try {
      await page.goto(BASE + '/dk1/n1');
      await page.waitForSelector('.pris .pris-now');
      assert.equal(await page.locator('.pris details').count(), 0);
      assert.equal(await page.locator('.pris .pris-chev').count(), 0);
      assert.equal((await page.locator('.pris-cap').first().textContent()).trim(), 'Inkl. nettarif, afgifter og moms');
      assert.doesNotMatch(await page.locator('.pris').textContent(), /NaN|undefined/);
    } finally { fixtureCharges = true; }
  });

  await test('prices: the period pill is a tablist that switches the chart between 2 døgn and 5 døgn', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pris .pp2 .pris-plot');
    assert.equal(await page.locator('.pris-period').getAttribute('role'), 'tablist');
    assert.deepEqual((await page.locator('.pris-period [role="tab"]').allTextContents()).map(t => t.trim()), ['2 døgn', '5 døgn']);
    assert.equal(await page.locator('.pris-card.pp2').isVisible(), true);
    assert.equal(await page.locator('.pris-card.pp5').isVisible(), false);
    assert.equal((await page.locator('.pp2 .pris-ct').textContent()).trim(), 'Næste 2 døgn');
    await page.locator('.pris-period [data-pris-period="5"]').click();
    assert.equal(await page.locator('.pris-card.pp5').isVisible(), true);
    assert.equal(await page.locator('.pris-card.pp2').isVisible(), false);
    assert.equal((await page.locator('.pp5 .pris-ct').textContent()).trim(), 'Næste 5 døgn');
    assert.equal(await page.locator('.pris-period [data-pris-period="5"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.pris-period [data-pris-period="2"]').getAttribute('aria-selected'), 'false');
    assert.equal(await page.locator('.pp5 .pc').count(), 120, 'five days of hourly bars');
    assert.equal(await page.locator('.pris').getAttribute('data-period'), '5');
  });

  await test('prices: 5 døgn labels every day under its 24 bars, with the Prognose divider where the forecast begins', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-plot');
    await page.locator('.pris-period [data-pris-period="5"]').click();
    const labels = await page.locator('.pp5 .pris-xl .xd').allTextContents();
    assert.deepEqual(labels, [0, 1, 2, 3, 4].map(n => { const x = dayAfter(n); return `${x.ws} ${x.d}`; }));
    const lefts = await page.locator('.pp5 .pris-xl .xd').evaluateAll(els => els.map(e => parseFloat(e.style.left)));
    lefts.forEach((l, i) => assert.ok(Math.abs(l - (i * 24 + 12) / 120 * 100) < 0.01, `label ${i} at ${l}%`));
    assert.equal(await page.locator('.pp5 .pris-sep').count(), 4, 'a divider at every midnight');
    // Days 0 and 1 are børspriser in the fixture, day 2 is the first forecast day.
    const fc = page.locator('.pp5 .pris-fc');
    assert.equal((await fc.textContent()).trim(), 'Prognose');
    assert.ok(Math.abs(parseFloat(await fc.evaluate(e => e.style.left)) - 48 / 120 * 100) < 0.01, 'Prognose sits at the start of day 3');
    // Today is dimmed up to the current hour, with one dot on it.
    assert.equal(await page.locator('.pp5 .pc.past').count(), hourDk());
    assert.equal(await page.locator('.pp5 .pd').count(), 1);
  });

  await test('prices: 5 døgn tooltip names later days by weekday and date, and stays inside the card at both ends', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-plot');
    await page.locator('.pris-period [data-pris-period="5"]').click();
    const box = await page.locator('.pp5 .pris-plot').boundingBox();
    const hit = async i => {
      await page.mouse.move(box.x + box.width * (i + 0.5) / 120, box.y + box.height * 0.7);
      const tip = page.locator('.pp5 .pris-tip');
      await tip.waitFor({ state: 'visible' });
      return (await tip.textContent()).trim();
    };
    const x = dayAfter(3);
    assert.equal(await hit(3 * 24 + 13), `${x.ws} ${x.d}. ${x.m} kl. 13 · ${pris(fixturePrice('inkl_alt', null, 13))} kr/kWh`);
    assert.equal(await hit(24 + 13), `I morgen kl. 13 · ${pris(fixturePrice('inkl_alt', null, 13))} kr/kWh`);
    assert.equal(await hit(19), `I dag kl. 19 · ${pris(fixturePrice('inkl_alt', null, 19))} kr/kWh`);
    for (const i of [0, 119]) {
      await hit(i);
      const inside = await page.evaluate(() => {
        const t = document.querySelector('.pp5 .pris-tip').getBoundingClientRect(), c = document.querySelector('.pp5').getBoundingClientRect();
        return t.left >= c.left && t.right <= c.right;
      });
      assert.equal(inside, true, `the tooltip overflows the card at bar ${i}`);
    }
  });

  await test('prices: the stat tiles and the Dag for dag list follow the period (2 or 5 rows, day wording)', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-plot');
    const rows = () => page.locator('.pris-week tbody tr:visible').count();
    assert.equal(await rows(), 2);
    assert.equal(await page.locator('.pris-tiles.pp2').isVisible(), true);
    assert.equal(await page.locator('.pris-tiles.pp5').isVisible(), false);
    await page.locator('.pris-period [data-pris-period="5"]').click();
    assert.equal(await rows(), 5);
    const names = (await page.locator('.pris-week tbody tr:visible th').allTextContents()).map(t => t.trim());
    assert.deepEqual(names.slice(0, 2).map(t => t.replace(/\d.*$/, '')), ['I dag', 'I morgen']);
    const d2 = dayAfter(2);
    assert.ok(names[2].startsWith(d2.wd), names[2]);
    assert.ok(names[2].includes(`${d2.d}. ${d2.m}`), names[2]);
    assert.deepEqual((await page.locator('.pris-week tbody tr:visible td:last-child').allTextContents()).map(t => t.trim()),
      ['Børspris', 'Børspris', 'Prognose', 'Prognose', 'Prognose']);
    // Same price every day in the fixture, so the cheapest/dearest hour is today (now or later) —
    // the tile wording must be i dag / i aften / i morgen, never a date, in these cases.
    const keys = (await page.locator('.pris-tiles.pp5 .k').allTextContents()).map(t => t.trim());
    assert.equal(keys.length, 2);
    assert.match(keys[0], /^Billigst (i dag|i morgen|[a-zæøå]{3} \d+\.)$/);
    assert.match(keys[1], /^Dyrest (i dag|i aften|i morgen|[a-zæøå]{3} \d+\.)$/);
  });

  await test('prices: a legacy period value (10, "3–10") resolves to the 5 døgn view', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-plot');
    for (const legacy of [10, '10', '3–10', '3-10']) {
      await page.evaluate(() => setPrisPeriod(2));
      await page.evaluate(v => setPrisPeriod(v), legacy);
      assert.equal(await page.locator('.pris').getAttribute('data-period'), '5', `legacy ${legacy}`);
      assert.equal(await page.locator('.pris-card.pp5').isVisible(), true);
    }
    await page.evaluate(() => setPrisPeriod(undefined));
    assert.equal(await page.locator('.pris').getAttribute('data-period'), '2', 'an unknown value falls back to 2 døgn');
  });

  await test('clock: with a remembered net and an Intl that decorates the hour, the hero still shows a real hour and price (never NaN)', async () => {
    // Regression: an iPad showed "kl. NaN" and no price after the remembered net swapped in.
    for (const variant of ['suffix', 'suffix-no-parts']) {
      const hp = await ctx.newPage();
      await hp.addInitScript((v) => {
        try { localStorage.setItem('dk_net_pick', 'DK1/net_inkl_alt/n1'); } catch (_) {}
        // DateTimeFormat.prototype.format is a getter that returns a bound function, so it has to be
        // replaced with defineProperty — a plain assignment is silently ignored.
        const F = Intl.DateTimeFormat, desc = Object.getOwnPropertyDescriptor(F.prototype, 'format');
        Object.defineProperty(F.prototype, 'format', { configurable: true, get() {
          const f = desc.get.call(this), o = this.resolvedOptions();
          return (d) => { const s = f(d); return o.hour && !o.year && !o.weekday ? '‎' + s + ' h' : s; };
        } });
        if (v === 'suffix-no-parts') F.prototype.formatToParts = function () { throw new Error('formatToParts unavailable'); };
      }, variant);
      await hp.goto(BASE + '/');
      await hp.waitForFunction(() => /N1/.test((document.getElementById('netChipLong') || {}).textContent || ''), null, { timeout: 8000 });
      await hp.waitForFunction(() => { const n = document.querySelector('.pris-now'); return n && /\d,\d\d/.test(n.textContent); }, null, { timeout: 8000 });
      const label = (await hp.locator('.pris-label').first().textContent()).trim();
      const body = await hp.evaluate(() => document.body.innerText);
      assert.match(label, /kl\. \d\d$/, `${variant}: hero label is "${label}"`);
      assert.ok(!/NaN|undefined/.test(body), `${variant}: the page shows NaN/undefined`);
      assert.equal(+label.slice(-2), hourDk(), `${variant}: the hero hour is the Copenhagen hour`);
      assert.ok(await hp.locator('.pris-now').textContent().then(t => /\d,\d\d/.test(t)), `${variant}: no price`);
      await hp.close();
    }
  });

  await test('prices: hovering a bar shows its exact price, highlights it, and the tooltip stays inside the card', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-plot');
    const box = await page.locator('.pp2 .pris-plot').boundingBox();
    for (const [fx, hour, day] of [[0.005, 0, 'I dag'], [0.995, 23, 'I morgen']]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.7);
      const tip = page.locator('.pp2 .pris-tip');
      await tip.waitFor({ state: 'visible' });
      const want = `${day} kl. ${String(hour).padStart(2, '0')} · ${pris(fixturePrice('inkl_alt', null, hour))} kr/kWh`;
      assert.equal((await tip.textContent()).trim(), want);
      const inside = await page.evaluate(() => {
        const t = document.querySelector('.pp2 .pris-tip').getBoundingClientRect(), c = document.querySelector('.pp2').getBoundingClientRect();
        return t.left >= c.left && t.right <= c.right && t.top >= c.top;
      });
      assert.equal(inside, true, 'the tooltip overflows the card');
      assert.equal(await page.locator('.pp2 .pc.on').count(), 1, 'the hovered bar is not highlighted');
    }
    await page.mouse.move(5, 5);
    assert.equal(await page.locator('.pp2 .pris-tip').isVisible(), false, 'the tooltip stays after the pointer left');
  });

  await test('prices: the axis is zero-based with kr/kWh above it, and the verdict pill is one of Billig / Middel / Dyr', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pp2 .pris-yl span');
    const ticks = await page.locator('.pp2 .pris-yl span').allTextContents();
    assert.equal(ticks[0], '0');
    assert.ok(ticks.every((t, i) => i === 0 || +t.replace(',', '.') > +ticks[i - 1].replace(',', '.')), ticks.join(' '));
    assert.equal((await page.locator('.pp2 .pris-unit').textContent()).trim(), 'kr/kWh');
    assert.match(await page.locator('.pris-pill').textContent(), /^(Billig|Middel|Dyr) lige nu$/);
  });

  await test('phone: at 390 px the screen is one column, the switch moves into the chart card, no horizontal scroll', async () => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(BASE + '/');
    await p.waitForSelector('.pris .pris-now');
    assert.equal(await p.locator('.pris-seg-hero').isVisible(), false);
    assert.equal(await p.locator('.pp2 .pris-seg-card').isVisible(), true);
    assert.equal(await p.locator('#tabBar').isVisible(), true);
    assert.deepEqual((await p.locator('#tabBar a').allTextContents()).map(t => t.trim()), ['Pris', 'Smart hjem']);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.equal(sw[0], sw[1], `horizontal scroll: ${sw.join(' vs ')}`);
    await p.close();
  });

  await test('header: Pris · Smart hjem · Om, with the net chip and "Hent appen"', async () => {
    await page.goto(BASE + '/');
    // A net visited earlier in the run is remembered, and the chip would say so.
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/');
    const links = (await page.locator('header.site-nav .site-links a').allTextContents()).map(t => t.trim());
    assert.deepEqual(links, ['Pris', 'Smart hjem', 'Om']);
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'DK1 · Vestdanmark');
    assert.equal(await page.locator('header.site-nav .app-btn').textContent(), 'Hent appen');
    assert.equal(await page.locator('header.site-nav a.app-btn').getAttribute('href'), '/download', '"Hent appen" is a link to the page, not a button that opens a dialog');
    assert.equal(await page.locator('dialog#appDialog').count(), 0, 'the app dialog is gone');
    await page.locator('header.site-nav .site-links a:has-text("Smart hjem")').click();
    await page.waitForSelector('main[data-page="automation"].active');
    assert.equal((await page.locator('main[data-page="automation"] .page-title').textContent()).trim(), 'Smart hjem');
  });

  await test('start: a remembered net company is the one the Pris screen and the chip describe', async () => {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.setItem('dk_net_pick', 'DK1/net_inkl_alt/n1'));
    forecastRequests.length = 0;
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.querySelector('.pris')?.dataset.key === 'DK1|din|n1');
    assert.ok(forecastRequests.includes('DK1|net_inkl_alt|5790001089030'), forecastRequests.join(', '));
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'N1 · Vestdanmark');
    assert.equal(await page.evaluate(() => location.pathname), '/', 'the address stays the front page');
    await page.evaluate(() => localStorage.clear());
  });

  await test('net chip: opens "Netselskab og indstillinger", and a net chosen there opens its page', async () => {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.clear());
    await page.locator('#netChip').click();
    await page.waitForSelector('#netDialog[open]');
    assert.equal((await page.locator('#netDialogTitle').textContent()).trim(), 'Netselskab og indstillinger');
    assert.equal(await page.locator('#netDialog #gpsBtn').count(), 1, 'the position lookup lives in the dialog');
    await page.locator('#netDlgDK2 a:has-text("Radius")').click();
    await page.waitForURL(u => u.pathname === '/dk2/radius');
    await page.waitForSelector('.pris .pris-now');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'Radius · Østdanmark');
    await page.evaluate(() => localStorage.clear());
  });

  for (const [legacy, clean] of [
    ['/#tariffer', '/tariffer'],
    ['/#DK1/net_inkl_alt/n1', '/dk1/n1'],
    ['/dk1#DK1/spot_inkl', '/dk1?pris=spot'],
    ['/dk1/trefor#DK1/net_inkl_tarif/trefor', '/dk1/trefor'],
    ['/dk1#DK1/spot_ex', '/dk1?pris=spot'],
    ['/tariffer#tariffer', '/tariffer'],
  ]) {
    await test(`legacy link ${legacy} is rewritten to ${clean}`, async () => {
      await page.goto(BASE + legacy);
      await page.waitForURL(u => u.pathname + u.search === clean && u.hash === '');
    });
  }

  await test('prices: the day-by-hour grid and its week paging are gone, the Pris screen is there', async () => {
    // The "Time for time · 4 dage tilbage, 3 døgn frem" grid with Forrige/Næste
    // paging was removed; the Pris screen replaced it.
    for (const url of ['/dk1', '/dk1/n1', '/#DK1/inkl_alt']) {
      await page.goto(BASE + url);
      await page.waitForSelector('main[data-page="prices"].active .pris .pris-now');
      for (const sel of ['#priceTable', '#tableWrapper', '#weekLabel', '#nextWeekBtn', '#loadingIndicator', '#priceDetail', 'button:has-text("Forrige")', 'button:has-text("Næste")'])
        assert.equal(await page.locator(sel).count(), 0, `${url}: ${sel} is back`);
      assert.equal(await page.evaluate(() => typeof changeWeek + typeof renderTable + typeof tableWindow), 'undefinedundefinedundefined');
      const text = await page.locator('main[data-page="prices"]').innerText();
      assert.ok(!/4 dage tilbage|Forrige/.test(text), `${url}: copy about the grid is back`);
      assert.ok(await page.locator('main[data-page="prices"] .pris-week').count() >= 1, `${url}: the "Dag for dag" list is gone`);
    }
  });

  await test('prices: the price data the grid used to load still reaches Smart hjem (seven days back, fetched once)', async () => {
    // The automation page plans over the last seven days of priceData; the price
    // pages fill it. Answered with eight deterministic days (today-7 .. today+2)
    // so the test is about the wiring, not the upstream feed.
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const requests = [];
    const handler = route => {
      const u = new URL(route.request().url());
      requests.push({ start: u.searchParams.get('start'), end: u.searchParams.get('end'), area: u.searchParams.get('area') });
      const records = [];
      for (let back = 7; back >= -2; back--) {
        const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - back);
        for (let h = 0; h < 24; h++)
          records.push({ TimeDK: `${ymd(d)}T${String(h).padStart(2, '0')}:00:00`, DayAheadPriceDKK: 400 + h * 10 });
      }
      route.fulfill({ json: { records } });
    };
    await page.route('**/api/raw/prices*', handler);
    try {
      await page.goto(BASE + '/dk1');
      await page.waitForSelector('main[data-page="prices"].active .pris .pris-now');
      await page.waitForFunction(() => Object.keys(priceData).length >= 8);
      const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
      assert.equal(requests.length, 1, `price requests from the price page: ${JSON.stringify(requests)}`);
      assert.deepEqual(requests[0], { start: day(-7), end: day(2), area: 'DK1' });
      // On to Smart hjem inside the same document (a hash route — a link is a
      // full page load and would start from nothing): it reuses priceData.
      await page.evaluate(() => { location.hash = '#automation'; });
      await page.waitForSelector('main[data-page="automation"].active #autoTableWrapper table');
      assert.equal(requests.length, 1, 'Smart hjem fetched again although priceData was already loaded');
      // Seven day columns plus the hour column, every cell a price from the feed.
      assert.equal(await page.locator('#autoTableWrapper tr').first().locator('th').count(), 8);
      assert.equal(await page.locator('#autoTableWrapper tr').count(), 25);
      const cell = (await page.locator('#autoTableWrapper tr').nth(1).locator('td').nth(1).textContent()).trim();
      assert.match(cell, /^\d+,\d\d$/, `Smart hjem cell is not a price: "${cell}"`);
      // And opened cold, Smart hjem fetches for itself.
      requests.length = 0;
      await page.goto(BASE + '/automation');
      await page.waitForSelector('main[data-page="automation"].active #autoTableWrapper table');
      assert.equal(requests.length, 1, `cold Smart hjem price requests: ${JSON.stringify(requests)}`);
      assert.equal(await page.locator('#autoTableWrapper tr').count(), 25);
    } finally {
      await page.unroute('**/api/raw/prices*', handler);
    }
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
    // Dropdown should have every net across DK1+DK2 (12 + 3 = 15+)
    await page.waitForFunction(() =>
      document.querySelectorAll('#autoNet option').length >= 15);
    const netCount = await page.locator('#autoNet option').count();
    assert.ok(netCount >= 15, `#autoNet has ${netCount} options, expected ≥15 (all DK1+DK2 nets)`);
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

  await test('automation: the appliance picker lists controllable appliances, no old "Enhed" device list', async () => {
    // "Enhed" (a Shelly/HA device-type list) was removed in ce46406; #autoDevice
    // came back as "Apparat" with appliance types for the flex-capacity feature.
    await page.goto(BASE + '/#automation');
    const label = await page.locator('label[for="autoDevice"]').first().textContent();
    assert.match(label, /apparat/i, `label was "${label}"`);
    const values = await page.locator('#autoDevice option').evaluateAll(os => os.map(o => o.value));
    for (const v of ['ev_charger', 'water_heater', 'heat_pump']) {
      assert.ok(values.includes(v), `appliance option ${v} missing (have ${values.join(', ')})`);
    }
  });

  await test('automation: the generated Home Assistant code reads the day plan and decides per hour', async () => {
    await page.goto(BASE + '/#automation');
    await page.waitForFunction(() => (document.getElementById('exportHACode')?.textContent || '').includes('binary_sensor'));
    const ha = await page.locator('#exportHACode').textContent();
    assert.ok(!ha.includes('${'), 'an unreplaced template placeholder is left in the YAML');
    assert.match(ha, /resource: "https:\/\/elpriser\.org\/api\/schedule\?/, 'must fetch /api/schedule');
    assert.doesNotMatch(ha, /resource: "[^"]*\/api\/now/, 'must not poll /api/now');
    const m = ha.match(/scan_interval:\s*(\d+)/);
    assert.ok(m && +m[1] >= 21600, `scan_interval ${m && m[1]}`);
    assert.match(ha, /s\[now\(\)\.hour\]\.on/);
    // Every entity the automation and the flex block refer to is one the YAML defines.
    for (const ref of ha.matchAll(/(sensor|binary_sensor)\.([a-z0-9_]+)/g)) {
      const [, domain, id] = ref;
      if (id === 'energidataservice' || id.endsWith('_power')) continue;
      assert.ok(ha.includes(`name: "${id}"`), `${domain}.${id} is referenced but never defined`);
    }
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

  await test('automation: #autoStrategy exposes the 5 visible strategies (with use-case text)', async () => {
    await page.goto(BASE + '/#automation');
    const opts = await page.locator('#autoStrategyMenu .cs-opt').evaluateAll(els =>
      els.map(e => ({
        value: e.dataset.value,
        label: e.querySelector('.cs-l')?.textContent,
        useCase: e.querySelector('.cs-r')?.textContent,
      })));
    const vals = opts.map(o => o.value);
    ['cheapest_n','cheapest_pct','avoid_expensive_n','avoid_expensive_pct','smart']
      .forEach(s => assert.ok(vals.includes(s), `#autoStrategy missing "${s}"`));
    // Every option must have non-empty use-case text on the right side
    opts.forEach(o => assert.ok(o.useCase && o.useCase.trim().length > 0,
      `strategy "${o.value}" missing use-case text on the right`));
  });

  await test('automation: changing #autoStrategy updates label/help text', async () => {
    await page.goto(BASE + '/#automation');
    await pickStrategy('avoid_expensive_n');
    assert.equal(await page.locator('#autoStrategy').inputValue(), 'avoid_expensive_n');
    // Visible button label reflects selection
    const display = (await page.locator('#autoStrategyDisplay').textContent()).trim();
    assert.match(display, /undgå dyreste/i);
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
  for (const url of ['/automation', '/blog/elafgift-2028', '/dk1/n1']) {
    await test(`routing: the header logo on ${url} returns to start page`, async () => {
      await page.goto(BASE + url);
      const dp = await page.evaluate(() =>
        document.querySelector('main.active')?.dataset.page);
      // The header logo is the one way home (the per-page house icons are gone).
      assert.equal(await page.locator(`[data-page="${dp}"] a[title="Startside"]`).count(), 0, 'per-page home icon is back');
      await page.locator('header.site-nav a.site-logo').first().click();
      await page.waitForSelector('main[data-page="start"].active');
      assert.equal(await page.evaluate(() => location.pathname), '/',
        'the logo must land on / (not keep sub-page pathname)');
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

  // ── 8. Footer: four groups, the net companies behind a disclosure ──────────

  await test('footer: collapsed by default, the net-list disclosure closed, net links present but hidden', async () => {
    await page.goto(BASE + '/dk1/n1');
    await page.waitForSelector('footer.sf');
    assert.equal(await page.locator('footer details[open]').count(), 0, 'no disclosure open');
    assert.equal(await page.locator('footer details.sf-all a[href^="/dk"]').count(), 15, '15 net links in the DOM');
    assert.equal(await page.locator('footer details.sf-all a[href="/dk1/trefor"]').isVisible(), false, 'hidden while closed');
    assert.deepEqual(await page.locator('footer .sf-h').allTextContents().then(a => a.slice(0, 4)), ['Priser', 'Smart hjem', 'Viden', 'Elpriser']);
  });

  await test('footer: the summaries open with a click and the keyboard, and a net link navigates', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('footer.sf');
    const sum = page.locator('footer details.sf-all > summary');
    await sum.scrollIntoViewIfNeeded();
    await sum.click();
    assert.equal(await page.locator('footer details.sf-all').evaluate(d => d.open), true, 'opens on click');
    assert.equal(await page.locator('footer details.sf-all a[href="/dk2/radius"]').isVisible(), true, 'links visible once open');
    await sum.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('footer details.sf-all').evaluate(d => d.open), false, 'closes with Enter');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('footer details.sf-all').evaluate(d => d.open), true, 'opens with Space');
    await page.locator('footer details.sf-all a[href="/dk1/trefor"]').click();
    await page.waitForFunction(() => location.pathname === '/dk1/trefor');
    await page.waitForSelector('main[data-page="prices"].active');
  });

  await test('footer: four columns at 1280 px, two at 390 px, no horizontal scroll at 360 px, 44 px targets on phones', async () => {
    const cols = () => page.locator('footer .sf-cols').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/blog');
    await page.waitForSelector('footer.sf');
    assert.equal(await cols(), 4, 'four columns on desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await cols(), 2, 'two columns on a phone');
    await page.setViewportSize({ width: 360, height: 780 });
    await page.locator('footer details').evaluateAll(ds => ds.forEach(d => { d.open = true; }));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `page scrolls horizontally by ${over}px with every disclosure open`);
    const small = await page.evaluate(() => [...document.querySelectorAll('footer summary, footer .sf-l a, footer .sf-chips a, footer .sf-apps a')]
      .map(a => [a.textContent.trim(), a.getBoundingClientRect().height]).filter(([, h]) => h < 43.5));
    assert.deepEqual(small, [], 'footer targets under 44 px');
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test('footer: keyboard focus shows a ring on footer links and summaries', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('footer.sf');
    const ring = async sel => {
      await page.keyboard.press('Tab'); // keyboard modality, so :focus-visible applies
      await page.locator(sel).first().focus();
      return page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
    };
    assert.equal(await ring('footer .sf-l a'), 'solid 2px', 'link ring');
    assert.equal(await ring('footer details.sf-all > summary'), 'solid 2px', 'summary ring');
  });

  // ── 9. Retired pages: 301 on the dev server, old #blog/… hashes, the new anchors ──

  const head = (pathAndQuery) => new Promise((ok, no) => {
    http.get(BASE + pathAndQuery, res => { res.resume(); ok({ status: res.statusCode, headers: res.headers }); }).on('error', no);
  });
  const RETIRED = [
    ['/blog/v2g-v2h-bidirektional-opladning', '/blog', '/blog'],
    ['/blog/biler-ladere-v2h-v2g',            '/blog', '/blog'],
    ['/blog/shelly-elpris-automation',        '/automation#shelly', '/automation'],
    ['/blog/home-assistant-elpriser',         '/automation#home-assistant', '/automation'],
    ['/blog/forsta-din-elpris',               '/om-elpriser', '/om-elpriser'],
  ];
  for (const [from, to] of RETIRED) {
    await test(`retired page ${from}: 301 to ${to} (dev server, as in production)`, async () => {
      const r = await head(from);
      assert.equal(r.status, 301);
      assert.equal(r.headers.location, to);
      assert.equal(r.headers['cache-control'], 'public, max-age=3600');
      const q = await head(from + '?utm_source=x');
      assert.equal(q.headers.location, to.replace(/(#.*)?$/, m => '?utm_source=x' + m), 'the query string survives');
    });
  }

  for (const [from, to, path] of RETIRED) {
    await test(`old shared link /#${from.slice(1)} lands on ${to}`, async () => {
      await page.goto(BASE + '/#' + from.slice(1), { waitUntil: 'commit' });
      // The page replaces itself while it loads; watch the address rather than a load event.
      const want = BASE + to;
      for (let i = 0; i < 50 && page.url() !== want; i++) await new Promise(r => setTimeout(r, 100));
      assert.equal(page.url(), want, 'the old hash must end on the page that replaced it');
      await page.waitForSelector(`main[data-page="${path === '/om-elpriser' ? 'om-elpriser' : path.slice(1)}"].active`);
    });
  }

  await test('old hash on the page that replaced it is rewritten in place: /automation#blog/shelly-elpris-automation → #shelly', async () => {
    await page.goto(BASE + '/automation#blog/shelly-elpris-automation');
    await page.waitForFunction(() => location.hash === '#shelly');
    assert.equal(await page.evaluate(() => location.pathname), '/automation');
    await page.waitForSelector('main[data-page="automation"].active');
  });

  for (const id of ['shelly', 'home-assistant']) {
    await test(`/automation#${id}: the page stays /automation, keeps its anchor, and scrolls to the section`, async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(BASE + '/automation#' + id);
      await page.waitForSelector('main[data-page="automation"].active');
      await page.waitForFunction(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.top >= 0 && r.top < 400; }, id);
      const st = await page.evaluate(() => ({ p: location.pathname, h: location.hash }));
      assert.deepEqual(st, { p: '/automation', h: '#' + id }, 'the anchor must survive route()');
      const h2 = (await page.locator(`#${id} h2`).textContent()).trim();
      assert.ok(h2.length > 5, 'heading present');
    });
  }

  await test('the generator above the guides still works with an anchor in the URL', async () => {
    await page.goto(BASE + '/automation#home-assistant');
    await page.waitForSelector('main[data-page="automation"].active #autoTableWrapper table');
    await page.selectOption('#autoArea', 'DK2');
    assert.equal(await page.locator('#autoArea').inputValue(), 'DK2');
    assert.equal(await page.evaluate(() => location.hash), '#home-assistant');
  });

  await test('/om-elpriser reads "Forstå din elpris", and is the footer\'s only explainer link', async () => {
    await page.goto(BASE + '/om-elpriser');
    await page.waitForSelector('main[data-page="om-elpriser"].active');
    assert.equal((await page.locator('main[data-page="om-elpriser"] .page-title').textContent()).trim(), 'Forstå din elpris');
    assert.deepEqual(await page.locator('footer a[href="/om-elpriser"]').allTextContents(), ['Forstå din elpris']);
    assert.equal(await page.locator('footer .sf-more').count(), 0, 'no "Flere guides" disclosure');
  });

  await test('/blog lists the four remaining posts and nothing else', async () => {
    await page.goto(BASE + '/blog');
    await page.waitForSelector('main[data-page="blog"].active');
    assert.deepEqual(await page.locator('main[data-page="blog"] a.card').evaluateAll(a => a.map(x => x.getAttribute('href')).sort()),
      ['/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst']);
  });

  await test('no page links to a retired URL (start, automation, om-elpriser, blog, posts, tariffer, api)', async () => {
    for (const url of ['/', '/automation', '/om-elpriser', '/blog', '/blog/elafgift-2028', '/blog/elafgift-og-spotpris',
                       '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst', '/tariffer', '/api']) {
      await page.goto(BASE + url);
      await page.waitForSelector('main.active');
      const bad = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href').split('#')[0].split('?')[0])
        .filter(h => /^\/blog\/(v2g-v2h-bidirektional-opladning|biler-ladere-v2h-v2g|shelly-elpris-automation|home-assistant-elpriser|forsta-din-elpris)$/.test(h)));
      assert.deepEqual(bad, [], `${url} links ${bad.join(', ')}`);
    }
  });


  // ── 9. The foreign price areas: /no/strompris, /sv/elpris, /fi/sahkon-hinta on the Pris screen, and /norden ──

  const zoneNow = () => page.evaluate(() => ({
    key: document.querySelector('[data-page="zone"] .pris')?.dataset.key,
    price: document.querySelector('[data-page="zone"] .pris-now')?.textContent,
    sel: [...document.querySelectorAll('#zTabs [aria-selected="true"]')].map(a => a.dataset.zone),
    hash: location.hash, lang: document.documentElement.lang, hist: history.length,
  }));

  await test('/no/strompris: the Pris screen in Norwegian øre, five zone tabs, NO1 first, <html lang="nb">', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const z = await zoneNow();
    assert.deepEqual(z.sel, ['no1']); assert.equal(z.key, 'no1'); assert.equal(z.lang, 'nb');
    assert.equal(await page.locator('#zTabs [role="tab"]').count(), 5);
    assert.deepEqual(await page.locator('#zTabs [role="tab"]').evaluateAll(a => a.map(x => x.textContent)), ['NO1Oslo', 'NO2Kristiansand', 'NO3Trondheim', 'NO4Tromsø', 'NO5Bergen']);
    assert.equal(await page.locator('main[data-page="zone"] .pris-u').textContent(), 'øre/kWh');
    assert.match(await page.locator('main[data-page="zone"] .pris-label').textContent(), /^Strømpris akkurat nå/);
    assert.equal(await page.locator('[data-pris-view]').count(), 0, 'no Din pris / Spotpris switch on a foreign zone');
    assert.deepEqual(await page.locator('main[data-page="zone"] .pris-period button').allTextContents(), ['2 døgn', '5 døgn']);
    assert.equal(await page.locator('main[data-page="zone"] h1').count(), 1);
    // The text block lists every zone with its city; the page is drawn without NaN.
    const list = await page.locator('#zList').textContent();
    for (const c of ['Oslo', 'Kristiansand', 'Trondheim', 'Tromsø', 'Bergen']) assert.ok(list.includes(c), c);
    assert.ok(!/NaN|undefined/.test(await page.locator('main[data-page="zone"]').textContent()));
  });

  await test('/no/strompris#no4 opens on NO4; a tab switches the screen in place (no reload, address follows, Back leaves the page)', async () => {
    await page.goto(BASE + '/no/strompris#no4');
    await page.waitForSelector('main[data-page="zone"] .pris');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no4');
    const a = await zoneNow();
    assert.deepEqual(a.sel, ['no4']); assert.equal(a.hash, '#no4');
    await page.locator('#zt-no2').click();
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no2');
    const b = await zoneNow();
    assert.deepEqual(b.sel, ['no2']); assert.equal(b.hash, '#no2'); assert.notEqual(b.price, a.price, 'the price is the new zone\'s');
    assert.equal(b.hist, a.hist, 'a tab is not a new history entry');
    assert.equal(await page.locator('#zt-no2').getAttribute('tabindex'), '0');
    assert.equal(await page.locator('#zt-no4').getAttribute('tabindex'), '-1');
    assert.equal(await page.locator('#zPanel').getAttribute('aria-labelledby'), 'zt-no2');
  });

  await test('/no/strompris tabs are keyboard operable: arrows, Home and End move and select', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    await page.locator('#zt-no1').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no2');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'zt-no2');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no5');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no1');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no5');
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no1');
  });

  await test('a zone in the text block selects that zone too, and the period choice survives a tab switch', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    await page.locator('main[data-page="zone"] [data-pris-period="5"]').click();
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-period'), '5');
    await page.locator('#zList a[data-zone="no3"]').click();
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no3');
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-period'), '5', '5 døgn stays');
    assert.deepEqual((await zoneNow()).sel, ['no3']);
  });

  await test('/sv/elpris opens on SE3 in Swedish; /fi/sahkon-hinta has no tabs, snt and Finnish words', async () => {
    await page.goto(BASE + '/sv/elpris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const s = await zoneNow();
    assert.deepEqual(s.sel, ['se3']); assert.equal(s.lang, 'sv');
    assert.equal(await page.locator('#zTabs [role="tab"]').count(), 4);
    assert.equal(await page.locator('main[data-page="zone"] .pris-u').textContent(), 'öre/kWh');
    assert.deepEqual(await page.locator('main[data-page="zone"] .pris-period button').allTextContents(), ['2 dygn', '5 dygn']);
    await page.goto(BASE + '/fi/sahkon-hinta');
    await page.waitForSelector('main[data-page="zone"] .pris');
    assert.equal((await zoneNow()).lang, 'fi');
    assert.equal(await page.locator('#zTabs [role="tab"]').count(), 0);
    assert.equal(await page.locator('main[data-page="zone"] .pris-u').textContent(), 'snt/kWh');
    assert.deepEqual(await page.locator('main[data-page="zone"] .pris-period button').allTextContents(), ['2 vrk', '5 vrk']);
  });

  await test('the foreign pages offer only 2 and 5 døgn: no 10-day wording, five day rows, 120 bars', async () => {
    for (const [url, five] of [['/no/strompris', '5 døgn'], ['/sv/elpris', '5 dygn'], ['/fi/sahkon-hinta', '5 vrk']]) {
      await page.goto(BASE + url);
      await page.waitForSelector('main[data-page="zone"] .pris');
      await page.locator('main[data-page="zone"] [data-pris-period="5"]').click();
      const t = await page.evaluate(() => document.querySelector('main[data-page="zone"]').innerText);
      assert.ok(!/\b10 (døgn|dager|dygn|vrk)/i.test(t), `${url} mentions 10 days`);
      assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp5 .pc[data-tip]').count(), 120);
      assert.equal(await page.locator('main[data-page="zone"] .pris-week tbody tr').count(), 5);
      assert.ok((await page.locator('main[data-page="zone"] .pris-card.pp5 .pris-ct').textContent()).endsWith(five));
    }
  });

  await test('a hover on a zone bar shows the tooltip in the zone\'s unit, and the 5-day axis is in øre', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const plot = page.locator('main[data-page="zone"] .pris-card.pp2 .pris-plot');
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    assert.match(await page.locator('main[data-page="zone"] .pris-card.pp2 .pris-tip').textContent(), /^I morgen kl\. \d\d · \d+ øre\/kWh$/);
    const ticks = await page.locator('main[data-page="zone"] .pris-card.pp2 .pris-yl span').allTextContents();
    assert.ok(ticks.length >= 3 && ticks.every(x => /^\d+$/.test(x)), ticks.join(' '));
  });

  await test('/norden: one table of all 13 areas in DKK with the basis stated; rows link to the country pages', async () => {
    await page.goto(BASE + '/norden');
    await page.waitForSelector('main[data-page="norden"] .nt tbody tr');
    assert.equal(await page.locator('main[data-page="norden"] .nt tbody tr').count(), 13);
    assert.match(await page.locator('.nt-cap').textContent(), /DKK\/kWh uden moms, afgifter og nettariffer/);
    const hrefs = await page.locator('main[data-page="norden"] .nt tbody a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert.deepEqual(hrefs, ['/no/strompris#no1', '/no/strompris#no2', '/no/strompris#no3', '/no/strompris#no4', '/no/strompris#no5', '/sv/elpris#se1', '/sv/elpris#se2', '/sv/elpris#se3', '/sv/elpris#se4', '/fi/sahkon-hinta', '/dk1', '/dk2']);
    const no1 = await page.locator('#no1 td').allTextContents();
    assert.ok(no1.every(x => /^-?\d+,\d\d(–-?\d+,\d\d)?$/.test(x)), no1.join(' '));
    // EUR/MWh 70 + swing; rate 10 on the zone, DKK rate 10 on dk1 in this stub → kr = EUR/MWh / 100.
    assert.ok(parseFloat(no1[1].replace(',', '.')) > 0.2 && parseFloat(no1[1].replace(',', '.')) < 1.5);
    assert.equal(await page.locator('#nl th a').count(), 0, 'NL has no page');
    assert.equal(await page.locator('html').getAttribute('lang'), 'da');
  });

  await test('the old zone addresses redirect (server.js mirrors production): /no2 → /no/strompris#no2 with NO2 selected, /nl → /norden#nl', async () => {
    await page.goto(BASE + '/no2');
    await page.waitForSelector('main[data-page="zone"] .pris');
    assert.equal(new URL(page.url()).pathname, '/no/strompris'); assert.equal(new URL(page.url()).hash, '#no2');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no2');
    await page.goto(BASE + '/se4');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'se4');
    assert.equal(new URL(page.url()).pathname, '/sv/elpris');
    await page.goto(BASE + '/fi');
    assert.equal(new URL(page.url()).pathname, '/fi/sahkon-hinta');
    // The first spelling of the three pages (live for a day) goes straight to the final URL.
    for (const [from, to] of [['/norge', '/no/strompris'], ['/sverige', '/sv/elpris'], ['/finland', '/fi/sahkon-hinta']]) {
      await page.goto(BASE + from);
      assert.equal(new URL(page.url()).pathname, to, `${from} redirects to ${to}`);
    }
    await page.goto(BASE + '/nl');
    await page.waitForSelector('main[data-page="norden"] .nt tbody tr');
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).hash, '/norden#nl');
  });

  await test('the localised paths are routed: clean URL stays, hash tabs stay, a language folder alone is not a page', async () => {
    for (const [url, dp] of [['/no/strompris', 'zone'], ['/sv/elpris', 'zone'], ['/fi/sahkon-hinta', 'zone']]) {
      await page.goto(BASE + url);
      await page.waitForSelector(`main[data-page="${dp}"].active .pris`);
      assert.equal(new URL(page.url()).pathname, url); assert.equal(new URL(page.url()).hash, '');
    }
    await page.goto(BASE + '/sv/elpris#se1');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'se1');
    await page.locator('#zt-se4').click();
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'se4');
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).hash, '/sv/elpris#se4', 'a tab keeps the two-segment path and moves the hash');
    await page.goto(BASE + '/#no/strompris');
    await page.waitForFunction(() => location.pathname === '/no/strompris');
  });

  await test('an old #hash link (/#no3, /#nl) is sent to the new page', async () => {
    await page.goto(BASE + '/#no3');
    await page.waitForFunction(() => location.pathname === '/no/strompris');
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no3');
    assert.equal(new URL(page.url()).hash, '#no3');
    await page.goto(BASE + '/#nl');
    await page.waitForFunction(() => location.pathname === '/norden');
  });

  await test('footer and the net dialog link Norden, Norge, Sverige and Finland — and nothing links an old zone URL', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('main[data-page="start"].active');
    const foot = await page.locator('footer .sf-all .sf-nets > div:last-child a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert.deepEqual(foot, ['/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta']);
    for (const url of ['/', '/dk1', '/automation', '/om-elpriser', '/blog', '/blog/groennest-og-dyrest', '/tariffer', '/api', '/no/strompris', '/norden']) {
      await page.goto(BASE + url);
      await page.waitForSelector('main.active');
      const bad = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href').split('#')[0].split('?')[0]).filter(h => /^\/(no[1-5]|se[1-4]|fi|nl)$/.test(h)));
      assert.deepEqual(bad, [], `${url} links ${bad.join(', ')}`);
    }
  });

  await test('phone: /no/strompris at 390 px has no horizontal page scroll; the tab row scrolls on its own and shows the selected tab', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    await ctx2.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    await ctx2.route('**/api/nordic*', r => r.fulfill({ json: { zone: 'no5', zoneInfo: { rate: 10 }, days: Array.from({ length: 10 }, (_, i) => ({ date: new Date(Date.parse(todayDk() + 'T12:00:00Z') + (i - 1) * 86400000).toISOString().slice(0, 10), type: i < 3 ? 'actual' : 'forecast', prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 80 + h })) })) } }));
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/no/strompris#no5');
    await p2.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no5');
    assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways');
    const vis = await p2.evaluate(() => { const r = document.getElementById('zt-no5').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
    assert.ok(vis, 'the selected tab is scrolled into view');
    await ctx2.close();
  });


  // ── 10. /download: the "Hent appen" page with the two store badges ─────────

  const APPLE = 'https://apps.apple.com/dk/app/id6820474476';
  const PLAY  = 'https://play.google.com/store/apps/details?id=org.elpriser.app';
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const downloadCtx = async opts => {
    const c = await browser.newContext({ bypassCSP: true, ...opts });
    await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    return c;
  };
  /** The badges in the order they are laid out, left to right and top to bottom. */
  const badgeOrder = p => p.evaluate(() => [...document.querySelectorAll('.dl-badge')]
    .map(a => ({ id: a.classList.contains('dl-apple') ? 'apple' : 'play', x: a.getBoundingClientRect().x, y: a.getBoundingClientRect().y }))
    .sort((a, b) => a.y - b.y || a.x - b.x).map(b => b.id));

  await test('/download: H1, the honest lead, both badges with the exact links and Danish accessible names, in the same size', async () => {
    await page.goto(BASE + '/download');
    await page.waitForSelector('main[data-page="download"].active');
    assert.equal((await page.locator('main[data-page="download"] .page-title').textContent()).trim(), 'Hent Elpriser-appen');
    const main = await page.locator('main[data-page="download"]').innerText();
    assert.match(main, /i morgen og de næste 5 døgn/);
    assert.doesNotMatch(main, /10 døgn/);
    const apple = page.getByRole('link', { name: 'Hent i App Store — iPhone og iPad' });
    const play  = page.getByRole('link', { name: 'Hent på Google Play — Android' });
    assert.equal(await apple.getAttribute('href'), APPLE);
    assert.equal(await play.getAttribute('href'), PLAY);
    for (const l of [apple, play]) assert.equal(await l.getAttribute('rel'), 'noopener');
    const [a, p] = [await apple.boundingBox(), await play.boundingBox()];
    assert.ok(a.height >= 44 && a.height === p.height && a.width === p.width, `badges differ: ${JSON.stringify([a, p])}`);
    assert.equal(await page.locator('header.site-nav a.app-btn').getAttribute('aria-current'), 'page', 'the header button marks the page it leads to');
    assert.equal(await page.locator('.site-links a.on').count(), 0, 'no main-menu item claims this page');
    assert.equal(await page.evaluate(() => document.title), 'Hent Elpriser-appen — iPhone og Android, gratis');
  });

  await test('/download: header "Hent appen" navigates there from the front page, and the footer links it once', async () => {
    await page.goto(BASE + '/');
    await page.locator('header.site-nav a.app-btn').click();
    await page.waitForSelector('main[data-page="download"].active');
    assert.equal(await page.evaluate(() => location.pathname), '/download');
    assert.deepEqual(await page.locator('footer a[href="/download"]').allTextContents(), ['Hent appen']);
  });

  await test('/download: no device hides a store — desktop shows both side by side, iPhone puts the App Store first, Android Google Play first', async () => {
    const desk = await page.context().newPage();
    await desk.setViewportSize({ width: 1280, height: 800 });
    await desk.goto(BASE + '/download');
    await desk.waitForSelector('.dl-badge');
    assert.deepEqual(await badgeOrder(desk), ['apple', 'play']);
    const rows = await desk.evaluate(() => [...document.querySelectorAll('.dl-badge')].map(a => Math.round(a.getBoundingClientRect().y)));
    assert.equal(rows[0], rows[1], 'side by side on a desktop');
    await desk.close();

    for (const [ua, want] of [[IOS_UA, ['apple', 'play']], [ANDROID_UA, ['play', 'apple']]]) {
      const c = await downloadCtx({ userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      await p.goto(BASE + '/download');
      await p.waitForSelector('.dl-badge');
      assert.deepEqual(await badgeOrder(p), want, ua.slice(0, 40));
      assert.equal(await p.locator('.dl-badge').evaluateAll(l => l.every(a => a.getBoundingClientRect().width > 0 && getComputedStyle(a).display !== 'none')), true, 'both badges stay visible');
      await c.close();
    }
    // JavaScript off: the markup order, App Store first, and both there.
    const c = await downloadCtx({ userAgent: ANDROID_UA, javaScriptEnabled: false });
    const p = await c.newPage();
    await p.goto(BASE + '/download');
    assert.equal(await p.locator('.dl-badge').count(), 2);
    await c.close();
  });

  await test('/download: dark mode — page, badges and text all follow the dark ramp', async () => {
    const c = await downloadCtx({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    await p.goto(BASE + '/download');
    await p.waitForSelector('.dl-badge');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), true);
    const look = await p.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      title: getComputedStyle(document.querySelector('main[data-page="download"] .page-title')).color,
      btn: getComputedStyle(document.querySelector('.app-btn')).backgroundColor,
    }));
    assert.equal(look.body, 'rgb(13, 18, 33)', 'the dark page ground');
    assert.equal(look.title, 'rgb(232, 237, 245)', 'light title on dark');
    assert.equal(look.btn, 'rgb(238, 242, 249)', 'the header button flips with the theme, as before');
    await c.close();
  });

  await test('/download: at 390 px there is no horizontal scroll, the badges stack at full size, and every link is at least 44 px', async () => {
    const c = await downloadCtx({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await p.goto(BASE + '/download');
    await p.waitForSelector('.dl-badge');
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.equal(sw[0], sw[1], `horizontal scroll: ${sw.join(' vs ')}`);
    const boxes = await p.locator('.dl-badge').evaluateAll(l => l.map(a => { const r = a.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
    assert.equal(boxes[0][0], boxes[1][0], 'stacked, left-aligned');
    assert.ok(boxes[1][1] > boxes[0][1], 'one under the other');
    assert.ok(boxes.every(b => b[3] >= 44 && b[2] + b[0] <= 390), JSON.stringify(boxes));
    await c.close();
  });


  // ── City pages: /elpris/<by> ─────────────────────────────────────────────────

  /** A browser context of its own (colour scheme, viewport) that sees the same fixture and the same city render. */
  const cityCtx = async opts => {
    const c = await browser.newContext({ bypassCSP: true, ...opts });
    await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    await c.route('**/api/forecast*', forecastRoute);
    await c.route('**/elpris/*', cityRoute);
    return c;
  };
  const byName = n => CITIES.find(c => c.name === n);
  const multi = CITIES.find(c => c.nets[0].share < 0.75) || CITIES[0];

  for (const c of [byName('Silkeborg'), byName('København'), multi]) {
    const main = c.nets[0];
    await test(`city: /elpris/${c.slug} is its own page — heading, the Pris screen for ${main.name}, the chip, the text`, async () => {
      forecastRequests.length = 0;
      await page.goto(BASE + '/dk1/lnet');   // a visitor who has picked LNet (a net page remembers its net) ...
      await page.waitForSelector('main[data-page="prices"].active .pris-now');
      await page.goto(BASE + '/elpris/' + c.slug);
      await page.waitForSelector('main[data-page="city"].active .pris .pris-now');
      assert.equal(await page.locator('main[data-page]').count(), 1, 'only the city section is in the page');
      assert.equal((await page.locator('h1').allTextContents()).join('|'), `Elpris i ${c.name} i dag — time for time`);
      assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('net_inkl_alt', main.gln, hourDk())), 'the big number is the main net\'s all-in price');
      assert.ok(forecastRequests.includes(`${c.area}|net_inkl_alt|${main.gln}`), `asked for ${forecastRequests.join(', ')}`);
      assert.equal((await page.locator('.pris-cap').first().textContent()).trim(), 'Inkl. nettarif, afgifter og moms');
      assert.equal((await page.locator('#netChipLong').textContent()).trim(), `${main.name} · ${c.area === 'DK2' ? 'Østdanmark' : 'Vestdanmark'}`);
      assert.equal(await page.evaluate(() => location.pathname), '/elpris/' + c.slug, 'the address stays');
      assert.equal(await page.title(), `Elpris i ${c.name} i dag — time for time inkl. nettarif`, 'the router leaves the server\'s title alone');
      assert.equal(await page.evaluate(() => localStorage.getItem('dk_net_pick')), 'DK1/net_inkl_alt/lnet', '... and looking at a city neither replaces that pick nor makes the city\'s net the visitor\'s own');
      const text = await page.locator('main[data-page="city"]').innerText();
      assert.ok(text.includes(`Hos ${main.name} er nettariffen i dag lavest kl. 00–17 og 21–24 (0,20 kr/kWh) og højest kl. 17–21 (0,50 kr/kWh)`), text.slice(0, 600));
      assert.equal(await page.locator('.pris-period [data-pris-period]').count(), 2, 'only 2 og 5 døgn');
    });
  }

  await test('city: "Er dit netselskab et andet? Skift" opens the net chooser, the city\'s net is marked, and another net opens its own page', async () => {
    await page.goto(BASE + '/elpris/silkeborg');
    await page.waitForSelector('main[data-page="city"].active .pris-now');
    const dlg = page.locator('#netDialog');
    assert.equal(await dlg.evaluate(d => d.open), false);
    await page.getByRole('button', { name: 'Er dit netselskab et andet? Skift' }).click();
    assert.equal(await dlg.evaluate(d => d.open), true, 'the existing dialog opens');
    assert.deepEqual(await page.locator('#netDialog .pd-links a.on').allTextContents(), ['N1'], 'the city\'s main net is the marked one');
    await page.locator('#netDlgDK1 a', { hasText: /^Trefor$/ }).click();
    await page.waitForSelector('main[data-page="prices"].active');
    assert.equal(await page.evaluate(() => location.pathname), '/dk1/trefor');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'Trefor · Vestdanmark');
  });

  await test('dinel: the Aarhus page links Dinel\'s page, which opens with Dinel\'s Pris screen (its GLN is asked for)', async () => {
    forecastRequests.length = 0;
    await page.goto(BASE + '/elpris/aarhus');
    await page.waitForSelector('main[data-page="city"].active .pris-now');
    assert.equal((await page.locator('main[data-page="city"] a[href="/dk1/dinel"]').first().textContent()).trim(), 'Dinel', 'Aarhus names Dinel as a link');
    await page.locator('main[data-page="city"] a[href="/dk1/dinel"]').first().click();
    await page.waitForSelector('main[data-page="prices"].active .pris-now');
    assert.equal(await page.evaluate(() => location.pathname), '/dk1/dinel');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'Dinel · Vestdanmark');
    assert.ok(forecastRequests.includes('DK1|net_inkl_alt|5790000610099'), `asked for ${forecastRequests.join(', ')}`);
    assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('net_inkl_alt', '5790000610099', hourDk())), 'the big number is Dinel\'s all-in price');
    // The net dialog (built from NETS) lists it in DK1 only.
    assert.equal(await page.locator('#netDlgDK1 a[data-net="dinel"]').count(), 1, 'the dialog offers Dinel in DK1');
    assert.equal(await page.locator('#netDlgDK2 a[data-net="dinel"]').count(), 0, 'and not in DK2');
  });

  await test('city: Kun spotpris is a view of the same page, and 5 døgn shows five days', async () => {
    forecastRequests.length = 0;
    await page.goto(BASE + '/elpris/silkeborg');
    await page.waitForSelector('main[data-page="city"].active .pris-now');
    await page.locator('.pris-seg-hero button', { hasText: 'Kun spotpris' }).click();
    await page.waitForFunction(() => document.querySelector('.pris-cap')?.textContent.trim() === 'Spotpris inkl. moms');
    assert.equal(await page.evaluate(() => location.pathname), '/elpris/silkeborg', 'still the city page');
    assert.ok(forecastRequests.includes('DK1|spot_inkl|'), forecastRequests.join(', '));
    await page.locator('.pris-period [data-pris-period="5"]').click();
    assert.equal(await page.locator('.pris-period [aria-selected="true"]').getAttribute('data-pris-period'), '5');
    assert.equal(await page.locator('.pris-period [data-pris-period]').count(), 2, 'no ten-day pill');
  });

  await test('city: a link in the footer\'s Byer list opens the page, and the net page links back to the city', async () => {
    await page.goto(BASE + '/');
    await page.locator('footer details.sf-all > summary').click();
    await page.locator('footer a[href="/elpris/koebenhavn"]').click();
    await page.waitForSelector('main[data-page="city"].active');
    assert.equal(await page.evaluate(() => location.pathname), '/elpris/koebenhavn');
    assert.match(await page.locator('h1').textContent(), /Elpris i København/);
  });

  await test('city: at 390 px nothing scrolls sideways, the text wraps, and the chooser button is a 44 px target', async () => {
    const c = await cityCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    for (const city of [byName('Silkeborg'), multi]) {
      await p.goto(BASE + '/elpris/' + city.slug);
      await p.waitForSelector('main[data-page="city"].active .pris-now');
      const m = await p.evaluate(() => {
        const b = document.querySelector('main[data-page="city"] button.gps-light').getBoundingClientRect();
        const t = document.querySelector('main[data-page="city"] .text-sm').getBoundingClientRect();
        return { sw: [document.documentElement.scrollWidth, innerWidth], h: b.height, w: b.width, tr: t.right, tl: t.left };
      });
      assert.equal(m.sw[0], m.sw[1], `${city.slug}: horizontal scroll ${m.sw.join(' vs ')}`);
      assert.ok(m.h >= 44, `${city.slug}: button height ${m.h}`);
      assert.ok(m.w <= 390 && m.tr <= 390 && m.tl >= 0, `${city.slug}: inside the viewport ${JSON.stringify(m)}`);
    }
    await c.close();
  });

  await test('city: dark mode — the heading, the text and the page follow the dark ramp', async () => {
    const c = await cityCtx({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    await p.goto(BASE + '/elpris/silkeborg');
    await p.waitForSelector('main[data-page="city"].active .pris-now');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), true);
    const look = await p.evaluate(() => {
      const rgb = e => getComputedStyle(e).color;
      return {
        body: getComputedStyle(document.body).backgroundColor,
        title: rgb(document.querySelector('main[data-page="city"] h1')),
        text: rgb(document.querySelector('main[data-page="city"] .text-sm p')),
        link: rgb(document.querySelector('main[data-page="city"] .text-sm a')),
        btn: getComputedStyle(document.querySelector('main[data-page="city"] button.gps-light')).color,
      };
    });
    assert.equal(look.body, 'rgb(13, 18, 33)', 'the dark page ground');
    assert.equal(look.title, 'rgb(232, 237, 245)', 'light heading on dark');
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.ok(lum(look.text) > 0.5 && lum(look.link) > 0.4 && lum(look.btn) > 0.4, `readable on dark: ${JSON.stringify(look)}`);
    await c.close();
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
