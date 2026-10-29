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
  // /prognose is written by the Pages Function too (the screen for DK1 on 7 døgn is in the HTML it serves): the same treatment.
  const prognoseRoute = async route => {
    const u = new URL(route.request().url());
    if (route.request().resourceType() !== 'document' || u.pathname !== '/prognose') return route.fallback();
    const r = await ssrCity(u.pathname);
    route.fulfill({ status: r.status, contentType: 'text/html; charset=utf-8', body: r.body });
  };
  await ctx.route('**/prognose', prognoseRoute);

  // server.js has no /api/nordic either. The foreign-area pages draw from it, so answer it for all thirteen
  // zones with ten days from yesterday (like the live feed). The price encodes the zone, so a tab switch is visible:
  // EUR/MWh = 10 × (zone number) + the day's swing, at rate 10 → øre/kWh = EUR/MWh.
  // The four EU zones (indices 13 to 16) answer like the EU job's KV values: yesterday, today and tomorrow, all `actual`,
  // EUR rate 1 (Poland 4.4), no model; `euDays` is how many of those days are published (2: tomorrow is not).
  const ZN = ['dk1', 'dk2', 'no1', 'no2', 'no3', 'no4', 'no5', 'se1', 'se2', 'se3', 'se4', 'fi', 'nl',
    'de', 'fr', 'pl', 'it-n'];
  const nordicRequests = [];
  let euDays = 3;
  const nordicRoute = route => {
    const zone = new URL(route.request().url()).searchParams.get('zone');
    nordicRequests.push(zone);
    const k = ZN.indexOf(zone);
    if (k < 0) return route.fulfill({ status: 400, json: { error: 'zone' } });
    const base = Date.parse(todayDk() + 'T12:00:00Z');
    if (k >= 13) {
      const b = Date.parse(todayDk() + 'T12:00:00Z');
      return route.fulfill({ json: { zone, unit: 'EUR/MWh', trainedThrough: null, zoneInfo: { rate: zone === 'pl' ? 4.4 : 1, currency: zone === 'pl' ? 'PLN' : 'EUR' },
        days: Array.from({ length: euDays }, (_, i) => ({ date: new Date(b + (i - 1) * 86400000).toISOString().slice(0, 10), type: 'actual',
          prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(60 + (k - 13) * 10 + Math.sin(h / 24 * 6.28) * 25 + i).toFixed(2) })) })) } });
    }
    route.fulfill({ json: { zone, unit: 'EUR/MWh', zoneInfo: { rate: 10, currency: 'X' },
      days: Array.from({ length: 10 }, (_, i) => ({
        date: new Date(base + (i - 1) * 86400000).toISOString().slice(0, 10), type: i < 3 ? 'actual' : 'forecast',
        prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(60 + k * 10 + Math.sin(h / 24 * 6.28) * 25 + i).toFixed(2) })) })) } });
  };
  await ctx.route('**/api/nordic*', nordicRoute);   // all thirteen zones, nl included (index 12: the Dutch page draws from it)
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
    ['/nl/stroomprijs',                        'zone'],
    ['/de/strompreis',                         'zone'],
    ['/fr/prix-electricite',                   'zone'],
    ['/pl/ceny-pradu',                         'zone'],
    ['/it/prezzo-luce',                        'zone'],
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
                     '/om-elpriser', '/download', '/prognose', '/dk1', '/dk2', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce', '/norden']) {
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

  await test('start: no area cards and no 16-button net list — one compact row instead', async () => {
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

  await test('start: "Find dit netselskab" opens the net dialog, which lists all 16 nets; choosing one opens its page', async () => {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.clear());
    await page.locator('main[data-page="start"] [data-area-row] button').click();
    await page.waitForSelector('#netDialog[open]');
    assert.equal((await page.locator('#netDialogTitle').textContent()).trim(), 'Netselskab og indstillinger');
    // 16 nets plus one "Uden netselskab" per area.
    assert.equal(await page.locator('#netDialog .pd-links a[data-net]:not([data-net=""])').count(), 16, 'the dialog lists every net');
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
    // The window opens up to six hours before now: tomorrow 13 is slot 37 minus the hour it opens on.
    const open = hourDk() - Math.min(6, hourDk()), len = 48 + Math.min(6, hourDk());
    await page.mouse.click(box.x + box.width * (24 + 13 - open + 0.5) / len, box.y + box.height * 0.7);
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
    // 2 døgn is the six hours before now (fewer in the small hours) and 48 hours on from the current hour: the last bar is 47 hours after now.
    const now = hourDk(), first = now - Math.min(6, now), last = (now + 47) % 24;
    for (const [fx, hour, day] of [[0.005, first, 'I dag'], [0.995, last, now === 0 ? 'I morgen' : null]]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.7);
      const tip = page.locator('.pp2 .pris-tip');
      await tip.waitFor({ state: 'visible' });
      const want = `kl. ${String(hour).padStart(2, '0')} · ${pris(fixturePrice('inkl_alt', null, hour))} kr/kWh`, got = (await tip.textContent()).trim();
      assert.ok(day ? got === `${day} ${want}` : got.endsWith(want) && /^(man|tir|ons|tor|fre|lør|søn) \d+\. \w+ kl\./.test(got), `${got} is not ${day || 'a later day'} ${want}`);
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
    // Dropdown should have every net across DK1+DK2 (13 + 3 = 16+)
    await page.waitForFunction(() =>
      document.querySelectorAll('#autoNet option').length >= 16);
    const netCount = await page.locator('#autoNet option').count();
    assert.ok(netCount >= 16, `#autoNet has ${netCount} options, expected ≥16 (all DK1+DK2 nets)`);
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

  // ── 6. Forecast page — the Pris screen on 2 | 5 | 7 døgn, area and net from the header chip ──

  await page.setViewportSize({ width: 1280, height: 720 });
  /** The state of the screen as a visitor sees it: only what is displayed counts. */
  const progView = () => page.evaluate(() => {
    const vis = e => e.getClientRects().length > 0;
    const card = [...document.querySelectorAll('main[data-page="prognose"] .pris-card')].filter(vis);
    const tiles = [...document.querySelectorAll('main[data-page="prognose"] .pris-tiles')].filter(vis);
    const rows = [...document.querySelectorAll('main[data-page="prognose"] .pris-week tbody tr')].filter(vis);
    return {
      period: document.querySelector('main[data-page="prognose"] .pris').dataset.period,
      cards: card.map(c => c.getAttribute('aria-label')), bars: card.map(c => c.querySelectorAll('.pc').length),
      labels: card.map(c => [...c.querySelectorAll('.pris-xl span')].map(x => x.textContent)),
      tiles: tiles.map(t => t.className), rows: rows.length,
      unc: rows.map(r => r.lastElementChild.textContent), type: rows.map(r => r.children[3].textContent),
      lead: document.getElementById('fcPeriodDays').textContent,
      selected: document.querySelector('main[data-page="prognose"] .pris-period [aria-selected="true"]').dataset.prisPeriod,
    };
  });

  await test('prognose: the canonical Pris screen — one h1, head, 2 | 5 | 7 døgn opening on 7, no selects, no old chart', async () => {
    await page.goto(BASE + '/prognose');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    assert.deepEqual(await page.locator('h1').allTextContents(), ['Elprisprognose']);
    assert.equal((await page.locator('main[data-page="prognose"] .page-eyebrow').textContent()).trim(), 'Forventede elpriser · DK1 Vest');
    assert.equal((await page.locator('main[data-page="prognose"] #fcPeriodDays').evaluate(e => e.parentElement.textContent)).trim(),
      'Nu og 7 døgn frem, time for time: faktiske børspriser, så langt de er afregnet, og en prognose for resten. Jo længere frem, jo mere usikker er den.');
    assert.deepEqual((await page.locator('.pris-period [role="tab"]').allTextContents()).map(t => t.trim()), ['2 døgn', '5 døgn', '7 døgn']);
    const v = await progView();
    assert.equal(v.period, '7'); assert.equal(v.selected, '7');
    assert.deepEqual(v.cards, ['Næste 7 døgn']); assert.deepEqual(v.bars, [168]); assert.equal(v.rows, 7);
    assert.deepEqual(v.tiles, ['pris-tiles pp7']);
    assert.equal(await page.locator('main[data-page="prognose"] select').count(), 0, 'the area and mode selects are gone');
    for (const gone of ['#fcArea', '#fcMode', '#fcTable', '#fcCurve', '#prognoseForecast', '#prognoseWeek', '.fcweek'])
      assert.equal(await page.locator(gone).count(), 0, `${gone} is back`);
    assert.ok(!/Nu og 2 døgn frem|10 døgn|10 dage/.test(await page.locator('main[data-page="prognose"]').innerText()), 'old or ten-day wording on the page');
    assert.equal(await page.title(), 'Elpriser prognose 7 dage — time for time, DK1 og DK2');
    assert.equal(await page.evaluate(() => location.pathname), '/prognose');
    // The big number is the area's price now (DK1, no net), like the front page; the sections below the screen are text.
    assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('inkl_alt', null, hourDk())));
    assert.ok((await page.locator('main[data-page="prognose"] h2').allTextContents()).slice(0, 2).join('|') === 'Sådan laves prognosen|Det kan prognosen ikke');
  });

  await test('prognose: 2 → 5 → 7 døgn changes the card, the bars, the labels, the tiles, the rows, Usikkerhed and the lead', async () => {
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    const want = {
      2: { card: 'Næste 2 døgn', bars: 48 + Math.min(6, hourDk()), rows: 2, unc: ['—', 'Lav'], tile: 'pp2' },
      5: { card: 'Næste 5 døgn', bars: 120, rows: 5, unc: ['—', 'Lav', 'Lav', 'Middel', 'Middel'], tile: 'pp5' },
      7: { card: 'Næste 7 døgn', bars: 168, rows: 7, unc: ['—', 'Lav', 'Lav', 'Middel', 'Middel', 'Middel', 'Høj'], tile: 'pp7' },
    };
    const seen = [];
    for (const n of [2, 5, 7]) {
      await page.locator(`.pris-period [data-pris-period="${n}"]`).click();
      const v = await progView(), w = want[n];
      assert.equal(v.period, String(n)); assert.equal(v.selected, String(n));
      assert.deepEqual(v.cards, [w.card], `${n}: the visible card`); assert.deepEqual(v.bars, [w.bars], `${n}: bars`);
      assert.equal(v.rows, w.rows, `${n}: day rows`); assert.deepEqual(v.unc, w.unc, `${n}: Usikkerhed`);
      assert.deepEqual(v.tiles, [`pris-tiles ${w.tile}`], `${n}: tiles`); assert.equal(v.lead, String(n), `${n}: the lead`);
      assert.deepEqual(v.type.slice(0, 2), ['Børspris', 'Børspris'], `${n}: Type stays Børspris/Prognose`);
      seen.push(v.labels[0]);
    }
    assert.ok(seen[0].length >= 6 && seen[0].includes('I morgen 00') && seen[0].every(l => /^(\d\d|I morgen 00|I dag 00|\S+ 00)$/.test(l)), '2 døgn keeps its hourly labels, by the clock from now');
    assert.equal(seen[1].length, 5, '5 døgn: a label per day'); assert.equal(seen[2].length, 7, '7 døgn: a label per day');
    assert.match(seen[2][0], /^(søn|man|tir|ons|tor|fre|lør) \d+$/, 'weekday and date');
    assert.equal(await page.locator('.pris-period [data-pris-period="7"]').getAttribute('aria-selected'), 'true');
    // Back to the front page: its pill is untouched.
    await page.goto(BASE + '/');
    await page.waitForSelector('main[data-page="start"].active .pris');
    assert.deepEqual((await page.locator('.pris-period [role="tab"]').allTextContents()).map(t => t.trim()), ['2 døgn', '5 døgn']);
    assert.equal(await page.locator('main[data-page="start"] .pris').getAttribute('data-period'), '2', 'the front page still opens on 2 døgn');
  });

  // The written summary ("Ugen i korte træk"): one card per period in the HTML, only the chosen one is shown.
  const sumView = () => page.evaluate(() => {
    const vis = [...document.querySelectorAll('main[data-page="prognose"] .pris-sum')].filter(e => e.getClientRects().length);
    return vis.map(e => ({ heading: e.querySelector('.pris-dt').textContent, items: [...e.querySelectorAll('li')].map(li => li.textContent) }));
  });
  await test('prognose: the written summary sits between the chart and "Dag for dag", follows 2 → 5 → 7 døgn, and the header chip (area and net)', async () => {
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    const order = await page.evaluate(() => {
      const m = document.querySelector('main[data-page="prognose"] .pris'), kids = [...m.children].map(c => c.className.split(' ')[0] + (c.classList.contains('pris-sum') ? ' ' + [...c.classList].find(x => /^pp\d/.test(x)) : ''));
      return kids.join('|');
    });
    assert.match(order, /pris-right\|pris-days pp2\|pris-days pp5\|pris-days pp7\|pris-days$/, order);
    const want = { 2: ['I dag og i morgen i korte træk', /^Sikkerhed: begge dage er sikre\.$/], 5: ['De næste 5 døgn i korte træk', /^Sikkerhed: /], 7: ['Ugen i korte træk', /^Sikkerhed: /] };
    const heads = [];
    for (const n of [2, 5, 7]) {
      await page.locator(`.pris-period [data-pris-period="${n}"]`).click();
      const v = await sumView();
      assert.equal(v.length, 1, `${n}: exactly one summary is visible`);
      assert.equal(v[0].heading, want[n][0]);
      assert.ok(v[0].items.length >= 3 && v[0].items.length <= 5, `${n}: ${v[0].items.length} bullets`);
      assert.match(v[0].items.at(-1), want[n][1]);
      assert.ok(!/NaN|undefined|10 d/.test(v[0].items.join(' ')), v[0].items.join(' '));
      heads.push(v[0].heading);
    }
    assert.equal(new Set(heads).size, 3);
    const dk1 = (await sumView())[0].items.join('|');
    await page.locator('#netChip').click();
    await page.waitForSelector('#netDialog[open]');
    await page.locator('#netDlgDK2 a', { hasText: /^Radius$/ }).click();
    await page.waitForFunction(() => document.querySelector('main[data-page="prognose"] .pris')?.dataset.key === 'DK2|din|radius');
    const radius = (await sumView())[0].items.join('|');
    assert.notEqual(radius, dk1, 'the summary follows area and net (the numbers are Radius\'s all-in prices)');
    await page.locator('#netChip').click();
    await page.locator('#netDlgDK1 a[data-net=""]').click();
    await page.waitForFunction(() => document.querySelector('main[data-page="prognose"] .pris')?.dataset.key === 'DK1|din|');
    assert.equal((await sumView())[0].items.join('|'), dk1, 'back to DK1: the same summary again');
    await page.evaluate(() => localStorage.clear());
  });

  await test('prognose: the written summary fits at 390 px in every period and is readable in dark mode', async () => {
    for (const dark of [false, true]) {
      const c = await browser.newContext({ viewport: dark ? { width: 1280, height: 800 } : { width: 390, height: 844 }, isMobile: !dark, hasTouch: !dark, colorScheme: dark ? 'dark' : 'light', bypassCSP: true });
      await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
      await c.route('**/api/forecast*', forecastRoute);
      await c.route('**/prognose', prognoseRoute);
      const p = await c.newPage();
      await p.goto(BASE + '/prognose');
      await p.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
      for (const n of [7, 5, 2]) {
        await p.locator(`.pris-period [data-pris-period="${n}"]`).click();
        const m = await p.evaluate(() => {
          const s = [...document.querySelectorAll('main[data-page="prognose"] .pris-sum')].find(e => e.getClientRects().length), r = s.getBoundingClientRect();
          const lum = c => { const [a, b, d] = c.match(/\d+/g).map(Number); return (0.2126 * a + 0.7152 * b + 0.0722 * d) / 255; };
          const li = s.querySelector('li');
          return { sw: [document.documentElement.scrollWidth, innerWidth], box: [r.left, r.right], over: [...s.querySelectorAll('li')].some(l => l.scrollWidth > l.clientWidth + 1),
            card: lum(getComputedStyle(s).backgroundColor), text: lum(getComputedStyle(li).color) };
        });
        assert.equal(m.sw[0], m.sw[1], `${n}: horizontal scroll ${m.sw.join(' vs ')}`);
        assert.ok(m.box[0] >= 0 && m.box[1] <= m.sw[1], `${n}: the summary card is outside the screen`);
        assert.ok(!m.over, `${n}: a bullet overflows`);
        if (dark) assert.ok(m.card < 0.25 && m.text > 0.45, `${n}: dark card ${m.card} text ${m.text}`);
        else assert.ok(m.card > 0.8 && m.text < 0.4, `${n}: light card ${m.card} text ${m.text}`);
      }
      await c.close();
    }
  });

  await test('prognose: a legacy period (10, "3–10") reads as 7; the arrow keys walk 2 → 5 → 7 → 2 round the pill; the page does not move to the tooltips', async () => {
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    await page.locator('.pris-period [data-pris-period="2"]').click();
    for (const legacy of [10, '10', '3–10', '3-10']) {
      await page.locator('.pris-period [data-pris-period="2"]').click();
      await page.evaluate(v => setPrisPeriod(v), legacy);
      assert.equal(await page.locator('main[data-page="prognose"] .pris').getAttribute('data-period'), '7', `legacy ${legacy}`);
    }
    await page.locator('.pris-period [data-pris-period="2"]').click();
    await page.locator('.pris-period [data-pris-period="2"]').focus();
    const order = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); order.push(await page.evaluate(() => document.activeElement.dataset.prisPeriod)); }
    assert.deepEqual(order, ['5', '7', '2']);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.prisPeriod), '7');
    assert.equal(await page.locator('main[data-page="prognose"] .pris').getAttribute('data-period'), '7');
  });

  await test('prognose: hovering a bar of the 7 døgn chart shows the exact price and the day; a later day can be picked', async () => {
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    const plot = page.locator('.pp7 .pris-plot');
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width * 0.93, box.y + box.height / 2);
    const tip = (await page.locator('.pp7 .pris-tip').textContent()).trim();
    assert.match(tip, /^(søn|man|tir|ons|tor|fre|lør) \d+\. [a-zæøå]+ kl\. \d\d · \d,\d\d kr\/kWh$/, tip);
    await page.mouse.click(box.x + box.width * 0.93, box.y + box.height / 2);
    assert.equal(await page.locator('main[data-page="prognose"] .pris-bdback').count() > 0, true, 'the picked bar opens the breakdown for its day');
  });

  await test('prognose: the header chip chooses the area and net on the page itself — the address stays, the screen, eyebrow and chip follow', async () => {
    await page.goto(BASE + '/prognose');
    await page.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    forecastRequests.length = 0;
    await page.locator('#netChip').click();
    await page.waitForSelector('#netDialog[open]');
    await page.locator('#netDlgDK2 a', { hasText: /^Radius$/ }).click();
    await page.waitForFunction(() => document.querySelector('main[data-page="prognose"] .pris')?.dataset.key === 'DK2|din|radius');
    assert.equal(await page.evaluate(() => location.pathname), '/prognose', 'the address stays');
    assert.equal(await page.locator('#netDialog').evaluate(d => d.open), false, 'the dialog closes');
    assert.equal((await page.locator('#fcWhere').textContent()).trim(), 'DK2 Øst · Radius');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'Radius · Østdanmark');
    assert.ok(forecastRequests.includes('DK2|net_inkl_alt|5790000705689'), forecastRequests.join(', '));
    assert.equal((await page.locator('.pris-now').textContent()).trim(), pris(fixturePrice('net_inkl_alt', '5790000705689', hourDk())), 'the big number is Radius\'s all-in price');
    const v = await progView();
    assert.equal(v.period, '7', 'the period survives'); assert.equal(v.rows, 7);
    assert.equal(await page.evaluate(() => localStorage.getItem('dk_net_pick')), 'DK2/net_inkl_alt/radius', 'the choice is remembered like any net pick');
    // The period word in the lead follows too, and a reload comes back to the remembered net.
    await page.locator('.pris-period [data-pris-period="5"]').click();
    assert.equal((await page.locator('#fcPeriodDays').textContent()).trim(), '5');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('main[data-page="prognose"] .pris')?.dataset.key === 'DK2|din|radius');
    assert.equal((await page.locator('#fcWhere').textContent()).trim(), 'DK2 Øst · Radius');
    assert.equal((await page.locator('#fcPeriodDays').textContent()).trim(), '7', 'a fresh visit opens on 7 døgn again');
    // "Uden netselskab" in DK1: the area's own price.
    forecastRequests.length = 0;
    await page.locator('#netChip').click();
    await page.locator('#netDlgDK1 a[data-net=""]').click();
    await page.waitForFunction(() => document.querySelector('main[data-page="prognose"] .pris')?.dataset.key === 'DK1|din|');
    assert.equal((await page.locator('#fcWhere').textContent()).trim(), 'DK1 Vest');
    assert.equal((await page.locator('#netChipLong').textContent()).trim(), 'DK1 · Vestdanmark');
    assert.ok(forecastRequests.includes('DK1|inkl_alt|'), forecastRequests.join(', '));
    // The dialog's other links still leave the page: Norge is a page of its own.
    await page.locator('#netChip').click();
    await page.locator('#netDialog a[href="/no/strompris"]').click();
    await page.waitForURL(u => u.pathname === '/no/strompris');
    await page.evaluate(() => localStorage.clear());
  });

  await test('prognose: at 390 px nothing scrolls sideways in any of the three periods, and the day list fits its card', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
    await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    await c.route('**/api/forecast*', forecastRoute);
    await c.route('**/prognose', prognoseRoute);
    const p = await c.newPage();
    await p.goto(BASE + '/prognose');
    await p.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    for (const n of [7, 5, 2]) {
      await p.locator(`.pris-period [data-pris-period="${n}"]`).tap();
      const m = await p.evaluate(() => {
        const t = document.querySelector('main[data-page="prognose"] .pris-week'), d = t.closest('.pris-days').getBoundingClientRect();
        const card = [...document.querySelectorAll('main[data-page="prognose"] .pris-card')].find(c => c.getClientRects().length).getBoundingClientRect();
        return { sw: [document.documentElement.scrollWidth, innerWidth], table: [t.getBoundingClientRect().right, d.right], card: [card.left, card.right],
          cells: [...t.querySelectorAll('thead th')].map(x => x.textContent) };
      });
      assert.equal(m.sw[0], m.sw[1], `${n}: horizontal scroll ${m.sw.join(' vs ')}`);
      assert.ok(m.table[0] <= m.table[1] + 0.5, `${n}: the day list overflows its card ${m.table.join(' > ')}`);
      assert.ok(m.card[0] >= 0 && m.card[1] <= 390, `${n}: the chart card is outside the screen ${m.card.join(', ')}`);
      assert.equal(m.cells[m.cells.length - 1], 'Usikkerhed');
    }
    await c.close();
  });

  await test('prognose: dark mode — the head, the screen, the day list and the text blocks follow the dark ramp', async () => {
    const c = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, bypassCSP: true });
    await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    await c.route('**/api/forecast*', forecastRoute);
    await c.route('**/prognose', prognoseRoute);
    const p = await c.newPage();
    await p.goto(BASE + '/prognose');
    await p.waitForSelector('main[data-page="prognose"].active .pris .pris-now');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), true);
    const look = await p.evaluate(() => {
      const col = e => getComputedStyle(e).color, bgc = e => getComputedStyle(e).backgroundColor;
      const m = document.querySelector('main[data-page="prognose"]');
      return { body: bgc(document.body), h1: col(m.querySelector('h1')), eyebrow: col(m.querySelector('.page-eyebrow')), lead: col(m.querySelector('#fcPeriodDays').parentElement),
        block: col(m.querySelector('h2 + p')), heading: col(m.querySelector('h2')), link: col(m.querySelector('h2 + p a')),
        hero: bgc(m.querySelector('.pris-hero')), cell: col(m.querySelector('.pris-week tbody td')), unc: col(m.querySelector('.pris-week tbody tr:last-child td:last-child')),
        days: bgc(m.querySelector('.pris-days')) };
    });
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.equal(look.body, 'rgb(13, 18, 33)', 'the dark page ground');
    assert.equal(look.h1, 'rgb(232, 237, 245)', 'light heading on dark');
    for (const k of ['eyebrow', 'lead', 'block', 'heading', 'link', 'cell', 'unc']) assert.ok(lum(look[k]) > 0.45, `${k} is too dark on dark: ${look[k]}`);
    for (const k of ['hero', 'days']) assert.ok(lum(look[k]) < 0.25, `${k} is not a dark card: ${look[k]}`);
    await c.close();
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
    assert.equal(await page.locator('footer details.sf-all a[href^="/dk"]').count(), 16, '16 net links in the DOM');
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
    for (const [url, five] of [['/no/strompris', '5 døgn'], ['/sv/elpris', '5 dygn'], ['/fi/sahkon-hinta', '5 vrk'], ['/nl/stroomprijs', '5 dagen']]) {
      await page.goto(BASE + url);
      await page.waitForSelector('main[data-page="zone"] .pris');
      await page.locator('main[data-page="zone"] [data-pris-period="5"]').click();
      const t = await page.evaluate(() => document.querySelector('main[data-page="zone"]').innerText);
      assert.ok(!/\b10 (døgn|dager|dygn|vrk|dagen)/i.test(t), `${url} mentions 10 days`);
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
    assert.deepEqual(hrefs, ['/no/strompris#no1', '/no/strompris#no2', '/no/strompris#no3', '/no/strompris#no4', '/no/strompris#no5', '/sv/elpris#se1', '/sv/elpris#se2', '/sv/elpris#se3', '/sv/elpris#se4', '/fi/sahkon-hinta', '/nl/stroomprijs', '/dk1', '/dk2']);
    const no1 = await page.locator('#no1 td').allTextContents();
    assert.ok(no1.every(x => /^-?\d+,\d\d(–-?\d+,\d\d)?$/.test(x)), no1.join(' '));
    // EUR/MWh 70 + swing; rate 10 on the zone, DKK rate 10 on dk1 in this stub → kr = EUR/MWh / 100.
    assert.ok(parseFloat(no1[1].replace(',', '.')) > 0.2 && parseFloat(no1[1].replace(',', '.')) < 1.5);
    assert.equal(await page.locator('#nl th a').getAttribute('href'), '/nl/stroomprijs', 'NL has a page of its own, like the other countries');
    assert.equal(await page.locator('html').getAttribute('lang'), 'da');
  });

  await test('the old zone addresses redirect (server.js mirrors production): /no2 → /no/strompris#no2 with NO2 selected, /nl → /nl/stroomprijs', async () => {
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
    await page.goto(BASE + '/nl');   // straight to the Dutch page, not through /norden#nl
    await page.waitForSelector('main[data-page="zone"] .pris');
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).hash, '/nl/stroomprijs');
  });

  await test('the localised paths are routed: clean URL stays, hash tabs stay, a language folder alone is not a page', async () => {
    for (const [url, dp] of [['/no/strompris', 'zone'], ['/sv/elpris', 'zone'], ['/fi/sahkon-hinta', 'zone'], ['/nl/stroomprijs', 'zone']]) {
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
    await page.waitForFunction(() => location.pathname === '/nl/stroomprijs');
  });

  await test('footer and the net dialog link Norden, eight countries — and nothing links an old zone URL', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('main[data-page="start"].active');
    const foot = await page.locator('footer .sf-all .sf-nets > div:last-child a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert.deepEqual(foot, ['/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce']);
    const dlg = await page.locator('#netDialog .pd-links:not([id])').last().evaluate(el => [...el.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.textContent]));
    assert.deepEqual(dlg, [['/norden', 'Norden'], ['/no/strompris', 'Norge'], ['/sv/elpris', 'Sverige'], ['/fi/sahkon-hinta', 'Finland'], ['/nl/stroomprijs', 'Nederland'], ['/de/strompreis', 'Tyskland'], ['/fr/prix-electricite', 'Frankrig'], ['/pl/ceny-pradu', 'Polen'], ['/it/prezzo-luce', 'Italien']], 'the net dialog lists the same ten');
    for (const url of ['/', '/dk1', '/automation', '/om-elpriser', '/blog', '/blog/groennest-og-dyrest', '/tariffer', '/api', '/no/strompris', '/nl/stroomprijs', '/norden']) {
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

  // ── 9b. The country pages' chrome: header navigation and footer in the page's own language ──────────────────────
  // server.js hands the browser the whole index.html, so this is the client side of the localisation (the same
  // chromeHTML the server renders from; test-zone-pages.mjs covers the server's HTML through the real function).
  const CHROME = {
    '/no/strompris':   { lang: 'nb', nav: ['Danmark', 'Norge', 'Sverige', 'Finland', 'Nederland', 'Tyskland', 'Frankrike', 'Polen', 'Italia'], cur: 'Norge', menu: 'Hovedmeny', land: 'Land', privacy: 'Personvern (på dansk)' },
    '/sv/elpris':      { lang: 'sv', nav: ['Danmark', 'Norge', 'Sverige', 'Finland', 'Nederländerna', 'Tyskland', 'Frankrike', 'Polen', 'Italien'], cur: 'Sverige', menu: 'Huvudmeny', land: 'Länder', privacy: 'Integritet (på danska)' },
    '/fi/sahkon-hinta': { lang: 'fi', nav: ['Tanska', 'Norja', 'Ruotsi', 'Suomi', 'Alankomaat', 'Saksa', 'Ranska', 'Puola', 'Italia'], cur: 'Suomi', menu: 'Päävalikko', land: 'Maat', privacy: 'Tietosuoja (tanskaksi)' },
    '/nl/stroomprijs': { lang: 'nl', nav: ['Denemarken', 'Noorwegen', 'Zweden', 'Finland', 'Nederland', 'Duitsland', 'Frankrijk', 'Polen', 'Italië'], cur: 'Nederland', menu: 'Hoofdmenu', land: 'Landen', privacy: 'Privacy (in het Deens)' },
    // The four EU pages (actual prices only): the footer's data line is the CC BY 4.0 credit to Bundesnetzagentur | SMARD.de plus the note that the data were changed.
    '/de/strompreis': { lang: 'de', act: 1, nav: ['Dänemark', 'Norwegen', 'Schweden', 'Finnland', 'Niederlande', 'Deutschland', 'Frankreich', 'Polen', 'Italien'], cur: 'Deutschland', menu: 'Hauptmenü', land: 'Länder', privacy: 'Datenschutz (auf Dänisch)' },
    '/fr/prix-electricite': { lang: 'fr', act: 1, nav: ['Danemark', 'Norvège', 'Suède', 'Finlande', 'Pays-Bas', 'Allemagne', 'France', 'Pologne', 'Italie'], cur: 'France', menu: 'Menu principal', land: 'Pays', privacy: 'Confidentialité (en danois)' },
    '/pl/ceny-pradu': { lang: 'pl', act: 1, nav: ['Dania', 'Norwegia', 'Szwecja', 'Finlandia', 'Holandia', 'Niemcy', 'Francja', 'Polska', 'Włochy'], cur: 'Polska', menu: 'Menu główne', land: 'Kraje', privacy: 'Prywatność (po duńsku)' },
    '/it/prezzo-luce': { lang: 'it', act: 1, nav: ['Danimarca', 'Norvegia', 'Svezia', 'Finlandia', 'Paesi Bassi', 'Germania', 'Francia', 'Polonia', 'Italia'], cur: 'Italia', menu: 'Menu principale', land: 'Paesi', privacy: 'Privacy (in danese)' },
  };
  const DANISH_CHROME = /Smart hjem|Hent appen|Hent til|Netselskab|netselskab|Hovedmenu|Mobilnavigation|Privatliv|Åbne datasæt|Alle guides|Forstå din elpris|Tariffer|Prognose$/m;
  const chromeState = p => p.evaluate(() => {
    const q = s => document.querySelector(s), r = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; };
    const links = [...document.querySelectorAll('.site-nav .site-links a')];
    return {
      lang: document.documentElement.lang, scroll: [document.documentElement.scrollWidth, innerWidth],
      navText: links.map(a => a.textContent), navHref: links.map(a => a.getAttribute('href')),
      navCur: links.filter(a => a.getAttribute('aria-current') === 'page').map(a => a.textContent),
      navHeights: links.map(a => r(a).h), navVisible: links.map(a => r(a).r <= innerWidth + 1 && r(a).l >= -1),
      menu: q('.site-links')?.getAttribute('aria-label'), logo: q('.site-logo')?.textContent.trim(), logoHref: q('.site-logo')?.getAttribute('href'),
      chip: !!q('#netChip'), app: !!q('.app-btn'), tabbar: !!q('#tabBar'), dialog: !!q('#netDialog'), actions: !!q('.site-actions'),
      headText: q('.site-nav').innerText, footText: q('footer').innerText,
      footHeading: q('footer .sf-h')?.textContent, footLinks: [...document.querySelectorAll('footer .sf-chips a')].map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]),
      privacy: (a => a && [a.textContent, a.getAttribute('href'), a.getAttribute('hreflang')])(q('footer .sf-legal a[href="/privatliv"]')),
      footers: document.querySelectorAll('footer').length, details: document.querySelectorAll('footer details').length,
      navBottom: r(q('.site-nav')).h,
      bodyPad: getComputedStyle(document.body).paddingBottom,
    };
  });
  for (const [url, w] of Object.entries(CHROME)) {
    for (const [vw, vh] of [[1280, 800], [390, 844]]) {
      await test(`${url} at ${vw} px: header and footer are ${w.lang} — country navigation, no net chip/app button/tab bar/net dialog, slim footer, no overflow`, async () => {
        const c = await browser.newContext({ viewport: { width: vw, height: vh }, bypassCSP: true, ...(vw < 600 ? { isMobile: true, hasTouch: true } : {}) });
        await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
        await c.route('**/api/nordic*', nordicRoute);
        const p = await c.newPage();
        await p.goto(BASE + url);
        await p.waitForSelector('main[data-page="zone"] .pris');
        const s = await chromeState(p);
        assert.equal(s.lang, w.lang);
        assert.deepEqual(s.navText, w.nav); assert.deepEqual(s.navHref, ['/dk1', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce']);
        assert.deepEqual(s.navCur, [w.cur], 'the current country is marked aria-current');
        assert.equal(s.menu, w.menu); assert.equal(s.logo, 'Elpriser'); assert.equal(s.logoHref, '/');
        assert.deepEqual([s.chip, s.app, s.tabbar, s.dialog, s.actions], [false, false, false, false, false], 'no Danish net chip, app button, tab bar, net dialog or action row');
        assert.ok(!/Smart hjem|Hent appen|DK1 ·/.test(s.headText), `header text: ${s.headText}`);
        assert.ok(!DANISH_CHROME.test(s.footText), `footer text: ${s.footText}`);
        assert.equal(s.footers, 1); assert.equal(s.details, 0, 'a slim footer: no disclosure of net companies');
        assert.equal(s.footHeading, w.land);
        assert.deepEqual(s.footLinks.map(x => x[0]), w.nav); assert.deepEqual(s.footLinks.map(x => x[1]), ['/dk1', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/de/strompreis', '/fr/prix-electricite', '/pl/ceny-pradu', '/it/prezzo-luce']);
        assert.deepEqual(s.footLinks.filter(x => x[2]).map(x => x[0]), [w.cur]);
        assert.deepEqual(s.privacy, [w.privacy, '/privatliv', 'da']);
        if (w.act) { assert.match(s.footText, /© Elpriser\.org — .*Bundesnetzagentur \| SMARD\.de \(Energy-Charts\.info\), CC BY 4\.0 — .*elpriser\.org.*Hugging Face/s); assert.ok(!/Energi Data Service|ENTSO/.test(s.footText), 'the EU pages credit neither Energi Data Service nor ENTSO-E'); }
        else assert.match(s.footText, /© Elpriser\.org — .*ENTSO-E.*Energi Data Service.*Hugging Face/s);
        assert.equal(s.scroll[0], s.scroll[1], `horizontal page scroll ${s.scroll.join(' vs ')}`);
        assert.ok(s.navVisible.every(Boolean) || vw < 600, 'every country is inside the viewport on a wide screen');
        if (vw < 600) {
          assert.ok(s.navHeights.every(h => h >= 44), `tap targets ${s.navHeights.join(',')}`);
          assert.equal(s.bodyPad, '0px', 'the Danish tab bar\'s room at the bottom is gone');
          // the row scrolls on its own if it is wider than the screen; the page never does
          const sc = await p.evaluate(() => { const n = document.querySelector('.site-links'); return [n.scrollWidth, n.clientWidth, n.getBoundingClientRect().right <= innerWidth + 1]; });
          assert.ok(sc[2], 'the navigation row stays inside the screen');
        }
        // the Pris screen is still there and was not disturbed by the chrome swap
        assert.ok(await p.locator('main[data-page="zone"] .pris-now').count() === 1);
        await c.close();
      });
    }
  }

  await test('the country navigation works: a link leads to that country\'s page (its own chrome), Danmark leads to the Danish site with the Danish chrome back', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    await page.locator('.site-nav .site-links a', { hasText: /^Sverige$/ }).click();
    await page.waitForFunction(() => location.pathname === '/sv/elpris' && document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'se3');
    assert.deepEqual((await chromeState(page)).navCur, ['Sverige']);
    assert.equal((await chromeState(page)).menu, 'Huvudmeny', 'the new page has the Swedish chrome, not the Norwegian one');
    await page.locator('footer .sf-chips a', { hasText: /^Nederländerna$/ }).click();
    await page.waitForFunction(() => location.pathname === '/nl/stroomprijs' && document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'nl');
    assert.equal((await chromeState(page)).menu, 'Hoofdmenu');
    await page.locator('.site-nav .site-links a', { hasText: /^Denemarken$/ }).click();
    await page.waitForFunction(() => location.pathname === '/dk1');
    await page.waitForSelector('main[data-page="prices"].active');
    const d = await chromeState(page);
    assert.deepEqual([d.chip, d.app, d.tabbar, d.dialog], [true, true, true, true], 'the Danish site has its chip, app button, tab bar and dialog');
    assert.equal(d.lang, 'da'); assert.deepEqual(d.navText, ['Pris', 'Smart hjem', 'Om']);
    assert.ok(await page.evaluate(() => !document.documentElement.classList.contains('xc')));
    // And the other way: the Danish net dialog links Nederland.
    await page.locator('#netChip').click();
    await page.locator('#netDialog a[href="/nl/stroomprijs"]').click();
    await page.waitForFunction(() => location.pathname === '/nl/stroomprijs');
  });

  await test('tab switching still works with the localised chrome, and the chrome survives it unchanged', async () => {
    await page.goto(BASE + '/no/strompris');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const before = await chromeState(page);
    await page.locator('#zt-no3').click();
    await page.waitForFunction(() => document.querySelector('[data-page="zone"] .pris')?.dataset.key === 'no3');
    await page.locator('main[data-page="zone"] [data-pris-period="5"]').click();
    const after = await chromeState(page);
    assert.deepEqual([after.navText, after.navCur, after.footLinks, after.menu, after.lang], [before.navText, before.navCur, before.footLinks, before.menu, before.lang]);
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-period'), '5');
  });

  await test('dark mode: the country header and footer follow the theme (dark surfaces, readable links, a marked current country)', async () => {
    for (const url of Object.keys(CHROME)) {
      const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', bypassCSP: true });
      await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
      await c.route('**/api/nordic*', nordicRoute);
      const p = await c.newPage();
      await p.goto(BASE + url);
      await p.waitForSelector('main[data-page="zone"] .pris');
      const m = await p.evaluate(() => {
        const lum = col => { const [a, b, d] = col.match(/[\d.]+/g).slice(0, 3).map(Number); return (0.2126 * a + 0.7152 * b + 0.0722 * d) / 255; };
        const cur = document.querySelector('.site-links a[aria-current]'), other = document.querySelector('.site-links a:not([aria-current])'), chip = document.querySelector('footer .sf-chips a[aria-current]'), chip2 = document.querySelector('footer .sf-chips a:not([aria-current])');
        return { dark: document.documentElement.classList.contains('dark'), head: lum(getComputedStyle(document.querySelector('.site-nav')).backgroundColor), body: lum(getComputedStyle(document.body).backgroundColor),
          other: lum(getComputedStyle(other).color), chipBg: lum(getComputedStyle(chip).backgroundColor), chipTx: lum(getComputedStyle(chip).color), chip2Tx: lum(getComputedStyle(chip2).color), chip2Bg: lum(getComputedStyle(chip2).backgroundColor),
          legal: lum(getComputedStyle(document.querySelector('.sf-legal')).color), curColor: getComputedStyle(cur).color, otherColor: getComputedStyle(other).color };
      });
      assert.ok(m.dark && m.head < 0.25 && m.body < 0.25, `${url}: dark surfaces ${JSON.stringify(m)}`);
      assert.ok(m.other > 0.4 && m.chip2Tx > 0.5 && m.chip2Bg < 0.25 && m.legal > 0.4, `${url}: readable on dark ${JSON.stringify(m)}`);
      assert.ok(m.curColor !== m.otherColor, `${url}: the current country is told apart in the header`);
      assert.ok(m.chipTx > 0.9 && m.chipBg < 0.6, `${url}: the current country's chip in the footer is a filled pill with white text ${JSON.stringify(m)}`);
      await c.close();
    }
  });

  await test('/nl/stroomprijs: Dutch Pris screen in cent, one zone and no tabs, Dutch period switch 2 ⇄ 5 dagen (120 bars, five rows), <html lang="nl">', async () => {
    await page.goto(BASE + '/nl/stroomprijs');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const z = await zoneNow();
    assert.deepEqual(z.sel, []); assert.equal(z.key, 'nl'); assert.equal(z.lang, 'nl'); assert.equal(z.hash, '');
    assert.equal(await page.locator('#zTabs [role="tab"]').count(), 0);
    assert.equal(await page.title(), 'Stroomprijs vandaag en morgen, prognose 5 dagen vooruit');
    assert.equal((await page.locator('main[data-page="zone"] h1').textContent()), 'Stroomprijs in Nederland: vandaag en prognose voor de komende 5 dagen');
    assert.equal(await page.locator('main[data-page="zone"] .pris-u').textContent(), 'cent/kWh');
    assert.match(await page.locator('main[data-page="zone"] .pris-label').textContent(), /^Stroomprijs nu · (zon|maan|dins|woens|donder|vrij|zater)dag om \d\d$/);
    assert.match(await page.locator('main[data-page="zone"] .pris-hero .pris-cap').first().textContent(), /Spotprijs zonder btw, belastingen en netkosten/);
    assert.equal(await page.locator('[data-pris-view]').count(), 0);
    assert.deepEqual(await page.locator('main[data-page="zone"] .pris-period button').allTextContents(), ['2 dagen', '5 dagen']);
    assert.equal(await page.locator('main[data-page="zone"] .pris-period [aria-selected="true"]').textContent(), '2 dagen');
    // NL is index 12 in the stub: 60 + 12 × 10 = 180 EUR/MWh + swing; rate 10 → the figure is EUR/MWh in cent/kWh × 10 ÷ 10.
    const price = parseFloat((await page.locator('main[data-page="zone"] .pris-now').textContent()).replace(',', '.'));
    assert.ok(price > 140 && price < 230, `price ${price}`);
    await page.locator('main[data-page="zone"] [data-pris-period="5"]').click();
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-period'), '5');
    assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp5 .pc[data-tip]').count(), 120);
    assert.equal(await page.locator('main[data-page="zone"] .pris-week tbody tr').count(), 5);
    assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp5 .pris-ct').textContent(), 'Komende 5 dagen');
    await page.locator('main[data-page="zone"] [data-pris-period="2"]').click();
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-period'), '2');
    assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp2 .pc[data-tip]').count(), 48 + Math.min(6, hourDk()));
    const list = await page.locator('#zList').textContent();
    assert.match(list, /Nederland \(NL\): gem\. vandaag [\d,]+ cent\/kWh, gem\. morgen [\d,]+ cent\/kWh/);
    const t = await page.evaluate(() => document.querySelector('main[data-page="zone"]').innerText);
    assert.ok(!/NaN|undefined|\b10 d|\børe\b|\bsnt\b|døgn|dygn|vrk/.test(t), t.slice(0, 300));
    await page.locator('main[data-page="zone"] .pris-card.pp2 .pris-plot').hover({ position: { x: 300, y: 80 } });
    assert.match(await page.locator('main[data-page="zone"] .pris-card.pp2 .pris-tip').textContent(), /^(Vandaag|Morgen) om \d\d · [\d,]+ cent\/kWh$/);
  });


  // ── 9c. The four EU pages: Germany, France, Poland, Northern Italy — actual day-ahead prices only ─────────────
  const EUP = {
    '/de/strompreis':       { lang: 'de', key: 'de', unit: 'ct/kWh', h1: 'Strompreis in Deutschland: heute und morgen', title: 'Strompreis aktuell und morgen – Börsenstrompreis Deutschland', card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', now: /^Strompreis jetzt · (Sonn|Mon|Diens|Mittwoch|Donners|Frei|Sams)\w* um \d\d Uhr$/, chg: 'Änderung: Stundenmittel von elpriser.org berechnet' },
    '/fr/prix-electricite': { lang: 'fr', key: 'fr', unit: 'c€/kWh', h1: 'Prix de l’électricité en France : aujourd’hui et demain', title: 'Prix de l’électricité aujourd’hui et demain en France', card: 'Aujourd’hui et demain', one: 'Aujourd’hui', kind: 'Prix day-ahead', now: /^Prix de l’électricité maintenant · \w+ à \d\d h$/, chg: 'Modifié : moyennes horaires calculées par elpriser.org' },
    '/pl/ceny-pradu':       { lang: 'pl', key: 'pl', unit: 'gr/kWh', h1: 'Cena prądu w Polsce: dziś i jutro', title: 'Cena prądu dziś i jutro – giełdowa cena energii w Polsce', card: 'Dziś i jutro', one: 'Dziś', kind: 'Cena RDN', now: /^Cena prądu teraz · \S+ godz\. \d\d$/, chg: 'Zmiany: średnie godzinowe i przeliczenie na grosze wykonane przez elpriser.org' },
    '/it/prezzo-luce':      { lang: 'it', key: 'it-n', unit: 'c€/kWh', h1: 'Prezzo dell’energia elettrica in Italia del Nord: oggi e domani', title: 'Prezzo dell’energia elettrica oggi e domani – Italia del Nord', card: 'Oggi e domani', one: 'Oggi', kind: 'Prezzo day-ahead', now: /^Prezzo della luce adesso · \S+ alle \d\d$/, chg: 'Modifiche: medie orarie calcolate da elpriser.org' },
  };
  const FORECAST_WORDS = /prognos|vorhersage|prévision|previsi|prognoz|forecast|ennuste|\bmodel/i;
  for (const [url, w] of Object.entries(EUP)) {
    await test(`${url}: the Pris screen in ${w.lang}, one period (no pill), today and tomorrow, day-ahead type only, no forecast wording, the CC BY 4.0 credit and the change note`, async () => {
      euDays = 3;
      await page.goto(BASE + url);
      await page.waitForSelector('main[data-page="zone"] .pris');
      assert.equal(await page.locator('html').getAttribute('lang'), w.lang);
      assert.equal(await page.title(), w.title);
      assert.equal(await page.locator('main[data-page="zone"] h1').textContent(), w.h1);
      assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-key'), w.key);
      assert.equal(await page.locator('main[data-page="zone"] .pris-u').textContent(), w.unit);
      assert.match(await page.locator('main[data-page="zone"] .pris-label').textContent(), w.now);
      assert.equal(await page.locator('main[data-page="zone"] .pris-period').count(), 0, 'one period: no pill at all');
      assert.equal(await page.locator('main[data-page="zone"] .pris-card').count(), 1);
      assert.equal(await page.locator('main[data-page="zone"] .pris-card .pris-ct').textContent(), w.card);
      assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp2 .pc[data-tip]').count(), 48);
      assert.equal(await page.locator('main[data-page="zone"] .pris-week tbody tr').count(), 2);
      assert.deepEqual([...new Set(await page.locator('main[data-page="zone"] .pris-week tbody td:last-child').allTextContents())], [w.kind]);
      assert.equal(await page.locator('main[data-page="zone"] .pris-fc').count(), 0, 'no forecast divider');
      assert.equal(await page.locator('[data-pris-view]').count(), 0);
      assert.equal(await page.locator('#zTabs [role="tab"]').count(), 0, 'one zone: no tabs');
      const t = await page.evaluate(() => document.querySelector('main[data-page="zone"]').innerText);
      assert.ok(!FORECAST_WORDS.test(t) && !/NaN|undefined|\børe\b|\bsnt\b|døgn|dygn|vrk|Børspris|ENTSO/.test(t), t.slice(0, 400));
      // The licence: attribution to Bundesnetzagentur | SMARD.de (via Energy-Charts.info), the CC BY 4.0 link, and that the data were changed — in the text block and in the footer.
      const list = await page.locator('#zList').textContent();
      assert.match(list, /Bundesnetzagentur \| SMARD\.de \(Energy-Charts\.info\), CC BY 4\.0\.$/);
      assert.deepEqual(await page.locator('#zList .zl-n a').evaluateAll(a => a.map(x => [x.textContent, x.getAttribute('href')])),
        [['Bundesnetzagentur | SMARD.de', 'https://www.smard.de'], ['Energy-Charts.info', 'https://www.energy-charts.info'], ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/']]);
      const foot = await page.locator('footer .sf-legal').textContent();
      assert.ok(foot.includes('Bundesnetzagentur | SMARD.de (Energy-Charts.info), CC BY 4.0 — ' + w.chg), foot);
      assert.ok(!/ENTSO|Energi Data Service/.test(foot + list));
      const tip = await page.evaluate(() => document.querySelector('main[data-page="zone"] .pris-card.pp2 .pc[data-tip]').dataset.tip);
      assert.match(tip, /\d/);
    });
  }

  await test('/pl/ceny-pradu: the euro price is converted to grosze at the response\'s PLN rate (÷10 × 4,4), with a comma', async () => {
    await page.goto(BASE + '/pl/ceny-pradu');
    await page.waitForSelector('main[data-page="zone"] .pris');
    // k = 15 in the stub: 60 + 2 × 10 = 80 EUR/MWh ± 25 swing + 1 → 56…106 EUR/MWh → 24.6…46.6 gr/kWh.
    const v = parseFloat((await page.locator('main[data-page="zone"] .pris-now').textContent()).replace(',', '.'));
    assert.ok(v > 24 && v < 47, `price ${v}`);
    assert.match(await page.locator('main[data-page="zone"] .pris-now').textContent(), /^\d+,\d$/);
    assert.match(await page.locator('#zList').textContent(), /Polska \(PL\): śr\. dziś [\d,]+ gr\/kWh, śr\. jutro [\d,]+ gr\/kWh/);
  });

  await test('/it/prezzo-luce: one zone (IT-North) and no tabs — the page says Nord everywhere; Ireland and the other Italian zones are gone', async () => {
    nordicRequests.length = 0;
    await page.goto(BASE + '/it/prezzo-luce');
    await page.waitForSelector('main[data-page="zone"] .pris');
    assert.equal(await page.locator('#zTabs [role="tab"]').count(), 0);
    assert.equal(await page.locator('main[data-page="zone"] .pris').getAttribute('data-key'), 'it-n');
    assert.deepEqual([...new Set(nordicRequests)], ['it-n'], 'the page asks for IT-North only');
    assert.equal(await page.locator('#zList li').count(), 1);
    assert.match(await page.locator('#zList li').textContent(), /^Italia del Nord \(IT-Nord\): media oggi [\d,]+ c€\/kWh, media domani [\d,]+ c€\/kWh$/);
    assert.equal(await page.locator('.site-links a[href="/ie/electricity-price"]').count(), 0);
    const r = await page.goto(BASE + '/ie/electricity-price');
    assert.ok(r.status() === 404 || (await page.locator('main[data-page="zone"].active').count()) === 0, 'Ireland is not a page any more');
  });

  await test('the EU pages while tomorrow is not published: one day — the title says so, 24 bars, one row, no NaN', async () => {
    euDays = 2;
    try {
      for (const [url, w] of Object.entries(EUP)) {
        await page.goto(BASE + url);
        await page.waitForSelector('main[data-page="zone"] .pris');
        assert.equal(await page.locator('main[data-page="zone"] .pris-card .pris-ct').textContent(), w.one, url);
        assert.equal(await page.locator('main[data-page="zone"] .pris-card.pp2 .pc[data-tip]').count(), 24, url);
        assert.equal(await page.locator('main[data-page="zone"] .pris-week tbody tr').count(), 1, url);
        const t = await page.evaluate(() => document.querySelector('main[data-page="zone"]').innerText);
        assert.ok(!/NaN|undefined/.test(t) && !FORECAST_WORDS.test(t), `${url}: ${t.slice(0, 200)}`);
      }
    } finally { euDays = 3; }
  });

  await test('the country navigation has nine entries in one row on a desktop, and scrolls sideways on a phone without the page doing so', async () => {
    await page.goto(BASE + '/de/strompreis');
    await page.waitForSelector('main[data-page="zone"] .pris');
    const wide = await page.evaluate(() => { const l = [...document.querySelectorAll('.site-nav .site-links a')]; return { n: l.length, tops: [...new Set(l.map(a => Math.round(a.getBoundingClientRect().top)))], right: Math.max(...l.map(a => a.getBoundingClientRect().right)), w: innerWidth }; });
    assert.equal(wide.n, 9); assert.equal(wide.tops.length, 1, `the row wraps: ${wide.tops}`); assert.ok(wide.right <= wide.w);
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true, isMobile: true, hasTouch: true });
    await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
    await c.route('**/api/nordic*', nordicRoute);
    const p = await c.newPage();
    await p.goto(BASE + '/it/prezzo-luce');
    await p.waitForSelector('main[data-page="zone"] .pris');
    const m = await p.evaluate(() => { const n = document.querySelector('.site-links'), l = [...n.querySelectorAll('a')]; return { n: l.length, tops: [...new Set(l.map(a => Math.round(a.getBoundingClientRect().top)))], scrolls: n.scrollWidth > n.clientWidth, page: document.documentElement.scrollWidth <= innerWidth, cur: l.filter(a => a.getAttribute('aria-current')).length }; });
    assert.deepEqual([m.n, m.tops.length, m.scrolls, m.page, m.cur], [9, 1, true, true, 1], JSON.stringify(m));
    await c.close();
  });

  await test('the EU pages at 390 px, light and dark: nothing overflows (the day list wraps), the chart and the cards stay inside the screen', async () => {
    for (const scheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, bypassCSP: true, isMobile: true, hasTouch: true });
      await c.route('**/*', r => /googletagmanager|google-analytics/.test(r.request().url()) ? r.abort() : r.fallback());
      await c.route('**/api/nordic*', nordicRoute);
      const p = await c.newPage();
      for (const url of Object.keys(EUP)) {
        await p.goto(BASE + url);
        await p.waitForSelector('main[data-page="zone"] .pris');
        const o = await p.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth,
          wide: [...document.querySelectorAll('main[data-page="zone"] .pris *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.zt')).length }));
        assert.deepEqual([o.page, o.wide], [0, 0], `${url} ${scheme}: ${JSON.stringify(o)}`);
      }
      await c.close();
    }
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
    await c.route('**/prognose', prognoseRoute);
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
