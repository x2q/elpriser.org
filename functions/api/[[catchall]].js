/**
 * Cloudflare Pages Function — handles all /api/* routes
 *
 * Endpoints:
 *   /api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...]
 *   /api/prices?area=DK1&mode=inkl_alt[&gln=...][&date=YYYY-MM-DD]
 *   /api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...][&date=YYYY-MM-DD]
 *   /api/shelly/tariff?area=DK1&mode=inkl_alt[&gln=...]   → Tibber-compatible JSON
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function fail(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Danish timezone helpers ───────────────────────────────────────────────────
// Workers run in UTC. Denmark uses CET (UTC+1) in winter, CEST (UTC+2) in summer.
// Transition: last Sunday in March 02:00 CET → 03:00 CEST (01:00 UTC)
//             last Sunday in October 03:00 CEST → 02:00 CET (01:00 UTC)

function lastSunOfMonth(y, mo) {
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();   // last day of month
  const dow  = new Date(Date.UTC(y, mo - 1, last)).getUTCDay(); // 0=Sun
  return last - dow;
}

/** Given a UTC date-string + UTC hour, return the Danish UTC offset (1 or 2). */
function danishOffset(utcDateStr, utcHour) {
  const [y, m, d] = utcDateStr.split('-').map(Number);
  const sunMar = lastSunOfMonth(y, 3);
  const sunOct = lastSunOfMonth(y, 10);
  // Spring forward: last-Sun-Mar at 01:00 UTC; Fall back: last-Sun-Oct at 01:00 UTC
  const afterSpring = m > 3 || (m === 3 && (d > sunMar || (d === sunMar && utcHour >= 1)));
  const beforeFall  = m < 10 || (m === 10 && (d < sunOct || (d === sunOct && utcHour < 1)));
  return (afterSpring && beforeFall) ? 2 : 1;
}

/** Format a Date as YYYY-MM-DD using its UTC fields. */
function fmtUTC(d) {
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/** Return a Date adjusted to Danish local time (for extracting local date/hour). */
function danishNow() {
  const utc = new Date();
  const off = danishOffset(fmtUTC(utc), utc.getUTCHours());
  return new Date(utc.getTime() + off * 3_600_000);
}

/**
 * Format an ISO-8601 timestamp for a Danish local hour on a given date.
 * localHour is in 0-23 Danish local time.
 */
function isoWithOffset(dateStr, localHour) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const sunMar = lastSunOfMonth(y, 3);
  const sunOct = lastSunOfMonth(y, 10);
  // Determine if this local hour is in CEST or CET
  const inSummer =
    (m > 3 || (m === 3 && (d > sunMar || (d === sunMar && localHour >= 2)))) &&
    (m < 10 || (m === 10 && (d < sunOct || (d === sunOct && localHour < 3))));
  const off = inSummer ? 2 : 1;
  return `${dateStr}T${String(localHour).padStart(2, '0')}:00:00+0${off}:00`;
}

// ── Energi Data Service fetchers ──────────────────────────────────────────────

async function fetchSpotPrices(area, start, end) {
  const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
  const res = await fetch(
    `https://api.energidataservice.dk/dataset/DayAheadPrices` +
    `?start=${start}&end=${end}&filter=${f}&sort=TimeDK%20asc&limit=0`
  );
  const j = await res.json();
  // TimeDK is Danish local time. In Workers (UTC), parsing it without 'Z' treats it
  // as UTC — but the date and hour NUMBERS extracted are still the correct Danish values.
  const g = {};
  for (const r of (j.records || [])) {
    const dt = new Date(r.TimeDK);
    const dk = fmtUTC(dt);         // date portion of TimeDK string
    const h  = dt.getUTCHours();   // hour portion of TimeDK string
    (g[dk] ??= {})[h] ??= [];
    g[dk][h].push(r.DayAheadPriceDKK);
  }
  const out = {};
  for (const dk in g) {
    out[dk] = {};
    for (const h in g[dk]) {
      const v = g[dk][h];
      out[dk][h] = v.reduce((a, b) => a + b, 0) / v.length;
    }
  }
  return out;
}

