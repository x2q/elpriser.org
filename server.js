#!/usr/bin/env node
/**
 * Elpris API server
 *
 * Endpoints:
 *   GET /api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...]
 *       → {on, price, hour, area, strategy}   — minimal, for Shelly/HA polling
 *
 *   GET /api/prices?area=DK1&mode=inkl_alt[&gln=...][&date=YYYY-MM-DD]
 *       → {area, mode, date, unit, prices:[{hour,price}], current_hour, current_price}
 *
 *   GET /api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...][&date=YYYY-MM-DD]
 *       → {area, mode, strategy, param, date, on_now, schedule:[{hour,price,on}]}
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 8080;
const __dir = __dirname;

// ── helpers ──────────────────────────────────────────────────────────────────

function fetchJSON(u) {
  return new Promise((resolve, reject) => {
    https.get(u, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const fmt = d =>
  d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

// ── data fetchers ─────────────────────────────────────────────────────────────

async function fetchSpotPrices(area, start, end) {
  const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
  const j = await fetchJSON(
    `https://api.energidataservice.dk/dataset/DayAheadPrices` +
    `?start=${start}&end=${end}&filter=${f}&sort=TimeDK%20asc&limit=0`
  );
  // Group MWh records into hourly averages keyed by [date][hour]
  const g = {};
  for (const r of (j.records || [])) {
    const dt = new Date(r.TimeDK), dk = fmt(dt), h = dt.getHours();
    (g[dk] ??= {})[h] ??= [];
    g[dk][h].push(r.DayAheadPriceDKK);
  }
  const out = {};
  for (const d in g) {
    out[d] = {};
    for (const h in g[d]) {
      const v = g[d][h];
      out[d][h] = v.reduce((a, b) => a + b, 0) / v.length;
    }
  }
  return out;
}

async function fetchEnCharges() {
  const GLN = '5790000432752';
  const f = encodeURIComponent(JSON.stringify({
    GLN_Number: GLN, ChargeType: 'D03', ResolutionDuration: 'P1D'
  }));
  const defaults = { sys: 0.072, trans: 0.043, afg: 0.008 };
  try {
    const j = await fetchJSON(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=20&columns=ChargeTypeCode,ValidFrom,ValidTo,Price1`
    );
    const now = new Date(), c = { ...defaults };
    for (const r of (j.records || [])) {
      if (new Date(r.ValidFrom) > now) continue;
      if (r.ValidTo && new Date(r.ValidTo) < now) continue;
      if (r.ChargeTypeCode === '41000')  c.sys  = r.Price1 || 0;
      else if (r.ChargeTypeCode === '40000')  c.trans = r.Price1 || 0;
      else if (r.ChargeTypeCode === 'EA-001') c.afg   = r.Price1 || 0;
    }
    return c;
  } catch { return defaults; }
}

async function fetchTariffRecords(gln) {
  const f = encodeURIComponent(JSON.stringify({ GLN_Number: gln, ChargeType: 'D03', Note: 'Nettarif C' }));
  const cols = 'ValidFrom,ValidTo,ResolutionDuration,' +
    Array.from({ length: 24 }, (_, i) => 'Price' + (i + 1)).join(',');
  try {
    const j = await fetchJSON(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=10&columns=${cols}`
    );
    const now = new Date(), horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 3);
    const records = [];
    for (const r of (j.records || [])) {
      if (r.ResolutionDuration !== 'PT1H') continue;
      const vf = new Date(r.ValidFrom);
      if (vf > horizon) continue;
      if (r.ValidTo && new Date(r.ValidTo) <= now) continue;
      records.push({
        // Store date portion as YYYY-MM-DD string — avoids DST/timezone bugs
        // when comparing against price-date strings later.
        fromStr: r.ValidFrom.slice(0, 10),
        toStr:   r.ValidTo ? r.ValidTo.slice(0, 10) : null,
        hourly: Array.from({ length: 24 }, (_, i) => r['Price' + (i + 1)] || 0)
      });
    }
    return records;
  } catch { return []; }
}

// Compare using YYYY-MM-DD string comparison — completely timezone-safe.
// JavaScript's new Date("YYYY-MM-DD") treats the string as UTC midnight,
// while new Date("YYYY-MM-DDTHH:MM:SS") (no Z) is parsed as LOCAL time,
// causing off-by-one errors on DST boundary days (e.g. last Sunday of March).
function getTariffHourly(records, dateStr) {
  for (const r of records) {
    if (r.fromStr > dateStr) continue;          // tariff not yet valid
    if (r.toStr && r.toStr <= dateStr) continue; // tariff expired
    return r.hourly;
  }
  return Array(24).fill(0);
}

// ── price conversion ──────────────────────────────────────────────────────────

function cvt(dkkMwh, h, mode, en, tariff) {
  const spot = dkkMwh / 1000;
  switch (mode) {
    case 'spot_ex':           return spot;
    case 'spot_inkl':         return spot * 1.25;
    case 'inkl_alt':          return (spot + en.sys + en.trans + en.afg) * 1.25;
    case 'inkl_alt_minus':    return (spot + en.sys + en.trans) * 1.25;
    case 'net_inkl_alt':      return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans + en.afg) * 1.25;
    case 'net_inkl_tarif':    return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans) * 1.25;
    default:                  return spot * 1.25;
  }
}

// ── strategy ──────────────────────────────────────────────────────────────────

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

// ── Shelly / Tibber helpers ───────────────────────────────────────────────────

// Format an ISO-8601 timestamp for a local clock hour on a given YYYY-MM-DD date.
// Uses the actual UTC offset for that instant so DST is handled correctly.
function isoWithOffset(dateStr, hour) {
  const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
  const off = -d.getTimezoneOffset();           // minutes ahead of UTC
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${dateStr}T${String(hour).padStart(2, '0')}:00:00${sign}${hh}:${mm}`;
}

// Assign Tibber-style price levels based on quintile within the supplied array.
function priceLevels(prices) {
  const valid = prices.filter(p => p !== null && p !== undefined);
  if (!valid.length) return prices.map(() => 'NORMAL');
  const sorted = [...valid].sort((a, b) => a - b);
  const at = frac => sorted[Math.min(Math.floor(sorted.length * frac), sorted.length - 1)];
  const [p20, p40, p60, p80] = [at(0.2), at(0.4), at(0.6), at(0.8)];
  return prices.map(p => {
    if (p === null || p === undefined) return 'NORMAL';
    if (p <= p20) return 'VERY_CHEAP';
    if (p <= p40) return 'CHEAP';
    if (p <= p60) return 'NORMAL';
    if (p <= p80) return 'EXPENSIVE';
    return 'VERY_EXPENSIVE';
  });
}

// ── Shelly Live Tariff endpoint ───────────────────────────────────────────────

async function handleShellyTariff(req, res, pu) {
  const q    = pu.query || {};
  const area = (q.area || 'DK1').toUpperCase();
  if (!['DK1', 'DK2'].includes(area)) return jsonErr(res, 400, 'area must be DK1 or DK2');

  const mode = q.mode || 'inkl_alt';
  const gln  = q.gln  || null;

  try {
    const now  = new Date();
    const s    = new Date(now); s.setDate(s.getDate() - 1);
    const e    = new Date(now); e.setDate(e.getDate() + 2);

    const today    = fmt(now);
    const tomorrow = fmt(new Date(now.getTime() + 86_400_000));

    const needsEn    = !['spot_ex', 'spot_inkl'].includes(mode);
    const needsTarif = mode.startsWith('net_') && gln;

    const [priceData, enCharges, tariffRecords] = await Promise.all([
      cached(`prices-${area}-${fmt(s)}-${fmt(e)}`, 5 * 60_000,
        () => fetchSpotPrices(area, fmt(s), fmt(e))),
      needsEn
        ? cached('encharges', 60 * 60_000, fetchEnCharges)
        : Promise.resolve({ sys: 0, trans: 0, afg: 0 }),
      needsTarif
        ? cached(`tariff-${gln}`, 60 * 60_000, () => fetchTariffRecords(gln))
        : Promise.resolve([]),
    ]);

    function dayPrices(dateStr) {
      const dayData     = priceData[dateStr] || {};
      const tariffHrly  = needsTarif ? getTariffHourly(tariffRecords, dateStr) : null;
      return Array.from({ length: 24 }, (_, h) => {
        const raw = dayData[h];
        return raw === undefined ? null : +cvt(raw, h, mode, enCharges, tariffHrly).toFixed(4);
      });
    }

    function makeEntries(dateStr) {
      const prices = dayPrices(dateStr);
      const levels = priceLevels(prices);
      return prices.map((total, hour) => {
        if (total === null) return null;
        return {
          total,
          startsAt: isoWithOffset(dateStr, hour),
          currency: 'DKK',
          level:    levels[hour],
        };
      }).filter(Boolean);
    }

    const todayEntries    = makeEntries(today);
    const tomorrowEntries = makeEntries(tomorrow);

    // Tibber-compatible response shape consumed by Shelly's Live Tariff feature
    jsonOK(res, {
      data: {
        viewer: {
          homes: [{
            currentSubscription: {
              priceInfo: {
                today:    todayEntries,
                tomorrow: tomorrowEntries,
              }
            }
          }]
        }
      }
    });
  } catch (err) {
    console.error('Shelly tariff error:', err);
    jsonErr(res, 500, err.message);
  }
}

// ── cache ─────────────────────────────────────────────────────────────────────

const _cache = new Map();
function cached(key, ttlMs, fn) {
  const now = Date.now(), e = _cache.get(key);
  if (e && now - e.ts < ttlMs) return Promise.resolve(e.v);
  return fn().then(v => { _cache.set(key, { ts: now, v }); return v; });
}

// ── API handler ───────────────────────────────────────────────────────────────

async function handleAPI(req, res, pu) {
  const q = pu.query || {};
  const area = (q.area || 'DK1').toUpperCase();
  if (!['DK1', 'DK2'].includes(area)) return jsonErr(res, 400, 'area must be DK1 or DK2');

  const mode     = q.mode || 'inkl_alt';
  const gln      = q.gln || null;
  const today    = fmt(new Date());
  const dateStr  = q.date || today;
  const strategy = q.strategy || 'cheapest_n';
  const param    = +(q.hours ?? q.pct ?? 6);
  const endpoint = pu.pathname.split('/')[2]; // /api/{endpoint}

  try {
    const now = new Date();
    const s = new Date(now); s.setDate(s.getDate() - 1);
    const e = new Date(now); e.setDate(e.getDate() + 2);

    const needsEn    = !['spot_ex', 'spot_inkl'].includes(mode);
    const needsTarif = mode.startsWith('net_') && gln;

    const [priceData, enCharges, tariffRecords] = await Promise.all([
      cached(`prices-${area}-${fmt(s)}-${fmt(e)}`, 5 * 60_000,
        () => fetchSpotPrices(area, fmt(s), fmt(e))),
      needsEn
        ? cached('encharges', 60 * 60_000, fetchEnCharges)
        : Promise.resolve({ sys: 0, trans: 0, afg: 0 }),
      needsTarif
        ? cached(`tariff-${gln}`, 60 * 60_000, () => fetchTariffRecords(gln))
        : Promise.resolve([]),
    ]);

    const dayData     = priceData[dateStr] || {};
    const tariffHrly  = needsTarif ? getTariffHourly(tariffRecords, dateStr) : null;

    const hourlyPrices = Array.from({ length: 24 }, (_, h) => {
      const raw = dayData[h];
      return raw === undefined ? null : +cvt(raw, h, mode, enCharges, tariffHrly).toFixed(4);
    });

    const curHour = new Date().getHours();

    if (endpoint === 'prices') {
      return jsonOK(res, {
        area, mode, date: dateStr, unit: 'DKK/kWh',
        prices: hourlyPrices.map((price, hour) => ({ hour, price })),
        current_hour: curHour,
        current_price: hourlyPrices[curHour],
      });
    }

    if (endpoint === 'schedule' || endpoint === 'now') {
      const schedule = computeSchedule(hourlyPrices, strategy, param);

      if (endpoint === 'now') {
        return jsonOK(res, {
          on:       schedule[curHour],
          price:    hourlyPrices[curHour],
          hour:     curHour,
          area,
          mode,
          strategy,
        });
      }

      return jsonOK(res, {
        area, mode, strategy, param, date: dateStr,
        on_now: schedule[curHour],
        schedule: hourlyPrices.map((price, hour) => ({ hour, price, on: schedule[hour] })),
      });
    }

    jsonErr(res, 404, 'Unknown endpoint. Available: /api/now  /api/prices  /api/schedule');
  } catch (err) {
    console.error('API error:', err);
    jsonErr(res, 500, err.message);
  }
}

function jsonOK(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}
function jsonErr(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: msg }));
}

// ── static file server ────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',   '.json': 'application/json',
  '.png': 'image/png',  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let fp = path.join(__dir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fp.startsWith(__dir)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dir, 'index.html'), (e2, d) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
}

// ── server ────────────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  const pu = url.parse(req.url, true);
  if (pu.pathname.startsWith('/api/shelly/')) return handleShellyTariff(req, res, pu);
  if (pu.pathname.startsWith('/api/')) return handleAPI(req, res, pu);
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`\n⚡ Elpris server → http://localhost:${PORT}`);
  console.log(`\nAPI endpoints:`);
  console.log(`  /api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6`);
  console.log(`  /api/prices?area=DK1&mode=inkl_alt`);
  console.log(`  /api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6`);
  console.log(`  Add &gln=<GLN_NUMBER> for net_inkl_alt / net_inkl_tarif modes`);
  console.log(`\nShelly Live Tariff (Tibber-compatible):`);
  console.log(`  /api/shelly/tariff?area=DK1&mode=inkl_alt`);
  console.log(`  /api/shelly/tariff?area=DK1&mode=net_inkl_alt&gln=5790001089030  (N1)\n`);
});
