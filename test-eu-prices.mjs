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

for (const f of ['test_energy_charts_parse.py', 'test_entsoe_parse.py']) test(`python unit tests: ${f} passes`, () => {
  const r = spawnSync('python3', [path.join(DIR, f)], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'python3 is not available: ' + (r.error && r.error.message));
  assert.equal(r.status, 0, f + ' failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the Python suite ran suspiciously few tests');
});

const apiArray = (api, name) => ((api.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
const readJob = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const zoneBlock = job => job.slice(job.indexOf('ZONES = {'), job.indexOf('\n}\n', job.indexOf('ZONES = {')));

test('the two jobs write exactly the keys /api/nordic reads, for exactly the zones the API serves', () => {
  const ec = readJob('build_eu_prices.py'), en = readJob('build_entsoe_prices.py');
  const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const ecZones = [...zoneBlock(ec).matchAll(/^\s+"([a-z-]+)":\s+\("([A-Za-z-]+)",/gm)].map(m => [m[1], m[2]]);
  const enZones = [...zoneBlock(en).matchAll(/^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(ecZones, [['de', 'DE-LU'], ['fr', 'FR'], ['pl', 'PL'], ['it-n', 'IT-North'], ['at', 'AT'], ['be', 'BE'], ['ch', 'CH'], ['cz', 'CZ'], ['hu', 'HU'], ['si', 'SI']],
    'Energy-Charts licenses CC BY 4.0 for these bidding zones (checked in the API\'s own license_info); its others are private/internal use only');
  assert.deepEqual(ecZones.map(z => z[0]), apiArray(api, 'EU_ZONES_ENERGY_CHARTS'), 'the Energy-Charts job and /api/nordic disagree about the zones');
  assert.deepEqual(enZones.map(z => z[0]), apiArray(api, 'EU_ZONES_ENTSOE'), 'the ENTSO-E job and /api/nordic disagree about the zones');
  assert.equal(enZones.length, 15);
  assert.ok(!ecZones.some(z => enZones.some(e => e[0] === z[0])), 'a zone is in both jobs');
  assert.ok(/const EU_ZONES = \[\.\.\.EU_ZONES_ENERGY_CHARTS, \.\.\.EU_ZONES_ENTSOE\]/.test(api), 'EU_ZONES is the two lists');
  for (const job of [ec, en]) {
    assert.ok(job.includes('f"eu-prices-{zone}"') && /`eu-prices-\$\{zone\}`/.test(api), 'the KV key differs between a job and the API');
    assert.ok(/CLOUDFLARE_ACCOUNT_ID/.test(job) && /CLOUDFLARE_API_TOKEN/.test(job), 'a job does not read Cloudflare\'s credentials from the environment');
    assert.ok(!/[0-9a-f]{32}/.test(job.replace(/KV_NAMESPACE\s*=\s*"[0-9a-f]{32}"/, '')), 'a 32-hex literal (a token?) sits in a job');
  }
  assert.ok(/os\.environ\.get\("CLOUDFLARE_API_TOKEN"\)/.test(ec), 'the Energy-Charts job does not read Cloudflare\'s token from the environment');
  assert.ok(/os\.environ\.get\("ENTSOE_TOKEN"\)/.test(en), 'the ENTSO-E job does not read its token from the environment');
});

test('each price source is read in ONE place: Energy-Charts from build_eu_prices.py, ENTSO-E from build_entsoe_prices.py — and never from the Worker', () => {
  const ecReaders = [], enReaders = [], enMentions = [];
  for (const dir of ['functions', 'scripts/eu_prices']) for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, String(f));
    if (!fs.statSync(fp).isFile() || !/\.(js|py|mjs|json)$/.test(fp) || fp.includes('/fixtures/') || /test_[a-z_]+\.py$/.test(fp)) continue;
    const t = fs.readFileSync(fp, 'utf8');
    if (t.includes('api.energy-charts.info') && /urlopen|fetch\(/.test(t)) ecReaders.push(path.relative(ROOT, fp));
    if (t.includes('web-api.tp.entsoe.eu') && /urlopen|fetch\(/.test(t)) enReaders.push(path.relative(ROOT, fp));
    if (/ENTSOE_TOKEN|securityToken/.test(t)) enMentions.push(path.relative(ROOT, fp));
  }
  assert.deepEqual(ecReaders, ['scripts/eu_prices/build_eu_prices.py'], 'the Energy-Charts API is read somewhere else than the one job');
  assert.deepEqual(enReaders, ['scripts/eu_prices/build_entsoe_prices.py'], 'the ENTSO-E API is read somewhere else than the one job');
  assert.deepEqual(enMentions, ['scripts/eu_prices/build_entsoe_prices.py'], 'the ENTSO-E token is handled somewhere else than the one job');
  const ec = readJob('build_eu_prices.py'), en = readJob('build_entsoe_prices.py');
  assert.ok(/UA = "elpriser\.org\/1\.0 \(\+https:\/\/elpriser\.org; hello@elpriser\.org\)"/.test(ec), 'the User-Agent the API owner can reach us by');
  assert.ok(/PAUSE = 35/.test(ec) && /Retry-After/.test(ec), 'the Energy-Charts job does not space its requests / honour Retry-After');
  assert.ok(/Retry-After/.test(en) && /B\.UA/.test(en), 'the ENTSO-E job does not honour Retry-After / send the User-Agent');
  assert.ok(/raise RuntimeError\(f"ENTSO-E HTTP \{e\.code\}"\)\s+# never the URL/.test(en), 'an ENTSO-E error may carry the URL, and the URL carries the token');
  assert.ok(/B\.log\([^\n]*\(token, cf_token\)\)/.test(en), 'the ENTSO-E job logs without masking the tokens');
});