async function fetchEnCharges() {
  const GLN = '5790000432752';
  const f = encodeURIComponent(JSON.stringify({
    GLN_Number: GLN, ChargeType: 'D03', ResolutionDuration: 'P1D',
  }));
  const defaults = { sys: 0.072, trans: 0.043, afg: 0.008 };
  try {
    const res = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=20&columns=ChargeTypeCode,ValidFrom,ValidTo,Price1`
    );
    const j = await res.json();
    const now = new Date(), c = { ...defaults };
    for (const r of (j.records || [])) {
      if (new Date(r.ValidFrom) > now) continue;
      if (r.ValidTo && new Date(r.ValidTo) < now) continue;
      if      (r.ChargeTypeCode === '41000')  c.sys   = r.Price1 || 0;
      else if (r.ChargeTypeCode === '40000')  c.trans = r.Price1 || 0;
      else if (r.ChargeTypeCode === 'EA-001') c.afg   = r.Price1 || 0;
    }
    return c;
  } catch { return defaults; }
}

async function fetchTariffRecords(gln) {
  const f = encodeURIComponent(JSON.stringify({
    GLN_Number: gln, ChargeType: 'D03', Note: 'Nettarif C',
  }));
  const cols = 'ValidFrom,ValidTo,ResolutionDuration,' +
    Array.from({ length: 24 }, (_, i) => 'Price' + (i + 1)).join(',');
  try {
    const res = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=10&columns=${cols}`
    );
    const j = await res.json();
    const now = new Date(), horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() + 3);
    const records = [];
    for (const r of (j.records || [])) {
      if (r.ResolutionDuration !== 'PT1H') continue;
      if (new Date(r.ValidFrom) > horizon) continue;
      if (r.ValidTo && new Date(r.ValidTo) <= now) continue;
      records.push({
        fromStr: r.ValidFrom.slice(0, 10),
        toStr:   r.ValidTo ? r.ValidTo.slice(0, 10) : null,
        hourly:  Array.from({ length: 24 }, (_, i) => r['Price' + (i + 1)] || 0),
      });
    }
    return records;
  } catch { return []; }
}

/** Timezone-safe tariff lookup using YYYY-MM-DD string comparison. */
function getTariffHourly(records, dateStr) {
  for (const r of records) {
    if (r.fromStr > dateStr) continue;
    if (r.toStr && r.toStr <= dateStr) continue;
    return r.hourly;
  }
  return Array(24).fill(0);
}

// ── Price conversion ──────────────────────────────────────────────────────────

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

// ── Schedule strategy ─────────────────────────────────────────────────────────

function computeSchedule(prices, strategy, param) {
  const valid = prices.map((p, h) => ({ h, p })).filter(x => x.p !== null);
  const on = Array(24).fill(false);
  if (strategy === 'cheapest_n') {
    const n = Math.min(Math.max(1, +param), valid.length);
    [...valid].sort((a, b) => a.p - b.p).slice(0, n).forEach(x => on[x.h] = true);
  } else if (strategy === 'cheapest_pct') {
    const n = Math.max(1, Math.round(valid.length * (+param / 100)));
    [...valid].sort((a, b) => a.p - b.p).slice(0, n).forEach(x => on[x.h] = true);
  } else if (strategy === 'avoid_expensive_n') {
    const n = Math.min(Math.max(1, +param), valid.length);
    const expensive = new Set([...valid].sort((a, b) => b.p - a.p).slice(0, n).map(x => x.h));
    for (const x of valid) on[x.h] = !expensive.has(x.h);
  } else if (strategy === 'avoid_expensive_pct') {
    const n = Math.max(1, Math.round(valid.length * (+param / 100)));
    const expensive = new Set([...valid].sort((a, b) => b.p - a.p).slice(0, n).map(x => x.h));
    for (const x of valid) on[x.h] = !expensive.has(x.h);
  } else if (strategy === 'avoid_peak') {
    for (let h = 0; h < 24; h++) on[h] = (h < 17 || h >= 21);
  } else if (strategy === 'night_cheap') {
    for (let h = 0; h < 24; h++) on[h] = (h >= 23 || h < 6);
  }
  return on;
}

