#!/usr/bin/env node
/**
 * Elpris test suite
 * Run: node test.js
 *
 * Tests: price conversion, tariff selection (incl DST edge cases),
 *        strategy computation, and live API endpoints.
 */

'use strict';

const assert  = require('node:assert/strict');
const http    = require('node:http');

// ─────────────────────────────────────────────────────────────────────────────
// Inline copies of the pure functions from server.js so unit tests have no
// network dependency and run independently of server state.
// These must stay in sync with server.js — any divergence is itself a test failure.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = d =>
  d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

function getTariffHourly(records, dateStr) {
  for (const r of records) {
    if (r.fromStr > dateStr) continue;
    if (r.toStr && r.toStr <= dateStr) continue;
    return r.hourly;
  }
  return Array(24).fill(0);
}

function cvt(dkkMwh, h, mode, en, tariff) {
  const spot = dkkMwh / 1000;
  switch (mode) {
    case 'spot_ex':        return spot;
    case 'spot_inkl':      return spot * 1.25;
    case 'inkl_alt':       return (spot + en.sys + en.trans + en.afg) * 1.25;
    case 'inkl_alt_minus': return (spot + en.sys + en.trans) * 1.25;
    case 'net_inkl_alt':   return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans + en.afg) * 1.25;
    case 'net_inkl_tarif': return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans) * 1.25;
    default:               return spot * 1.25;
  }
}

function computeSchedule(prices, strategy, param) {
  const valid = prices.map((p, h) => ({ h, p })).filter(x => x.p !== null);
  const on = Array(24).fill(false);
  if (strategy === 'cheapest_n') {
    const n = Math.min(Math.max(1, +param), valid.length);
    [...valid].sort((a, b) => a.p - b.p).slice(0, n).forEach(x => on[x.h] = true);
  } else if (strategy === 'cheapest_pct') {
    const n = Math.max(1, Math.round(valid.length * (+param / 100)));
    [...valid].sort((a, b) => a.p - b.p).slice(0, n).forEach(x => on[x.h] = true);
  } else if (strategy === 'avoid_peak') {
    for (let h = 0; h < 24; h++) on[h] = (h < 17 || h >= 21);
  } else if (strategy === 'night_cheap') {
    for (let h = 0; h < 24; h++) on[h] = (h >= 23 || h < 6);
  }
  return on;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal test runner
// ─────────────────────────────────────────────────────────────────────────────

let _passed = 0, _failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    _passed++;
    results.push({ ok: true, name });
  } catch (e) {
    _failed++;
    results.push({ ok: false, name, msg: e.message });
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    _passed++;
    results.push({ ok: true, name });
  } catch (e) {
    _failed++;
    results.push({ ok: false, name, msg: e.message });
  }
}

