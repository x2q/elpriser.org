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
import { parseZone, daysFrom } from './tests/golden/zones.mjs';       // the reference of what the Android and iOS apps make of /api/nordic

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

// A company that publishes its household tariff under another Note than "Nettarif C" (Zeanet: "Nettarif C time") is
// fetched with all its Notes, and a KV archive built before that (no `notes`) would hide periods, so it is ignored.
const GLN_ZEANET = '5790001089375';
const zeanetArchive = (notes) => ({ ...tariffArchive(), ...(notes ? { notes } : {}) });
const tariffCalls = api => api.calls.filter(u => u.includes('DatahubPricelist') && u.includes(GLN_ZEANET)).map(decodeURIComponent);

test('tariff Notes: a company with its own Notes is fetched under all of them; the others under "Nettarif C" alone', async () => {
  const api = await createApi();
  await api.get(`/api/now?area=DK2&mode=net_inkl_alt&gln=${GLN_ZEANET}`);
  const z = tariffCalls(api);
  assert.ok(z.length >= 1 && z.every(u => u.includes('"Note":["Nettarif C","Nettarif C time"]')), z.join('\n'));
  const api2 = await createApi();
  await api2.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  const n1 = api2.calls.filter(u => u.includes('DatahubPricelist') && u.includes(GLN_N1)).map(decodeURIComponent);
  assert.ok(n1.length >= 1 && n1.every(u => u.includes('"Note":"Nettarif C"')), n1.join('\n'));
});

test('tariff Notes: an archive without the company\'s Notes is ignored, one with them is used', async () => {
  const stale = await createApi({ kv: makeKv({ [`dk-nettarif-${GLN_ZEANET}`]: zeanetArchive(null) }) });
  await stale.get(`/api/now?area=DK2&mode=net_inkl_alt&gln=${GLN_ZEANET}`);
  assert.ok(tariffCalls(stale).length >= 1, 'the stale archive was trusted: no live fetch');
  const fresh = await createApi({ kv: makeKv({ [`dk-nettarif-${GLN_ZEANET}`]: zeanetArchive(['Nettarif C', 'Nettarif C time']) }) });
  await fresh.get(`/api/now?area=DK2&mode=net_inkl_alt&gln=${GLN_ZEANET}`);
  assert.equal(tariffCalls(fresh).length, 0, 'an archive with the right Notes is used without going upstream');
  // A company on the default needs no `notes` in its archive.
  const n1 = await createApi({ kv: makeKv({ [`dk-nettarif-${GLN_N1}`]: tariffArchive() }) });
  await n1.get(`/api/now?area=DK1&mode=net_inkl_alt&gln=${GLN_N1}`);
  assert.equal(n1.calls.filter(u => u.includes('DatahubPricelist') && u.includes(GLN_N1)).length, 0);
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

// ── /api/nordic — the Nordic zones, and the EU zones (actual prices only) ─────────────────────────────

const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };
/** A KV value as the Spark jobs write it: days of 24 hours, EUR/MWh. `actual` days only for the EU job. */
const feed = (zone, dates, type = 'actual', trained = null) => ({
  zone, generated: day(0), trainedThrough: trained, unit: 'EUR/MWh',
  days: dates.map((d, i) => ({ date: d, type, prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 50 + h + i })) })),
});
// Energy-Charts (CC BY 4.0 from SMARD.de), ENTSO-E (build_entsoe_prices.py), Elexon BMRS (gb, build_elexon_prices.py) and SEMOpx (ie, build_semopx_prices.py); Italy's other zones (it-cn, it-cs, ...) are not served yet
const EST_ZONES = ['gb', 'pt', 'ie'];      // the zones that may have an estimate of the hours without a price yet (functions/_estimate.js)
const EU = ['de', 'fr', 'pl', 'it-n', 'at', 'be', 'ch', 'cz', 'hu', 'si', 'es', 'pt', 'sk', 'gr', 'ro', 'bg', 'hr', 'rs', 'ee', 'lv', 'lt', 'me', 'mk', 'al', 'xk', 'gb', 'ie'];

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

// ── NL: the Nordic feed (model forecast) with the settled ENTSO-E days of eu-prices-nl laid over it ──
// nordic-forecast-nl is written once a day at 12:40 UTC and the Dutch day-ahead results often reach ENTSO-E after that, so its today (and
// tomorrow) are forecast days although the auction has settled. build_entsoe_prices.py (NORDIC_OVERLAY) writes eu-prices-nl twice a day.
const nlFeed = (actual, forecast, generated = day(-1)) => ({
  zone: 'nl', generated, trainedThrough: day(-3), unit: 'EUR/MWh',
  days: [...feed('nl', actual, 'actual').days,
    ...feed('nl', forecast, 'forecast').days.map(d => ({ ...d, prices: d.prices.map(p => ({ ...p, eur_mwh: p.eur_mwh + 100, min_eur_mwh: p.eur_mwh + 90, max_eur_mwh: p.eur_mwh + 110 })) }))],
});
const nlGet = async (nordic, settled) => createApi({ kv: makeKv({ ...(nordic ? { 'nordic-forecast-nl': nordic } : {}), ...(settled ? { 'eu-prices-nl': settled } : {}) }), ecb: ECB })
  .then(api => api.get('/api/nordic?zone=nl'));
const kinds = b => b.days.map(d => [d.date, d.type]);
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => day(a + i));

