#!/usr/bin/env node
// /api/slots — prices as absolute UTC slots, 15 minutes where the market has them.
// Run: npm run test:slots   (hermetic: the real handler with faked upstreams; part of test:unit)
//
// What is pinned:
//  - the daylight-saving arithmetic of functions/_slots.js against the platform's own time zone data, for every zone the API serves: a local day is
//    23, 24 or 25 hours long, its slots are contiguous and start at local midnight, and the local clock of every slot is the hour it was priced for;
//  - the endpoint: 15-minute slots from KV `eu-slots-<zone>` where they exist, hourly slots (with the type and the model's band) where they do not,
//    no overlap between the two, the currency conversion, the 400s and the 404;
//  - Denmark: a settled day in 15-minute slots whose mean is the hour's /api/forecast price, forecast days hourly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, makeKv } from './tests/upstream.mjs';
import { ZONE_TZ, tzOffsetMin, localMidnight, hourlySlots, storedSlots, mergeSlots } from './functions/_slots.js';

const DAY = 86_400_000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const day = n => iso(Date.now() + n * DAY);
const localHour = (tz, ms) => new Date(ms + tzOffsetMin(tz, ms) * 60000).getUTCHours();
const flatDay = (date, base = 100) => ({ date, type: 'actual', prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: base + h })) });

// ── the arithmetic ────────────────────────────────────────────────────────────

test('every zone: a local day is 23, 24 or 25 hours, contiguous from local midnight, and each slot is priced for its own wall-clock hour', () => {
  const dates = [];
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) for (const m of ['03', '10']) {
    const last = new Date(Date.UTC(y, +m, 0)).getUTCDate();
    const sun = last - new Date(Date.UTC(y, +m - 1, last)).getUTCDay();
    for (let d = -2; d <= 2; d++) dates.push(iso(Date.UTC(y, +m - 1, sun) + d * DAY));
  }
  dates.push('2026-01-15', '2026-07-15');
  for (const [zone, tz] of Object.entries(ZONE_TZ)) {
    let prevEnd = null;
    for (const date of dates.sort()) {
      const slots = hourlySlots(flatDay(date), tz);
      const mid = localMidnight(date, tz);
      assert.equal(new Date(mid + tzOffsetMin(tz, mid) * 60000).toISOString().slice(11, 19), '00:00:00', `${zone} ${date}: local midnight`);
      assert.ok([23, 24, 25].includes(slots.length), `${zone} ${date}: ${slots.length} slots`);
      assert.equal(slots[0].start, mid, `${zone} ${date}: starts at local midnight`);
      for (let i = 1; i < slots.length; i++) assert.equal(slots[i].start, slots[i - 1].end, `${zone} ${date}: contiguous`);
      assert.equal(slots.at(-1).end, localMidnight(iso(Date.parse(date + 'T00:00:00Z') + DAY), tz), `${zone} ${date}: ends at the next local midnight`);
      for (const s of slots) assert.equal(s.value, 100 + localHour(tz, s.start), `${zone} ${date}: the slot at ${new Date(s.start).toISOString()} carries its local hour's price`);
      prevEnd = slots.at(-1).end;
    }
    assert.ok(prevEnd);
  }
});

