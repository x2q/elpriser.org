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

test('python unit tests for the EU price job pass', () => {
  const r = spawnSync('python3', [path.join(DIR, 'test_energy_charts_parse.py')], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'python3 is not available: ' + (r.error && r.error.message));
  assert.equal(r.status, 0, 'test_energy_charts_parse.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the Python suite ran suspiciously few tests');
});

test('the job writes exactly the keys /api/nordic reads, for exactly the zones the API serves — the four CC BY 4.0 zones', () => {
  const job = fs.readFileSync(path.join(DIR, 'build_eu_prices.py'), 'utf8');
  const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const jobZones = [...job.slice(job.indexOf('ZONES = {'), job.indexOf('\n}\n', job.indexOf('ZONES = {'))).matchAll(/^\s+"([a-z-]+)":\s+\("([A-Za-z-]+)",/gm)].map(m => [m[1], m[2]]);
  const apiZones = (api.match(/const EU_ZONES = \[([^\]]*)\]/) || [])[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(jobZones, [['de', 'DE-LU'], ['fr', 'FR'], ['pl', 'PL'], ['it-n', 'IT-North']], 'Energy-Charts licenses CC BY 4.0 for these bidding zones; the others are private/internal use only');
  assert.deepEqual(jobZones.map(z => z[0]).sort(), [...apiZones].sort(), 'the job and /api/nordic disagree about the zones');
  assert.ok(job.includes('f"eu-prices-{zone}"') && /`eu-prices-\$\{zone\}`/.test(api), 'the KV key differs between the job and the API');
  assert.ok(/CLOUDFLARE_ACCOUNT_ID/.test(job) && /CLOUDFLARE_API_TOKEN/.test(job) && /os\.environ\.get\("CLOUDFLARE_API_TOKEN"\)/.test(job), 'the job does not read Cloudflare\'s credentials from the environment');
  assert.ok(!/[0-9a-f]{32}/.test(job.replace(/KV_NAMESPACE\s*=\s*"[0-9a-f]{32}"/, '')), 'a 32-hex literal (a token?) sits in the job');
});

test('the price source is read in ONE place: Energy-Charts, from build_eu_prices.py — and ENTSO-E is not used for these zones', () => {
  const readers = [], entsoe = [];
  for (const dir of ['functions', 'scripts/eu_prices']) for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, String(f));
    if (!fs.statSync(fp).isFile() || !/\.(js|py|mjs|json)$/.test(fp) || fp.includes('/fixtures/') || fp.includes('test_energy_charts_parse')) continue;
    const t = fs.readFileSync(fp, 'utf8');
    if (t.includes('api.energy-charts.info') && /urlopen|fetch\(/.test(t)) readers.push(path.relative(ROOT, fp));
    if (/web-api\.tp\.entsoe\.eu|ENTSOE_TOKEN|securityToken|A44/.test(t)) entsoe.push(path.relative(ROOT, fp));
  }
  assert.deepEqual(readers, ['scripts/eu_prices/build_eu_prices.py'], 'the Energy-Charts API is read somewhere else than the one job');
  assert.deepEqual(entsoe, [], 'ENTSO-E code or token handling is back in the EU price job');
  const job = fs.readFileSync(path.join(DIR, 'build_eu_prices.py'), 'utf8');
  assert.ok(/UA = "elpriser\.org\/1\.0 \(\+https:\/\/elpriser\.org; hello@elpriser\.org\)"/.test(job), 'the User-Agent the API owner can reach us by');
  assert.ok(/PAUSE = 35/.test(job) && /Retry-After/.test(job), 'the job does not space its requests / honour Retry-After');
  assert.ok(fs.readdirSync(DIR).every(f => !/entsoe/i.test(f)), 'an entsoe file is back');
});