test('/api/nordic: NL today (and tomorrow) are settled prices, the nordic model days follow the last settled day without a hole', async () => {
  // the feed is a day old: yesterday settled, today and the next eight days forecast
  const nordic = nlFeed([day(-2), day(-1)], span(0, 8));
  let r = await nlGet(nordic, feed('nl', [day(-1), day(0)]));
  assert.equal(r.status, 200);
  assert.deepEqual(kinds(r.body), [[day(-2), 'actual'], [day(-1), 'actual'], [day(0), 'actual'], ...span(1, 8).map(d => [d, 'forecast'])]);
  assert.deepEqual(r.body.days[2].prices[3], { hour: 3, eur_mwh: 54 }, 'today is the settled price of eu-prices-nl (50 + hour 3 + day 1 of ITS list), not the model\'s');
  assert.deepEqual(r.body.days[3].prices[3], { hour: 3, eur_mwh: 154, min_eur_mwh: 144, max_eur_mwh: 164 }, 'the forecast days are the nordic job\'s, band included');
  assert.equal(r.body.trainedThrough, day(-3));
  assert.equal(r.body.generated, day(-1));
  assert.ok(!('model' in r.body) && !('accuracy' in r.body));
  assert.deepEqual(r.body.zoneInfo, { name: 'NL Nederland', country: 'NL', currency: 'EUR', rate: 1, rateDate: '2026-10-23', rateSource: 'ECB' });
  // tomorrow's auction has settled too: it replaces the forecast of that date, the forecast starts the day after
  r = await nlGet(nordic, feed('nl', [day(-1), day(0), day(1)]));
  assert.deepEqual(kinds(r.body), [[day(-2), 'actual'], [day(-1), 'actual'], [day(0), 'actual'], [day(1), 'actual'], ...span(2, 8).map(d => [d, 'forecast'])]);
  // what the apps make of it: complete days from today, today and tomorrow actual, then the forecast, consecutive
  const days = daysFrom(parseZone(r.body).days, day(0));
  assert.deepEqual(days.map(d => d.actual), [true, true, false, false, false, false, false, false, false]);
});

test('/api/nordic: NL without eu-prices-nl is the nordic feed, byte for byte; a Nordic zone never reads the settled key', async () => {
  const nordic = nlFeed([day(-1)], span(0, 8));
  const r = await nlGet(nordic, null);
  assert.deepEqual(r.body, { ...nordic, zoneInfo: { name: 'NL Nederland', country: 'NL', currency: 'EUR', rate: 1, rateDate: '2026-10-23', rateSource: 'ECB' } });
  const kv = makeKv({ 'nordic-forecast-dk1': nlFeed([day(0)], span(1, 3)), 'eu-prices-dk1': feed('dk1', [day(0)]) });
  const d = await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=dk1');
  assert.deepEqual(d.body.days.map(x => x.type), ['actual', 'forecast', 'forecast', 'forecast']);
  assert.deepEqual(kv.ops.get, ['nordic-forecast-dk1']);
  assert.equal((await nlGet(null, feed('nl', [day(0)]))).status, 404, 'no nordic feed: unchanged, 404');
});

test('/api/nordic: NL - a forecast that cannot be joined to the settled days is dropped, a half-published day does not displace a forecast day', async () => {
  // the feed's forecast starts two days after the last settled day: no hole is closed with it
  let r = await nlGet(nlFeed([day(-1)], span(3, 8)), feed('nl', [day(0), day(1)]));
  assert.deepEqual(kinds(r.body), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'actual']]);
  // a hole inside the feed's forecast ends it there
  r = await nlGet(nlFeed([day(-1)], [day(1), day(2), day(4), day(5)]), feed('nl', [day(-1), day(0)]));
  assert.deepEqual(kinds(r.body), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'forecast'], [day(2), 'forecast']]);
  // today only half published at ENTSO-E (13 hours): the overlay ignores it, the feed's forecast day for today stays whole
  const half = feed('nl', [day(0)]); half.days[0].prices = half.days[0].prices.slice(0, 13);
  r = await nlGet(nlFeed([day(-1)], span(0, 3)), { ...half, days: [...feed('nl', [day(-1)]).days, ...half.days] });
  assert.deepEqual(kinds(r.body), [[day(-1), 'actual'], ...span(0, 3).map(d => [d, 'forecast'])]);
  assert.equal(r.body.days[1].prices.length, 24);
  // a day with a null price is not a settled day
  const nul = feed('nl', [day(0)]); nul.days[0].prices[5].eur_mwh = null;
  r = await nlGet(nlFeed([day(-1)], span(0, 2)), nul);
  assert.deepEqual(kinds(r.body), [[day(-1), 'actual'], [day(0), 'forecast'], [day(1), 'forecast'], [day(2), 'forecast']]);
  // a spring-forward day (23 hours, local hour 2 does not exist) is
  const dst = feed('nl', [day(0)]); dst.days[0].prices = dst.days[0].prices.filter(p => p.hour !== 2);
  r = await nlGet(nlFeed([day(-1)], span(0, 2)), dst);
  assert.deepEqual(kinds(r.body), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'forecast'], [day(2), 'forecast']]);
  // a `forecast` day in eu-prices-nl is not a settled price
  r = await nlGet(nlFeed([day(-1)], span(0, 2)), feed('nl', [day(0)], 'forecast'));
  assert.deepEqual(kinds(r.body).map(k => k[1]), ['actual', 'forecast', 'forecast', 'forecast']);
  assert.deepEqual(r.body.days[1].prices[0], { hour: 0, eur_mwh: 150, min_eur_mwh: 140, max_eur_mwh: 160 });
});

test('/api/nordic: NL - the nordic job has caught up (its own actual days) and the overlay is older: nothing is lost, nothing duplicated', async () => {
  const r = await nlGet(nlFeed([day(-1), day(0), day(1)], span(2, 8), day(0)), feed('nl', [day(-2), day(-1), day(0)]));
  assert.deepEqual(kinds(r.body), [[day(-2), 'actual'], [day(-1), 'actual'], [day(0), 'actual'], [day(1), 'actual'], ...span(2, 8).map(d => [d, 'forecast'])]);
  assert.equal(new Set(r.body.days.map(d => d.date)).size, r.body.days.length);
});