test('the day the clocks go back has 25 slots and the repeated hour 2 is priced the same twice; the day they go forward has 23 and no hour 2', () => {
  const back = hourlySlots(flatDay('2026-10-25'), 'Europe/Copenhagen');
  assert.equal(back.length, 25);
  assert.deepEqual(back.filter(s => s.value === 102).map(s => new Date(s.start).toISOString()), ['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z']);
  const fwd = hourlySlots(flatDay('2026-03-29'), 'Europe/Copenhagen');
  assert.equal(fwd.length, 23);
  assert.ok(!fwd.some(s => s.value === 102), 'hour 2 does not exist on the spring-forward day');
  assert.equal(new Date(fwd[0].start).toISOString(), '2026-03-28T23:00:00.000Z');
  // Helsinki is one hour ahead; Lisbon and London are on UTC in winter
  assert.equal(new Date(hourlySlots(flatDay('2026-11-05'), 'Europe/Helsinki')[0].start).toISOString(), '2026-11-04T22:00:00.000Z');
  assert.equal(new Date(hourlySlots(flatDay('2026-11-05'), 'Europe/Lisbon')[0].start).toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(new Date(hourlySlots(flatDay('2026-07-05'), 'Europe/London')[0].start).toISOString(), '2026-07-04T23:00:00.000Z');
});

test('an hour without a price has no slot, and bad days are not slots', () => {
  const d = flatDay('2026-11-05');
  d.prices[5].eur_mwh = null;
  assert.equal(hourlySlots(d, 'Europe/Berlin').length, 23);
  assert.deepEqual(hourlySlots({ date: 'x', prices: [] }, 'Europe/Berlin'), []);
  assert.deepEqual(hourlySlots(null, 'Europe/Berlin'), []);
});

test('stored 15-minute slots: validated, sorted, overlap dropped, and ignored when the record is old', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const rec = { generated: '2026-11-05', slots: [[1000, 15, 5], [100, 15, 4], [1000, 15, 99], ['x', 15, 1], [2000, 7, 1], [2000, 15, null], [1900, 15, 6], [3000, 15, 7]] };
  assert.deepEqual(storedSlots(rec, now).map(s => [s.start / 1000, (s.end - s.start) / 60000, s.value]), [[100, 15, 4], [1000, 15, 5], [1900, 15, 6], [3000, 15, 7]]);
  assert.deepEqual(storedSlots({ ...rec, generated: '2026-10-20' }, now), [], 'a record two weeks old is not used');
  assert.deepEqual(storedSlots({ slots: rec.slots }, now), [], 'no generated date, no slots');
  assert.deepEqual(storedSlots(null, now), []);
});

test('merging: an hourly slot is kept only where no 15-minute slot covers any part of it', () => {
  const h = (a, t) => ({ start: a * 3600000, end: (a + 1) * 3600000, value: 1, type: t });
  const q = (a, m) => ({ start: a * 3600000 + m * 60000, end: a * 3600000 + (m + 15) * 60000, value: 2 });
  const out = mergeSlots([q(1, 0), q(1, 15), q(1, 30), q(1, 45), q(2, 30)], [h(0, 'actual'), h(1, 'actual'), h(2, 'actual'), h(3, 'forecast')]);
  assert.deepEqual(out.map(s => [s.start / 60000, s.end / 60000, s.type]), [[0, 60, 'actual'], [60, 75, 'actual'], [75, 90, 'actual'], [90, 105, 'actual'], [105, 120, 'actual'], [150, 165, 'actual'], [180, 240, 'forecast']]);
});

// ── the endpoint ──────────────────────────────────────────────────────────────

const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };
const feed = (zone, days) => ({ zone, generated: day(0), trainedThrough: null, unit: 'EUR/MWh', days });
const forecastDay = (date, base) => ({ date, type: 'forecast', horizon: 2, prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: base + h, min_eur_mwh: base + h - 10, max_eur_mwh: base + h + 10 })) });
/** The 15-minute record of one Berlin day: 96 quarters, price = 200 + the quarter's index. */
const quarterRecord = (zone, date) => {
  const from = localMidnight(date, 'Europe/Berlin') / 1000;
  return { zone, generated: day(0), unit: 'EUR/MWh', slots: Array.from({ length: 96 }, (_, i) => [from + i * 900, 15, 200 + i]) };
};
const get = async (kv, url) => (await createApi({ kv: makeKv(kv), ecb: ECB })).get(url);

