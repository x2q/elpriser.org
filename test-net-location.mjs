#!/usr/bin/env node
/**
 * Location data on the net company pages (/dk1/<net>, /dk2/<net>) and the GeoJSON of Energistyrelsen's areas, through the
 * real Pages Function.
 * Run: node test-net-location.mjs   (hermetic: fake ASSETS, /api/now, /api/forecast and tariff)
 *
 * The page is about a grid company and the place it covers is its supply area. We hold no polygon of any supply
 * area, so the markup may say only what we know: the Place lies inside the price area and contains the cities whose
 * sampled addresses the company served — and a company with no sampled city gets the price area alone. What these
 * tests guard: every net page carries one WebPage whose spatialCoverage is a Place (never a Country), the same Place
 * is the Organization's areaServed, the cities are exactly the ones the page itself lists under "Byer i området",
 * each with its point and Wikidata id, and nothing is invented (no address, LocalBusiness or boundary).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);
const { CITIES, CITY_LOCATION } = await import(pathToFileURL(path.join(ROOT, 'functions/_cities.js')).href);
const { NET_AREAS, NET_AREAS_SOURCE } = await import(pathToFileURL(path.join(ROOT, 'functions/_net-areas.js')).href);
const { NET_ARM, SHAPE_MIN_SHARE, SHAPE_MAX_POINTS } = await import(pathToFileURL(path.join(ROOT, 'functions/_net-location.js')).href);

const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const forecast = (area, mode) => ({
  area, mode, generated: today, charges: { sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25 },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i), type: i === 0 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: +(1 + h / 40 + i * 0.01).toFixed(4) })),
    ...(mode.startsWith('net_') ? { grid_tariff: Array.from({ length: 24 }, () => 0.4) } : {}),
  })),
});
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async u => {
  const url = new URL(String(u)), json = b => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/forecast') return json(forecast(url.searchParams.get('area'), url.searchParams.get('mode')));
  if (url.pathname === '/api/now') return json({ price: 2.5, hour: 12 });
  if (url.pathname === '/api/raw/tariff') return json({ records: [{ Price1: 0.2, Price7: 0.4, Price18: 1 }] });
  return new Response('{}', { status: 404 });
};
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = await res.text();
  const ld = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  return { status: res.status, body, ld, text: body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
};

const sitemap = await (await onRequest({ request: new Request('https://elpriser.org/sitemap.xml'), env: { ASSETS: { fetch: async () => new Response(INDEX) } } })).text();
const netPaths = [...sitemap.matchAll(/<loc>https:\/\/elpriser\.org(\/dk[12]\/[a-z0-9-]+)<\/loc>/g)].map(m => m[1]);
const AREA = { dk1: 'DK1', dk2: 'DK2' };
const REGION = { DK1: 'Vestdanmark (Jylland og Fyn)', DK2: 'Østdanmark (Sjælland, Lolland-Falster og Bornholm)' };
const towns = (area, slug) => CITIES.filter(c => c.area === area && c.nets.some((x, i) => x.slug === slug && (i === 0 || x.share >= 0.25)));

test('there are net pages to test, and they all answer 200 with one WebPage', async () => {
  assert.ok(netPaths.length >= 14, `${netPaths.length} net pages in the sitemap`);
  for (const p of netPaths) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.ld.filter(x => x['@type'] === 'WebPage').length, 1, `${p}: one WebPage`);
  }
});

test('spatialCoverage is a Place inside the price area; the Organization serves the same Place', async () => {
  for (const p of netPaths) {
    const [, d, slug] = p.split('/'), area = AREA[d];
    const w = (await get(p)).ld.find(x => x['@type'] === 'WebPage');
    assert.equal(w.url, 'https://elpriser.org' + p);
    assert.equal(w.inLanguage, 'da');
    assert.equal(w.spatialCoverage['@type'], 'Place', `${p}: spatialCoverage must be a Place`);
    assert.deepEqual(w.spatialCoverage.containedInPlace, { '@type': 'Place', name: REGION[area] }, `${p}: inside the price area`);
    assert.deepEqual(w.about.areaServed, w.spatialCoverage, `${p}: the Organization serves the page's Place`);
    assert.equal(w.about['@type'], 'Organization');
    assert.match(w.about.globalLocationNumber, /^5790\d{9}$/);
    assert.ok(w.spatialCoverage.name.endsWith('s forsyningsområde') && w.spatialCoverage.name.includes(w.about.name), `${p}: ${w.spatialCoverage.name}`);
  }
});

test('the cities in the Place are exactly those the page lists, each with its point and Wikidata id', async () => {
  let withCities = 0, without = 0;
  for (const p of netPaths) {
    const [, d, slug] = p.split('/'), area = AREA[d];
    const r = await get(p), w = r.ld.find(x => x['@type'] === 'WebPage'), want = towns(area, slug);
    const got = (w.spatialCoverage.containsPlace || []);
    assert.deepEqual(got.map(x => x.name), want.map(c => c.name), `${p}: cities`);
    for (const c of got) {
      const row = CITIES.find(x => x.name === c.name), L = CITY_LOCATION[row.slug];
      assert.deepEqual(c.geo, { '@type': 'GeoCoordinates', latitude: L.lat, longitude: L.lng });
      assert.equal(c.sameAs[0], `https://www.wikidata.org/wiki/${L.wikidata}`);
      assert.ok(r.text.includes(c.name) && r.text.includes('Byer i området'), `${p}: the page itself names ${c.name}`);
    }
    if (want.length) withCities++; else { without++; assert.ok(!('containsPlace' in w.spatialCoverage), `${p}: no sampled city, no containsPlace`); assert.ok(!r.text.includes('Byer i området'), `${p}: the page lists no cities either`); }
  }
  assert.ok(withCities >= 8 && without >= 4, `${withCities} nets with cities, ${without} without`);
});

const inDK = (lat, lng) => lat > 54.4 && lat < 57.9 && lng > 7.9 && lng < 15.3;
const slugOf = p => p.split('/')[2];
const bySlug = {}; for (const p of netPaths) bySlug[slugOf(p)] = p;

test('the experiment: sixteen net companies, four variants of four, and the polygon only where it is the area', () => {
  assert.deepEqual(Object.keys(NET_ARM).sort(), Object.keys(NET_AREAS).sort(), 'every net has an arm and an area');
  assert.deepEqual(Object.keys(bySlug).sort(), Object.keys(NET_ARM).sort(), 'and a page');
  for (const a of ['base', 'box', 'map', 'shape']) assert.equal(Object.values(NET_ARM).filter(x => x === a).length, 4, a);
  for (const [slug, arm] of Object.entries(NET_ARM)) if (arm === 'shape') {
    assert.ok(NET_AREAS[slug].largestShare >= SHAPE_MIN_SHARE && NET_AREAS[slug].ring.length <= SHAPE_MAX_POINTS, `${slug}: the polygon is not the area`);
  }
});

test('each variant adds exactly its one thing to the control, and the data variants name their source', async () => {
  for (const [slug, p] of Object.entries(bySlug)) {
    const arm = NET_ARM[slug], r = await get(p), w = r.ld.find(x => x['@type'] === 'WebPage'), c = w.spatialCoverage, A = NET_AREAS[slug];
    assert.deepEqual(w.about.areaServed, c, `${p}: the Organization serves the page's Place`);
    assert.equal('geo' in c, arm === 'box' || arm === 'shape', `${p}: geo only in box and shape (${arm})`);
    assert.equal('hasMap' in c, arm === 'map', `${p}: hasMap only in map`);
    assert.equal('isBasedOn' in w, arm !== 'base', `${p}: isBasedOn only where Energistyrelsen's data is used`);
    assert.equal(r.text.includes('Energistyrelsens kort over netvirksomheder'), arm !== 'base', `${p}: the visible source line`);
    if (arm !== 'base') {
      assert.deepEqual(w.isBasedOn, { '@type': 'CreativeWork', name: NET_AREAS_SOURCE.name, url: NET_AREAS_SOURCE.url });
      assert.ok(r.body.includes(`href="${NET_AREAS_SOURCE.url}"`), `${p}: the source line links Energistyrelsen`);
    }
    if (arm === 'box') {
      assert.equal(c.geo['@type'], 'GeoShape');
      const [s, we, n, e] = c.geo.box.split(' ').map(Number);
      assert.deepEqual([s, we, n, e], A.box);
      assert.ok(s < n && we < e && inDK(s, we) && inDK(n, e), `${p}: ${c.geo.box}`);
    }
    if (arm === 'map') assert.equal(c.hasMap, `https://elpriser.org/net-areas/${slug}.geojson`);
    if (arm === 'shape') {
      const v = c.geo.polygon.split(' ').map(Number), pairs = [];
      for (let i = 0; i < v.length; i += 2) pairs.push([v[i], v[i + 1]]);
      assert.equal(c.geo['@type'], 'GeoShape');
      assert.ok(v.length % 2 === 0 && pairs.length >= 4 && pairs.length <= SHAPE_MAX_POINTS, `${p}: ${pairs.length} points`);
      assert.deepEqual(pairs[0], pairs[pairs.length - 1], `${p}: the ring is closed`);
      assert.ok(pairs.every(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && inDK(la, lo)), `${p}: every point is in Denmark`);
    }
  }
});

test('/net-areas.geojson and /net-areas/<net>.geojson: GeoJSON with its source, CORS, and 404 for what is not a net', async () => {
  const res = await onRequest({ request: new Request('https://elpriser.org/net-areas.geojson'), env: { ASSETS: { fetch: async () => new Response(INDEX) } } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/geo\+json/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control'), /max-age=\d{4,}/);
  const gj = await res.json();
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, 16);
  assert.ok(gj.attribution.includes('Energistyrelsen') && gj.attribution.includes(NET_AREAS_SOURCE.url) && /forenklet/i.test(gj.note));
  for (const f of gj.features) {
    assert.equal(f.type, 'Feature');
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type), f.properties.slug);
    assert.ok(f.properties.name && /^5790\d{9}$/.test(f.properties.gln) && f.properties.areaKm2 > 0);
  }
  const one = await (await onRequest({ request: new Request('https://elpriser.org/net-areas/n1.geojson'), env: { ASSETS: { fetch: async () => new Response(INDEX) } } })).json();
  assert.equal(one.features.length, 1); assert.equal(one.features[0].properties.slug, 'n1');
  for (const bad of ['/net-areas/ukendt.geojson', '/net-areas/n1', '/net-areas/.geojson', '/net-areas/..%2Fn1.geojson']) {
    const r = await onRequest({ request: new Request('https://elpriser.org' + bad), env: { ASSETS: { fetch: async () => new Response(INDEX) } } });
    assert.equal(r.status, 404, bad);
  }
});

// Point in polygon over the GeoJSON the site serves (even-odd rule; holes are rings after the first).
const inRing = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inPoly = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h));
const inGeom = (pt, g) => g.type === 'Polygon' ? inPoly(pt, g.coordinates) : g.coordinates.some(poly => inPoly(pt, poly));

test('the boundaries agree with the sampled addresses: each pilot city\'s centre lies in its main net company\'s area, and in no other', async () => {
  const gj = await (await onRequest({ request: new Request('https://elpriser.org/net-areas.geojson'), env: { ASSETS: { fetch: async () => new Response(INDEX) } } })).json();
  for (const c of CITIES) {
    const L = CITY_LOCATION[c.slug], hit = gj.features.filter(f => inGeom([L.lng, L.lat], f.geometry)).map(f => f.properties.slug);
    assert.deepEqual(hit, [c.nets[0].slug], `${c.slug}: the centre is in ${hit.join(',') || 'no area'}, the samples say ${c.nets[0].slug}`);
  }
});

test('nothing is invented: no address, LocalBusiness or country coverage, no NaN; /dk1 and /dk2 are unchanged', async () => {
  for (const p of netPaths) {
    const r = await get(p), s = JSON.stringify(r.ld.find(x => x['@type'] === 'WebPage'));
    assert.ok(!/LocalBusiness|PostalAddress|streetAddress|"Country"|undefined|NaN|null/.test(s), `${p}: ${s.slice(0, 200)}`);
  }
  for (const p of ['/dk1', '/dk2']) assert.ok(!(await get(p)).ld.some(x => x['@type'] === 'WebPage'), `${p}: the area pages carry no WebPage data`);
});