// ── Price levels (Tibber quintile scale) ─────────────────────────────────────

function priceLevels(prices) {
  const valid = prices.filter(p => p !== null && p !== undefined);
  if (!valid.length) return prices.map(() => 'NORMAL');
  const sorted = [...valid].sort((a, b) => a - b);
  const at = f => sorted[Math.min(Math.floor(sorted.length * f), sorted.length - 1)];
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

// ── In-memory cache (per Worker isolate) ─────────────────────────────────────

const _cache = new Map();
function cached(key, ttlMs, fn) {
  const now = Date.now(), e = _cache.get(key);
  if (e && now - e.ts < ttlMs) return Promise.resolve(e.v);
  return fn().then(v => { _cache.set(key, { ts: now, v }); return v; });
}

// ── Shared data loader ────────────────────────────────────────────────────────

async function loadData(area, mode, gln) {
  const now = new Date();
  const s = new Date(now); s.setUTCDate(s.getUTCDate() - 1);
  const e = new Date(now); e.setUTCDate(e.getUTCDate() + 2);
  const needsEn    = !['spot_ex', 'spot_inkl'].includes(mode);
  const needsTarif = mode.startsWith('net_') && gln;
  const [priceData, enCharges, tariffRecords] = await Promise.all([
    cached(`prices-${area}-${fmtUTC(s)}-${fmtUTC(e)}`, 5 * 60_000,
      () => fetchSpotPrices(area, fmtUTC(s), fmtUTC(e))),
    needsEn
      ? cached('encharges', 60 * 60_000, fetchEnCharges)
      : Promise.resolve({ sys: 0, trans: 0, afg: 0 }),
    needsTarif
      ? cached(`tariff-${gln}`, 60 * 60_000, () => fetchTariffRecords(gln))
      : Promise.resolve([]),
  ]);
  return { priceData, enCharges, tariffRecords };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const u    = new URL(request.url);
  const q    = u.searchParams;
  const area = (q.get('area') || 'DK1').toUpperCase();
  if (!['DK1', 'DK2'].includes(area)) return fail(400, 'area must be DK1 or DK2');

  const mode = q.get('mode') || 'inkl_alt';
  const gln  = q.get('gln')  || null;

  // Path segments after leading slash, e.g. /api/shelly/tariff → ['api','shelly','tariff']
  const parts = u.pathname.split('/').filter(Boolean);
  const seg1  = parts[1]; // 'now' | 'prices' | 'schedule' | 'shelly'
  const seg2  = parts[2]; // 'tariff' (when seg1==='shelly')

  // ── /api/forecast ───────────────────────────────────────────────────────
  if (seg1 === 'forecast') {
    try {
      return await handleForecast(area, mode);
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  try {
    const { priceData, enCharges, tariffRecords } = await loadData(area, mode, gln);

    const dkNow   = danishNow();
    const today   = fmtUTC(dkNow);
    const curHour = dkNow.getUTCHours(); // Danish local hour

    // ── /api/shelly/tariff ──────────────────────────────────────────────────
    if (seg1 === 'shelly' && seg2 === 'tariff') {
      const tomorrow = fmtUTC(new Date(dkNow.getTime() + 86_400_000));

      function makeEntries(dateStr) {
        const tariffH = (mode.startsWith('net_') && gln)
          ? getTariffHourly(tariffRecords, dateStr) : null;
        const prices = Array.from({ length: 24 }, (_, h) => {
          const raw = (priceData[dateStr] || {})[h];
          return raw === undefined ? null : +cvt(raw, h, mode, enCharges, tariffH).toFixed(4);
        });
        const levels = priceLevels(prices);
        return prices
          .map((total, hour) => total === null ? null : {
            total,
            startsAt: isoWithOffset(dateStr, hour),
            currency: 'DKK',
            level:    levels[hour],
          })
          .filter(Boolean);
      }

      return ok({
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  today:    makeEntries(today),
                  tomorrow: makeEntries(tomorrow),
                },
              },
            }],
          },
        },
      });
    }

    // ── /api/prices | /api/now | /api/schedule ──────────────────────────────
    const dateStr  = q.get('date') || today;
    const tariffH  = (mode.startsWith('net_') && gln)
      ? getTariffHourly(tariffRecords, dateStr) : null;

    const hourlyPrices = Array.from({ length: 24 }, (_, h) => {
      const raw = (priceData[dateStr] || {})[h];
      return raw === undefined ? null : +cvt(raw, h, mode, enCharges, tariffH).toFixed(4);
    });

    if (seg1 === 'prices') {
      return ok({
        area, mode, date: dateStr, unit: 'DKK/kWh',
        prices: hourlyPrices.map((price, hour) => ({ hour, price })),
        current_hour:  curHour,
        current_price: hourlyPrices[curHour],
      });
    }

    const strategy = q.get('strategy') || 'cheapest_n';
    const param    = +(q.get('hours') ?? q.get('pct') ?? 6);
    const schedule = computeSchedule(hourlyPrices, strategy, param);

    if (seg1 === 'now') {
      return ok({
        on:       schedule[curHour],
        price:    hourlyPrices[curHour],
        hour:     curHour,
        area, mode, strategy,
      });
    }

    if (seg1 === 'schedule') {
      return ok({
        area, mode, strategy, param, date: dateStr,
        on_now:   schedule[curHour],
        schedule: hourlyPrices.map((price, hour) => ({ hour, price, on: schedule[hour] })),
      });
    }

    return fail(404, 'Unknown endpoint. Try /api/now  /api/prices  /api/schedule  /api/forecast  /api/shelly/tariff');
  } catch (e) {
    console.error(e);
    return fail(500, String(e.message || e));
  }
}

