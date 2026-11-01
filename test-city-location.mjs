#!/usr/bin/env node
/**
 * The location data on the city pages and the experiment around it (functions/_city-location.js, CITY_LOCATION in
 * functions/_cities.js). Offline.
 * Run: node test-city-location.mjs
 *
 * One variant per page, because a URL cannot be A/B-tested against itself. What these tests guard is that the
 * table is sound (every city has a point inside Denmark, an entity id, a region and exactly one of five arms,
 * two cities each), that every arm writes exactly what it is meant to test and nothing else, and that nothing
 * is made up: spatialCoverage is a Place (never a Country — Search Console flagged that on /api), the Dataset
 * points at the city's own API URL, and no business address, LocalBusiness or invented date range appears.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITIES, CITY_LOCATION } from './functions/_cities.js';
import { cityLocation } from './functions/_city-location.js';

const ARMS = ['base', 'place', 'coverage', 'dataset', 'geo'];
const REGIONS = ['DK-81', 'DK-82', 'DK-83', 'DK-84', 'DK-85'];
const url = c => `https://elpriser.org/elpris/${c.slug}`;
const loc = c => cityLocation(c, c.nets[0], url(c));
const byArm = a => CITIES.filter(c => CITY_LOCATION[c.slug].arm === a);

test('the table: every city has a row, and every row a city', () => {
  assert.deepEqual(Object.keys(CITY_LOCATION).sort(), CITIES.map(c => c.slug).sort());
});

test('the table: a point inside Denmark, a Wikidata id, a Wikipedia title, a region, one of five arms', () => {
  const ids = new Set();
  for (const c of CITIES) {
    const L = CITY_LOCATION[c.slug];
    assert.ok(L.lat > 54.5 && L.lat < 57.8 && L.lng > 8 && L.lng < 15.3, `${c.slug}: the point is not in Denmark`);
    assert.match(L.wikidata, /^Q\d+$/, `${c.slug}: wikidata`);
    assert.ok(!ids.has(L.wikidata), `${c.slug}: the Wikidata id is used twice`); ids.add(L.wikidata);
    assert.ok(typeof L.wikipedia === 'string' && L.wikipedia.length > 2, `${c.slug}: wikipedia`);
    assert.ok(REGIONS.includes(L.region), `${c.slug}: region ${L.region}`);
    assert.ok(ARMS.includes(L.arm), `${c.slug}: arm ${L.arm}`);
    // Zealand and the capital region are the east of the country: the price area DK2 starts at about 11° east.
    assert.equal(['DK-84', 'DK-85'].includes(L.region), L.lng >= 11 && c.area === 'DK2', `${c.slug}: region, longitude and price area disagree`);
  }
});

test('the experiment: five arms with two cities each', () => {
  for (const a of ARMS) assert.equal(byArm(a).length, 2, `${a} has ${byArm(a).length} cities`);
});

test('base (the control): a City in Danmark and nothing else', () => {
  for (const c of byArm('base')) {
    const r = loc(c);
    assert.deepEqual(r.about, { '@type': 'City', name: c.name, containedInPlace: { '@type': 'Country', name: 'Danmark' } });
    assert.deepEqual([r.pageExtra, r.extraLd, r.headMeta], [{}, [], '']);
  }
});

test('place: the city as a Place with a point and sameAs, and nothing else', () => {
  for (const c of byArm('place')) {
    const r = loc(c), L = CITY_LOCATION[c.slug];
    assert.equal(r.about['@type'], 'City');
    assert.deepEqual(r.about.geo, { '@type': 'GeoCoordinates', latitude: L.lat, longitude: L.lng });
    assert.deepEqual(r.about.sameAs, [`https://www.wikidata.org/wiki/${L.wikidata}`, `https://da.wikipedia.org/wiki/${encodeURIComponent(L.wikipedia)}`]);
    assert.equal(r.about.containedInPlace.name, 'Danmark');
    assert.deepEqual([r.pageExtra, r.extraLd, r.headMeta], [{}, [], '']);
  }
});

test('coverage: the same Place, and a spatialCoverage that is a Place (never a Country)', () => {
  for (const c of byArm('coverage')) {
    const r = loc(c), L = CITY_LOCATION[c.slug];
    assert.ok(r.about.geo && r.about.sameAs, 'the coverage arm includes the place arm');
    assert.deepEqual(Object.keys(r.pageExtra), ['spatialCoverage']);
    assert.deepEqual(r.pageExtra.spatialCoverage, { '@type': 'Place', name: c.name, geo: { '@type': 'GeoCoordinates', latitude: L.lat, longitude: L.lng } });
    assert.deepEqual([r.extraLd, r.headMeta], [[], '']);
  }
});

test('dataset: one Dataset about the city, with a Place as spatialCoverage and the city\'s own API URL', () => {
  for (const c of byArm('dataset')) {
    const r = loc(c), d = r.extraLd[0], main = c.nets[0];
    assert.equal(r.extraLd.length, 1);
    assert.deepEqual([r.pageExtra, r.headMeta], [{}, '']);
    assert.equal(d['@type'], 'Dataset');
    assert.equal(d.url, url(c));
    assert.ok(d.name.includes(c.name) && d.description.includes(c.name) && d.description.includes(main.name) && d.description.includes(c.area));
    assert.equal(d.spatialCoverage['@type'], 'Place');
    assert.equal(d.isAccessibleForFree, true);
    assert.equal(d.license, 'https://www.energidataservice.dk/legal-information');
    assert.equal(d.distribution.length, 1);
    assert.equal(d.distribution[0].contentUrl, `https://elpriser.org/api/forecast?area=${c.area}&mode=net_inkl_alt&gln=${main.gln}`);
    assert.equal(d.distribution[0].encodingFormat, 'application/json');
    assert.equal(d.variableMeasured[0].unitText, 'DKK/kWh');
    // Nothing we cannot stand behind: no date range, no population, no address.
    assert.ok(!('temporalCoverage' in d) && !/indbygger|befolkning|address|LocalBusiness/i.test(JSON.stringify(d)));
  }
});

test('geo: four meta tags with the table\'s values, and nothing else', () => {
  for (const c of byArm('geo')) {
    const r = loc(c), L = CITY_LOCATION[c.slug];
    assert.equal(r.headMeta, [
      `<meta name="geo.region" content="${L.region}">`,
      `<meta name="geo.placename" content="${c.name}">`,
      `<meta name="geo.position" content="${L.lat};${L.lng}">`,
      `<meta name="ICBM" content="${L.lat}, ${L.lng}">`,
    ].join('\n  '));
    assert.deepEqual([r.pageExtra, r.extraLd], [{}, []]);
  }
});

test('every arm serialises cleanly: no undefined, NaN or LocalBusiness, and a city without a row gets the control', () => {
  for (const c of CITIES) {
    const r = loc(c), s = JSON.stringify(r);
    assert.ok(!/undefined|NaN|null|LocalBusiness|PostalAddress/.test(s), `${c.slug}: ${s}`);
  }
  const ghost = { slug: 'ingenby', name: 'Ingenby', area: 'DK1', nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1' }] };
  assert.deepEqual(cityLocation(ghost, ghost.nets[0], 'https://elpriser.org/elpris/ingenby').about, { '@type': 'City', name: 'Ingenby', containedInPlace: { '@type': 'Country', name: 'Danmark' } });
});