test('/api/nordic: every EU zone (27 of them) is served from its own eu-prices key, with zoneInfo, and nothing but actual days', async () => {
  const seed = Object.fromEntries(EU.map(z => [`eu-prices-${z}`, feed(z, [day(0), day(1)])]));
  for (const z of EU) {
    const kv = makeKv(seed), api = await createApi({ kv, ecb: ECB });
    const r = await api.get(`/api/nordic?zone=${z}`);
    assert.equal(r.status, 200, z);
    // the zones with an estimate (functions/_estimate.js ESTIMATE_ZONES) read one more key of their own; no other zone does
    const keys = [`eu-forecast-${z}`, `eu-prices-${z}`, ...(EST_ZONES.includes(z) ? [`eu-estimate-${z}`] : [])].sort();
    assert.deepEqual([...kv.ops.get].sort(), keys, `${z} reads exactly its own keys (prices, the forecast and, for ${EST_ZONES.join('/')}, the estimate: all absent here but the prices)`);
    assert.equal(r.body.zone, z);
    assert.equal(r.body.trainedThrough, null, `${z}: no model, so no training date`);
    assert.equal(r.body.unit, 'EUR/MWh');    // the fixture's; the real gb payload says GBP/MWh (below)
    assert.ok(r.body.days.every(d => d.type === 'actual' && d.prices.length === 24), `${z}: actual days of 24 hours`);
    const info = r.body.zoneInfo;
    assert.deepEqual(Object.keys(info), ['name', 'country', 'currency', 'rate', 'rateDate', 'rateSource'], `${z}: zoneInfo has the Nordic shape`);
    assert.equal(info.currency, z === 'pl' ? 'PLN' : z === 'gb' ? 'GBP' : 'EUR');
    assert.equal(info.rate, z === 'pl' ? 4.3945 : 1, `${z}: rate (Great Britain's feed is already in pounds: 1)`);
    assert.equal(info.country, z === 'it-n' ? 'IT' : z.toUpperCase());
    assert.equal(info.rateSource, 'ECB');
    assert.equal(r.headers.get('cache-control'), EST_ZONES.includes(z) ? 'public, max-age=300, s-maxage=300' : 'public, max-age=1800, s-maxage=1800', `${z}: same caching as a Nordic zone (five minutes where an estimate is replaced hour by hour)`);
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

test('/api/nordic: the source of each settled day (days[].source, written by the source-priority job) reaches the answer untouched, in /api/slots too', async () => {
  // yesterday and today from ENTSO-E, tomorrow from Energy-Charts (ENTSO-E had not published it): the answer says so, day by day
  const f = feed('de', [day(-1), day(0), day(1)]);
  f.days[0].source = 'entsoe'; f.days[1].source = 'entsoe'; f.days[2].source = 'energy-charts';
  const api = await createApi({ kv: makeKv({ 'eu-prices-de': f }), ecb: ECB });
  const r = await api.get('/api/nordic?zone=de');
  assert.deepEqual(r.body.days.map(d => d.source), ['entsoe', 'entsoe', 'energy-charts']);
  assert.deepEqual(r.body.days.map(d => d.date), [day(-1), day(0), day(1)]);
  assert.equal(r.body.days[2].prices.length, 24);
  // a zone whose KV was written before the layer (no `source`) is served exactly as before
  const old = await (await createApi({ kv: makeKv({ 'eu-prices-de': feed('de', [day(0)]) }), ecb: ECB })).get('/api/nordic?zone=de');
  assert.ok(old.body.days.every(d => !('source' in d)));
  assert.equal((await api.get('/api/slots?zone=de')).status, 200);
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
  // Italy's other zones and Northern Ireland are not served: 400, not an empty 404.
  for (const z of ['xx', 'it', 'it-x', 'uk', 'gbr', 'gb-nir', 'ni', 'de-lu', 'nl2', '../x', 'eu-prices-de', 'ie-sem', 'it-cn', 'it-cs', 'it-s', 'it-cal', 'it-sic', 'it-sar']) {
    const kv = makeKv({}), api = await createApi({ kv, ecb: ECB });
    const r = await api.get(`/api/nordic?zone=${encodeURIComponent(z)}`);
    assert.equal(r.status, 400, z);
    assert.match(r.body.error, /zone must be one of: .*no1.*de, fr, pl, it-n, at, be, ch, cz, hu, si, es, pt, sk, gr, ro, bg, hr, rs, ee, lv, lt, me, mk, al, xk, gb, ie$/);
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
  assert.equal(kv.reads(), 2, `20 requests cost ${kv.reads()} KV reads (the prices key and the forecast key, once each)`);
});

// ── EU forecast days: eu-forecast-<zone> on top of the settled prices (scripts/forecast_model/eu), NEW key, nothing else changes ──

/** The accuracy block as scripts/forecast_model/eu/gate.py accuracy_block writes it (version 2). */
const ACC = { version: 2, period: '2025-04-01..2026-11-02', baseline: 'level+shape', recent: '2026-09-01', fuel: true, showEur: false,
  byHorizon: { 2: { mae: 19.7, baseMae: 31.8, gain: 0.381, gainHold: 0.402, gainRecent: 0.393, bias: -6, baseBias: -9.2, regret: 2.16, baseRegret: 4.06, rankGain: 0.468, rankOk: true, coverage: 0.79, coverageRecent: 0.66, low: false, days: 572 },
    3: { mae: 22.1, baseMae: 33.0, gain: 0.27, gainHold: 0.3, gainRecent: 0.28, bias: -7, baseBias: -9.4, regret: 2.5, baseRegret: 4.1, rankGain: 0.4, rankOk: true, coverage: 0.78, coverageRecent: 0.65, low: false, days: 572 } } };

/** A forecast KV value as scripts/forecast_model/eu/forecast.py writes it: forecast days only, with horizon and P10/P90. */
const euFc = (zone, dates, { generated = day(0), trained = day(-1), accuracy } = {}) => ({
  zone, generated, generatedAt: `${generated}T12:50:00+00:00`, trainedThrough: trained, unit: 'EUR/MWh', model: 'eu-ens-v2',
  ...(accuracy ? { accuracy } : {}),
  days: dates.map((d, i) => ({ date: d, type: 'forecast', horizon: i + 2, prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 80 + h, min_eur_mwh: 60 + h, max_eur_mwh: 100 + h })) })),
});

test('/api/nordic: an EU zone with a forecast key gets the settled days first and the forecast days after them', async () => {
  const acc = ACC;
  const kv = makeKv({ 'eu-prices-de': feed('de', [day(-1), day(0), day(1)]), 'eu-forecast-de': euFc('de', [day(2), day(3), day(4)], { accuracy: acc }) });
  const r = await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=de');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.days.map(d => [d.date, d.type]), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'actual'], [day(2), 'forecast'], [day(3), 'forecast'], [day(4), 'forecast']]);
  assert.deepEqual(r.body.days[3].prices[5], { hour: 5, eur_mwh: 85, min_eur_mwh: 65, max_eur_mwh: 105 }, 'the Nordic field names for the band');
  assert.equal(r.body.days[3].horizon, 2);
  assert.equal(r.body.model, 'eu-ens-v2');
  assert.equal(r.body.trainedThrough, day(-1));
  assert.equal(r.body.forecastGenerated, day(0));
  assert.deepEqual(r.body.accuracy, acc);
  assert.equal(r.body.zoneInfo.currency, 'EUR');
  assert.deepEqual([...kv.ops.get].sort(), ['eu-forecast-de', 'eu-prices-de']);
  assert.equal(kv.ops.put.length, 0, 'the forecast is read, never written, by the API');
});

test('/api/nordic: a settled price always wins over a forecast for the same day, and a forecast never fills a hole before a settled day', async () => {
  // tomorrow is published (settled) although the forecast run still lists it: the settled day is used and the forecast copy dropped
  const kv = makeKv({ 'eu-prices-fr': feed('fr', [day(0), day(1)]), 'eu-forecast-fr': euFc('fr', [day(-1), day(0), day(1), day(2)]) });
  const r = await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=fr');
  assert.deepEqual(r.body.days.map(d => [d.date, d.type]), [[day(0), 'actual'], [day(1), 'actual'], [day(2), 'forecast']]);
});

test('/api/nordic: without a forecast key an EU zone answers exactly as before (byte for byte the settled prices)', async () => {
  const f = feed('es', [day(-1), day(0)]);
  const r = await (await createApi({ kv: makeKv({ 'eu-prices-es': f }), ecb: ECB })).get('/api/nordic?zone=es');
  assert.deepEqual(r.body, { ...f, zoneInfo: { name: 'ES Spain', country: 'ES', currency: 'EUR', rate: 1, rateDate: '2026-10-23', rateSource: 'ECB' } });
  assert.ok(!('model' in r.body) && !('accuracy' in r.body) && !('forecastGenerated' in r.body));
});

test('/api/nordic: a stale, malformed or foreign forecast is ignored, not repaired', async () => {
  const prices = feed('ro', [day(-1), day(0), day(1)]);
  const cases = {
    'a run older than 3 days before the newest settled day': euFc('ro', [day(2), day(3)], { generated: day(-4) }),
    'a run without a generated date': { ...euFc('ro', [day(2)]), generated: undefined },
    'no days': { ...euFc('ro', [day(2)]), days: [] },
    'days that are not forecast': { ...euFc('ro', [day(2)]), days: euFc('ro', [day(2)]).days.map(d => ({ ...d, type: 'actual' })) },
    'a day with 23 hours': { ...euFc('ro', [day(2)]), days: euFc('ro', [day(2)]).days.map(d => ({ ...d, prices: d.prices.slice(1) })) },
    'a NaN-ish hour (null)': { ...euFc('ro', [day(2)]), days: euFc('ro', [day(2)]).days.map(d => ({ ...d, prices: d.prices.map((p, i) => (i === 7 ? { hour: 7, eur_mwh: null } : p)) })) },
    'not an object': 'oops',
  };
  for (const [name, fc] of Object.entries(cases)) {
    const r = await (await createApi({ kv: makeKv({ 'eu-prices-ro': prices, 'eu-forecast-ro': fc }), ecb: ECB })).get('/api/nordic?zone=ro');
    assert.equal(r.status, 200, name);
    assert.deepEqual(r.body.days.map(d => d.type), ['actual', 'actual', 'actual'], `${name}: only the settled days`);
    assert.ok(!('model' in r.body), `${name}: no model metadata`);
  }
  // one malformed day among good ones ends the run there: the days after it would leave a hole, and the apps and the Pris screen stop at a hole
  const mixed = euFc('ro', [day(2), day(3), day(4)]);
  mixed.days[1].prices = mixed.days[1].prices.slice(0, 20);
  const r = await (await createApi({ kv: makeKv({ 'eu-prices-ro': prices, 'eu-forecast-ro': mixed }), ecb: ECB })).get('/api/nordic?zone=ro');
  assert.deepEqual(r.body.days.filter(d => d.type === 'forecast').map(d => d.date), [day(2)]);
  // the same malformed day first: nothing is usable
  const first = euFc('ro', [day(2), day(3)]);
  first.days[0].prices = first.days[0].prices.slice(0, 20);
  const r2 = await (await createApi({ kv: makeKv({ 'eu-prices-ro': prices, 'eu-forecast-ro': first }), ecb: ECB })).get('/api/nordic?zone=ro');
  assert.deepEqual(r2.body.days.map(d => d.type), ['actual', 'actual', 'actual']);
  assert.ok(!('model' in r2.body));
});

const euGet = async (zone, fc, dates = [day(-1), day(0), day(1)]) =>
  (await (await createApi({ kv: makeKv({ [`eu-prices-${zone}`]: feed(zone, dates), [`eu-forecast-${zone}`]: fc }), ecb: ECB })).get(`/api/nordic?zone=${zone}`)).body;
const fcDays = body => body.days.filter(d => d.type === 'forecast');

test('/api/nordic: the forecast days join the settled days without a hole, or not at all (the apps and the Pris screen stop at a hole)', async () => {
  // the run starts a day late (the settled prices end on day 1, the first forecast day is day 3): nothing is added
  let b = await euGet('de', euFc('de', [day(3), day(4), day(5)]));
  assert.deepEqual(b.days.map(d => d.type), ['actual', 'actual', 'actual']);
  assert.ok(!('model' in b) && !('accuracy' in b));
  // a hole inside the run ends it there
  b = await euGet('de', euFc('de', [day(2), day(3), day(5), day(6)]));
  assert.deepEqual(fcDays(b).map(d => d.date), [day(2), day(3)]);
  // the run starts earlier than the newest settled day (tomorrow was published after the run): the settled days win, the rest joins
  b = await euGet('de', euFc('de', [day(0), day(1), day(2), day(3)]));
  assert.deepEqual(b.days.map(d => [d.date, d.type]), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'actual'], [day(2), 'forecast'], [day(3), 'forecast']]);
  // only today is settled (before the auction): the run's first day is tomorrow
  b = await euGet('de', euFc('de', [day(1), day(2)]), [day(-1), day(0)]);
  assert.deepEqual(fcDays(b).map(d => d.date), [day(1), day(2)]);
  // days arriving out of order or twice are put in order and counted once
  const fc = euFc('de', [day(2), day(3), day(4)]);
  fc.days = [fc.days[2], fc.days[0], fc.days[1], { ...fc.days[0] }];
  b = await euGet('de', fc);
  assert.deepEqual(fcDays(b).map(d => d.date), [day(2), day(3), day(4)]);
  // never more than eight forecast days
  b = await euGet('de', euFc('de', Array.from({ length: 12 }, (_, i) => day(2 + i))));
  assert.equal(fcDays(b).length, 8);
});