test('/api/slots: the 15-minute prices where they exist, the hourly slots of the model after them, UTC timestamps, no overlap', async () => {
  const today = day(0), tomorrow = day(1), later = day(2);
  const r = await get({ 'eu-prices-de': feed('de', [flatDay(today), flatDay(tomorrow)]), 'eu-slots-de': quarterRecord('de', tomorrow), 'eu-forecast-de': { generated: day(0), trainedThrough: day(-1), model: 'eu-ens-v2', days: [forecastDay(later, 300)] } }, '/api/slots?zone=de');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const s = r.body.slots;
  const sizes = new Map();
  for (const x of s) sizes.set(x.type + ':' + (Date.parse(x.end) - Date.parse(x.start)) / 60000, (sizes.get(x.type + ':' + (Date.parse(x.end) - Date.parse(x.start)) / 60000) || 0) + 1);
  assert.equal(sizes.get('actual:15'), 96, 'tomorrow is 96 quarters');
  assert.equal(sizes.get('actual:60') >= 23, true, "today has no 15-minute record: its hourly slots stay");
  assert.equal(sizes.get('forecast:60'), 24, 'the model day is hourly');
  for (let i = 1; i < s.length; i++) assert.ok(Date.parse(s[i].start) >= Date.parse(s[i - 1].end), `no overlap at ${s[i].start}`);
  assert.match(s[0].start, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  const q0 = s.find(x => x.start === new Date(localMidnight(tomorrow, 'Europe/Berlin')).toISOString().replace('.000Z', 'Z'));
  assert.equal(q0.price, 0.2, '200 EUR/MWh is 0.2 EUR/kWh');
  assert.equal(r.body.currency, 'EUR');
  assert.equal(r.body.unit, 'EUR/kWh');
  const f = s.find(x => x.type === 'forecast');
  assert.ok(f.min < f.price && f.price < f.max, 'the model\'s band is passed on');
  assert.ok(!('min' in q0), 'a settled price has no band');
});

test('/api/slots: without a 15-minute record every slot is the hour it is, and nothing is invented', async () => {
  const r = await get({ 'eu-prices-de': feed('de', [flatDay(day(0))]) }, '/api/slots?zone=de');
  assert.equal(r.status, 200);
  assert.ok(r.body.slots.length >= 23 && r.body.slots.every(x => Date.parse(x.end) - Date.parse(x.start) === 3600000 && x.type === 'actual'));
  const old = await get({ 'eu-prices-de': feed('de', [flatDay(day(0))]), 'eu-slots-de': { ...quarterRecord('de', day(0)), generated: '2026-01-01' } }, '/api/slots?zone=de');
  assert.ok(old.body.slots.every(x => Date.parse(x.end) - Date.parse(x.start) === 3600000), 'a months-old 15-minute record is not used');
});

test('/api/slots: currency, the Polish zloty rate, actualonly, and the Nordic zones on their own clock', async () => {
  const pl = await get({ 'eu-prices-pl': feed('pl', [flatDay(day(0))]) }, '/api/slots?zone=pl');
  assert.equal(pl.body.currency, 'PLN');
  assert.equal(pl.body.slots[0].price, +(100 * 4.3945 / 1000).toFixed(5), 'EUR/MWh * the ECB rate / 1000');
  const eur = await get({ 'eu-prices-pl': feed('pl', [flatDay(day(0))]) }, '/api/slots?zone=pl&currency=eur');
  assert.equal(eur.body.currency, 'EUR');
  assert.equal(eur.body.slots[0].price, 0.1);
  const only = await get({ 'eu-prices-de': feed('de', [flatDay(day(0))]), 'eu-forecast-de': { generated: day(0), trainedThrough: day(-1), model: 'm', days: [forecastDay(day(1), 300)] } }, '/api/slots?zone=de&actualonly=1');
  assert.ok(only.body.slots.length && only.body.slots.every(x => x.type === 'actual'));
  const fi = await get({ 'nordic-forecast-fi': feed('fi', [flatDay(day(0))]) }, '/api/slots?zone=fi');
  assert.equal(fi.status, 200);
  assert.equal(fi.body.currency, 'EUR');
  const no = await get({ 'nordic-forecast-no1': feed('no1', [flatDay(day(0))]) }, '/api/slots?zone=no1');
  assert.equal(no.body.currency, 'NOK');
  const first = no.body.slots[0];
  assert.equal(first.price, +(100 * 10.4665 / 1000).toFixed(5));
  assert.equal(Date.parse(first.start), localMidnight(day(0), 'Europe/Copenhagen'), 'hour 0 of a Norwegian day is Copenhagen\'s midnight');
});

test('/api/slots: unknown zone, mode on a wholesale zone, bad currency, gb in euro, no data', async () => {
  assert.equal((await get({}, '/api/slots?zone=xx')).status, 400);
  assert.equal((await get({ 'eu-prices-de': feed('de', [flatDay(day(0))]) }, '/api/slots?zone=de&mode=inkl_alt')).status, 400);
  assert.equal((await get({ 'eu-prices-de': feed('de', [flatDay(day(0))]) }, '/api/slots?zone=de&currency=usd')).status, 400);
  assert.equal((await get({ 'eu-prices-gb': feed('gb', [flatDay(day(0))]) }, '/api/slots?zone=gb&currency=eur')).status, 400);
  assert.equal((await get({}, '/api/slots?zone=de')).status, 404);
  assert.equal((await get({}, '/api/slots?zone=no2')).status, 404);
  assert.equal((await get({ 'eu-prices-gb': feed('gb', [flatDay(day(0))]) }, '/api/slots?zone=gb')).body.currency, 'GBP');
});

test('/api/slots for Denmark: settled days in 15-minute slots whose mean is the hour of /api/forecast, forecast days hourly, every mode', async () => {
  const api = await createApi({ kv: makeKv({}), ecb: ECB });
  const fc = await api.get('/api/forecast?area=DK1&mode=inkl_alt');
  const r = await api.get('/api/slots?zone=dk1&mode=inkl_alt');
  assert.equal(r.status, 200);
  assert.equal(r.body.currency, 'DKK');
  const settled = r.body.slots.filter(s => s.type === 'actual');
  const quarters = settled.filter(s => Date.parse(s.end) - Date.parse(s.start) === 900000);
  // (the fake market reads `start` as a UTC date, so the first Danish hour of the window has no quarters: it stays one hourly slot, never a hole)
  assert.ok(quarters.length >= 180 && settled.length - quarters.length <= 2, `today and tomorrow are 15-minute slots (${quarters.length} of ${settled.length})`);
  assert.ok(r.body.slots.filter(s => s.type === 'forecast').every(s => Date.parse(s.end) - Date.parse(s.start) === 3600000), 'forecast days are hourly');
  // the four quarters of an hour average to the hour's forecast price (rounded to 4 decimals there)
  const hourOf = new Map(), want = new Map();
  for (const d of fc.body.days.filter(d => d.type === 'actual')) for (const p of d.prices) want.set(`${d.date} ${p.hour}`, p.price);
  for (const s of settled) {
    const t = Date.parse(s.start), k = new Date(t - (t % 3600000)).toISOString();
    (hourOf.get(k) ?? hourOf.set(k, []).get(k)).push(s.price);
  }
  let checked = 0;
  for (const [k, v] of hourOf) {
    if (v.length !== 4) continue;
    const local = new Date(Date.parse(k) + tzOffsetMin('Europe/Copenhagen', Date.parse(k)) * 60000).toISOString();
    const w = want.get(`${local.slice(0, 10)} ${+local.slice(11, 13)}`);
    if (w === undefined) continue;
    assert.ok(Math.abs(v.reduce((a, b) => a + b, 0) / 4 - w) < 0.0003, `${k}: mean of the quarters ${v} vs hour ${w}`);
    checked++;
  }
  assert.ok(checked >= 40, `compared ${checked} hours`);
  // the quarter prices differ within the hour (the fake market has four different quarters)
  assert.ok(new Set(settled.slice(0, 4).map(s => s.price)).size === 4);
  const spot = await api.get('/api/slots?zone=dk2&mode=spot_ex');
  assert.equal(spot.status, 200);
  assert.equal((await api.get('/api/slots?zone=dk1&mode=nope')).status, 400);
  assert.equal((await api.get('/api/slots?zone=dk1&mode=net_inkl_alt')).status, 400, 'a net_ mode needs a gln');
  assert.equal((await api.get('/api/slots?zone=dk1&gln=5790001089030')).status, 400);
  const net = await api.get('/api/slots?zone=dk1&mode=net_inkl_alt&gln=5790001089030');
  assert.equal(net.status, 200);
  assert.equal(net.body.gln, '5790001089030');
  assert.ok(net.body.slots.length > 96);
  const eur = await api.get('/api/slots?zone=dk1&mode=spot_ex&currency=eur');
  assert.equal(eur.body.currency, 'EUR');
  assert.ok(Math.abs(eur.body.slots[0].price * 7.4748 - spot.body.slots[0].price) < 0.01);
});

test('the OpenAPI document describes /api/slots', async () => {
  const api = await createApi({ kv: makeKv({}), ecb: ECB });
  const spec = (await api.get('/api/openapi.json')).body;
  const p = spec.paths['/api/slots'];
  assert.ok(p && p.get.operationId === 'getPriceSlots');
  assert.deepEqual(p.get.parameters.map(x => x.name).sort(), ['actualonly', 'currency', 'gln', 'mode', 'zone']);
});
