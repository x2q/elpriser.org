#!/usr/bin/env node
/**
 * The EU forecast job (scripts/forecast_model/eu): ONE pooled model for the 25 EU zones of /api/nordic, written to
 * KV `eu-forecast-<zone>` and read by /api/nordic next to the settled prices.
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

test('the model covers exactly the 25 EU zones /api/nordic serves, with the API\'s EIC code per ENTSO-E zone', () => {
  const zones = [...read('zones.py').matchAll(/^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",/gm)].map(m => m[1]);
  const apiEu = [...apiArray('EU_ZONES_ENERGY_CHARTS'), ...apiArray('EU_ZONES_ENTSOE')];
  assert.equal(zones.length, 25);
  assert.deepEqual(zones, apiEu, 'the model\'s zone list and the API\'s EU_ZONES differ (order included)');
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
  assert.ok(/MAX_H = 8/.test(f));
});
