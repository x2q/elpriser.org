// Hermetic API tests — the real /api/* handler, with its upstreams faked.
// Run: npm run test:api        (no network, no server, no browser)
//
// These replace the checks test-regressions.js used to make against a local
// `wrangler pages dev`, which needed the network and so failed for reasons that
// had nothing to do with the code. Each test names the bug it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './tests/upstream.mjs';

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
