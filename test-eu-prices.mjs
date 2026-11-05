#!/usr/bin/env node
/**
 * The Spark job behind /de/strompreis, /fr/prix-electricite, /pl/ceny-pradu and /it/prezzo-luce:
 * scripts/eu_prices/ (Energy-Charts /price parsing, hourly local days, KV write with an unchanged-body skip).
 * Run: npm run test:eu-prices   (hermetic: spawns python3 on the pure-Python unit tests; part of test:unit)
 *
 * The Python tests are the real tests (REAL Energy-Charts responses as fixtures: the 25-hour DST day, tomorrow absent, quarter-hourly
 * values; hourly and null values, the 23-hour day, the API's 404 and 429, the payload shape, the skip of an unchanged write, the one
 * request per zone 35 s apart); this wrapper makes them part of the node gate, and adds invariants on the job that must hold wherever it
 * is run: the zone table agrees with the API's, the price source is read in ONE file and it is not ENTSO-E, and the job reads no
 * credential but Cloudflare's, from the environment only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = import.meta.dirname;
const DIR = path.join(ROOT, 'scripts/eu_prices');

for (const f of ['test_energy_charts_parse.py', 'test_entsoe_parse.py', 'test_elexon_parse.py', 'test_semopx_parse.py']) test(`python unit tests: ${f} passes`, () => {
  const r = spawnSync('python3', [path.join(DIR, f)], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'python3 is not available: ' + (r.error && r.error.message));
  assert.equal(r.status, 0, f + ' failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the Python suite ran suspiciously few tests');
});

const apiArray = (api, name) => ((api.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
const readJob = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const zoneBlock = job => job.slice(job.indexOf('ZONES = {'), job.indexOf('\n}\n', job.indexOf('ZONES = {')));

test('the four jobs write exactly the keys /api/nordic reads, for exactly the zones the API serves', () => {
  const ec = readJob('build_eu_prices.py'), en = readJob('build_entsoe_prices.py'), ex = readJob('build_elexon_prices.py'), sx = readJob('build_semopx_prices.py');
  const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const ecZones = [...zoneBlock(ec).matchAll(/^\s+"([a-z-]+)":\s+\("([A-Za-z-]+)",/gm)].map(m => [m[1], m[2]]);
  const enZones = [...zoneBlock(en).matchAll(/^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(ecZones, [['de', 'DE-LU'], ['fr', 'FR'], ['pl', 'PL'], ['it-n', 'IT-North'], ['at', 'AT'], ['be', 'BE'], ['ch', 'CH'], ['cz', 'CZ'], ['hu', 'HU'], ['si', 'SI']],
    'Energy-Charts licenses CC BY 4.0 for these bidding zones (checked in the API\'s own license_info); its others are private/internal use only');
  assert.deepEqual(ecZones.map(z => z[0]), apiArray(api, 'EU_ZONES_ENERGY_CHARTS'), 'the Energy-Charts job and /api/nordic disagree about the zones');
  assert.deepEqual(enZones.map(z => z[0]), apiArray(api, 'EU_ZONES_ENTSOE'), 'the ENTSO-E job and /api/nordic disagree about the zones');
  assert.equal(enZones.length, 15);
  assert.ok(enZones.some(z => z[0] === 'xk' && z[1] === '10Y1001C--00100H'), 'Kosovo (EIC 10Y1001C--00100H) is an ENTSO-E zone');
  assert.ok(!enZones.some(z => z[0] === 'ie'), 'Ireland moved from ENTSO-E to SEMOpx: build_semopx_prices.py writes eu-prices-ie');
  const oneZone = job => [...zoneBlock(job).matchAll(/^\s+"([a-z-]+)":\s+\("([A-Za-z/]+)",\)/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(oneZone(ex), [['gb', 'Europe/London']], 'the Elexon job writes Great Britain only');
  assert.deepEqual(oneZone(sx), [['ie', 'Europe/Dublin']], 'the SEMOpx job writes Ireland only');
  assert.deepEqual(['gb'], apiArray(api, 'EU_ZONES_ELEXON'), 'the Elexon job and /api/nordic disagree about the zones');
  assert.deepEqual(['ie'], apiArray(api, 'EU_ZONES_SEMOPX'), 'the SEMOpx job and /api/nordic disagree about the zones');
  const lists = ['EU_ZONES_ENERGY_CHARTS', 'EU_ZONES_ENTSOE', 'EU_ZONES_ELEXON', 'EU_ZONES_SEMOPX'].map(n => apiArray(api, n)).flat();
  assert.equal(new Set(lists).size, lists.length, 'a zone is in two jobs');
  assert.ok(/const EU_ZONES = \[\.\.\.EU_ZONES_ENERGY_CHARTS, \.\.\.EU_ZONES_ENTSOE, \.\.\.EU_ZONES_ELEXON, \.\.\.EU_ZONES_SEMOPX\]/.test(api), 'EU_ZONES is the four lists');
  assert.ok(/gb:\s+\{ name: 'GB Great Britain',\s+country: 'GB', currency: 'GBP', rate: 1 \}/.test(api), 'gb is served in GBP with rate 1');
  assert.ok(readJob('elexon_parse.py').includes('UNIT = "GBP/MWh"'), 'the Elexon payload says GBP/MWh');
  for (const job of [ec, en, ex, sx]) {
    assert.ok(job.includes('f"eu-prices-{zone}"') && /`eu-prices-\$\{zone\}`/.test(api), 'the KV key differs between a job and the API');
    assert.ok(/CLOUDFLARE_ACCOUNT_ID/.test(job) && /CLOUDFLARE_API_TOKEN/.test(job), 'a job does not read Cloudflare\'s credentials from the environment');
    assert.ok(!/[0-9a-f]{32}/.test(job.replace(/KV_NAMESPACE\s*=\s*"[0-9a-f]{32}"/, '')), 'a 32-hex literal (a token?) sits in a job');
  }
  assert.ok(/os\.environ\.get\("CLOUDFLARE_API_TOKEN"\)/.test(ec), 'the Energy-Charts job does not read Cloudflare\'s token from the environment');
  assert.ok(/os\.environ\.get\("ENTSOE_TOKEN"\)/.test(en), 'the ENTSO-E job does not read its token from the environment');
});

test('the Netherlands is a Nordic-feed zone with an ENTSO-E settled overlay: the job NORDIC_OVERLAY, the API NORDIC_SETTLED_OVERLAY, and in none of the EU lists', () => {
  const en = readJob('build_entsoe_prices.py');
  const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const block = en.slice(en.indexOf('NORDIC_OVERLAY = {'), en.indexOf('\n}\n', en.indexOf('NORDIC_OVERLAY = {')));
  const zones = [...block.matchAll(/^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",\s+"([A-Za-z/_]+)"\)/gm)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(zones, [['nl', '10YNL----------L', 'Europe/Amsterdam']], 'NL: ENTSO-E bidding zone 10YNL----------L on the Amsterdam clock (CET/CEST like DE and DK)');
  assert.deepEqual(apiArray(api, 'NORDIC_SETTLED_OVERLAY'), ['nl']);
  assert.ok(/const NORDIC_ZONES = \[[^\]]*'nl'\]/.test(api), 'nl stays a Nordic-feed zone (the 9-day model forecast)');
  for (const n of ['EU_ZONES_ENERGY_CHARTS', 'EU_ZONES_ENTSOE', 'EU_ZONES_ELEXON', 'EU_ZONES_SEMOPX']) assert.ok(!apiArray(api, n).includes('nl'), `nl is in ${n}: it would lose its nordic forecast and break the pinned zone lists`);
  assert.ok(!zoneBlock(en).includes('"nl"'), 'nl must stay out of ZONES: the zone list is pinned to EU_ZONES_ENTSOE');
  assert.ok(/ALL_ZONES\s*=\s*\{\*\*ZONES, \*\*NORDIC_OVERLAY, \*\*NORDIC_SLOTS_ONLY\}/.test(en) && /zones = a\.zones\.split\(","\) if a\.zones else list\(ALL_ZONES\)/.test(en), 'the job runs the overlay zone by default');
  assert.ok(!/Energy-Charts|energy-charts/i.test(block), 'the Netherlands comes from ENTSO-E, never from Energy-Charts (licence)');
});

test('the 15-minute prices: the jobs write eu-slots-<zone>, /api/slots reads it, and the zone clocks of the API cover every zone it serves', () => {
  const en = readJob('build_entsoe_prices.py'), ec = readJob('build_eu_prices.py');
  const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const slots = fs.readFileSync(path.join(ROOT, 'functions/_slots.js'), 'utf8');
  assert.ok(ec.includes('f"eu-slots-{zone}"'), 'the shared writer (build_eu_prices.store_slots) writes eu-slots-<zone>');
  assert.ok(/`eu-slots-\$\{zone\}`/.test(api), '/api/slots reads the key the jobs write');
  assert.ok(/B\.store_slots\(/.test(en) && /store_slots\(zone, P\.parse_price/.test(ec), 'both jobs write the 15-minute prices');
  const nordicSlots = [...en.slice(en.indexOf('NORDIC_SLOTS_ONLY = {'), en.indexOf('\n}\n', en.indexOf('NORDIC_SLOTS_ONLY = {'))).matchAll(/^\s+"([a-z0-9]+)":/gm)].map(m => m[1]);
  assert.deepEqual(nordicSlots.sort(), apiArray(api, 'NORDIC_ZONES').filter(z => z !== 'nl').sort(), 'every Nordic-feed zone (nl has its own overlay) gets its 15-minute prices from the ENTSO-E job');
  const all = [...apiArray(api, 'NORDIC_ZONES'), ...apiArray(api, 'EU_ZONES_ENERGY_CHARTS'), ...apiArray(api, 'EU_ZONES_ENTSOE'), ...apiArray(api, 'EU_ZONES_ELEXON'), ...apiArray(api, 'EU_ZONES_SEMOPX')];
  for (const z of all) assert.ok(new RegExp(`['"]?${z}['"]?:\\s*'Europe/`).test(slots), `${z} has no time zone in functions/_slots.js ZONE_TZ`);
  assert.equal(all.length, 40);
});

test('each price source is read in ONE place: Energy-Charts from build_eu_prices.py, ENTSO-E from build_entsoe_prices.py — and never from the Worker', () => {
  const ecReaders = [], enReaders = [], enMentions = [], exReaders = [], sxReaders = [];
  for (const dir of ['functions', 'scripts/eu_prices']) for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, String(f));
    if (!fs.statSync(fp).isFile() || !/\.(js|py|mjs|json)$/.test(fp) || fp.includes('/fixtures/') || /test_[a-z_]+\.py$/.test(fp)) continue;
    const t = fs.readFileSync(fp, 'utf8');
    if (t.includes('api.energy-charts.info') && /urlopen|fetch\(/.test(t)) ecReaders.push(path.relative(ROOT, fp));
    if (t.includes('web-api.tp.entsoe.eu') && /urlopen|fetch\(/.test(t)) enReaders.push(path.relative(ROOT, fp));
    if (/ENTSOE_TOKEN|securityToken/.test(t)) enMentions.push(path.relative(ROOT, fp));
    if (t.includes('data.elexon.co.uk') && /urlopen|fetch\(/.test(t)) exReaders.push(path.relative(ROOT, fp));
    if (t.includes('reports.semopx.com') && /urlopen|fetch\(/.test(t)) sxReaders.push(path.relative(ROOT, fp));
  }
  assert.deepEqual(ecReaders, ['scripts/eu_prices/build_eu_prices.py'], 'the Energy-Charts API is read somewhere else than the one job');
  assert.deepEqual(enReaders, ['scripts/eu_prices/build_entsoe_prices.py'], 'the ENTSO-E API is read somewhere else than the one job');
  assert.deepEqual(enMentions, ['scripts/eu_prices/build_entsoe_prices.py'], 'the ENTSO-E token is handled somewhere else than the one job');
  assert.deepEqual(exReaders, ['scripts/eu_prices/build_elexon_prices.py'], 'Elexon BMRS is read somewhere else than the one job');
  assert.deepEqual(sxReaders, ['scripts/eu_prices/build_semopx_prices.py'], 'SEMOpx is read somewhere else than the one job');
  const exj = readJob('build_elexon_prices.py'), sxj = readJob('build_semopx_prices.py');
  assert.ok(/Retry-After/.test(exj) && /B\.UA/.test(exj) && /Retry-After/.test(sxj) && /B\.UA/.test(sxj), 'the Elexon / SEMOpx job does not honour Retry-After / send the User-Agent');
  assert.ok(!/ENTSOE_TOKEN|securityToken|Authorization|api[_-]?key/i.test(exj + sxj), 'the Elexon / SEMOpx job handles a credential: both APIs are public and keyless');
  assert.ok(/Contains BMRS data/.test(exj + readJob('elexon_parse.py')) && /Market Index/.test(readJob('elexon_parse.py')) && /NOT the day-ahead/.test(readJob('elexon_parse.py')), 'the Elexon job lost its licence line or its statement of what the price is');
  const ec = readJob('build_eu_prices.py'), en = readJob('build_entsoe_prices.py');
  assert.ok(/UA = "elpriser\.org\/1\.0 \(\+https:\/\/elpriser\.org; hello@elpriser\.org\)"/.test(ec), 'the User-Agent the API owner can reach us by');
  assert.ok(/PAUSE = 35/.test(ec) && /Retry-After/.test(ec), 'the Energy-Charts job does not space its requests / honour Retry-After');
  assert.ok(/Retry-After/.test(en) && /B\.UA/.test(en), 'the ENTSO-E job does not honour Retry-After / send the User-Agent');
  assert.ok(/raise RuntimeError\(f"ENTSO-E HTTP \{e\.code\}"\)\s+# never the URL/.test(en), 'an ENTSO-E error may carry the URL, and the URL carries the token');
  assert.ok(/B\.log\([^\n]*\(token, cf_token\)\)/.test(en), 'the ENTSO-E job logs without masking the tokens');
});
