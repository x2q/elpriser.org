#!/usr/bin/env node
/**
 * The EU forecast job (scripts/forecast_model/eu): the published recipe (mean of a 365-day ridge and LightGBM, both with gas and carbon inputs; plain
 * LightGBM for EE/LV/LT) for the 26 EU zones of /api/nordic, written to KV `eu-forecast-<zone>` and read by /api/nordic next to the settled prices.
 * Run: npm run test:eu-forecast   (hermetic; part of test:unit)
 *
 * The Python unit tests (leakage rule, training/scoring parity, metrics, payload) need pandas and numpy; where they are not
 * installed (the CI runner) that test is SKIPPED, visibly, and the invariants below - which need only node - still run.
 * They pin what must hold wherever the job runs: the model's zones are the API's EU zones, it writes only its own keys and
 * never a settled-price or Nordic key, and no credential sits in the code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = import.meta.dirname;
const DIR = path.join(ROOT, 'scripts/forecast_model/eu');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
const apiArray = name => ((api.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);

const havePandas = spawnSync('python3', ['-c', 'import pandas, numpy'], { encoding: 'utf8' }).status === 0;
test('python unit tests: test_eu_forecast.py passes', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(DIR, 'test_eu_forecast.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_eu_forecast.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the Python suite ran suspiciously few tests');
});

test('python unit tests: test_production.py passes (fuel failure policy, the ridge and its leakage rule, the ensemble, gate, accuracy block, bands, the checked-in gate files)', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(DIR, 'test_production.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_production.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the production suite ran suspiciously few tests');
});

test('python unit tests: nordic/test_nordic_recipe.py passes (the staged Nordic ensemble: leakage rule of the live rows, ridge window, leak-free reservoir, shape blend, gate publishing, the checked-in Nordic gate files obey the 5 % rule)', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(ROOT, 'scripts/forecast_model/nordic/test_nordic_recipe.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_nordic_recipe.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the Nordic suite ran suspiciously few tests');
});

test('python unit tests: test_fuel_regions.py passes (fuel parsers on saved fixtures, leak-free fuel features, per-region candidates)', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(DIR, 'test_fuel_regions.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_fuel_regions.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the fuel/region suite ran suspiciously few tests');
});

test('the fuel and per-region research code is research only: it never touches KV or the API, and its only secret is an optional env key', () => {
  for (const f of ['fetch_fuel.py', 'fuel_features.py', 'fuel_dataset.py', 'fuel_live.py', 'region_models.py', 'region_backtest.py', 'region_scores.py', 'region_report.py', 'nordic_backtest.py',
                   'recipe.py', 'gate.py', 'build_gate.py', 'calibrate_bands.py', 'family_models.py', 'quantile_backtest.py']) {
    const code = read(f).replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '');
    assert.ok(!/import kv\b|kv\.put|api\.cloudflare\.com|CLOUDFLARE_API_TOKEN|ENTSOE_TOKEN/.test(code), `${f} must not write to KV or use the price-job credentials`);
  }
  const ff = read('fetch_fuel.py');
  assert.ok(/os\.environ\.get\("GIE_API_KEY"\)/.test(ff), 'the AGSI+ key must come from the environment');
  assert.ok(!/GIE_API_KEY\s*=\s*["'][^"']+["']/.test(ff), 'no AGSI+ key literal');
});

test('the model covers the 26 EU zones /api/nordic serves a forecast for: its Energy-Charts, ENTSO-E and SEMOpx zones (Kosovo since the gate passed for it, docs/forecast-xk.md), not Great Britain', () => {
  const zones = [...read('zones.py').matchAll(/^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",/gm)].map(m => m[1]);
  const apiEu = [...apiArray('EU_ZONES_ENERGY_CHARTS'), ...apiArray('EU_ZONES_ENTSOE'), ...apiArray('EU_ZONES_SEMOPX')];
  assert.equal(zones.length, 26);
  assert.deepEqual([...zones].sort(), [...apiEu].sort(), 'the model\'s zone list and the API\'s EU zones differ');
  assert.ok(!zones.includes('gb') && zones.includes('xk'));
  const gate = JSON.parse(read('publish_gate.json'));
  assert.deepEqual(Object.keys(gate.zones), zones, 'the gate lists exactly the model\'s zones, in order');
});

test('the job writes only eu-forecast-* keys; the API reads exactly those beside eu-prices-*', () => {
  const job = read('train_daily.py');
  const puts = [...job.matchAll(/kv\.put\(f?"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(puts.sort(), ['eu-forecast-archive-{z}-{today.isoformat()}', 'eu-forecast-{z}'].sort());
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.py') && !f.startsWith('test_'))) {
    const t = read(f);
    const code = t.replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '');
    assert.ok(!/eu-prices-/.test(code), `${f} references an eu-prices key in code`);
    assert.ok(!/nordic-forecast|forecast-v3|forecast-v2|forecast-model/.test(code), `${f} references another model's KV key in code`);
  }
  assert.ok(/`eu-forecast-\$\{zone\}`/.test(api), 'the API does not read eu-forecast-<zone>');
  assert.ok(/EU_FORECAST_MAX_AGE_DAYS = 3/.test(api) && /FORECAST_TTL = 3 \* 86400/.test(read('kv.py')), 'API staleness limit and KV TTL must agree (3 days)');
});

test('no credential is a literal in the job; the tokens are read from the environment and never printed', () => {
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.py'))) {
    const t = read(f).replace(/KV_NAMESPACE\s*=\s*"[0-9a-f]{32}"/, '');
    assert.ok(!/[0-9a-f]{32}/.test(t), `a 32-hex literal sits in ${f}`);
    assert.ok(!/(print|log)\([^)]*(os\.environ|token\(\)|\bcf\b|\btoken\b)/.test(t), `${f} prints something that could be a token value`);
  }
  assert.ok(/os\.environ\.get\("ENTSOE_TOKEN"\)/.test(read('fetch_prices.py')));
  assert.ok(/os\.environ\.get\("CLOUDFLARE_API_TOKEN"\)/.test(read('train_daily.py')));
});

test('the page-facing contract: forecast days only, horizon and the Nordic band names', () => {
  const f = read('forecast.py');
  assert.ok(/"type": "forecast"/.test(f) && !/"type": "actual"/.test(f), 'the forecast key must carry forecast days only');
  assert.ok(/"min_eur_mwh"/.test(f) && /"max_eur_mwh"/.test(f) && /"horizon"/.test(f));
  assert.ok(/MAX_H = recipe\.H_MAX/.test(f) && /H_MIN, H_MAX = 2, 7/.test(read('recipe.py')), 'horizons D+2 .. D+7');
});

test('what is published is decided by checked-in files: the gate, the accuracy block and the band offsets; a missing gate means nothing is published', () => {
  const job = read('train_daily.py');
  assert.ok(/G\.load_gate\(os\.path\.join\(DIR, "publish_gate\.json"\)\)/.test(job) && /G\.load_accuracy\(/.test(job) && /G\.load_calibration\(/.test(job));
  assert.ok(/gate is None or acc is None[\s\S]{0,120}nothing is published[\s\S]{0,40}return 2/.test(job), 'no gate / accuracy file: exit 2 before anything is fetched or written');
  const gate = JSON.parse(read('publish_gate.json')), acc = JSON.parse(read('accuracy_eu.json')), cal = JSON.parse(read('calibration_eu.json'));
  assert.equal(gate.version, 2); assert.equal(acc.version, 2); assert.equal(cal.version, 2);
  // the owner's exclusion: AL D+7 (the Nordic zones named in the brief belong to the Nordic model)
  assert.ok(!gate.zones.al.fuel.includes(7) && !gate.zones.al.nofuel.includes(7));
  // Baltics: plain LightGBM, EUR instead of percent
  for (const z of ['ee', 'lv', 'lt']) { assert.equal(gate.zones[z].recipe, 'lgb'); assert.equal(acc.zones[z].showEur, true); }
  // no nominal 80 % anywhere in what is published
  assert.ok(!/80 ?%/.test(JSON.stringify(acc) + JSON.stringify(gate)));
  // every published cell carries the numbers a page prints, and passed the 5 % rule
  for (const [z, e] of Object.entries(gate.zones)) for (const h of e.fuel) {
    const c = acc.zones[z].fuel[String(h)];
    assert.ok(c && typeof c.mae === 'number' && typeof c.baseMae === 'number' && typeof c.gain === 'number' && typeof c.low === 'boolean' && typeof c.rankOk === 'boolean', `${z} D+${h}`);
    assert.ok(c.gain >= 0.05, `${z} D+${h} is published with a gain of ${c.gain}`);
  }
});

test('the fuel inputs (gas, carbon) are model inputs only: no page, no API text and no served file names or shows them', () => {
  const served = ['index.html', 'functions/[[path]].js', 'functions/api/[[catchall]].js', 'privatliv.html', 'style.css'];
  for (const f of served) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/mibgas|\beex\b|\bTTF\b|fuel_daily|ccgt|EUA price|EUR\/MWh gas/i.test(t), `${f} names a fuel source or shows a fuel price`);
  }
  // and the payload builder does not know the fuel columns
  const strip = t => t.replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '');
  assert.ok(!/gas|eua|ccgt|mibgas/i.test(strip(read('forecast.py'))), 'forecast.py (the payload builder) does not know the fuel columns');
  assert.ok(!/"gas"|"eua"|ccgt_mc/.test(strip(read('train_daily.py'))), 'the job does not write fuel columns anywhere');
});

test('the run scripts serialise runs, run at the lowest priority and need no extra key', () => {
  const sh = read('run_daily.sh');
  assert.ok(/flock -n \/tmp\/eu-forecast\.lock/.test(sh) && /nice -n 10/.test(sh) && /timeout 2h/.test(sh) && /train_daily\.py/.test(sh));
  assert.ok(!/GIE_API_KEY/.test(sh), 'no AGSI+ key needed');
  const rf = read('refresh_calibration.sh');
  assert.ok(/flock -n \/tmp\/eu-forecast-refresh\.lock/.test(rf) && /quantile_backtest\.py/.test(rf) && /calibrate_bands\.py/.test(rf) && /nice -n 10/.test(rf));
  assert.ok(!/kv\.put|api\.cloudflare/.test(rf), 'the refresh writes nothing to KV');
});

// ── The ESTIMATE of hours that have no price yet: Great Britain (rest of today, D+1..D+7), Portugal and Ireland (the missing last hour) — scripts/forecast_model/gb ──
const GB = path.join(ROOT, 'scripts/forecast_model/gb');
const readGb = f => fs.readFileSync(path.join(GB, f), 'utf8');
const stripPy = t => t.replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '');

test('python unit tests: scripts/forecast_model/gb/test_gb.py passes (leakage rule of the rows, baselines, models, hour 23, payloads, the checked-in gate files)', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(GB, 'test_gb.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_gb.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d{2,} tests/, 'the estimate suite ran suspiciously few tests');
});

// ── Open weights on Hugging Face — scripts/forecast_model/hf: the guard that keeps fuel-trained weights, data and credentials off the Hub, the stripped gate files, the cards' tables ──
test('python unit tests: scripts/forecast_model/hf/test_hf.py passes (the Hub guard refuses fuel weights, pickles, tables and credentials; fuel entries stripped; cards and tables)', { skip: havePandas ? false : 'pandas/numpy not installed here' }, () => {
  const r = spawnSync('python3', [path.join(ROOT, 'scripts/forecast_model/hf/test_hf.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'test_hf.py failed:\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /Ran \d+ tests/, 'the Hub suite did not run');
});

test('estimate: ONE list of zones — the API\'s ESTIMATE_ZONES, the job\'s ZONES and the zones of the hour-23 gate (plus gb) are the same three', () => {
  const js = fs.readFileSync(path.join(ROOT, 'functions/_estimate.js'), 'utf8');
  const jsZones = ((js.match(/export const ESTIMATE_ZONES = \[([^\]]*)\]/) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
  const pyZones = ((readGb('run_estimate.py').match(/^ZONES = \(([^)]*)\)/m) || [])[1] || '').split(',').map(x => x.trim().replace(/"/g, '')).filter(Boolean);
  assert.deepEqual(jsZones, ['gb', 'pt', 'ie']);
  assert.deepEqual(pyZones, jsZones);
  const h23 = JSON.parse(readGb('hour23_gate.json'));
  assert.deepEqual(Object.keys(h23.zones).sort(), jsZones.filter(z => z !== 'gb').sort());
  const euAll = [...apiArray('EU_ZONES_ELEXON'), ...apiArray('EU_ZONES_ENTSOE'), ...apiArray('EU_ZONES_SEMOPX')];
  for (const z of jsZones) assert.ok(euAll.includes(z), `${z} is an EU zone of the API`);
  assert.ok(/ESTIMATE_ZONES\.includes\(zone\)/.test(api) && /eu-estimate-\$\{zone\}/.test(api), 'the API reads eu-estimate-<zone> for those zones only');
});

test('estimate: the job writes only its own keys, serves each for no longer than the API accepts, and holds no credential', () => {
  const code = stripPy(readGb('run_estimate.py'));
  const keys = [...code.matchAll(/sink\.put\(\s*f?"([^"]+)"/g)].map(m => m[1].replace(/\{[^}]*\}/g, '<x>'));
  assert.deepEqual([...new Set(keys)].sort(), ['eu-estimate-<x>', 'eu-estimate-archive-gb-<x>', 'eu-estimate-gb', 'eu-forecast-gb']);
  assert.ok(!/eu-prices|nordic-forecast|forecast-v3|eu-forecast-(?!gb)/.test(code), 'it never writes a settled-price, Nordic or another zone\'s forecast key');
  assert.ok(!/ENTSOE_TOKEN|GIE_API_KEY/.test(code) && !/Bearer|api\.cloudflare\.com/.test(code), 'no credential in the code; kv.py carries the (env-supplied) write');
  assert.ok(/if self\.dry:\n\s+return "would write"/.test(code), 'a dry run returns before the KV write');
  const ttl = n => +(readGb('run_estimate.py').match(new RegExp(`${n} = (\\d+) \\* 3600`)) || [])[1];
  const js = fs.readFileSync(path.join(ROOT, 'functions/_estimate.js'), 'utf8');
  const maxAgeH = +(js.match(/ESTIMATE_MAX_AGE_MS = (\d+) \* 3600/) || [])[1];
  assert.ok(ttl('ESTIMATE_TTL') > 0 && ttl('ESTIMATE_TTL') <= maxAgeH, 'the estimate key never outlives what the API accepts');
  assert.ok(ttl('FORECAST_TTL') <= 12, 'the forecast days of gb are hours old at most, not days');
});

test('estimate: the run scripts serialise runs, run at the lowest priority, share the lock with the training, and write nothing to KV from the refresh', () => {
  const run = readGb('run_hourly.sh'), tr = readGb('train_daily.sh'), rf = readGb('refresh_gate.sh');
  assert.ok(/flock -n \/tmp\/gb-estimate\.lock/.test(run) && /nice -n 10/.test(run) && /timeout 20m/.test(run) && /run_estimate\.py/.test(run) && /12 \* \* \* \*/.test(run), 'hourly at :12, five minutes after the Elexon job');
  assert.ok(/flock -w \d+ \/tmp\/gb-estimate\.lock/.test(tr) && /nice -n 10/.test(tr) && /train_gb\.py/.test(tr));
  assert.ok(/backtest_gb\.py/.test(rf) && /build_gate_gb\.py/.test(rf) && /backtest_hour23\.py/.test(rf) && !/kv\.put|api\.cloudflare|run_estimate/.test(rf));
  for (const f of ['run_hourly.sh', 'train_daily.sh', 'refresh_gate.sh']) assert.ok(fs.statSync(path.join(GB, f)).mode & 0o111, `${f} is executable`);
});

test('estimate: no fuel input anywhere in the estimate code, and what is published passed the 5 % rule', () => {
  for (const f of fs.readdirSync(GB).filter(f => f.endsWith('.py') && !f.startsWith('test_'))) {
    assert.ok(!/mibgas|\beex\b|\bTTF\b|fuel_daily|ccgt|\bNBP\b|\bgas\b/i.test(stripPy(readGb(f))), `${f} uses no fuel input (GB gas is NBP: no licence, no input)`);
  }
  const gate = JSON.parse(readGb('gb_gate.json'));
  assert.ok(!/80 ?%/.test(JSON.stringify(gate)) && gate.unit === 'GBP/MWh' && gate.baseline === 'level+shape');
  for (const k of ['rest', 'days']) for (const [h, c] of Object.entries(gate[k])) if (c.publish) assert.ok(c.gain >= 0.05 && c.gainHold >= 0.05 && c.mae <= c.persistMae, `${k} ${h} is published with gain ${c.gain} / hold-out ${c.gainHold}`);
});
