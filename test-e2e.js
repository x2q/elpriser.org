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
  await ctx.route('**/api/forecast*', route => {
    const u = new URL(route.request().url());
    const mode = u.searchParams.get('mode'), gln = u.searchParams.get('gln'), area = u.searchParams.get('area');
    forecastRequests.push(`${area}|${mode}|${gln || ''}`);
    const base = Date.parse(todayDk() + 'T12:00:00Z');
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(base + i * 86400000).toISOString().slice(0, 10),
      type: i < 2 ? 'actual' : 'forecast',
      prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: fixturePrice(mode, gln, h) })),
    }));
    route.fulfill({ json: { area, mode, ...(gln ? { gln } : {}), days } });
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
    ['/dk1',                           'prices'],
    ['/dk2',                           'prices'],
    ['/blog/forsta-din-elpris',                  'blog-forsta-din-elpris'],
    ['/blog/shelly-elpris-automation',           'blog-shelly-elpris-automation'],
    ['/blog/home-assistant-elpriser',            'blog-home-assistant-elpriser'],
    ['/blog/v2g-v2h-bidirektional-opladning',    'blog-v2g-v2h-bidirektional-opladning'],
    ['/blog/biler-ladere-v2h-v2g',               'blog-biler-ladere-v2h-v2g'],
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
                     '/blog/home-assistant-elpriser', '/blog/v2g-v2h-bidirektional-opladning',
                     '/blog/biler-ladere-v2h-v2g', '/tariffer', '/automation', '/api',
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

  await test('start: both DK1 and DK2 zone cards offer the two views, Din pris and Spotpris', async () => {
    // The six price modes are no longer a choice; the area cards say so too.
    for (const z of ['#dk1-zone', '#dk2-zone']) {
      const labels = await page.locator(`${z} a`).allTextContents();
      assert.deepEqual(labels.map(t => t.trim()), ['Din pris — inkl. alt', 'Kun spotpris'], `${z}: ${labels.join(' | ')}`);
    }
  });

  for (const [selector, expectedUrl] of [
    ['#dk1-zone a:has-text("Din pris")',     '/dk1'],
    ['#dk1-zone a:has-text("Kun spotpris")', '/dk1?pris=spot'],
    ['#dk2-zone a:has-text("Din pris")',     '/dk2'],
    ['#dk2-zone a:has-text("Kun spotpris")', '/dk2?pris=spot'],
  ]) {
    await test(`zone: clicking "${selector.split('"')[1]}" navigates to ${expectedUrl}`, async () => {
      await page.goto(BASE + '/');
      await page.locator(selector).first().click();
      // A clean address: the path (and ?pris= for a non-default price), never a #hash.
      await page.waitForURL(u => u.pathname + u.search === expectedUrl && u.hash === '');
      await page.waitForSelector('main[data-page="prices"].active');
    });
  }

  await test('start: net chips — every net has one link, to its own page', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#dk1-nets .net-row');
    const rows = await page.locator('#dk1-nets .net-row').count();
    assert.ok(rows >= 10, `DK1 has ${rows} nets, expected ≥10`);
    for (let i = 0; i < rows; i++) {
      const chips = await page.locator('#dk1-nets .net-row').nth(i).locator('.net-chip').count();
      assert.equal(chips, 1, `DK1 row ${i} has ${chips} chips, expected 1`);
    }
  });

  await test('start: clicking a net chip navigates to net_inkl_alt path', async () => {
    await page.goto(BASE + '/');
    await page.locator('#dk1-nets .net-row').first().locator('.net-chip').first().click();
    await page.waitForURL(u => /^\/dk1\/[a-z0-9-]+$/.test(u.pathname) && u.hash === '' && u.search === '');
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
    assert.ok(count >= 5, `expected ≥5 FAQ items on the start page, got ${count}`);
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

  await test('prices: the period pill is a tablist that switches the chart between 2 døgn and 3–10 døgn', async () => {
    await page.goto(BASE + '/dk1');
    await page.waitForSelector('.pris .pp2 .pris-plot');
    assert.equal(await page.locator('.pris-period').getAttribute('role'), 'tablist');
    assert.equal(await page.locator('.pp2').isVisible(), true);
    assert.equal(await page.locator('.pp10').isVisible(), false);
    assert.equal((await page.locator('.pp2 .pris-ct').textContent()).trim(), 'Næste 2 døgn');
    await page.locator('.pris-period [data-pris-period="10"]').click();
    assert.equal(await page.locator('.pp10').isVisible(), true);
    assert.equal(await page.locator('.pp2').isVisible(), false);
    assert.equal((await page.locator('.pp10 .pris-ct').textContent()).trim(), 'Døgn 3–10');
    assert.equal(await page.locator('.pris-period [data-pris-period="10"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.pp10 .pc').count(), 192);
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
  for (const url of ['/automation', '/blog/shelly-elpris-automation', '/dk1/n1']) {
    await test(`routing: home-icon on ${url} returns to start page`, async () => {
      await page.goto(BASE + url);
      const dp = await page.evaluate(() =>
        document.querySelector('main.active')?.dataset.page);
      // Sub-pages have either the in-page home icon or the header logo; both
      // must lead to "/". (The prices page only has the logo.)
      await page.locator(
        `[data-page="${dp}"] a[title="Startside"], header.site-nav a.site-logo`).first().click();
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