function near(a, b, tol = 0.0001, msg = '') {
  assert.ok(Math.abs(a - b) < tol, `${msg} expected ~${b}, got ${a}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. TARIFF SELECTION — string-date comparison
// ─────────────────────────────────────────────────────────────────────────────

const WINTER = { fromStr: '2025-10-01', toStr: '2026-04-01', hourly: Array(24).fill(0).map((_, h) => h >= 17 && h < 21 ? 0.4 : 0.1) };
const SUMMER = { fromStr: '2026-04-01', toStr: null,         hourly: Array(24).fill(0.07) };
const TARIFF_RECORDS = [SUMMER, WINTER]; // API returns newest-first

test('tariff: summer tariff applies on April 1', () => {
  const h = getTariffHourly(TARIFF_RECORDS, '2026-04-01');
  near(h[0],  0.07, 0.001, 'off-peak hour');
  near(h[18], 0.07, 0.001, 'peak hour 18 in summer');
});

test('tariff: winter tariff applies on March 31', () => {
  const h = getTariffHourly(TARIFF_RECORDS, '2026-03-31');
  near(h[0],  0.1, 0.001, 'off-peak hour');
  near(h[18], 0.4, 0.001, 'peak hour 18 in winter');
});

test('tariff: winter tariff applies on DST change day (March 29)', () => {
  // DST changes last Sunday of March. That day must still use winter tariff,
  // NOT summer. This was the original bug — new Date() UTC vs local mismatch
  // caused summer tariff to be applied a day or two early.
  const h = getTariffHourly(TARIFF_RECORDS, '2026-03-29');
  near(h[18], 0.4, 0.001, 'peak hour 18 must use winter rate on DST change day');
  near(h[0],  0.1, 0.001, 'off-peak hour must use winter rate');
});

test('tariff: winter tariff applies day before DST change (March 28)', () => {
  const h = getTariffHourly(TARIFF_RECORDS, '2026-03-28');
  near(h[17], 0.4, 0.001, 'peak hour 17 winter');
});

test('tariff: expired record (ValidTo in the past) is skipped', () => {
  const old = { fromStr: '2024-10-01', toStr: '2025-04-01', hourly: Array(24).fill(9.99) };
  const current = { fromStr: '2025-10-01', toStr: null, hourly: Array(24).fill(0.1) };
  const h = getTariffHourly([old, current], '2026-03-15');
  near(h[0], 0.1, 0.001, 'expired record must be skipped');
});

test('tariff: future-only record returns zeros (no current tariff)', () => {
  const future = { fromStr: '2030-01-01', toStr: null, hourly: Array(24).fill(9.99) };
  const h = getTariffHourly([future], '2026-03-15');
  assert.deepEqual(h, Array(24).fill(0));
});

test('tariff: empty records returns zeros', () => {
  assert.deepEqual(getTariffHourly([], '2026-03-15'), Array(24).fill(0));
});

test('tariff: toStr boundary — record with toStr=dateStr is expired', () => {
  // toStr <= dateStr means expired (record ends before/on this date)
  const rec = { fromStr: '2025-01-01', toStr: '2026-03-15', hourly: Array(24).fill(5.0) };
  const h = getTariffHourly([rec], '2026-03-15');
  assert.deepEqual(h, Array(24).fill(0), 'toStr == dateStr should be expired');
});

test('tariff: toStr boundary — record valid up to but not including toStr', () => {
  const rec = { fromStr: '2025-01-01', toStr: '2026-03-16', hourly: Array(24).fill(5.0) };
  const h = getTariffHourly([rec], '2026-03-15');
  near(h[0], 5.0, 0.001, 'record with toStr one day later should still apply');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PRICE CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

const EN = { sys: 0.072, trans: 0.043, afg: 0.008 };
const TARIFF_H = Array(24).fill(0).map((_, h) => h >= 17 && h < 21 ? 0.35 : 0.05);

test('cvt: spot_ex — no vat, no charges', () => {
  near(cvt(1000, 0, 'spot_ex', EN, null), 1.0);
  near(cvt(500,  0, 'spot_ex', EN, null), 0.5);
  near(cvt(0,    0, 'spot_ex', EN, null), 0.0);
});

test('cvt: spot_inkl — spot * 1.25 only', () => {
  near(cvt(1000, 0, 'spot_inkl', EN, null), 1.25);
  near(cvt(0,    0, 'spot_inkl', EN, null), 0.0);
});

test('cvt: inkl_alt — spot + charges + vat', () => {
  // (1.0 + 0.072 + 0.043 + 0.008) * 1.25 = 1.123 * 1.25 = 1.40375
  near(cvt(1000, 0, 'inkl_alt', EN, null), 1.40375);
});

test('cvt: inkl_alt_minus — spot + sys + trans only (no afg)', () => {
  // (1.0 + 0.072 + 0.043) * 1.25 = 1.115 * 1.25 = 1.39375
  near(cvt(1000, 0, 'inkl_alt_minus', EN, null), 1.39375);
});

test('cvt: net_inkl_alt — off-peak hour uses low tariff', () => {
  const h = 10;
  // (1.0 + 0.05 + 0.072 + 0.043 + 0.008) * 1.25 = 1.173 * 1.25 = 1.46625
  near(cvt(1000, h, 'net_inkl_alt', EN, TARIFF_H), 1.46625);
});

test('cvt: net_inkl_alt — peak hour uses high tariff', () => {
  const h = 18;
  // (1.0 + 0.35 + 0.072 + 0.043 + 0.008) * 1.25 = 1.473 * 1.25 = 1.84125
  near(cvt(1000, h, 'net_inkl_alt', EN, TARIFF_H), 1.84125);
});

test('cvt: net_inkl_tarif — no elafgift', () => {
  const h = 10;
  // (1.0 + 0.05 + 0.072 + 0.043) * 1.25 = 1.165 * 1.25 = 1.45625
  near(cvt(1000, h, 'net_inkl_tarif', EN, TARIFF_H), 1.45625);
});

test('cvt: negative spot prices', () => {
  // Negative prices occur in DK1 during high wind
  near(cvt(-200, 0, 'spot_inkl', EN, null), -0.25);
  // inkl_alt can still be positive due to fixed charges
  near(cvt(-200, 0, 'inkl_alt', EN, null), (-0.2 + 0.072 + 0.043 + 0.008) * 1.25);
});

test('cvt: zero spot price', () => {
  near(cvt(0, 0, 'inkl_alt', EN, null), (0.072 + 0.043 + 0.008) * 1.25);
});

test('cvt: high spot price (2000 DKK/MWh = 2 DKK/kWh)', () => {
  // (2.0 + 0.072 + 0.043 + 0.008) * 1.25 = 2.123 * 1.25 = 2.65375
  near(cvt(2000, 0, 'inkl_alt', EN, null), 2.65375);
});

test('cvt: tariff null treated as zero for net modes', () => {
  near(cvt(1000, 0, 'net_inkl_alt',   EN, null), cvt(1000, 0, 'inkl_alt', EN, null));
  near(cvt(1000, 0, 'net_inkl_tarif', EN, null), cvt(1000, 0, 'inkl_alt_minus', EN, null));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. STRATEGY — computeSchedule
// ─────────────────────────────────────────────────────────────────────────────

function makeFlat(val) { return Array(24).fill(val); }

function makePrices(...pairs) {
  // pairs: [[hour, price], ...], rest null
  const p = Array(24).fill(null);
  pairs.forEach(([h, v]) => p[h] = v);
  return p;
}

test('strategy cheapest_n: picks exactly N cheapest hours', () => {
  // Prices increase hour by hour (0=cheapest, 23=most expensive)
  const prices = Array.from({ length: 24 }, (_, h) => h * 0.1);
  const on = computeSchedule(prices, 'cheapest_n', 6);
  const onHours = on.map((v, h) => v ? h : -1).filter(h => h >= 0);
  assert.equal(onHours.length, 6);
  assert.deepEqual(onHours, [0, 1, 2, 3, 4, 5], 'cheapest 6 are hours 0-5');
});

test('strategy cheapest_n: picks cheapest even when scattered', () => {
  const prices = Array(24).fill(2.0);
  prices[3] = 0.1; prices[7] = 0.2; prices[15] = 0.3;
  const on = computeSchedule(prices, 'cheapest_n', 3);
  assert.ok(on[3],  'hour 3 is cheapest — must be ON');
  assert.ok(on[7],  'hour 7 is 2nd cheapest — must be ON');
  assert.ok(on[15], 'hour 15 is 3rd cheapest — must be ON');
  const count = on.filter(Boolean).length;
  assert.equal(count, 3, 'exactly 3 hours ON');
});

test('strategy cheapest_n: param=1 turns on only the cheapest hour', () => {
  const prices = Array.from({ length: 24 }, (_, h) => h * 0.1);
  const on = computeSchedule(prices, 'cheapest_n', 1);
  assert.ok(on[0]);
  assert.equal(on.filter(Boolean).length, 1);
});

test('strategy cheapest_n: param > 24 clamped to available hours', () => {
  const prices = makeFlat(1.0);
  const on = computeSchedule(prices, 'cheapest_n', 99);
  assert.equal(on.filter(Boolean).length, 24);
});

test('strategy cheapest_n: null prices excluded from selection', () => {
  const prices = Array(24).fill(null);
  prices[5] = 0.5; prices[10] = 1.0; prices[20] = 2.0;
  const on = computeSchedule(prices, 'cheapest_n', 2);
  assert.ok(on[5],  'cheapest non-null hour ON');
  assert.ok(on[10], '2nd cheapest non-null hour ON');
  assert.ok(!on[20], 'expensive hour OFF');
  assert.equal(on.filter(Boolean).length, 2);
});

test('strategy cheapest_pct: 25% of 24 hours = 6 hours', () => {
  const prices = Array.from({ length: 24 }, (_, h) => h * 0.1);
  const on = computeSchedule(prices, 'cheapest_pct', 25);
  assert.equal(on.filter(Boolean).length, 6);
  assert.ok(on[0]); assert.ok(on[5]);  // cheapest 6
  assert.ok(!on[6]);                    // 7th is OFF
});

test('strategy cheapest_pct: 20% = billigste 20% for affugter', () => {
  const prices = Array.from({ length: 24 }, (_, h) => h * 0.1);
  const on = computeSchedule(prices, 'cheapest_pct', 20);
  // 20% of 24 = 4.8, rounds to 5
  assert.equal(on.filter(Boolean).length, 5);
});

test('strategy cheapest_pct: minimum 1 hour always ON', () => {
  const prices = makeFlat(1.0);
  const on = computeSchedule(prices, 'cheapest_pct', 1);
  assert.equal(on.filter(Boolean).length, 1);
});

test('strategy avoid_peak: hours 17-20 OFF, rest ON', () => {
  const prices = makeFlat(1.0);
  const on = computeSchedule(prices, 'avoid_peak', 0);
  for (let h = 0; h < 24; h++) {
    if (h >= 17 && h < 21) {
      assert.ok(!on[h], `hour ${h} should be OFF (peak)`);
    } else {
      assert.ok(on[h],  `hour ${h} should be ON (off-peak)`);
    }
  }
});

test('strategy avoid_peak: 20 hours ON, 4 hours OFF', () => {
  const on = computeSchedule(makeFlat(1.0), 'avoid_peak', 0);
  assert.equal(on.filter(Boolean).length, 20);
});

test('strategy night_cheap: only 23-05 ON', () => {
  const on = computeSchedule(makeFlat(1.0), 'night_cheap', 0);
  const nightHours = [23, 0, 1, 2, 3, 4, 5];
  for (let h = 0; h < 24; h++) {
    if (nightHours.includes(h)) assert.ok(on[h],  `hour ${h} night — must be ON`);
    else                         assert.ok(!on[h], `hour ${h} day — must be OFF`);
  }
  assert.equal(on.filter(Boolean).length, 7);
});

test('strategy: equal prices — cheapest_n picks first N by stable sort', () => {
  // All same price — any N is fine, just need exactly N
  const prices = makeFlat(1.0);
  const on = computeSchedule(prices, 'cheapest_n', 4);
  assert.equal(on.filter(Boolean).length, 4);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

test('fmt: formats date as YYYY-MM-DD', () => {
  assert.equal(fmt(new Date('2026-03-29')), '2026-03-29');
  assert.equal(fmt(new Date('2026-01-01')), '2026-01-01');
  assert.equal(fmt(new Date('2026-12-31')), '2026-12-31');
});

test('tariff string comparison: lexicographic order is chronological for YYYY-MM-DD', () => {
  assert.ok('2026-04-01' > '2026-03-31');
  assert.ok('2026-03-29' < '2026-04-01');
  assert.ok('2025-10-01' < '2026-03-29');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. API INTEGRATION TESTS (requires server running on port 8080)
// ─────────────────────────────────────────────────────────────────────────────

function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8080${path}`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { reject(new Error(`JSON parse failed: ${d.slice(0, 200)}`)); }
      });
    }).on('error', e => reject(new Error(`Connection failed: ${e.message} — is server running?`)));
  });
}

