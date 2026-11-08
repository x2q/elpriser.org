#!/usr/bin/env node
/**
 * scripts/check-forecast-coverage.mjs: the per-zone verdicts, on synthetic API answers and on the real Worker's answers for a zone whose forecast
 * does and does not join the settled prices. Hermetic (no network). Run: npm run test:forecast-coverage   (part of test:unit)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeZone, zoneLists, kindOf } from './scripts/check-forecast-coverage.mjs';
import { createApi, makeKv } from './tests/upstream.mjs';

const ROOT = import.meta.dirname;
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const worker = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
const lists = zoneLists(worker);
const gate = readJson('scripts/forecast_model/eu/publish_gate.json');
const gbGate = readJson('scripts/forecast_model/gb/gb_gate.json');
const TODAY = '2026-11-08';
const ctx = { today: TODAY, lists, gate, gbGate };
const day = n => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hours = (band = true) => Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 80 + h, ...(band ? { min_eur_mwh: 60 + h, max_eur_mwh: 100 + h } : {}) }));
const byHorizon = hs => Object.fromEntries(hs.map(h => [h, { mae: 20, baseMae: 30, gain: 0.3 }]));
/** What /api/nordic answers for an EU zone: settled days, then forecast days with horizons. */
const body = (zone, { settled = [-1, 0, 1], fc = [2, 3, 4, 5, 6, 7], first = 2, acc, trained = day(-2), run = day(-1), band = true } = {}) => ({
  zone, generated: day(0), trainedThrough: trained, unit: 'EUR/MWh',
  days: [...settled.map(n => ({ date: day(n), type: 'actual', prices: hours(false) })),
         ...fc.map((n, i) => ({ date: day(n), type: 'forecast', horizon: first + i, prices: hours(band) }))],
  ...(fc.length ? { model: 'eu-ens-v2', forecastGenerated: run, accuracy: { version: 2, fuel: true, byHorizon: byHorizon(acc || Array.from({ length: fc.length }, (_, i) => first + i)) } } : {}),
});

test('the zone lists come from the Worker and add up to the 40 price zones', () => {
  assert.equal(lists.nordic.length, 13);
  assert.equal(lists.eu.length, 27);
  assert.equal(new Set([...lists.nordic, ...lists.eu]).size, 40);
  assert.deepEqual(['de', 'xk', 'gb', 'dk1'].map(z => kindOf(z, lists)), ['eu', 'xk', 'gb', 'nordic']);
  assert.equal(lists.eu.filter(z => kindOf(z, lists) === 'eu').length, 25, 'the 25 zones of the EU job');
});

test('an EU zone showing every horizon the gate allows, fresh, passes', () => {
  const r = analyzeZone('de', body('de'), ctx);
  assert.equal(r.status, 'PASS', r.reasons.join('; '));
  assert.deepEqual(r.horizons, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r.byDesign, []);
});

test('Albania: h7 is "not published by design" (forced off in the gate), five days pass; h7 on the API would FAIL', () => {
  const al = analyzeZone('al', body('al', { fc: [2, 3, 4, 5, 6] }), ctx);
  assert.equal(al.status, 'PASS', al.reasons.join('; '));
  assert.deepEqual(al.byDesign, [7]);
  assert.match(al.notes.join(' '), /not published by design: h7 \(forced off in the gate\)/);
  const bad = analyzeZone('al', body('al', { fc: [2, 3, 4, 5, 6, 7] }), ctx);
  assert.equal(bad.status, 'FAIL');
  assert.match(bad.reasons.join(' '), /gate does not allow/);
});

test('no forecast at all, a missing top horizon, a horizon without numbers and a stale run each FAIL with their reason', () => {
  let r = analyzeZone('de', body('de', { fc: [] }), ctx);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons[0], /no forecast shown/);
  r = analyzeZone('at', body('at', { fc: [2, 3, 4, 5, 6] }), ctx);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons.join(' '), /allows up to h7 but the API shows h2-6/, 'at lost h7 (the 5-day bug)');
  r = analyzeZone('fr', body('fr', { acc: [2, 3, 4, 5, 6] }), ctx);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons.join(' '), /without accuracy numbers/);
  r = analyzeZone('fr', body('fr', { run: day(-3) }), ctx);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons.join(' '), /3 days old/);
  assert.equal(analyzeZone('fr', null, ctx).status, 'FAIL');
});

test('a run two days old, a late start (h3) and a stale training set WARN; a frozen one FAILs', () => {
  assert.equal(analyzeZone('fr', body('fr', { run: day(-2) }), ctx).status, 'WARN');
  const late = analyzeZone('fr', body('fr', { fc: [2, 3, 4, 5, 6], first: 3 }), ctx);     // h3-7: the site already had a settled day the model had not seen
  assert.equal(late.status, 'WARN', late.reasons.join('; '));
  assert.match(late.reasons.join(' '), /starts at h3, not h2/);
  assert.equal(analyzeZone('fr', body('fr', { trained: day(-5) }), ctx).status, 'WARN');
  assert.equal(analyzeZone('fr', body('fr', { trained: day(-9) }), ctx).status, 'FAIL');
});