// ── Forecast endpoint ────────────────────────────────────────────────────────

async function fetchHistoricalPrices(area, startDate, endDate) {
  const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
  const res = await fetch(
    `https://api.energidataservice.dk/dataset/DayAheadPrices` +
    `?start=${startDate}&end=${endDate}&filter=${f}&sort=TimeDK%20asc&limit=0`
  );
  const j = await res.json();
  // Group by date → hour → average price (DKK/MWh)
  const g = {};
  for (const r of (j.records || [])) {
    const dt = new Date(r.TimeDK);
    const dk = fmtUTC(dt);
    const h  = dt.getUTCHours();
    (g[dk] ??= {})[h] ??= [];
    g[dk][h].push(r.DayAheadPriceDKK);
  }
  const out = {};
  for (const dk in g) {
    out[dk] = {};
    for (const h in g[dk]) {
      const v = g[dk][h];
      out[dk][h] = v.reduce((a, b) => a + b, 0) / v.length;
    }
  }
  return out;
}

// Fetch wind+solar from Energi Data Service (1-2 days ahead) + Open-Meteo (7 days)
async function fetchWeatherForecasts(area) {
  // Coordinates: DK1 = central Jutland, DK2 = central Zealand
  const coords = area === 'DK1' ? { lat: 56.0, lon: 9.5 } : { lat: 55.5, lon: 12.0 };

  const [edsData, meteoData] = await Promise.all([
    // Energi Data Service: actual production forecasts (MW) for 1-2 days
    (async () => {
      try {
        const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
        const res = await fetch(
          `https://api.energidataservice.dk/dataset/Forecasts_Hour` +
          `?filter=${f}&sort=HourDK%20desc&limit=200&columns=HourDK,ForecastType,ForecastDayAhead,ForecastCurrent`
        );
        const j = await res.json();
        const wind = {}, solar = {};
        for (const r of (j.records || [])) {
          const dt = new Date(r.HourDK);
          const dk = fmtUTC(dt);
          const h  = dt.getUTCHours();
          const key = `${dk}:${h}`;
          const val = r.ForecastDayAhead ?? r.ForecastCurrent ?? 0;
          if (r.ForecastType.includes('Wind')) wind[key] = (wind[key] || 0) + val;
          if (r.ForecastType === 'Solar') solar[key] = (solar[key] || 0) + val;
        }
        return { wind, solar };
      } catch { return { wind: {}, solar: {} }; }
    })(),
    // Open-Meteo: wind speed + solar radiation for 7 days (free, no key)
    (async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
          `&hourly=wind_speed_80m,direct_radiation&forecast_days=7&timezone=Europe/Copenhagen`
        );
        const j = await res.json();
        const times = j.hourly?.time || [];
        const wind = j.hourly?.wind_speed_80m || [];
        const solar = j.hourly?.direct_radiation || [];
        const result = {};
        for (let i = 0; i < times.length; i++) {
          // times[i] format: "2026-04-15T14:00"
          const dt = new Date(times[i]);
          const dk = fmtUTC(dt);
          const h  = dt.getUTCHours();
          result[`${dk}:${h}`] = { windSpeed: wind[i] || 0, solarRad: solar[i] || 0 };
        }
        return result;
      } catch { return {}; }
    })(),
  ]);

  // Merge: EDS production data takes priority for wind (MW), Open-Meteo fills gaps
  // For days beyond EDS range, convert Open-Meteo wind speed to estimated production
  // Rough conversion: DK1 ~150 MW per m/s average, DK2 ~80 MW per m/s
  const windMwPerMs = area === 'DK1' ? 150 : 80;
  const solarPeakMw = area === 'DK1' ? 3000 : 2000; // rough installed capacity

  const combined = {};
  // Collect all keys from both sources
  const allKeys = new Set([...Object.keys(edsData.wind), ...Object.keys(edsData.solar), ...Object.keys(meteoData)]);
  for (const key of allKeys) {
    const edsWind = edsData.wind[key];
    const edsSolar = edsData.solar[key];
    const meteo = meteoData[key];

    // Wind: prefer EDS production forecast (MW), fallback to Open-Meteo estimate
    const windMw = edsWind !== undefined ? edsWind
      : (meteo ? meteo.windSpeed * windMwPerMs : 0);

    // Solar: prefer EDS, fallback to Open-Meteo estimate
    // Convert W/m² radiation to estimated MW: radiation/1000 * capacity * efficiency
    const solarMw = edsSolar !== undefined ? edsSolar
      : (meteo ? (meteo.solarRad / 1000) * solarPeakMw * 0.15 : 0);

    combined[key] = { wind: windMw, solar: solarMw, total: windMw + solarMw };
  }
  return combined;
}

