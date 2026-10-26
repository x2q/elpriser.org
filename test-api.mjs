// Hermetic API tests — the real /api/* handler, with its upstreams faked.
// Run: npm run test:api        (no network, no server, no browser)
//
// These replace the checks test-regressions.js used to make against a local
// `wrangler pages dev`, which needed the network and so failed for reasons that
// had nothing to do with the code. Each test names the bug it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createApi, makeKv, priceArchiveYear, tariffArchive, upstreamState } from './tests/upstream.mjs';

const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const range = `start=${day(-7)}&end=${day(2)}`;

// ── /api/raw/* — the Energi Data Service proxy (guards the EDS-CORS bug) ────

test('/api/raw/prices returns day-ahead records with CORS and an edge cache TTL', async () => {
  const api = await createApi();
  const r = await api.get(`/api/raw/prices?area=DK1&${range}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'CORS header missing');
  assert.match(r.headers.get('cache-control') || '', /s-maxage=\d+/, 'edge cache TTL missing');
  assert.ok(Array.isArray(r.body.records) && r.body.records.length > 0, 'expected non-empty records');
  assert.ok(r.body.records[0].TimeUTC && r.body.records[0].DayAheadPriceDKK !== undefined, 'record schema');
});

test('/api/raw/prices without a range answers 400', async () => {
  const api = await createApi();
  assert.equal((await api.get('/api/raw/prices?area=DK1')).status, 400);
});

test('/api/raw/prices with an invalid date answers 400', async () => {
  const api = await createApi();
  assert.equal((await api.get('/api/raw/prices?area=DK1&start=foo&end=bar')).status, 400);
});

test('an empty /api/raw/prices result is not cached — guards cache poisoning', async () => {
  // A transient EDS blip once returned [] and a 6 h max-age the browser honoured.
  const api = await createApi();
  const r = await api.get('/api/raw/prices?area=DK1&start=2035-01-01&end=2035-01-05');
  assert.equal(r.status, 200);
  assert.equal(r.body.records.length, 0, 'far-future window has no published prices');
  const m = (r.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  assert.ok(m, 'cache-control present');
  assert.equal(+m[1], 0, `empty result was sent with max-age=${m[1]}`);
});

test('/api/raw/prices sends an ETag and answers 304 to If-None-Match', async () => {
  const api = await createApi();
  const first = await api.get(`/api/raw/prices?area=DK1&${range}`);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'response must carry an ETag');
  const second = await api.get(`/api/raw/prices?area=DK1&${range}`, { 'If-None-Match': etag });
  assert.equal(second.status, 304);
});

test('/api/raw/prices caches until the next publication, not for 60 s', async () => {
  const api = await createApi();
  const r = await api.get(`/api/raw/prices?area=DK1&${range}`);
  const m = (r.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  assert.ok(m && +m[1] >= 300, `max-age was ${m && m[1]}`);
});

test('a second /api/raw/prices request is served from cache, not upstream', async () => {
  const api = await createApi();
  await api.get(`/api/raw/prices?area=DK1&${range}`);
  const before = api.calls.length;
  await api.get(`/api/raw/prices?area=DK1&${range}`);
  assert.equal(api.calls.length, before, 'second request went upstream again');
});

test('/api/now carries an ETag for conditional revalidation', async () => {
  const api = await createApi();
  const r = await api.get('/api/now?area=DK1&mode=inkl_alt');
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('etag'), '/api/now must send an ETag');
});

test('/api/raw/encharges returns the Energinet charge records', async () => {
  const api = await createApi();
  const r = await api.get('/api/raw/encharges');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.ok(Array.isArray(r.body.records) && r.body.records.length > 0);
});

test('/api/raw/tariff?gln= returns one net, not all of them', async () => {
  const api = await createApi();
  const r = await api.get('/api/raw/tariff?gln=5790000704842'); // Konstant
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.records) && r.body.records.length >= 1);
  assert.ok(r.body.records.length < 50, 'a single net should be a handful of records');
  const upstream = api.calls.filter(u => u.includes('DatahubPricelist')).map(decodeURIComponent);
  assert.ok(upstream.every(u => u.includes('5790000704842')), 'the GLN must be part of the upstream filter');
});

test('/api/raw/tariff with a missing or bad gln answers 400', async () => {
  const api = await createApi();
  assert.equal((await api.get('/api/raw/tariff')).status, 400);
  assert.equal((await api.get('/api/raw/tariff?gln=foo')).status, 400);
});

// ── /api/schedule strategy=smart (max consecutive OFF hours) ────────────────

const schedule = async (hours, maxOff) => {
  const api = await createApi();
  const r = await api.get(`/api/schedule?area=DK1&mode=spot_inkl&strategy=smart&hours=${hours}&max_off=${maxOff}`);
  assert.equal(r.status, 200);
  return r.body.schedule;
};

test('strategy=smart never runs more than max_off consecutive OFF hours', async () => {
  const sched = await schedule(8, 2);
  let longest = 0, run = 0;
  for (const h of sched) { run = h.on ? 0 : run + 1; longest = Math.max(longest, run); }
  assert.ok(longest <= 2, `run of ${longest} consecutive OFF hours exceeds max_off=2`);
  assert.equal(sched.filter(h => !h.on).length, 8, 'expected exactly 8 OFF hours');
});

test('strategy=smart with max_off=1 produces no adjacent OFF hours', async () => {
  const sched = await schedule(4, 1);
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].on || sched[i - 1].on, `hours ${i - 1} and ${i} are both OFF`);
  }
});

test('strategy=smart switches the most expensive hours OFF', async () => {
  const sched = await schedule(4, 4);
  const off = sched.filter(h => !h.on).map(h => h.price);
  const on = sched.filter(h => h.on).map(h => h.price);
  assert.ok(Math.min(...off) >= Math.max(...on), 'an OFF hour is cheaper than an ON hour');
});

// ── /api/* answers are data, not pages ──────────────────────────────────────

test('/api/<endpoint> answers carry X-Robots-Tag noindex', async () => {
  const api = await createApi();
  for (const p of ['/api/now?area=DK1&mode=inkl_alt', `/api/raw/prices?area=DK1&${range}`, '/api/openapi.json']) {
    const r = await api.get(p);
    assert.match(r.headers.get('x-robots-tag') || '', /noindex/, `${p} is indexable`);
  }
});

// ── /api/supplierlookup — OpenStreetMap Nominatim, then Green Power Denmark ──

const KONSTANT = { name: 'KONSTANT Net A/S' };
const jsonAddr = a => ({ display_name: 'x', address: { country_code: 'dk', ...a } });

test('supplierlookup: a numbered address resolves to the grid company in one GPD call', async () => {
  const api = await createApi({
    nominatim: () => jsonAddr({ road: 'P.O. Pedersens Vej', house_number: '2', postcode: '8200', suburb: 'Skejby', city: 'Aarhus N' }),
    gpd: () => ({ status: 200, body: KONSTANT }),
  });
  const r = await api.get('/api/supplierlookup?lat=56.20137&lng=10.19037');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'KONSTANT Net A/S');
  const gpd = api.calls.filter(u => u.includes('greenpowerdenmark'));
  assert.equal(gpd.length, 1);
  // Dots in "P.O." make GPD answer 404/500; they must go out as spaces, and the
  // parish (suburb) must not be part of the address.
  assert.equal(decodeURIComponent(gpd[0].split('/').pop()), 'P O  Pedersens Vej 2, 8200 Aarhus N'.replace('  ', ' '));
});

test('supplierlookup: looks around the point when the nearest object has no house number', async () => {
  let n = 0;
  const api = await createApi({
    nominatim: () => (++n === 1
      ? jsonAddr({ road: 'Torvet', postcode: '8000', city: 'Aarhus C' }) // a square: no number
      : jsonAddr({ road: 'Torvet', house_number: '3', postcode: '8000', city: 'Aarhus C' })),
    gpd: () => ({ status: 200, body: { name: 'Eloverblik Net' } }),
  });
  const r = await api.get('/api/supplierlookup?lat=56.1572&lng=10.2107');
  assert.equal(r.body.name, 'Eloverblik Net');
  assert.ok(api.calls.filter(u => u.includes('nominatim')).length >= 2, 'expected a second probe');
});

test('supplierlookup: a position outside Denmark is reported, not guessed', async () => {
  const api = await createApi({ nominatim: () => ({ display_name: 'Kiel', address: { country_code: 'de', road: 'Holstenstraße', house_number: '1', postcode: '24103', city: 'Kiel' } }) });
  const r = await api.get('/api/supplierlookup?lat=54.32&lng=10.13');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, null);
  assert.equal(r.body.error, 'outside_denmark');
  assert.equal(api.calls.filter(u => u.includes('greenpowerdenmark')).length, 0, 'GPD must not be asked about a foreign address');
});

test('supplierlookup: gives up after three GPD attempts with a reason the client can show', async () => {
  const api = await createApi({
    nominatim: () => jsonAddr({ road: 'Vejen', house_number: '1', postcode: '9999', city: 'Nowhere' }),
    gpd: () => ({ status: 404 }),
  });
  const r = await api.get('/api/supplierlookup?lat=55.5&lng=10.5');
  assert.equal(r.body.name, null);
  assert.equal(r.body.error, 'gpd_404');
  assert.equal(api.calls.filter(u => u.includes('greenpowerdenmark')).length, 3, 'at most three GPD tries');
});

test('supplierlookup: no address at all answers no_address instead of failing', async () => {
  const api = await createApi({ nominatim: () => null });
  const r = await api.get('/api/supplierlookup?lat=55.5&lng=10.5');
  assert.equal(r.status, 200);
  assert.equal(r.body.error, 'no_address');
});

test('supplierlookup: a second request for the same spot is cached', async () => {
  const api = await createApi({
    nominatim: () => jsonAddr({ road: 'Vesterbrogade', house_number: '1', postcode: '1620', city: 'København V' }),
    gpd: () => ({ status: 200, body: { name: 'Radius Elnet A/S' } }),
  });
  await api.get('/api/supplierlookup?lat=55.673&lng=12.564');
  const before = api.calls.length;
  await api.get('/api/supplierlookup?lat=55.673&lng=12.564');
  assert.equal(api.calls.length, before);
});

test('supplierlookup: bad coordinates answer 400', async () => {
  const api = await createApi();
  assert.equal((await api.get('/api/supplierlookup?lat=abc&lng=xyz')).status, 400);
});

test('supplierlookup answers with CORS headers — the original "Failed to fetch" cause (75fd5c9)', async () => {
  const api = await createApi({ nominatim: () => jsonAddr({ road: 'V', house_number: '1', postcode: '1000', city: 'K' }), gpd: () => ({ status: 200, body: { name: 'Radius Elnet A/S' } }) });
  const r = await api.get('/api/supplierlookup?lat=55.6&lng=12.5');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('supplierlookup answers a CORS preflight with 204', async () => {
  await createApi(); // installs the fake network and cache the handler expects
  // OPTIONS carries no body; build the request by hand instead of through get().
  const mod = await import('./functions/api/%5B%5Bcatchall%5D%5D.js');
  const res = await mod.onRequest({ request: new Request('https://elpriser.org/api/supplierlookup', { method: 'OPTIONS' }), env: {}, waitUntil() {} });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('supplierlookup without lat/lng answers 400 naming the missing field', async () => {
  const api = await createApi();
  const r = await api.get('/api/supplierlookup');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /lat/i);
});

test('the browser never has to reach Nominatim or GPD itself — the proxy answers alone', async () => {
  // detectLocation relies on this: only /api/supplierlookup is called client-side.
  const api = await createApi({
    nominatim: () => jsonAddr({ road: 'Vesterbrogade', house_number: '1', postcode: '1620', city: 'København V' }),
    gpd: () => ({ status: 200, body: { name: 'Radius Elnet A/S' } }),
  });
  const r = await api.get('/api/supplierlookup?lat=55.673&lng=12.564');
  assert.equal(r.body.name, 'Radius Elnet A/S');
});

// ── Workers KV usage — the free plan allows 100,000 reads a day ─────────────
//
// Every price call used to read the archive year(s) and the grid tariff straight
// from KV, and a page render makes several such calls: 55-85 thousand reads a
// day on a small site. The values change once a day, so a key should cost one
// read per location per TTL, not one per request.

const year = new Date().getUTCFullYear();
const seededKv = () => makeKv({
  [`prices-archive-DK1-${year}`]: priceArchiveYear(year),
  [`prices-archive-DK1-${year - 1}`]: priceArchiveYear(year - 1),
  'dk-nettarif-5790001089030': tariffArchive(),
});
const GLN_N1 = '5790001089030';

test('KV: 30 price requests cost one read per key, not 30', async () => {
  const kv = seededKv();
  const api = await createApi({ kv });
  for (let i = 0; i < 30; i++) {
    const r = await api.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
    assert.equal(r.status, 200);
  }
  const perKey = {};
  for (const k of kv.ops.get) perKey[k] = (perKey[k] || 0) + 1;
  for (const [k, n] of Object.entries(perKey)) assert.ok(n <= 1, `${k} was read ${n} times`);
  assert.ok(kv.reads() <= 4, `expected a handful of reads, got ${kv.reads()}: ${JSON.stringify(perKey)}`);
});

test('KV: the answer is the same with and without the cache layers', async () => {
  const kv = seededKv();
  const api = await createApi({ kv });
  const first = await api.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  const again = await api.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  assert.deepEqual(again.body, first.body);
  assert.ok(typeof first.body.price === 'number' || first.body.price == null);
});

test('KV: a key that is not in KV is remembered as missing, not re-read per request', async () => {
  const kv = makeKv({});                         // no tariff archive for any net
  const api = await createApi({ kv });
  for (let i = 0; i < 10; i++) await api.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  const n = kv.ops.get.filter(k => k === `dk-nettarif-${GLN_N1}`).length;
  assert.equal(n, 1, `the missing tariff key was read ${n} times`);
});

test('KV: /api/raw/prices does not read the rolling backup on every request', async () => {
  const kv = makeKv({});
  const api = await createApi({ kv });
  for (let i = 0; i < 15; i++) await api.get(`/api/raw/prices?area=DK1&${range}`);
  const reads = kv.ops.getWithMetadata.filter(k => k.startsWith('raw-prices-backup-')).length;
  assert.ok(reads <= 1, `rolling backup was read ${reads} times in 15 requests`);
});

test('/api/forecast carries the charges and the grid tariff, so an hour\'s price can be split into its parts', async () => {
  // The Pris screen shows what "Inkl. nettarif, afgifter og moms" is made of. It derives the
  // spot part from the price, so the fields it needs must be there and must add up.
  const api = await createApi();
  const net = await api.get(`/api/forecast?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  const area = await api.get('/api/forecast?area=DK1&mode=inkl_alt');
  const spot = await api.get('/api/forecast?area=DK1&mode=spot_ex');
  for (const r of [net, area, spot]) assert.equal(r.status, 200);
  const c = net.body.charges;
  assert.ok(c && c.sys > 0 && c.trans > 0 && c.afg >= 0 && c.vat === 0.25, `charges: ${JSON.stringify(c)}`);
  assert.deepEqual(area.body.charges, c, 'the charges differ between the area and the net response');
  let checked = 0;
  net.body.days.forEach((day, i) => {
    assert.ok(Array.isArray(day.grid_tariff) && day.grid_tariff.length === 24 && day.grid_tariff.every(Number.isFinite),
      `day ${day.date} has no 24-value grid_tariff`);
    const sd = spot.body.days[i], ad = area.body.days[i];
    assert.equal(sd.date, day.date);
    assert.ok(!('grid_tariff' in ad), 'the area response (no net) should not carry a grid tariff');
    day.prices.forEach((p, h) => {
      if (p.price == null || sd.prices[h].price == null) return;
      // all-in = (spot + sys + trans + afg + net tariff) * (1 + vat)
      const rebuilt = (sd.prices[h].price + c.sys + c.trans + c.afg + day.grid_tariff[h]) * (1 + c.vat);
      assert.ok(Math.abs(rebuilt - p.price) < 0.003, `${day.date} h${h}: parts give ${rebuilt.toFixed(4)}, price is ${p.price}`);
      const rebuiltArea = (sd.prices[h].price + c.sys + c.trans + c.afg) * (1 + c.vat);
      assert.ok(Math.abs(rebuiltArea - ad.prices[h].price) < 0.003, `${day.date} h${h}: area parts give ${rebuiltArea.toFixed(4)}, price is ${ad.prices[h].price}`);
      checked++;
    });
  });
  assert.ok(checked >= 48, `only ${checked} hours were checked`);
});

test('KV: the forecast model key is read once however many forecasts are served', async () => {
  const kv = seededKv();
  const api = await createApi({ kv });
  for (let i = 0; i < 10; i++) await api.get('/api/forecast?area=DK1&mode=inkl_alt');
  const n = kv.ops.get.filter(k => k === 'forecast-v3-DK1').length;
  assert.ok(n <= 1, `forecast-v3-DK1 was read ${n} times`);
});

// ── Pages Function (functions/[[path]].js): the five retired pages ──────────
// The posts folded into /automation, /om-elpriser and /blog (2026-10-17 cleanup). Each old URL
// must answer 301 to its replacement — not 404, not 200 with the homepage's canonical — and a
// retired URL must never be offered to a crawler again.

const pages = await import(pathToFileURL(path.resolve(import.meta.dirname, 'functions/[[path]].js')));
const callPages = (pathAndQuery, host = 'https://elpriser.org') =>
  pages.onRequest({ request: new Request(host + pathAndQuery), env: {}, next: () => new Response('asset') });

const RETIRED = {
  '/blog/v2g-v2h-bidirektional-opladning': 'https://elpriser.org/blog',
  '/blog/biler-ladere-v2h-v2g': 'https://elpriser.org/blog',
  '/blog/shelly-elpris-automation': 'https://elpriser.org/automation#shelly',
  '/blog/home-assistant-elpriser': 'https://elpriser.org/automation#home-assistant',
  '/blog/forsta-din-elpris': 'https://elpriser.org/om-elpriser',
};

for (const [from, to] of Object.entries(RETIRED)) {
  test(`${from} answers 301 to ${to.replace('https://elpriser.org', '')}, cacheable for an hour`, async () => {
    const r = await callPages(from);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), to);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(await r.text(), '', 'a redirect carries no body');
  });
}