test('the gate decides: it-n without fuel has only h2-4, so h5-7 are by design and h2-4 pass', () => {
  const b = body('it-n', { fc: [2, 3, 4] });
  b.accuracy.fuel = false;
  const r = analyzeZone('it-n', b, ctx);
  assert.equal(r.status, 'PASS', r.reasons.join('; '));
  assert.deepEqual(r.byDesign, [5, 6, 7]);
});

test('Kosovo: NO MODEL, not a failure; a forecast there would pass', () => {
  assert.equal(analyzeZone('xk', body('xk', { fc: [] }), ctx).status, 'NO MODEL');
  assert.equal(analyzeZone('xk', body('xk'), ctx).status, 'PASS');
});

test('Great Britain: horizons 1-7 from its own gate; a Nordic zone needs a gap-free run of at least 6 days', () => {
  const gb = analyzeZone('gb', body('gb', { settled: [-1, 0], fc: [1, 2, 3, 4, 5, 6, 7], first: 1, run: day(0) }), ctx);
  assert.equal(gb.status, 'PASS', gb.reasons.join('; '));
  const nordic = z => ({ zone: z, generated: day(-1), trainedThrough: day(-2), days: [-1, 0].map(n => ({ date: day(n), type: 'actual', prices: hours(false) }))
    .concat([1, 2, 3, 4, 5, 6, 7].map(n => ({ date: day(n), type: 'forecast', prices: hours(false) }))) });
  assert.equal(analyzeZone('dk1', nordic('dk1'), ctx).status, 'PASS');
  const hole = nordic('dk1');
  hole.days.splice(4, 1);                                              // day 3 missing
  assert.equal(analyzeZone('dk1', hole, ctx).status, 'FAIL');
  const short = nordic('no1');
  short.days = short.days.slice(0, 5);
  assert.equal(analyzeZone('no1', short, ctx).status, 'WARN');
});

// ── the real Worker: the case the check was written for (DE and AT, 2026-11-07/08) ──
const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };
const feed = (zone, dates) => ({ zone, generated: dates[dates.length - 1], trainedThrough: null, unit: 'EUR/MWh', days: dates.map(d => ({ date: d, type: 'actual', prices: hours(false) })) });
const euFc = (zone, dates, first = 2) => ({ zone, generated: day(-1), generatedAt: `${day(-1)}T15:15:02+00:00`, trainedThrough: day(-2), unit: 'EUR/MWh', model: 'eu-ens-v2',
  accuracy: { version: 2, fuel: true, byHorizon: byHorizon([2, 3, 4, 5, 6, 7]) },
  days: dates.map((d, i) => ({ date: d, type: 'forecast', horizon: first + i, prices: hours() })) });
const viaWorker = async (zone, settled, fc) => {
  const api = await createApi({ kv: makeKv({ [`eu-prices-${zone}`]: feed(zone, settled), [`eu-forecast-${zone}`]: fc }), ecb: ECB });
  return (await api.get(`/api/nordic?zone=${zone}`)).body;
};

test('the real Worker + the check: a run that starts a day after the cache joins (h2-7, PASS); one that starts two days late is hidden and FAILs with the reason', async () => {
  const settled = [day(-2), day(-1), day(0)];
  // the Spark job's join point: the last known day never later than today + 1, so the first forecast day follows the site's last settled day (today)
  // ... here the site has through today, the run starts tomorrow
  const joined = await viaWorker('de', settled, euFc('de', [1, 2, 3, 4, 5, 6].map(day)));
  const ok = analyzeZone('de', joined, ctx);
  assert.equal(ok.status, 'PASS', ok.reasons.join('; '));
  assert.deepEqual(ok.horizons, [2, 3, 4, 5, 6, 7]);
  // the old behaviour on a Friday or Saturday: the cache was a day ahead, the run started a day later than the site's settled days end
  const hidden = await viaWorker('de', settled, euFc('de', [2, 3, 4, 5, 6].map(day)));
  assert.ok(!hidden.days.some(d => d.type === 'forecast'), 'the Worker shows no forecast across a hole');
  const bad = analyzeZone('de', hidden, ctx);
  assert.equal(bad.status, 'FAIL');
  assert.match(bad.reasons[0], new RegExp(`start the day after the last settled day \\(${day(1)}\\)`));
});

test('the script is wired: npm run forecast-coverage, in test:unit, and the runbook explains it', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['forecast-coverage'], 'node scripts/check-forecast-coverage.mjs');
  assert.match(pkg.scripts['test:unit'], /test-forecast-coverage\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'docs/forecast-runbook.md'), 'utf8'), /npm run forecast-coverage/);
});