test('/api/nordic: a band is on all 24 hours of a day or on none, and contains the price; anything else costs that day', async () => {
  const mk = edit => { const f = euFc('at', [day(2), day(3)]); edit(f.days[0].prices); return f; };
  const cases = {
    'a band on 23 hours only': f => { delete f[4].min_eur_mwh; delete f[4].max_eur_mwh; },
    'min above the price': f => { f[9].min_eur_mwh = f[9].eur_mwh + 1; },
    'max below the price': f => { f[9].max_eur_mwh = f[9].eur_mwh - 1; },
    'only a min': f => { delete f[2].max_eur_mwh; },
    'a text band': f => { f[2].min_eur_mwh = '60'; },
    'a repeated hour': f => { f[3].hour = 2; },
    'an hour outside 0-23': f => { f[23].hour = 24; },
  };
  for (const [name, edit] of Object.entries(cases)) {
    const b = await euGet('at', mk(edit));
    assert.deepEqual(b.days.map(d => d.type), ['actual', 'actual', 'actual'], `${name}: the broken first day ends the run`);
  }
  // no band at all is fine (a run published without calibration)
  const nb = euFc('at', [day(2), day(3)]);
  for (const d of nb.days) d.prices = d.prices.map(({ hour, eur_mwh }) => ({ hour, eur_mwh }));
  const b = await euGet('at', nb);
  assert.deepEqual(fcDays(b).map(d => d.date), [day(2), day(3)]);
  assert.ok(!('min_eur_mwh' in fcDays(b)[0].prices[0]));
});

