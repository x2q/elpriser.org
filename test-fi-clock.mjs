#!/usr/bin/env node
/**
 * Finland on its OWN clock: /api/nordic?zone=fi serves Helsinki days (functions/_localdays.js), not the Copenhagen-hour days of the Nordic feed.
 * Run: node test-fi-clock.mjs   (hermetic: the real API handler and the real Pages Function, a fake KV and Cache API; no network)
 *
 * The ground truth is ENTSO-E (A44, EIC 10YFI-1--------U), cross-checked with Energy-Charts (bzn=FI): tests/fixtures/fi-entsoe-2026-11-03.json, hourly means
 * keyed by the UTC instant at which the hour starts. The market day 2026-11-03 starts at 2026-11-02T23:00Z (00:00 CET = 01:00 Helsinki), so
 *   - the Nordic job's feed (hour 0 = Copenhagen 00:00) has index 0 = 23:00Z for every zone, and
 *   - a Helsinki day 2026-11-03 begins at 2026-11-02T22:00Z (EET, UTC+2): hour h = 22:00Z + h hours.
 * Before the change /api/nordic?zone=fi gave the first for `fi` while the contract, the OpenAPI text, both apps and the web's ZONES said the second
 * (an app at 14:30 Helsinki read index 14, the price of 15:00-16:00). What is pinned here:
 *   1. the API: every hour of the Finnish days 2026-11-03 and 04 is the ENTSO-E price of the UTC instant it names; dk1 (Copenhagen's clock) is untouched;
 *   2. DST (2026-03-29: 23 hours, 2026-10-25: 25 hours) against an oracle built from Intl's Europe/Helsinki, hour by hour;
 *   3. the days of the window: type (a day with a model hour is a forecast day), the band, the first day, the tail, junk in, the input never changed;
 *   4. the Finnish page: 'klo 20' at 20:05 Helsinki, not 'klo 19';
 *   5. the NL overlay and every other zone: the same answer as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi, makeKv } from './tests/upstream.mjs';

const ROOT = import.meta.dirname;
const load = f => import(pathToFileURL(path.join(ROOT, f)).href);
const { rebucketToLocalDays, NORDIC_LOCAL_SHIFT, LOCAL_DAY_MIN_HOURS } = await load('functions/_localdays.js');

const HOUR = 3_600_000;
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fi-entsoe-2026-11-03.json'), 'utf8'));
const entsoe = new Map(FIX.hours.map(([t, v]) => [Date.parse(t), v]));      // UTC hour start (ms) -> EUR/MWh
const at = iso => entsoe.get(Date.parse(iso));

/** (date, hour) of an instant on a zone's wall clock. */
const labelOf = (ms, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
};
/** The 24 rows of every local date a UTC-hour series touches, on `tz`'s clock: the mean of the hours that carry the label (the repeated hour of a clock-back day),
 *  null for a label nothing carries (the hour the clocks skip). This IS the Nordic job's rule (fetch_prices.py: floor to the hour in local time, then average). */
function localDays(series, tz, type = 'actual') {
  const by = new Map();
  for (const [ms, v] of series) {
    const { date, hour } = labelOf(ms, tz);
    if (!by.has(date)) by.set(date, Array.from({ length: 24 }, () => []));
    by.get(date)[hour].push(v);
  }
  return [...by.keys()].sort().map(date => ({ date, type, prices: by.get(date).map((vs, hour) => ({ hour, eur_mwh: vs.length ? +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(4) : null })) }));
}
const feedOf = days => ({ zone: 'fi', generated: '2026-11-03', trainedThrough: '2026-11-01', unit: 'EUR/MWh', days });
const priced = d => d.prices.filter(p => p.eur_mwh !== null).length;
const complete = days => days.filter(d => priced(d) >= LOCAL_DAY_MIN_HOURS);