function buildForecast(historicalPrices, weatherForecasts, area, mode, enCharges) {
  const dkNow = danishNow();
  const today = fmtUTC(dkNow);
  const dates = Object.keys(historicalPrices).sort();

  // Find which dates have actual data for today/tomorrow
  const tomorrow = fmtUTC(new Date(dkNow.getTime() + 86_400_000));
  const hasToday = historicalPrices[today] && Object.keys(historicalPrices[today]).length > 12;
  const hasTomorrow = historicalPrices[tomorrow] && Object.keys(historicalPrices[tomorrow]).length > 12;

  // Build historical averages by weekday + hour (last 28 days)
  // Weight recent week 2x vs older weeks
  const weekdayHourSums = {};  // {weekday: {hour: {wSum, wCount, min, max}}}
  const sevenDaysAgo = fmtUTC(new Date(dkNow.getTime() - 7 * 86_400_000));

  for (const d of dates) {
    if (d >= today) continue; // Don't include today/future in historical
    const dt = new Date(d);
    const wd = dt.getUTCDay(); // 0=Sun
    const weight = d >= sevenDaysAgo ? 2 : 1;
    for (let h = 0; h < 24; h++) {
      const raw = historicalPrices[d]?.[h];
      if (raw === undefined) continue;
      const p = cvtForecast(raw, h, mode, enCharges);
      if (!weekdayHourSums[wd]) weekdayHourSums[wd] = {};
      if (!weekdayHourSums[wd][h]) weekdayHourSums[wd][h] = { wSum: 0, wCount: 0, min: Infinity, max: -Infinity };
      const s = weekdayHourSums[wd][h];
      s.wSum += p * weight;
      s.wCount += weight;
      s.min = Math.min(s.min, p);
      s.max = Math.max(s.max, p);
    }
  }

  // Build 7-day output
  const days = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const d = fmtUTC(new Date(dkNow.getTime() + dayOffset * 86_400_000));
    const isActual = (dayOffset === 0 && hasToday) || (dayOffset === 1 && hasTomorrow);

    const prices = [];
    for (let h = 0; h < 24; h++) {
      if (isActual) {
        const raw = historicalPrices[d]?.[h];
        if (raw !== undefined) {
          prices.push({ hour: h, price: +cvtForecast(raw, h, mode, enCharges).toFixed(4) });
        } else {
          prices.push({ hour: h, price: null });
        }
      } else {
        const dt = new Date(d);
        const wd = dt.getUTCDay();
        const stats = weekdayHourSums[wd]?.[h];
        if (stats && stats.wCount > 0) {
          let forecast = stats.wSum / stats.wCount;

          // Weather correction: wind + solar production reduces prices
          const wKey = `${d}:${h}`;
          const weather = weatherForecasts[wKey];
          if (weather && weather.total > 0) {
            // More renewable production → lower prices
            // Baseline: typical combined wind+solar production
            const baseline = area === 'DK1' ? 3000 : 1800;
            const ratio = weather.total / baseline;
            // Cap adjustment between 0.6x and 1.4x
            const adj = Math.max(0.6, Math.min(1.4, 1 / Math.sqrt(ratio)));
            forecast *= adj;
          }

          prices.push({
            hour: h,
            price: +forecast.toFixed(4),
            min: +stats.min.toFixed(4),
            max: +stats.max.toFixed(4),
          });
        } else {
          prices.push({ hour: h, price: null });
        }
      }
    }

    days.push({
      date: d,
      type: isActual ? 'actual' : 'forecast',
      weekday: new Date(d).getUTCDay(),
      prices,
    });
  }

  return days;
}