test('/api/nordic: fields are copied by name - the job\'s archive numbers and unknown fields never reach a client', async () => {
  const fc = euFc('be', [day(2), day(3)], { accuracy: ACC });
  for (const d of fc.days) { d.uncorrected = Array(24).fill(1); d.shadow = Array(24).fill(2); d.secret = 'x'; d.prices[0].extra = 1; }
  fc.zoneSecret = 'y';
  const b = await euGet('be', fc);
  const d0 = fcDays(b)[0];
  assert.deepEqual(Object.keys(d0), ['date', 'type', 'horizon', 'prices']);
  assert.deepEqual(Object.keys(d0.prices[0]), ['hour', 'eur_mwh', 'min_eur_mwh', 'max_eur_mwh']);
  assert.ok(!('zoneSecret' in b) && !('recipe' in b));
  assert.ok(!JSON.stringify(b).includes('uncorrected') && !JSON.stringify(b).includes('shadow'));
});

test('/api/nordic: the accuracy block is passed on as it is, a non-object one is dropped, and the days do not need it', async () => {
  assert.deepEqual((await euGet('ch', euFc('ch', [day(2)], { accuracy: ACC }))).accuracy, ACC);
  for (const bad of ['oops', 7, [1, 2], null]) {
    const fc = euFc('ch', [day(2)]);
    fc.accuracy = bad;
    const b = await euGet('ch', fc);
    assert.deepEqual(fcDays(b).map(d => d.date), [day(2)], JSON.stringify(bad));
    assert.ok(!('accuracy' in b), JSON.stringify(bad));
  }
});

test('/api/nordic: what the apps make of an EU zone with forecast days (the golden parseZone + daysFrom the Android and iOS tests are written against)', async () => {
  // settled up to tomorrow, six forecast days D+2..D+7 after it
  const b = await euGet('de', euFc('de', [day(2), day(3), day(4), day(5), day(6), day(7)], { accuracy: ACC }));
  const parsed = parseZone(b);
  const days = daysFrom(parsed.days, day(0));
  assert.deepEqual(days.map(d => d.date), [day(0), day(1), day(2), day(3), day(4), day(5), day(6), day(7)], 'today..today+7, consecutive, no hole');
  assert.deepEqual(days.map(d => d.actual), [true, true, false, false, false, false, false, false]);
  for (const d of days) assert.equal(d.price.length, 24);
  assert.equal(days[0].lo, null, 'a settled day has no band');
  for (const d of days.slice(2)) {
    assert.ok(d.lo && d.hi, 'a forecast day carries its band');
    d.price.forEach((p, h) => assert.ok(d.lo[h] <= p && p <= d.hi[h], 'min <= price <= max'));
  }
  assert.equal(parsed.currency, 'EUR');
  // a day the API refuses (23 hours) never reaches the apps as a half day, and nothing after it either: a hole would end their run at that point
  const cut = euFc('de', [day(2), day(3), day(4)]);
  cut.days[1].prices = cut.days[1].prices.slice(0, 23);
  const c = await euGet('de', cut);
  assert.deepEqual(daysFrom(parseZone(c).days, day(0)).map(d => d.date), [day(0), day(1), day(2)]);
  // a run that starts a day late joins nothing: the apps show the settled days only, the same as without a forecast
  const late = await euGet('de', euFc('de', [day(3), day(4)]));
  assert.deepEqual(daysFrom(parseZone(late).days, day(0)).map(d => d.actual), [true, true]);
});