/** The Nordic job's value for fi on 2026-11-03: the market days 2026-11-02, 03 and 04 from ENTSO-E, indexed by the Copenhagen hour, then model days 05..11 with a band. */
function nordicFi() {
  const days = localDays(entsoe, 'Europe/Copenhagen');
  assert.deepEqual(days.map(d => d.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.ok(days.every(d => d.prices.every(p => p.eur_mwh !== null)), 'the fixture covers three whole market days');
  for (let i = 5; i <= 11; i++) {
    days.push({ date: `2026-11-${String(i).padStart(2, '0')}`, type: 'forecast',
      prices: Array.from({ length: 24 }, (_, h) => { const p = 20 + i + h; return { hour: h, eur_mwh: p, min_eur_mwh: p - 10, max_eur_mwh: p + 30 }; }) });
  }
  return feedOf(days);
}
const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };

// ── 1. the API against ENTSO-E ───────────────────────────────────────────────────────────────────────

test('the fixture is what it says: the Copenhagen-hour feed of 2026-11-03 starts at 23:00Z, and equals what the API served before (5.77 at index 0)', () => {
  const feed = nordicFi();
  assert.equal(feed.days[1].prices[0].eur_mwh, at('2026-11-02T23:00:00Z'));
  assert.equal(feed.days[1].prices[0].eur_mwh, 5.77);
  assert.equal(feed.days[1].prices[19].eur_mwh, 265.25);
});

test('/api/nordic?zone=fi: hour h of a day is the ENTSO-E price of the UTC instant on the Finnish wall clock — 2026-11-03 hour 0 is 2026-11-02T22:00Z', async () => {
  const api = await createApi({ kv: makeKv({ 'nordic-forecast-fi': nordicFi() }), ecb: ECB });
  const r = await api.get('/api/nordic?zone=fi');
  assert.equal(r.status, 200);
  assert.equal(r.body.zone, 'fi');
  const helsinki = r.body.days.filter(d => d.type === 'actual');
  // the Helsinki days of the three market days: 2026-11-02 (its hour 0 has no source: the feed starts on the 2nd), 03 and 04 complete, 05 is mixed (a model day)
  assert.deepEqual(r.body.days.map(d => d.date).slice(0, 4), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  for (const date of ['2026-11-03', '2026-11-04']) {
    const day = r.body.days.find(d => d.date === date);
    assert.equal(day.type, 'actual', `${date} is all settled`);
    assert.equal(day.prices.length, 24);
    const start = Date.parse(date + 'T00:00:00Z') - 2 * HOUR;               // Helsinki midnight in EET (UTC+2): 22:00Z the evening before
    day.prices.forEach((p, h) => {
      assert.equal(p.hour, h);
      assert.equal(p.eur_mwh, entsoe.get(start + h * HOUR), `${date} hour ${h} must be the price of ${new Date(start + h * HOUR).toISOString()}`);
    });
  }
  assert.ok(helsinki.length >= 3);
  const d3 = r.body.days.find(d => d.date === '2026-11-03').prices;
  assert.equal(d3[0].eur_mwh, at('2026-11-02T22:00:00Z'), 'hour 0 = 2026-11-02T22:00Z, the hour BEFORE the market day: Copenhagen 23:00 of the previous day');
  assert.equal(d3[1].eur_mwh, 5.77, 'hour 1 (01:00 Helsinki) = 23:00Z = the first hour of the market day');
  assert.equal(d3[2].eur_mwh, 5.11, 'Energy-Charts (bzn=FI) 2026-11-03T00:00Z: 5.52 5.17 4.95 4.8 -> mean 5.11 = Helsinki 02:00');
  assert.equal(d3[20].eur_mwh, 265.25, '20:00 Helsinki = 18:00Z = 19:00 CET, the evening peak');
  assert.equal(r.body.zoneInfo.currency, 'EUR');
  assert.equal(r.body.trainedThrough, '2026-11-01', 'the model\'s own fields are untouched');
});

test('/api/nordic: the Copenhagen-clock zones are served exactly as before (dk1, no3, se4, nl), only fi is cut into Helsinki days', async () => {
  const f = nordicFi();
  const kv = makeKv({ ...Object.fromEntries(['dk1', 'dk2', 'no1', 'no3', 'se4', 'nl'].map(z => [`nordic-forecast-${z}`, { ...f, zone: z }])), 'nordic-forecast-fi': f });
  const api = await createApi({ kv, ecb: ECB });
  for (const z of ['dk1', 'dk2', 'no1', 'no3', 'se4', 'nl']) {
    const r = await api.get(`/api/nordic?zone=${z}`);
    assert.deepEqual(r.body.days, f.days, `${z}: days are the KV value, byte for byte`);
    assert.equal(r.body.days[1].prices[0].eur_mwh, at('2026-11-02T23:00:00Z'), `${z}: index 0 of 2026-11-03 is 23:00Z (00:00 CET)`);
  }
  assert.notDeepEqual((await api.get('/api/nordic?zone=fi')).body.days, f.days);
  assert.deepEqual(NORDIC_LOCAL_SHIFT, { fi: 1 }, 'only Finland is on another clock than Copenhagen among the Nordic-feed zones');
});

test('/api/nordic?zone=fi: Helsinki days 02..11 from the source days 02..11 — the first has a null hour 0, a day with a model hour is a forecast day, the one-hour tail is not served', async () => {
  const api = await createApi({ kv: makeKv({ 'nordic-forecast-fi': nordicFi() }), ecb: ECB });
  const { days } = (await api.get('/api/nordic?zone=fi')).body;
  assert.deepEqual(days.map(d => [d.date, d.type]), [
    ['2026-11-02', 'actual'], ['2026-11-03', 'actual'], ['2026-11-04', 'actual'],
    ['2026-11-05', 'forecast'], ['2026-11-06', 'forecast'], ['2026-11-07', 'forecast'], ['2026-11-08', 'forecast'], ['2026-11-09', 'forecast'], ['2026-11-10', 'forecast'], ['2026-11-11', 'forecast'],
  ], 'Helsinki 12th would hold one hour (the 11th at 23:00 CET): not a day');
  assert.equal(days[0].prices[0].eur_mwh, null, 'no source for Helsinki 00:00 on the first date of the feed');
  assert.equal(priced(days[0]), 23);
  const d5 = days[3].prices;      // Helsinki 5th: hour 0 = the SETTLED 4th-23:00 CET (2.16), hours 1-23 the model's
  assert.equal(d5[0].eur_mwh, 2.16);
  assert.equal(d5[0].min_eur_mwh, 2.16); assert.equal(d5[0].max_eur_mwh, 2.16);
  assert.equal(d5[1].eur_mwh, 25, 'source 5th hour 0 = 20 + 5 + 0');
  assert.equal(d5[1].min_eur_mwh, 15); assert.equal(d5[1].max_eur_mwh, 55);
  assert.ok(d5.every(p => 'min_eur_mwh' in p && 'max_eur_mwh' in p), 'a band on every hour of a forecast day');
  assert.ok(!days[2].prices.some(p => 'min_eur_mwh' in p), 'a settled day carries no band');
});

// ── 2. DST against Intl ────────────────────────────────────────────────────────────────────────────

/** The oracle: the same UTC-hour series cut into days by Intl's Europe/Helsinki instead of by shifting Copenhagen's. A value is unique per instant, so a mean of the
 *  repeated hour is told from either of its halves. */
function dstCheck(fromUtc, toUtc) {
  const series = [];
  for (let t = fromUtc, i = 0; t < toUtc; t += HOUR, i++) series.push([t, 100 + i]);
  const cph = localDays(series, 'Europe/Copenhagen');
  const expected = complete(localDays(series, 'Europe/Helsinki'));
  const got = rebucketToLocalDays(feedOf(cph), 1).days;
  assert.deepEqual(got, expected, 'every Helsinki day, hour for hour, equals the one Intl\'s Europe/Helsinki cuts out of the same instants');
  return { got, series };
}

test('DST spring forward 2026-03-29: the Finnish day has 23 hours — hour 3 does not exist (Copenhagen 02) and hour 4 is the price of 01:00Z', () => {
  const t0 = Date.parse('2026-03-26T23:00:00Z'), t1 = Date.parse('2026-03-30T22:00:00Z');        // Copenhagen midnight (CET) of the 27th .. Copenhagen midnight (CEST) of the 31st
  const { got } = dstCheck(t0, t1);
  const d = got.find(x => x.date === '2026-03-29');
  assert.equal(priced(d), 23);
  assert.equal(d.prices[3].eur_mwh, null, 'Helsinki 03:00 does not exist on 2026-03-29');
  const inst = ms => 100 + (ms - t0) / HOUR;
  assert.equal(d.prices[2].eur_mwh, inst(Date.parse('2026-03-29T00:00:00Z')), 'Helsinki 02:00 EET = 00:00Z');
  assert.equal(d.prices[4].eur_mwh, inst(Date.parse('2026-03-29T01:00:00Z')), 'Helsinki 04:00 EEST = 01:00Z');
  assert.equal(d.prices[0].eur_mwh, inst(Date.parse('2026-03-28T22:00:00Z')), 'Helsinki midnight = 22:00Z (EET)');
  assert.equal(d.prices[23].eur_mwh, inst(Date.parse('2026-03-29T20:00:00Z')), 'Helsinki 23:00 EEST = 20:00Z');
});

test('DST fall back 2026-10-25: the Finnish day has 25 hours in 24 rows — hour 3 is the mean of its two occurrences (00:00Z and 01:00Z)', () => {
  const t0 = Date.parse('2026-10-23T22:00:00Z'), t1 = Date.parse('2026-10-27T23:00:00Z');        // Copenhagen midnight (CEST) of the 24th .. Copenhagen midnight (CET) of the 28th
  const { got } = dstCheck(t0, t1);
  const d = got.find(x => x.date === '2026-10-25');
  assert.equal(priced(d), 24);
  const inst = ms => 100 + (ms - t0) / HOUR;
  assert.equal(d.prices[3].eur_mwh, +((inst(Date.parse('2026-10-25T00:00:00Z')) + inst(Date.parse('2026-10-25T01:00:00Z'))) / 2).toFixed(4), 'Helsinki 03:00 EEST and 03:00 EET');
  assert.equal(d.prices[0].eur_mwh, inst(Date.parse('2026-10-24T21:00:00Z')), 'Helsinki midnight = 21:00Z (EEST)');
  assert.equal(d.prices[4].eur_mwh, inst(Date.parse('2026-10-25T02:00:00Z')), 'Helsinki 04:00 EET = 02:00Z');
  assert.equal(d.prices[23].eur_mwh, inst(Date.parse('2026-10-25T21:00:00Z')), 'Helsinki 23:00 EET = 21:00Z');
});

test('every day of a year, hour for hour: the shifted feed equals Intl\'s Helsinki days (summer, winter and both clock changes)', () => {
  const t0 = Date.parse('2026-01-01T23:00:00Z'), t1 = Date.parse('2027-01-01T23:00:00Z');       // CET midnight of 2 Jan 2026 .. CET midnight of 2 Jan 2027
  const { got } = dstCheck(t0, t1);
  assert.ok(got.length >= 360);
});

// ── 3. the window ───────────────────────────────────────────────────────────────────────────────────

const flat = (date, type, base, band = false) => ({ date, type, prices: Array.from({ length: 24 }, (_, h) => (band
  ? { hour: h, eur_mwh: base + h, min_eur_mwh: base + h - 5, max_eur_mwh: base + h + 5 } : { hour: h, eur_mwh: base + h })) });

test('rebucketToLocalDays: hour h is source hour h-1, hour 0 the source hour 23 of the day before; the type follows the HOURS: one model hour makes a forecast day', () => {
  const feed = feedOf([flat('2026-11-03', 'actual', 100), flat('2026-11-04', 'actual', 200), flat('2026-11-05', 'forecast', 300, true), flat('2026-11-06', 'forecast', 400, true)]);
  const out = rebucketToLocalDays(feed, 1);
  assert.deepEqual(out.days.map(d => [d.date, d.type, priced(d)]), [
    ['2026-11-03', 'actual', 23],       // the feed starts on the 3rd: Helsinki 00:00 would be the 2nd at 23:00, which is not in it
    ['2026-11-04', 'actual', 24],       // 3rd 23:00 + 4th 00-22, all settled
    ['2026-11-05', 'forecast', 24],     // 4th 23:00 settled, 5th 00-22 the model's: not a settled day
    ['2026-11-06', 'forecast', 24],
  ], 'the 7th would have one hour (6th 23:00): dropped');
  assert.deepEqual(out.days[1].prices[0], { hour: 0, eur_mwh: 123 }, 'Helsinki 4th 00:00 = source 3rd 23:00');
  assert.deepEqual(out.days[1].prices[1], { hour: 1, eur_mwh: 200 });
  assert.deepEqual(out.days[2].prices[0], { hour: 0, eur_mwh: 223, min_eur_mwh: 223, max_eur_mwh: 223 }, 'a settled hour in a forecast day: min = max = the price');
  assert.deepEqual(out.days[2].prices[1], { hour: 1, eur_mwh: 300, min_eur_mwh: 295, max_eur_mwh: 305 });
  assert.equal(out.zone, 'fi'); assert.equal(out.trainedThrough, '2026-11-01'); assert.equal(out.generated, '2026-11-03');
});

test('rebucketToLocalDays: tomorrow is not published yet (the feed is settled up to today, the model after) — tomorrow is a forecast day, today and yesterday stay settled', () => {
  const feed = feedOf([flat('2026-11-02', 'actual', 100), flat('2026-11-03', 'actual', 200), flat('2026-11-04', 'forecast', 300, true), flat('2026-11-05', 'forecast', 400, true)]);
  const out = rebucketToLocalDays(feed, 1);
  assert.deepEqual(out.days.map(d => [d.date, d.type]), [['2026-11-02', 'actual'], ['2026-11-03', 'actual'], ['2026-11-04', 'forecast'], ['2026-11-05', 'forecast']]);
  assert.equal(out.days[2].prices[0].eur_mwh, 223, 'Finnish 4th 00:00 is the settled 3rd 23:00 CET, shown as such inside a forecast day');
});

test('rebucketToLocalDays: a feed that starts the day before (the Nordic job with yesterday) has a complete first day; horizon is carried, nothing else of a day is', () => {
  const y = flat('2026-11-02', 'actual', 100); y.note = 'x';
  const f = flat('2026-11-04', 'forecast', 300, true); f.horizon = 2;
  const out = rebucketToLocalDays(feedOf([y, flat('2026-11-03', 'actual', 200), f]), 1);
  assert.deepEqual(out.days.map(d => [d.date, d.type, priced(d)]), [['2026-11-02', 'actual', 23], ['2026-11-03', 'actual', 24], ['2026-11-04', 'forecast', 24]]);
  assert.equal(out.days[2].horizon, 2);
  assert.ok(!('horizon' in out.days[1]) && !('note' in out.days[0]));
});

test('rebucketToLocalDays: a hole in the dates stays a hole, a null hour stays null, junk is skipped, and the input is never changed', () => {
  const a = flat('2026-11-03', 'actual', 100), b = flat('2026-11-06', 'actual', 200);
  b.prices[5] = { hour: 5, eur_mwh: null };
  const junk = [null, 5, { date: 'x', type: 'actual', prices: [] }, { date: '2026-11-04', type: 'weird', prices: [] }, { date: '2026-11-04', type: 'actual', prices: 'no' }, { date: '2026-11-04', type: 'actual', prices: [null, { hour: 99, eur_mwh: 1 }, { hour: 1, eur_mwh: 'x' }] }];
  const feed = feedOf([a, ...junk, b]);
  const before = JSON.stringify(feed);
  const out = rebucketToLocalDays(feed, 1);
  assert.equal(JSON.stringify(feed), before, 'the KV value is not mutated');
  assert.deepEqual(out.days.map(d => d.date), ['2026-11-03', '2026-11-06'], 'the 4th and 5th have at most one hour (the 3rd 23:00 on the 4th): not days; the 7th likewise');
  assert.equal(out.days[1].prices[6].eur_mwh, null, 'Helsinki 06:00 is source 05:00, which has no price');
  assert.equal(priced(out.days[1]), 22, 'the hole costs the hour 6, and hour 0 (the 5th has no 23:00)');
  assert.equal(rebucketToLocalDays(feed, 0), feed, 'offset 0: the very same object');
  assert.equal(rebucketToLocalDays(feed, 24), feed);
  assert.equal(rebucketToLocalDays(feed, 1.5), feed);
  for (const bad of [null, undefined, {}, { days: 'x' }, { days: [] }, { days: [null] }]) assert.equal(rebucketToLocalDays(bad, 1), bad);
});

test('rebucketToLocalDays: a general offset is a plain slot shift (+2 here), nothing is special about +1', () => {
  const out = rebucketToLocalDays(feedOf([flat('2026-11-03', 'actual', 100), flat('2026-11-04', 'actual', 200)]), 2);
  assert.deepEqual(out.days.map(d => [d.date, priced(d)]), [['2026-11-03', 22], ['2026-11-04', 24]]);
  assert.equal(out.days[1].prices[0].eur_mwh, 122); assert.equal(out.days[1].prices[1].eur_mwh, 123); assert.equal(out.days[1].prices[2].eur_mwh, 200);
});

// ── 4. the Finnish page, end to end: the real handler behind the real page ──────────────────────────────────

test('/fi/sahkon-hinta at 20:05 Helsinki (18:05Z) says "klo 20" and the price of 20:00-21:00 Helsinki, 26,5 snt — not "klo 19"; cheapest tomorrow is Helsinki 23:00', async () => {
  const api = await createApi({ kv: makeKv({ 'nordic-forecast-fi': nordicFi() }), ecb: ECB });
  const apiFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'elpriser.org' && url.pathname === '/api/nordic') {
      const r = await api.get(url.pathname + url.search);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }
    return apiFetch(input, init);
  };
  const RealDate = Date, FIXED = RealDate.parse('2026-11-03T18:05:00Z');
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
  try {
    const { onRequest } = await load('functions/[[path]].js');
    const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const res = await onRequest({ request: new Request('https://elpriser.org/fi/sahkon-hinta'), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
    assert.equal(res.status, 200);
    const page = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    const text = page.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /Sähkön hinta juuri nyt · tiistai klo 20 26,5 snt\/kWh/, 'the clock on the page is Helsinki\'s');
    assert.doesNotMatch(text, /juuri nyt · tiistai klo 19/);
    assert.match(page, /data-hour="20"/, 'the current bar is hour 20');
    assert.match(text, /Halvin huomenna 0,3 snt · klo 23/, 'tomorrow (Helsinki 4 Nov) is cheapest at 23:00 Helsinki = 21:00Z = 22:00 CET (2.84 EUR/MWh)');
  } finally { globalThis.Date = RealDate; globalThis.fetch = apiFetch; }
});