test('a retired URL keeps its query string through the redirect (utm_* from old shares)', async () => {
  const r = await callPages('/blog/shelly-elpris-automation?utm_source=nyhedsbrev');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://elpriser.org/automation?utm_source=nyhedsbrev#shelly');
});

test('retired URLs written with a trailing slash or capitals still end on the replacement', async () => {
  for (const [from, to] of [['/blog/forsta-din-elpris/', '/blog/forsta-din-elpris'], ['/Blog/Forsta-Din-Elpris', '/blog/forsta-din-elpris']]) {
    const hop1 = await callPages(from);
    assert.equal(hop1.status, 301, `${from} first hop`);
    assert.equal(new URL(hop1.headers.get('location')).pathname, to);
    const hop2 = await callPages(to);
    assert.equal(hop2.headers.get('location'), 'https://elpriser.org/om-elpriser');
  }
});

test('the live posts and pages are not caught by the redirect table', async () => {
  for (const ok of ['/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst', '/blog', '/automation', '/om-elpriser']) {
    // These render the SPA, which needs the asset binding this harness does not have; the point
    // is only that they are not answered with a redirect.
    const r = await callPages(ok).catch(() => null);
    assert.ok(!r || r.status !== 301, `${ok} must not be redirected away`);
  }
});

test('the served sitemap and llms.txt name none of the retired URLs and keep the replacements (llms-full.txt shares the text; test-static.js checks its source)', async () => {
  const sitemap = await (await callPages('/sitemap.xml')).text();
  const llms = await (await callPages('/llms.txt')).text();
  for (const from of Object.keys(RETIRED)) {
    for (const [name, text] of [['sitemap', sitemap], ['llms.txt', llms]])
      assert.ok(!text.includes(from), `${name} still names ${from}`);
  }
  for (const keep of ['/automation', '/om-elpriser', '/blog', '/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst'])
    assert.ok(sitemap.includes(`<loc>https://elpriser.org${keep}</loc>`), `sitemap lost ${keep}`);
  assert.ok(llms.includes('https://elpriser.org/automation#shelly') && llms.includes('https://elpriser.org/om-elpriser'), 'llms.txt points at the replacements');
});