test('/api/nordic: Baltic and Balkan zones, Poland and Ireland are served like the rest (forecast days, the ECB rate of the zone\'s currency)', async () => {
  for (const z of ['ee', 'lv', 'lt', 'al', 'ie', 'pl', 'it-n']) {
    const b = await euGet(z, euFc(z, [day(2), day(3)]));
    assert.deepEqual(fcDays(b).map(d => d.date), [day(2), day(3)], z);
    assert.equal(b.zoneInfo.currency, z === 'pl' ? 'PLN' : 'EUR');
  }
});

test('/api/nordic: no settled prices means 404 even when a forecast exists, and Nordic zones never read an eu-forecast key', async () => {
  const r = await (await createApi({ kv: makeKv({ 'eu-forecast-de': euFc('de', [day(2)]) }), ecb: ECB })).get('/api/nordic?zone=de');
  assert.equal(r.status, 404, 'a forecast with no settled day beside it is not served');
  const kv = makeKv({ 'nordic-forecast-no1': feed('no1', [day(0), day(1)], 'forecast', day(-1)), 'eu-forecast-no1': euFc('no1', [day(5)]) });
  const n = await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=no1');
  assert.deepEqual(n.body.days.map(d => d.date), [day(0), day(1)], 'a Nordic zone is untouched');
  assert.deepEqual(kv.ops.get, ['nordic-forecast-no1'], 'and costs no extra KV read');
});

test('/api/nordic: an EU zone with a forecast is still cached and still one read per key however often it is asked', async () => {
  const kv = makeKv({ 'eu-prices-pt': feed('pt', [day(0), day(1)]), 'eu-forecast-pt': euFc('pt', [day(2), day(3)]) });
  const api = await createApi({ kv, ecb: ECB });
  const first = await api.get('/api/nordic?zone=pt');
  assert.ok(first.headers.get('etag'));
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300, s-maxage=300', 'pt may carry an estimate: five minutes');
  for (let i = 0; i < 20; i++) await api.get('/api/nordic?zone=pt');
  assert.equal(kv.reads(), 3, 'prices, forecast and estimate, once each');
  const de = makeKv({ 'eu-prices-de': feed('de', [day(0), day(1)]), 'eu-forecast-de': euFc('de', [day(2), day(3)]) });
  const dapi = await createApi({ kv: de, ecb: ECB });
  assert.equal((await dapi.get('/api/nordic?zone=de')).headers.get('cache-control'), 'public, max-age=1800, s-maxage=1800');
  for (let i = 0; i < 20; i++) await dapi.get('/api/nordic?zone=de');
  assert.equal(de.reads(), 2, 'a zone without an estimate costs no extra read');
});

// ── The ESTIMATE of hours that have no price yet (gb: today's unpriced hours; pt, ie: the last local hour of the newest day) — functions/_estimate.js ──

/** A settled day whose hours from `from` on have no price (null), as the Elexon job writes today. */
const partialDay = (date, from, to = 24) => ({ date, type: 'actual', prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: h >= from && h < to ? null : 100 + h })) });
const estKv = (zone, date, hours, { at = new Date().toISOString(), band = true, extra = {} } = {}) => ({
  zone, date, generatedAt: at, model: 'gb-est-v1', method: 'gb-intraday-ensemble', unit: zone === 'gb' ? 'GBP/MWh' : 'EUR/MWh',
  hours: hours.map(h => ({ hour: h, eur_mwh: 150 + h, ...(band ? { min_eur_mwh: 130 + h, max_eur_mwh: 190 + h } : {}) })),
  accuracy: { asOf: 2, unit: zone === 'gb' ? 'GBP/MWh' : 'EUR/MWh', mae: 18.1, baseMae: 24.7, gain: 0.267, coverage: 0.77 }, ...extra });
const estGet = async (zone, est, days, fc) => (await (await createApi({ kv: makeKv({ [`eu-prices-${zone}`]: { ...feed(zone, []), days }, ...(est === undefined ? {} : { [`eu-estimate-${zone}`]: est }), ...(fc ? { [`eu-forecast-${zone}`]: fc } : {}) }), ecb: ECB })).get(`/api/nordic?zone=${zone}`)).body;
const range2 = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

test('/api/nordic?zone=gb: the estimate of the rest of today is a separate top-level object — days[] are never touched, and only unpriced hours are estimated', async () => {
  const days = [{ ...feed('gb', [day(-1)]).days[0] }, partialDay(day(0), 3)];
  const b = await estGet('gb', estKv('gb', day(0), range2(1, 24)), days);      // hours 1 and 2 already have a settled price: they are dropped
  assert.deepEqual(b.days, days, 'the settled days are byte for byte what the price job wrote');
  assert.equal(b.estimate.type, 'forecast');
  assert.equal(b.estimate.scope, 'partial-day');
  assert.equal(b.estimate.date, day(0));
  assert.deepEqual(b.estimate.prices.map(p => p.hour), range2(3, 24), 'a settled price always replaces an estimate');
  assert.deepEqual(b.estimate.prices[0], { hour: 3, eur_mwh: 153, min_eur_mwh: 133, max_eur_mwh: 193 }, 'hour-level, with the P10/P90 band in the Nordic field names');
  assert.equal(b.estimate.accuracy.unit, 'GBP/MWh');
  assert.equal(b.estimate.model, 'gb-est-v1');
  assert.deepEqual(Object.keys(b.estimate).sort(), ['accuracy', 'date', 'generatedAt', 'method', 'model', 'prices', 'scope', 'type']);
  assert.equal(b.zoneInfo.currency, 'GBP');
});

test('/api/nordic?zone=gb: a client that has never heard of `estimate` makes exactly what it made before (the apps\' parseZone, daysFrom)', async () => {
  const days = [{ ...feed('gb', [day(-1)]).days[0] }, partialDay(day(0), 3)];
  const plain = await estGet('gb', undefined, days);
  const withEst = await estGet('gb', estKv('gb', day(0), range2(3, 24)), days);
  assert.ok(!('estimate' in plain));
  assert.deepEqual(parseZone(withEst), parseZone(plain), 'the golden parseZone ignores it');
  assert.deepEqual(daysFrom(parseZone(withEst).days, day(0)), daysFrom(parseZone(plain).days, day(0)));
  const { estimate, ...rest } = withEst;
  assert.deepEqual(rest, plain, 'removing the estimate gives the old answer');
});