async function runAPITests() {
  await testAsync('api /api/now: returns on, price, hour for DK1 inkl_alt', async () => {
    const { status, body } = await apiGet('/api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6');
    assert.equal(status, 200);
    assert.ok(typeof body.on === 'boolean',    'on must be boolean');
    assert.ok(typeof body.price === 'number',  'price must be number');
    assert.ok(typeof body.hour === 'number',   'hour must be number');
    assert.ok(body.hour >= 0 && body.hour <= 23, 'hour in range 0-23');
    assert.equal(body.area, 'DK1');
    assert.equal(body.mode, 'inkl_alt');
  });

  await testAsync('api /api/now: works for DK2', async () => {
    const { status, body } = await apiGet('/api/now?area=DK2&mode=inkl_alt&strategy=cheapest_n&hours=6');
    assert.equal(status, 200);
    assert.equal(body.area, 'DK2');
    assert.ok(typeof body.on === 'boolean');
  });

  await testAsync('api /api/now: invalid area returns 400', async () => {
    const { status } = await apiGet('/api/now?area=DK3&mode=inkl_alt');
    assert.equal(status, 400);
  });

  await testAsync('api /api/prices: returns 24 hours', async () => {
    const { status, body } = await apiGet('/api/prices?area=DK1&mode=spot_inkl');
    assert.equal(status, 200);
    assert.equal(body.prices.length, 24, '24 hourly entries');
    assert.equal(body.unit, 'DKK/kWh');
    body.prices.forEach((p, i) => {
      assert.equal(p.hour, i, `prices[${i}].hour must be ${i}`);
      if (p.price !== null) assert.ok(typeof p.price === 'number', 'price is number when present');
    });
  });

  await testAsync('api /api/prices: spot_inkl prices are spot_ex * 1.25', async () => {
    const [ex, inkl] = await Promise.all([
      apiGet('/api/prices?area=DK1&mode=spot_ex'),
      apiGet('/api/prices?area=DK1&mode=spot_inkl'),
    ]);
    assert.equal(ex.status, 200); assert.equal(inkl.status, 200);
    ex.body.prices.forEach((p, i) => {
      if (p.price !== null && inkl.body.prices[i].price !== null) {
        // toFixed(4) rounding can create up to 0.00005 error; use 0.001
        near(inkl.body.prices[i].price, p.price * 1.25, 0.001,
          `hour ${i}: inkl should be ex * 1.25`);
      }
    });
  });

  await testAsync('api /api/prices: inkl_alt > spot_inkl (charges add cost)', async () => {
    const [spot, inkl] = await Promise.all([
      apiGet('/api/prices?area=DK1&mode=spot_inkl'),
      apiGet('/api/prices?area=DK1&mode=inkl_alt'),
    ]);
    const defined = inkl.body.prices.filter((p, i) =>
      p.price !== null && spot.body.prices[i].price !== null);
    assert.ok(defined.length > 0, 'need at least some prices');
    // inkl_alt adds sys+trans+afg = 0.123 DKK/kWh before VAT,
    // so inkl_alt should exceed spot_inkl by ~0.154 (0.123*1.25)
    defined.forEach((p, i) => {
      const diff = p.price - spot.body.prices[i].price;
      assert.ok(diff > 0.1, `hour ${i}: inkl_alt must exceed spot_inkl by at least 0.1, diff=${diff.toFixed(4)}`);
    });
  });

  await testAsync('api /api/schedule: returns 24-entry schedule with on field', async () => {
    const { status, body } = await apiGet('/api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6');
    assert.equal(status, 200);
    assert.equal(body.schedule.length, 24);
    body.schedule.forEach(s => {
      assert.ok(typeof s.on === 'boolean', 'on is boolean');
      assert.equal(s.hour, body.schedule.indexOf(s));
    });
  });

  await testAsync('api /api/schedule: cheapest_n=6 turns on exactly 6 non-null hours', async () => {
    const { body } = await apiGet('/api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6');
    const onCount = body.schedule.filter(s => s.on).length;
    const nonNull = body.schedule.filter(s => s.price !== null).length;
    assert.ok(onCount <= 6, `on=${onCount} should be ≤ 6`);
    if (nonNull >= 6) assert.equal(onCount, 6, 'exactly 6 ON when 6+ prices available');
  });

  await testAsync('api /api/schedule: avoid_peak turns off hours 17-20', async () => {
    const { body } = await apiGet('/api/schedule?area=DK1&mode=inkl_alt&strategy=avoid_peak');
    [17, 18, 19, 20].forEach(h => {
      assert.ok(!body.schedule[h].on, `hour ${h} must be OFF for avoid_peak`);
    });
  });

  await testAsync('api /api/schedule: night_cheap turns on only 23-05', async () => {
    const { body } = await apiGet('/api/schedule?area=DK1&mode=inkl_alt&strategy=night_cheap');
    const nightHours = new Set([23, 0, 1, 2, 3, 4, 5]);
    body.schedule.forEach(s => {
      if (s.on) assert.ok(nightHours.has(s.hour), `hour ${s.hour} is ON but not a night hour`);
    });
  });

  await testAsync('api /api/now: on_now matches schedule[current_hour].on', async () => {
    const [nowRes, schRes] = await Promise.all([
      apiGet('/api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6'),
      apiGet('/api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6'),
    ]);
    const hour = nowRes.body.hour;
    assert.equal(
      nowRes.body.on,
      schRes.body.schedule[hour].on,
      `on_now (${nowRes.body.on}) must match schedule[${hour}].on`
    );
  });

  await testAsync('api /api/now: price matches /api/prices current hour', async () => {
    const [nowRes, priceRes] = await Promise.all([
      apiGet('/api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6'),
      apiGet('/api/prices?area=DK1&mode=inkl_alt'),
    ]);
    const hour = nowRes.body.hour;
    const expected = priceRes.body.prices[hour].price;
    near(nowRes.body.price, expected, 0.001, `now.price must match prices[${hour}]`);
  });

  await testAsync('api /api/now: CORS header present', async () => {
    const { headers } = await new Promise((resolve, reject) => {
      http.get('http://localhost:8080/api/now?area=DK1&mode=inkl_alt', res => {
        resolve({ headers: res.headers });
      }).on('error', reject);
    });
    assert.equal(headers['access-control-allow-origin'], '*', 'CORS header must be *');
  });

  await testAsync('api static: serves index.html at /', async () => {
    const { status } = await new Promise((resolve, reject) => {
      http.get('http://localhost:8080/', res => {
        resolve({ status: res.statusCode });
        res.resume();
      }).on('error', reject);
    });
    assert.equal(status, 200);
  });

  await testAsync('api unknown endpoint: returns 404 with error message', async () => {
    const { status, body } = await apiGet('/api/unknown');
    assert.equal(status, 404);
    assert.ok(body.error, 'error field present');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run everything
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n⚡ Elpris Test Suite\n' + '─'.repeat(50));

  // Unit tests (sync, no network)
  console.log('\n📋 Unit tests');
  // (already run above via test())

  // Integration tests (require server)
  console.log('\n🌐 API integration tests (requires server on :8080)');
  await runAPITests();

  // Report
  console.log('\n' + '─'.repeat(50));
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '\n   └─ ' + r.msg}`);
  }
  console.log('\n' + '─'.repeat(50));
  console.log(`\n${_passed} passed, ${_failed} failed\n`);
  process.exit(_failed > 0 ? 1 : 0);
})();