// ── KV writes — the free plan allows 1,000 a day (alert at 50 % on 2026-10-23) ──

async function withClock(offsetMs, fn) {
  const real = Date.now;
  Date.now = () => real() + offsetMs;
  try { return await fn(); } finally { Date.now = real; }
}

test('an unchanged price backup is not rewritten every ten minutes — guards the KV write limit', async () => {
  // Backups were rewritten once per 10 minutes per key, although a day's published
  // prices do not change. Same body: leave it; renew the 7-day expiry once a day.
  const kv = makeKv({});
  const urls = [`/api/raw/prices?area=DK1&${range}`, '/api/prices?area=DK1&mode=inkl_alt'];
  const hit = async () => { const api = await createApi({ kv }); for (const u of urls) await api.get(u); };
  await hit();
  const first = [...kv.ops.put];
  assert.ok(first.includes('raw-prices-backup-DK1'), 'the rolling backup is written the first time');
  assert.ok(first.some(k => k.startsWith('prices-DK1-')), 'the per-window backup is written the first time');

  await withClock(30 * 60_000, hit);
  assert.deepEqual(kv.ops.put, first, `unchanged data rewritten 30 minutes later: ${kv.ops.put.slice(first.length)}`);

  await withClock(25 * 3600_000, hit);
  assert.ok(kv.ops.put.length > first.length, 'the expiry is never renewed, so the backups would vanish after 7 days');
  assert.ok(kv.ops.put.length <= first.length * 2 + 1, 'the daily renewal rewrote more than the same backups once');
});