test('/api/nordic?zone=gb: forecast days D+1.. follow the partial day of settled prices without a hole, beside the estimate', async () => {
  const days = [{ ...feed('gb', [day(-1)]).days[0] }, partialDay(day(0), 3)];
  const fc = { ...euFc('gb', [day(1), day(2), day(3)], { accuracy: { ...ACC, unit: 'GBP/MWh' } }), unit: 'GBP/MWh', model: 'gb-est-v1' };
  fc.days.forEach((d, i) => { d.horizon = i + 1; });
  const b = await estGet('gb', estKv('gb', day(0), range2(3, 24)), days, fc);
  assert.deepEqual(b.days.map(d => [d.date, d.type]), [[day(-1), 'actual'], [day(0), 'actual'], [day(1), 'forecast'], [day(2), 'forecast'], [day(3), 'forecast']]);
  assert.deepEqual(b.days.filter(d => d.type === 'forecast').map(d => d.horizon), [1, 2, 3]);
  assert.equal(b.model, 'gb-est-v1');
  assert.equal(b.accuracy.unit, 'GBP/MWh');
  assert.equal(b.estimate.prices.length, 21);
});

test('/api/nordic: an estimate is served only when it is fresh, well-formed and for a day of the answer — otherwise the answer is the settled prices alone', async () => {
  const days = [partialDay(day(0), 3)];
  const ok = await estGet('gb', estKv('gb', day(0), range2(3, 24)), days);
  assert.ok(ok.estimate);
  // too old (a job that stopped), from the future, for another day, for no day of the answer
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(0), range2(3, 24), { at: new Date(Date.now() - 3.2 * 3600e3).toISOString() }), days)), 'older than three hours');
  assert.ok('estimate' in await estGet('gb', estKv('gb', day(0), range2(3, 24), { at: new Date(Date.now() - 2.5 * 3600e3).toISOString() }), days), 'two and a half hours is fine');
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(0), range2(3, 24), { at: new Date(Date.now() + 3600e3).toISOString() }), days)), 'from the future');
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(1), range2(3, 24)), days)), 'a day the answer does not have');
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(0), range2(0, 3)), days)), 'every hour already settled: nothing left to estimate');
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(0), range2(3, 24), { extra: { generatedAt: 'yesterday' } }), days)), 'a generatedAt that is not a time');
  // a settled day that is complete takes no estimate; a forecast day (not settled) takes none either
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(0), range2(3, 24)), [{ ...feed('gb', [day(0)]).days[0] }])), 'a complete settled day');
  assert.ok(!('estimate' in await estGet('gb', estKv('gb', day(1), range2(0, 24)), [partialDay(day(0), 3), { ...feed('gb', [day(1)], 'forecast').days[0] }])), 'a forecast day');
});

test('/api/nordic: estimated hours are copied by name, a band is on every hour or on none, min <= price <= max, bad hours are dropped', async () => {
  const days = [partialDay(day(0), 3)];
  const est = estKv('gb', day(0), range2(3, 24));
  est.hours[0].secret = 'x'; est.secret = 'y';
  est.hours[1] = { hour: 4, eur_mwh: 155, min_eur_mwh: 160, max_eur_mwh: 190 };         // min above the price: the hour is dropped
  est.hours[2] = { hour: 5, eur_mwh: 'x' };                                              // not a number
  est.hours[3] = { hour: 3, eur_mwh: 1 };                                                // a duplicate hour: the first one wins
  est.hours.push({ hour: 24, eur_mwh: 1 }, { hour: -1, eur_mwh: 1 }, { hour: 1.5, eur_mwh: 1 }, null);
  const b = await estGet('gb', est, days);
  assert.deepEqual(b.estimate.prices.map(p => p.hour), [3, ...range2(7, 24)]);   // 4 (band outside), 5 (not a number), the duplicate 3 (it replaced 6)
  assert.deepEqual(Object.keys(b.estimate.prices[0]), ['hour', 'eur_mwh', 'min_eur_mwh', 'max_eur_mwh']);
  assert.ok(!JSON.stringify(b).includes('secret'));
  const half = estKv('gb', day(0), range2(3, 24));
  delete half.hours[5].min_eur_mwh; delete half.hours[5].max_eur_mwh;
  const h = await estGet('gb', half, days);
  assert.ok(h.estimate.prices.every(p => !('min_eur_mwh' in p)), 'a band on some hours only is no band');
  for (const bad of ['oops', 7, [1], { hours: 'x' }, { hours: [] }]) assert.ok(!('estimate' in await estGet('gb', bad, days)), JSON.stringify(bad));
});

test('/api/nordic: Portugal and Ireland get the one missing last hour estimated, any other zone ignores (and never reads) an estimate key', async () => {
  for (const z of ['pt', 'ie']) {
    const days = [feed(z, [day(0)]).days[0], partialDay(day(1), 23)];
    const b = await estGet(z, estKv(z, day(1), [23]), days);
    assert.deepEqual(b.estimate.prices.map(p => p.hour), [23], z);
    assert.equal(b.estimate.date, day(1));
    assert.deepEqual(b.days, days, `${z}: the day with 23 priced hours is left as it is`);
    assert.equal(b.zoneInfo.currency, 'EUR');
  }
  const kv = makeKv({ 'eu-prices-de': feed('de', [day(0)]), 'eu-estimate-de': estKv('de', day(0), [23]) });
  const r = await (await createApi({ kv, ecb: ECB })).get('/api/nordic?zone=de');
  assert.ok(!('estimate' in r.body));
  assert.ok(![...kv.ops.get].includes('eu-estimate-de'), 'no read for a zone that is not on the list');
});