/** Simplified cvt for forecast — uses mode + enCharges but no tariff (too variable per user) */
function cvtForecast(dkkMwh, h, mode, en) {
  const spot = dkkMwh / 1000;
  switch (mode) {
    case 'spot_ex':        return spot;
    case 'spot_inkl':      return spot * 1.25;
    case 'inkl_alt':       return (spot + en.sys + en.trans + en.afg) * 1.25;
    case 'inkl_alt_minus': return (spot + en.sys + en.trans) * 1.25;
    default:               return spot * 1.25;
  }
}

async function handleForecast(area, mode) {
  const dkNow = danishNow();
  const start = new Date(dkNow.getTime() - 28 * 86_400_000);
  const end   = new Date(dkNow.getTime() + 2 * 86_400_000); // Include tomorrow

  const [historicalPrices, weatherForecasts, enCharges] = await Promise.all([
    cached(`forecast-prices-${area}-${fmtUTC(start)}-${fmtUTC(end)}`, 30 * 60_000,
      () => fetchHistoricalPrices(area, fmtUTC(start), fmtUTC(end))),
    cached(`forecast-weather-${area}`, 30 * 60_000,
      () => fetchWeatherForecasts(area)),
    cached('encharges', 60 * 60_000, fetchEnCharges),
  ]);

  const days = buildForecast(historicalPrices, weatherForecasts, area, mode, enCharges);

  return ok({
    area,
    mode,
    generated: new Date().toISOString(),
    days,
  });
}