test('a changed price backup is still written (after the ten-minute window)', async () => {
  const kv = makeKv({});
  const api = await createApi({ kv });
  await api.get(`/api/raw/prices?area=DK1&${range}`);
  const before = kv.ops.put.length;
  // A different range holds different records, so the rolling backup gains data.
  await withClock(30 * 60_000, async () => {
    await (await createApi({ kv })).get(`/api/raw/prices?area=DK1&start=${day(-30)}&end=${day(-20)}`);
  });
  assert.ok(kv.ops.put.length > before, 'new data was not stored');
});

// ── /api/nordic — the Nordic zones, and the eleven EU zones (actual prices only) ─────────────────────────────

const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };
/** A KV value as the Spark jobs write it: days of 24 hours, EUR/MWh. `actual` days only for the EU job. */
const feed = (zone, dates, type = 'actual', trained = null) => ({
  zone, generated: day(0), trainedThrough: trained, unit: 'EUR/MWh',
  days: dates.map((d, i) => ({ date: d, type, prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 50 + h + i })) })),
});
const EU = ['de', 'fr', 'pl', 'it-n'];   // the four zones Energy-Charts licenses CC BY 4.0; Ireland and Italy's other zones are not served

test('/api/nordic: a Nordic zone is served exactly as before — the KV value plus zoneInfo with the ECB rate', async () => {
  // The EU zones share this handler; the Nordic answer must not change by a byte.
  const f = feed('no1', [day(-1), day(0), day(1)], 'actual', '2026-10-25');
  const api = await createApi({ kv: makeKv({ 'nordic-forecast-no1': f }), ecb: ECB });
  const r = await api.get('/api/nordic?zone=no1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ...f, zoneInfo: { name: 'NO1 Oslo', country: 'NO', currency: 'NOK', rate: 10.4665, rateDate: '2026-10-23', rateSource: 'ECB' } });
  assert.equal(r.headers.get('cache-control'), 'public, max-age=1800, s-maxage=1800');
  // Without the ECB the fallback rate is used and says so.
  const fb = await (await createApi({ kv: makeKv({ 'nordic-forecast-no1': f }) })).get('/api/nordic?zone=no1');
  assert.equal(fb.body.zoneInfo.rate, 10.84);
  assert.equal(fb.body.zoneInfo.rateSource, 'fallback');
  assert.equal((await (await createApi({ kv: makeKv({ 'nordic-forecast-dk1': feed('dk1', [day(0)]) }), ecb: ECB })).get('/api/nordic')).body.zone, 'dk1', 'no zone means dk1, as before');
});

test('/api/nordic: every EU zone (de, fr, pl, it-n) is served from its own eu-prices key, with zoneInfo, and nothing but actual days', async () => {
  const seed = Object.fromEntries(EU.map(z => [`eu-prices-${z}`, feed(z, [day(0), day(1)])]));
  for (const z of EU) {
    const kv = makeKv(seed), api = await createApi({ kv, ecb: ECB });
    const r = await api.get(`/api/nordic?zone=${z}`);
    assert.equal(r.status, 200, z);
    assert.deepEqual(kv.ops.get, [`eu-prices-${z}`], `${z} reads exactly its own key`);
    assert.equal(r.body.zone, z);
    assert.equal(r.body.trainedThrough, null, `${z}: no model, so no training date`);
    assert.equal(r.body.unit, 'EUR/MWh');
    assert.ok(r.body.days.every(d => d.type === 'actual' && d.prices.length === 24), `${z}: actual days of 24 hours`);
    const info = r.body.zoneInfo;
    assert.deepEqual(Object.keys(info), ['name', 'country', 'currency', 'rate', 'rateDate', 'rateSource'], `${z}: zoneInfo has the Nordic shape`);
    assert.equal(info.currency, z === 'pl' ? 'PLN' : 'EUR');
    assert.equal(info.rate, z === 'pl' ? 4.3945 : 1, `${z}: rate`);
    assert.equal(info.country, z === 'it-n' ? 'IT' : z.toUpperCase());
    assert.equal(info.rateSource, 'ECB');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=1800, s-maxage=1800', `${z}: same caching as a Nordic zone`);
  }
});

test('/api/nordic: Poland is converted with the ECB PLN rate, and falls back (saying so) when the ECB file is not sane', async () => {
  const kv = makeKv({ 'eu-prices-pl': feed('pl', [day(0)]) });
  assert.equal((await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=pl')).body.zoneInfo.rate, 4.3945);
  const bad = await (await createApi({ kv: makeKv({ 'eu-prices-pl': feed('pl', [day(0)]) }), ecb: { ...ECB, PLN: 0.43 } })).get('/api/nordic?zone=pl');
  assert.equal(bad.body.zoneInfo.rate, 4.39);
  assert.equal(bad.body.zoneInfo.rateSource, 'fallback');
});

test('/api/nordic: a day that is not published yet is simply absent — tomorrow before the auction gives one day', async () => {
  const api = await createApi({ kv: makeKv({ 'eu-prices-de': feed('de', [day(-1), day(0)]) }), ecb: ECB });
  const r = await api.get('/api/nordic?zone=de');
  assert.deepEqual(r.body.days.map(d => d.date), [day(-1), day(0)]);
  assert.ok(!r.body.days.some(d => d.date === day(1)), 'a day that is not in KV must not appear');
});

test('/api/nordic: a zone without data answers 404 exactly like a Nordic zone without data, and nothing is invented', async () => {
  for (const z of ['it-n', 'se2']) {
    const api = await createApi({ kv: makeKv({}), ecb: ECB });
    const r = await api.get(`/api/nordic?zone=${z}`);
    assert.equal(r.status, 404, z);
    assert.deepEqual(Object.keys(r.body), ['error'], `${z}: the same JSON error shape`);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  }
  // The key families do not cross: a Nordic key never answers for an EU zone and the other way round.
  const kv = makeKv({ 'nordic-forecast-de': feed('de', [day(0)], 'forecast'), 'eu-prices-no1': feed('no1', [day(0)]) });
  assert.equal((await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=de')).status, 404);
  assert.equal((await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=no1')).status, 404);
});

test('/api/nordic: an unknown zone is rejected with 400 and the list of zones, and never reaches KV', async () => {
  // Ireland and Italy's other zones are not served (their price data is not CC BY 4.0 at the source): 400, not an empty 404.
  for (const z of ['xx', 'it', 'it-x', 'gb', 'de-lu', 'nl2', '../x', 'eu-prices-de', 'ie', 'it-cn', 'it-cs', 'it-s', 'it-cal', 'it-sic', 'it-sar']) {
    const kv = makeKv({}), api = await createApi({ kv, ecb: ECB });
    const r = await api.get(`/api/nordic?zone=${encodeURIComponent(z)}`);
    assert.equal(r.status, 400, z);
    assert.match(r.body.error, /zone must be one of: .*no1.*de, fr, pl, it-n$/);
    assert.equal(kv.reads(), 0, `${z} must not cost a KV read`);
  }
  assert.equal((await (await createApi({ kv: makeKv({ 'eu-prices-de': feed('de', [day(0)]) }), ecb: ECB })).get('/api/nordic?zone=DE')).status, 200, 'the zone is case-insensitive like the Nordic ones');
});

test('/api/nordic: EU zones carry an ETag, answer 304, and cost one KV read however often they are asked', async () => {
  const kv = makeKv({ 'eu-prices-it-n': feed('it-n', [day(0)]) });
  const api = await createApi({ kv, ecb: ECB });
  const first = await api.get('/api/nordic?zone=it-n');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'ETag');
  assert.equal((await api.get('/api/nordic?zone=it-n', { 'If-None-Match': etag })).status, 304);
  for (let i = 0; i < 20; i++) await api.get('/api/nordic?zone=it-n');
  assert.equal(kv.reads(), 1, `20 requests cost ${kv.reads()} KV reads`);
});

test('/api/openapi.json documents /api/nordic with every zone, and says the EU zones are actual prices only', async () => {
  const spec = (await (await createApi()).get('/api/openapi.json')).body;
  const op = spec.paths['/api/nordic'].get;
  const zones = op.parameters[0].schema.enum;
  for (const z of ['dk1', 'no5', 'se4', 'fi', 'nl', ...EU]) assert.ok(zones.includes(z), `${z} missing from the zone enum`);
  assert.equal(zones.length, 13 + 4);
  for (const z of ['ie', 'it-cn', 'it-sar']) assert.ok(!zones.includes(z), `${z} must not be offered`);
  assert.match(op.description, /actual prices only, no forecast/);
  assert.match(op.description, /Bundesnetzagentur \| SMARD\.de via Energy-Charts\.info/);
  assert.match(op.description, /CC BY 4\.0/);
  assert.match(op.description, /changed by elpriser\.org/);
  assert.doesNotMatch(op.description, /ENTSO-E/);
  assert.match(op.description, /excluding VAT, taxes and grid fees/);
});

// ── Tomorrow's prices around 13:00 (a page still said "Prognose" for tomorrow at 13:29 on 2026-10-26) ──

/** Freeze `new Date()` and Date.now() at an instant; returns { set(iso), restore() }. */
function freezeClock(iso) {
  const Real = Date;
  let fixed = Real.parse(iso);
  class FakeDate extends Real {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
  return { set(next) { fixed = Real.parse(next); }, restore() { globalThis.Date = Real; } };
}
const FC = '/api/forecast?area=DK1&mode=inkl_alt';
const tomorrowOf = body => body.days.find(d => d.date === '2026-10-27');

test('a missing tomorrow after 12:30 is kept for one minute only, in the response and in every cache layer', async () => {
  const clock = freezeClock('2026-10-26T11:40:00Z');          // 12:40 CET, 13:00 not yet struck
  try {
    upstreamState.tomorrowPublished = false;
    const api = await createApi();
    const first = await api.get(FC);
    assert.equal(tomorrowOf(first.body).type, 'forecast', 'tomorrow is a forecast until the auction results are out');
    assert.match(first.headers.get('cache-control'), /max-age=60, s-maxage=60/, 'an answer lacking a due tomorrow must not be cached for half an hour');

    upstreamState.tomorrowPublished = true;                    // the results appear
    clock.set('2026-10-26T11:42:00Z');                         // two minutes later
    const second = await api.get(FC);
    assert.equal(tomorrowOf(second.body).type, 'actual', 'tomorrow stayed a forecast after the prices were published');
    assert.match(second.headers.get('cache-control'), /max-age=1800/, 'once tomorrow is in, the normal 30 minutes apply');
  } finally { upstreamState.tomorrowPublished = true; clock.restore(); }
});

test('before 12:30 a missing tomorrow is normal: no short caching, no extra fetching', async () => {
  const clock = freezeClock('2026-10-26T10:00:00Z');          // 11:00 CET
  try {
    upstreamState.tomorrowPublished = false;
    const api = await createApi();
    const r = await api.get(FC);
    assert.match(r.headers.get('cache-control'), /max-age=1800/);
  } finally { upstreamState.tomorrowPublished = true; clock.restore(); }
});

test('prices fetched after 13:00 without tomorrow are not kept until the next day — guards the underlying price cache', async () => {
  // The old rule kept anything fetched after 13:00 until the NEXT 13:00 (clamped to 6 h), whatever it contained.
  const clock = freezeClock('2026-10-26T12:05:00Z');          // 13:05 CET, results delayed
  try {
    upstreamState.tomorrowPublished = false;
    const api = await createApi();
    assert.equal(tomorrowOf((await api.get(FC)).body).type, 'forecast');
    upstreamState.tomorrowPublished = true;
    clock.set('2026-10-26T12:08:00Z');                         // three minutes later: published
    assert.equal(tomorrowOf((await api.get(FC)).body).type, 'actual', 'a missing tomorrow was kept for hours');
  } finally { upstreamState.tomorrowPublished = true; clock.restore(); }
});