test('/api/openapi.json documents /api/nordic with every zone, the EU forecast days and what they are worth', async () => {
  const spec = (await (await createApi()).get('/api/openapi.json')).body;
  const op = spec.paths['/api/nordic'].get;
  const zones = op.parameters[0].schema.enum;
  for (const z of ['dk1', 'no5', 'se4', 'fi', 'nl', ...EU]) assert.ok(zones.includes(z), `${z} missing from the zone enum`);
  assert.equal(zones.length, 13 + 27);
  for (const z of ['it-cn', 'it-sar', 'uk', 'gb-nir']) assert.ok(!zones.includes(z), `${z} must not be offered`);
  assert.match(op.description, /\*\*Forecast days for 26 EU zones\*\*/);
  assert.match(op.description, /NOT an official forecast/);
  assert.match(op.description, /all of the above except `gb`/);
  assert.match(op.description, /at least 5 % below that of a simple level-and-shape method out of sample/);
  assert.match(op.description, /`gainRecent`[^\n]*2026-09-01/);
  assert.match(op.description, /not a promised 80 %/);
  assert.match(op.description, /`accuracy\.showEur`/);
  assert.match(op.description, /settled price always replaces the forecast/);
  assert.doesNotMatch(op.description, /MIBGAS|EEX|\bTTF\b|gas price|carbon price/i, 'the fuel inputs are never named on a public page');
  assert.match(op.description, /Bundesnetzagentur \| SMARD\.de via Energy-Charts\.info/);
  assert.match(op.description, /CC BY 4\.0/);
  assert.match(op.description, /changed by elpriser\.org/);
  assert.match(op.description, /ENTSO-E Transparency Platform \(day-ahead prices, article 12\.1\.d\)/);
  assert.match(op.description, /`xk` Kosovo/);
  assert.match(op.description, /`ie` Ireland[^\n]*Source: SEMOpx, the day-ahead auction results/);
  // Great Britain is NOT a day-ahead price, is in pounds, and carries the licence's attribution.
  assert.match(op.description, /`gb`: NOT a day-ahead price/);
  assert.match(op.description, /Market Index Price \(within-day\)/);
  assert.match(op.description, /GBP\/MWh/);
  assert.match(op.description, /Contains BMRS data © Elexon Limited copyright and database right/);
  assert.match(op.description, /Northern Ireland is not in `gb`/);
  assert.match(op.description, /excluding VAT, taxes and grid fees/);
});

test('/api/nordic?zone=gb: Great Britain is served in pounds — unit GBP/MWh, zoneInfo.currency GBP with rate 1 (so the sub-unit is pence), no ECB conversion, no tomorrow', async () => {
  const f = { ...feed('gb', [day(-1), day(0)]), unit: 'GBP/MWh' };
  const api = await createApi({ kv: makeKv({ 'eu-prices-gb': f }), ecb: ECB });
  const r = await api.get('/api/nordic?zone=gb');
  assert.equal(r.status, 200);
  assert.equal(r.body.unit, 'GBP/MWh');
  assert.equal(r.body.trainedThrough, null);
  assert.deepEqual(r.body.zoneInfo, { name: 'GB Great Britain', country: 'GB', currency: 'GBP', rate: 1, rateDate: '2026-10-23', rateSource: 'ECB' });
  assert.deepEqual(r.body.days.map(d => d.date), [day(-1), day(0)]);
  // the same answer when the ECB file is unavailable: the rate is 1, not a missing number
  const fb = await (await createApi({ kv: makeKv({ 'eu-prices-gb': f }) })).get('/api/nordic?zone=gb');
  assert.equal(fb.body.zoneInfo.rate, 1);
  assert.equal(fb.body.zoneInfo.currency, 'GBP');
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

test('before 12:30 a missing tomorrow is normal: no short caching', async () => {
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

test('mode=spot is an alias of spot_inkl, every other unknown mode is still a 400 — guards the home-made sensors that ask for `spot`', async () => {
  // Until 2026-08-24 an unknown mode was priced as spot incl. VAT and three Home Assistant installs still send
  // `mode=spot` every few minutes; they have had a 400 ever since.
  const api = await createApi();
  for (const ep of ['prices', 'forecast']) {
    const alias = await api.get(`/api/${ep}?area=DK1&mode=spot`);
    const real  = await api.get(`/api/${ep}?area=DK1&mode=spot_inkl`);
    assert.equal(alias.status, 200, `${ep}: mode=spot gave ${alias.status}`);
    assert.equal(alias.body.mode, 'spot_inkl');
    assert.deepEqual(alias.body, real.body, `${ep}: the alias priced something else`);
    const bad = await api.get(`/api/${ep}?area=DK1&mode=spott`);
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /unknown mode "spott"/);
  }
});

test('a net_ mode without gln answers 400 and says where to find the number', async () => {
  const api = await createApi();
  for (const ep of ['prices', 'forecast', 'now', 'schedule']) {
    const r = await api.get(`/api/${ep}?area=DK1&mode=net_inkl_alt`);
    assert.equal(r.status, 400, ep);
    assert.match(r.body.error, /needs gln/);
    assert.match(r.body.error, /elpriser\.org\/automation/);
  }
});

// ── a day that is not priced yet never goes upstream ────────────────────────

test('/api/prices for the day after tomorrow answers without calling Energi Data Service — a Worker is rate-limited (429) after a few calls, and each of these became a 503', async () => {
  const api = await createApi();
  const r = await api.get(`/api/prices?area=DK1&date=${day(3)}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.prices.every(p => p.price === null), 'a day the market has not priced has no prices');
  assert.equal(api.calls.filter(u => u.includes('DayAheadPrices')).length, 0, 'asked upstream for a day that cannot exist yet');
});

test('between 00:00 and 01:00 Danish time the Danish tomorrow is inside the default window — one shared fetch, not an upstream call per request for a day that is not published', async () => {
  const clock = freezeClock('2026-11-03T23:30:00Z');          // 00:30 CET on 2026-11-04: the UTC date is still 11-03
  try {
    upstreamState.tomorrowPublished = false;
    const api = await createApi();
    for (let i = 0; i < 3; i++) {
      const r = await api.get('/api/prices?area=DK1&date=2026-11-05');
      assert.equal(r.status, 200);
      assert.ok(r.body.prices.every(p => p.price === null), 'tomorrow is not published at 00:30');
    }
    assert.equal(api.calls.filter(u => u.includes('DayAheadPrices')).length, 1, 'each request for tomorrow went upstream on its own');
  } finally { upstreamState.tomorrowPublished = true; clock.restore(); }
});
