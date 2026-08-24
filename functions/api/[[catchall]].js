/**
 * Cloudflare Pages Function — handles all /api/* routes
 *
 * Endpoints:
 *   /api/now?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...]
 *   /api/now?area=DK1&strategy=smart&hours=4&max_off=2[&gln=...]
 *   /api/prices?area=DK1&mode=inkl_alt[&gln=...][&date=YYYY-MM-DD]
 *   /api/prices?area=DK1&start=YYYY-MM-DD&end=YYYY-MM-DD   (range, max 1150 days)
 *   /api/schedule?area=DK1&mode=inkl_alt&strategy=cheapest_n&hours=6[&gln=...][&date=YYYY-MM-DD]
 *   /api/shelly/tariff?area=DK1&mode=inkl_alt[&gln=...]   → Tibber-compatible JSON
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Discoverability: every /api/* response points machines at the OpenAPI spec.
  // RFC 8631 + many tool ecosystems (Postman, MCP, ChatGPT plugins) consume this.
  'Link': '</api/openapi.json>; rel="describedby"; type="application/json"',
};

// ── Conditional-request (ETag) JSON responder ───────────────────────────────
// Day-ahead prices are immutable once published; the only reason to transfer
// the body again is when the data has actually changed. We derive a weak ETag
// from the body and honour `If-None-Match`, so a client/CDN that already has
// the current data gets an empty `304 Not Modified` instead of a re-download.
// `maxAge` (seconds) is how long the browser may serve from its own cache
// before even revalidating — tune per endpoint to "time until data can change".

// Fast, stable 32-bit string hash (FNV-1a) for ETag generation.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Build a cache-aware JSON response.
 * @param data       any JSON-serialisable value
 * @param opts.maxAge browser cache seconds (default 0 → always revalidate)
 * @param opts.sMaxAge edge cache seconds (defaults to maxAge)
 * @param opts.request the incoming Request — enables 304 when If-None-Match hits
 * @param opts.pretty  2-space indent (default true, matches old `ok()`)
 */
function jsonResponse(data, opts = {}) {
  const { maxAge = 0, request = null, pretty = true } = opts;
  const sMaxAge = opts.sMaxAge != null ? opts.sMaxAge : maxAge;
  const body = JSON.stringify(data, null, pretty ? 2 : 0);
  const etag = `"${hash32(body)}"`;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}`,
    'ETag': etag,
    ...CORS,
  };
  // Conditional request — client already has this exact data.
  const inm = request && request.headers.get('if-none-match');
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}

function fail(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/**
 * Turn an upstream failure into an honest status. Energinet answers a rate
 * limit with HTTP 200 and a statusCode in the body, so without this the caller
 * would see either a 500 (their request was fine) or, worse, an empty result
 * cached as though the market had no prices that day.
 */
function upstreamFail(e) {
  if (e && e.upstreamStatus === 429) {
    const res = fail(503, `Upstream rate limit (Energi Data Service). ${e.message}`);
    if (e.retryAfter) res.headers.set('Retry-After', String(e.retryAfter));
    return res;
  }
  return fail(500, String((e && e.message) || e));
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

// ── Cache-freshness windows ──────────────────────────────────────────────────
// Day-ahead prices for the next day are published around 13:00 (CET/CEST) and
// are immutable until the next day's publication. So there is genuinely no new
// data to fetch between publications — we cache until the next ~13:00 window.

/** Seconds until the next 13:00 Danish local time (clamped 5 min … 6 h). */
function secondsUntilNextPublish() {
  const dk  = danishNow(); // DK-local components readable via UTC getters
  const sec = dk.getUTCHours() * 3600 + dk.getUTCMinutes() * 60 + dk.getUTCSeconds();
  const target = 13 * 3600;
  const delta  = sec < target ? target - sec : (86400 - sec) + target;
  return Math.max(300, Math.min(delta, 6 * 3600));
}

/**
 * Cache lifetime for a price range ending at `end` (exclusive, YYYY-MM-DD).
 * A range that ends at or before today is settled history — those prices were
 * fixed at auction years ago and will never change, so it can be held for a
 * day. Anything reaching into tomorrow is waiting on the next publication.
 */
function priceTtl(end) {
  return end <= fmtUTC(new Date()) ? 86400 : secondsUntilNextPublish();
}

/** Seconds until the top of the next hour (clamped 30 s … 1 h). Used where the
 *  response depends on the current hour (e.g. /api/now's current price). */
function secondsUntilNextHour() {
  const d = new Date();
  return Math.max(30, Math.min(3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds()), 3600));
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

// Energinet split the day-ahead price into two datasets when the market moved
// to 15-minute resolution. Neither one covers the whole history:
//
//   Elspotprices    2000-01-01 .. 2025-09-30   hourly
//   DayAheadPrices  2025-10-01 .. tomorrow     15-minute
//
// Asking DayAheadPrices for 2024 does not fail — it returns an empty record
// list — so a range that crosses the boundary silently loses everything before
// it. Any range query has to be split and both halves fetched.
const PRICE_DATASET_SWITCH = '2025-10-01';

// Elspotprices starts at 2000-01-01. Requests before that are a caller
// mistake, not an empty market, and are worth saying so explicitly.
const EARLIEST_PRICE_DATE = '2000-01-01';
// Three years plus a leap day of headroom — enough for the longest range the
// site itself offers, while keeping a single response bounded.
const MAX_RANGE_DAYS = 1150;

/** Normalise an Elspotprices row to the DayAheadPrices field names, so callers
 *  see one schema regardless of which side of the boundary a row came from. */
function normaliseElspot(r) {
  return {
    TimeUTC: r.HourUTC,
    TimeDK: r.HourDK,
    PriceArea: r.PriceArea,
    DayAheadPriceEUR: r.SpotPriceEUR,
    DayAheadPriceDKK: r.SpotPriceDKK,
  };
}

async function fetchEdsDataset(dataset, area, start, end) {
  const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
  const sortCol = dataset === 'Elspotprices' ? 'HourDK' : 'TimeDK';
  const res = await fetch(
    `https://api.energidataservice.dk/dataset/${dataset}` +
    `?start=${start}&end=${end}&filter=${f}&sort=${sortCol}%20asc&limit=0`
  );
  const j = await res.json();
  // EDS answers rate limits with a 200 and a statusCode body, not an HTTP
  // error — treat that as a failure so the caller's backup path can run
  // instead of caching an empty range as though it were genuinely empty.
  if (j.statusCode && j.statusCode >= 400) {
    const err = new Error(`EDS ${dataset} ${j.statusCode}: ${j.message || 'error'}`);
    // Carried so the route can answer 503 + Retry-After instead of a flat 500:
    // upstream throttling is temporary and the caller should be told to wait,
    // not told their request was wrong.
    err.upstreamStatus = j.statusCode;
    const wait = /in (\d+) seconds/.exec(j.message || '');
    if (wait) err.retryAfter = +wait[1];
    throw err;
  }
  const rows = j.records || [];
  return dataset === 'Elspotprices' ? rows.map(normaliseElspot) : rows;
}

/** Day-ahead price records for [start, end), spanning both datasets. */
async function fetchPriceRecords(area, start, end) {
  const parts = [];
  if (start < PRICE_DATASET_SWITCH) {
    parts.push(fetchEdsDataset('Elspotprices', area, start,
                               end < PRICE_DATASET_SWITCH ? end : PRICE_DATASET_SWITCH));
  }
  if (end > PRICE_DATASET_SWITCH) {
    parts.push(fetchEdsDataset('DayAheadPrices', area,
                               start > PRICE_DATASET_SWITCH ? start : PRICE_DATASET_SWITCH, end));
  }
  const chunks = await Promise.all(parts);
  return chunks.flat();
}

async function fetchSpotPrices(area, start, end) {
  const j = { records: await fetchPriceRecords(area, start, end) };
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

// Charge-type codes in Energinet's DatahubPricelist. EA-001 is the ordinary
// electricity duty; EA-002 is the reduced rate that applies to consumption
// above 4,000 kWh/year in homes with electric heating. They diverge enormously
// — 72.0 vs 0.8 øre/kWh in 2025 — so which one applies is not a rounding
// detail for a heat-pump customer, it is most of the bill.
const CHARGE_CODES = { '41000': 'sys', '40000': 'trans', 'EA-001': 'afg', 'EA-002': 'afgReduced' };

// Used only when DatahubPricelist cannot be reached. These are the rates in
// force at the time of writing, so they are right for today and wrong for any
// historical date — which is why a lookup failure must not silently pass for
// history. See chargesOn().
const CHARGE_FALLBACK = { sys: 0.072, trans: 0.043, afg: 0.008, afgReduced: 0.008 };

/**
 * Every system tariff, transmission tariff and electricity duty rate, with the
 * period each was in force.
 *
 * The previous version asked only for what was valid *now* and returned a
 * single set of numbers. That silently priced January 2025 at 2026's duty of
 * 0.8 øre/kWh instead of the 72 øre actually levied — understating the cost of
 * every historical hour by about 0.9 kr/kWh including VAT.
 */
async function fetchChargeHistory() {
  const GLN = '5790000432752';
  const f = encodeURIComponent(JSON.stringify({
    GLN_Number: GLN, ChargeTypeCode: Object.keys(CHARGE_CODES),
  }));
  const out = { sys: [], trans: [], afg: [], afgReduced: [] };
  const res = await fetch(
    `https://api.energidataservice.dk/dataset/DatahubPricelist` +
    `?filter=${f}&sort=ValidFrom%20asc&limit=0&columns=ChargeTypeCode,ValidFrom,ValidTo,Price1`
  );
  const j = await res.json();
  if (j.statusCode && j.statusCode >= 400) {
    throw new Error(`EDS DatahubPricelist ${j.statusCode}: ${j.message || 'error'}`);
  }
  for (const r of (j.records || [])) {
    const key = CHARGE_CODES[r.ChargeTypeCode];
    if (!key) continue;
    out[key].push({
      from: r.ValidFrom.slice(0, 10),
      to: r.ValidTo ? r.ValidTo.slice(0, 10) : null,
      price: r.Price1 || 0,
    });
  }
  // Newest first, so the first match in chargesOn() is the most specific one.
  for (const k in out) out[k].sort((a, b) => (a.from < b.from ? 1 : -1));
  return out;
}

function pickRate(list, dateStr, fallback) {
  for (const r of list) {
    if (r.from > dateStr) continue;
    if (r.to && r.to <= dateStr) continue;
    return r.price;
  }
  return fallback;
}

/**
 * The charges that applied on `dateStr`.
 *
 * `useToday` answers "what would this price curve cost under today's taxes",
 * which is a legitimate question when comparing years, but it is not what the
 * hour actually cost. Historical rates are the default for that reason.
 */
function chargesOn(history, dateStr, { reduced = false, useToday = false } = {}) {
  if (!history) return { sys: CHARGE_FALLBACK.sys, trans: CHARGE_FALLBACK.trans, afg: CHARGE_FALLBACK.afg };
  const on = useToday ? fmtUTC(new Date()) : dateStr;
  return {
    sys: pickRate(history.sys, on, CHARGE_FALLBACK.sys),
    trans: pickRate(history.trans, on, CHARGE_FALLBACK.trans),
    afg: reduced
      ? pickRate(history.afgReduced, on, CHARGE_FALLBACK.afgReduced)
      : pickRate(history.afg, on, CHARGE_FALLBACK.afg),
  };
}

/**
 * A grid company's household tariff (Nettarif C) with its full hourly profile,
 * for every period overlapping [from, to].
 *
 * Two things the previous version got wrong, both of which erased history:
 *
 *   1. It dropped any record whose ValidTo had passed, so for a past date
 *      there was nothing left to match and the tariff silently became zero.
 *      A zero tariff is not visibly wrong — it just makes net_inkl_alt equal
 *      inkl_alt, which is how this went unnoticed.
 *   2. It took the 10 most recent records regardless of the dates asked for.
 *
 * There is deliberately no lower date bound. DatahubPricelist filters on
 * ValidFrom, so any window cuts off the record that was already in force when
 * the window opens. A generous lookback is not enough either: N1's area 016
 * has published the same flat tariff since 2023-02-01, so a query about 2025
 * needs to reach back two years to find it, and a company that never changes
 * its tariff would need an unbounded one. The full history for a single
 * company is at most a few hundred records — 222 KB for the largest — and it
 * is cached, so fetching all of it is cheaper than being subtly wrong.
 */
async function fetchTariffRecords(gln, to) {
  const f = encodeURIComponent(JSON.stringify({
    GLN_Number: gln, ChargeType: 'D03', Note: 'Nettarif C',
  }));
  const cols = 'ValidFrom,ValidTo,ChargeTypeCode,ResolutionDuration,' +
    Array.from({ length: 24 }, (_, i) => 'Price' + (i + 1)).join(',');
  // Three days past the end so a tariff published for tomorrow is available.
  const ahead = fmtUTC(new Date(Date.parse(to) + 3 * 86_400_000));
  try {
    const res = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?end=${ahead}&filter=${f}` +
      `&sort=ValidFrom%20desc&limit=0&columns=${cols}`
    );
    const j = await res.json();
    if (j.statusCode && j.statusCode >= 400) {
      const err = new Error(`EDS DatahubPricelist ${j.statusCode}: ${j.message || 'error'}`);
      err.upstreamStatus = j.statusCode;
      const wait = /in (\d+) seconds/.exec(j.message || '');
      if (wait) err.retryAfter = +wait[1];
      throw err;
    }
    const records = [];
    for (const r of (j.records || [])) {
      // Not every company publishes an hourly profile. Before time-of-use
      // tariffs became the norm — and still today for some areas — the tariff
      // is a single flat rate at P1D resolution, carried in Price1 alone.
      // Rejecting those left the company with no tariff at all rather than a
      // flat one: N1's area 016 gets its first hourly tariff on 2026-07-01,
      // so every earlier date silently priced at zero grid tariff.
      const hourly = r.ResolutionDuration === 'PT1H'
        ? Array.from({ length: 24 }, (_, i) => r['Price' + (i + 1)] || 0)
        : r.ResolutionDuration === 'P1D'
          ? Array(24).fill(r.Price1 || 0)
          : null;
      if (!hourly) continue;
      records.push({
        fromStr: r.ValidFrom.slice(0, 10),
        toStr:   r.ValidTo ? r.ValidTo.slice(0, 10) : null,
        code:    r.ChargeTypeCode,
        hourly,
        // Prefer an hourly profile when both resolutions cover the same date.
        rank:    r.ResolutionDuration === 'PT1H' ? 0 : 1,
      });
    }
    // Newest first, then by code, so a date covered by more than one charge
    // type resolves the same way every time. N1's area 344 publishes the same
    // tariff under two codes (flex- and template-settled) with identical
    // prices; picking arbitrarily would still be a latent inconsistency.
    records.sort((x, y) => (x.fromStr !== y.fromStr
      ? (x.fromStr < y.fromStr ? 1 : -1)
      : x.rank !== y.rank ? x.rank - y.rank
      : (x.code < y.code ? -1 : 1)));
    return records;
  } catch (e) {
    // Rethrown rather than swallowed into an empty list. An empty list now
    // means "this company published no tariff", which the response reports as
    // a null price — a claim we must not make because a request timed out.
    throw e;
  }
}

/**
 * The tariff in force on `dateStr`, or null if the company published none.
 *
 * Null rather than 24 zeros. A zero tariff is not distinguishable from a real
 * one in the output, so the old fallback turned "we have no data for this
 * company on this date" into "this company charged nothing" — which is how
 * net_inkl_alt came to equal inkl_alt for every historical date without
 * anything appearing to be wrong.
 */
function getTariffHourly(records, dateStr) {
  for (const r of records) {
    if (r.fromStr > dateStr) continue;
    if (r.toStr && r.toStr <= dateStr) continue;
    return { hourly: r.hourly, kind: r.rank === 0 ? 'hourly' : 'flat' };
  }
  return null;
}

// ── Price conversion ──────────────────────────────────────────────────────────

// The `_elvarme` variants are not separate formulas — they are the same sum
// with the reduced electricity duty substituted, which is resolved upstream in
// chargesOn(). Keeping that decision out of here means there is one place that
// knows which duty applies, rather than two that can disagree.
const PRICE_MODE_SET = new Set([
  'spot_ex', 'spot_inkl', 'inkl_alt', 'inkl_alt_elvarme', 'inkl_alt_minus',
  'net_inkl_alt', 'net_inkl_alt_elvarme', 'net_inkl_tarif',
]);

const usesReducedTax = mode => mode.endsWith('_elvarme');

function cvt(dkkMwh, h, mode, en, tariff) {
  const spot = dkkMwh / 1000;
  switch (mode) {
    case 'spot_ex':        return spot;
    case 'spot_inkl':      return spot * 1.25;
    case 'inkl_alt':
    case 'inkl_alt_elvarme':
      return (spot + en.sys + en.trans + en.afg) * 1.25;
    case 'inkl_alt_minus': return (spot + en.sys + en.trans) * 1.25;
    case 'net_inkl_alt':
    case 'net_inkl_alt_elvarme':
      return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans + en.afg) * 1.25;
    case 'net_inkl_tarif': return (spot + (tariff?.[h] ?? 0) + en.sys + en.trans) * 1.25;
    // Unreachable: the route rejects unknown modes. The old default returned
    // spot incl. VAT for anything it did not recognise, so a typo produced a
    // plausible number for a different quantity than the caller asked for.
    default:               throw new Error(`unknown mode ${mode}`);
  }
}

// ── Schedule strategy ─────────────────────────────────────────────────────────

function computeSchedule(prices, strategy, param, param2) {
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
  } else if (strategy === 'smart') {
    // Turn OFF the most expensive hours, but never more than `maxRun`
    // consecutive hours — protects fridges/freezers from warming up and
    // heat pumps / heated rooms from cooling down during pause windows.
    // Greedy: sort desc by price, mark OFF in turn, skip any hour whose
    // marking would extend a run beyond maxRun. Stops at `total` OFF hours.
    const total  = Math.min(Math.max(1, +param), valid.length);
    const maxRun = Math.max(1, +(param2 || 2));
    const off = Array(24).fill(false);
    const sorted = [...valid].sort((a, b) => b.p - a.p);
    let count = 0;
    for (const { h } of sorted) {
      if (count >= total) break;
      let runLeft = 0;
      for (let i = h - 1; i >= 0 && off[i]; i--) runLeft++;
      let runRight = 0;
      for (let i = h + 1; i < 24 && off[i]; i++) runRight++;
      if (runLeft + 1 + runRight <= maxRun) { off[h] = true; count++; }
    }
    // Default ON for hours without price data — safer for cooling appliances.
    for (let h = 0; h < 24; h++) on[h] = !off[h];
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

/**
 * Settled Danish prices, read from our own archive in Workers KV rather than
 * from Energi Data Service.
 *
 * One key per area per year, built by scripts/data_backup/build_price_archive.py
 * with the value already in the shape used here: date → 24 hourly DKK/MWh.
 * Reading years rather than days keeps a three-year pull at a handful of KV
 * reads instead of a thousand upstream requests.
 */
async function loadPriceArchive(area, from, to, env) {
  if (!env || !env.PRICE_CACHE) return {};
  const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const parts = await Promise.all(years.map(y =>
    env.PRICE_CACHE.get(`prices-archive-${area}-${y}`, 'json').catch(() => null)));
  const out = {};
  for (const part of parts) {
    if (!part) continue;
    for (const d in part) {
      if (d < from || d >= to) continue;
      const hours = part[d];
      const row = {};
      for (let h = 0; h < 24; h++) if (hours[h] !== null && hours[h] !== undefined) row[h] = hours[h];
      if (Object.keys(row).length) out[d] = row;
    }
  }
  return out;
}

/**
 * Prices for [from, to), preferring the archive and asking upstream only for
 * the days it does not hold — in practice the last day or two plus tomorrow.
 *
 * If upstream then fails, whatever the archive returned is still served. A
 * partial history beats a 500 for a caller who asked for three years and
 * needed 1,093 of those days to be exactly the settled numbers they already are.
 */
async function loadPrices(area, from, to, env) {
  const archive = await loadPriceArchive(area, from, to, env);

  const missing = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += 86_400_000) {
    const d = fmtUTC(new Date(t));
    if (!archive[d]) missing.push(d);
  }
  if (!missing.length) return archive;

  // Fetch one contiguous span covering the gaps rather than one call per day.
  const liveFrom = missing[0];
  const liveTo   = fmtUTC(new Date(Date.parse(missing[missing.length - 1]) + 86_400_000));
  try {
    const live = await edgeCached(`prices-${area}-${liveFrom}-${liveTo}`, priceTtl(liveTo),
      () => fetchSpotPrices(area, liveFrom, liveTo), env);
    return { ...archive, ...live };
  } catch (err) {
    if (Object.keys(archive).length) {
      console.error('upstream failed, serving archive only', err);
      return archive;
    }
    throw err;
  }
}

/**
 * Load prices plus the charges needed to convert them.
 *
 * `range` overrides the default yesterday..+2 window. It has to exist: `date`
 * used to be applied only as a lookup into that fixed window, so any date
 * outside it came back as 24 nulls with a 200 — indistinguishable from a day
 * the market genuinely never priced.
 */
async function loadData(area, mode, gln, env, range = null) {
  const now = new Date();
  const s = new Date(now); s.setUTCDate(s.getUTCDate() - 1);
  const e = new Date(now); e.setUTCDate(e.getUTCDate() + 2);
  const from = range ? range.start : fmtUTC(s);
  const to   = range ? range.end   : fmtUTC(e);
  const needsEn    = !['spot_ex', 'spot_inkl'].includes(mode);
  const needsTarif = mode.startsWith('net_') && gln;
  const [priceData, chargeHistory, tariffRecords] = await Promise.all([
    loadPrices(area, from, to, env),
    // The whole rate history is 49 records, so there is nothing to gain by
    // fetching a window of it — and caching it whole means a range spanning
    // several tax years costs one lookup, not one per year.
    needsEn
      ? cached('charge-history', 6 * 60 * 60_000, fetchChargeHistory)
      : Promise.resolve(null),
    // Keyed by the window as well as the company: a cache holding only the
    // current tariff must not answer a query about 2024.
    needsTarif
      ? cached(`tariff-${gln}-${to}`, 6 * 60 * 60_000,
               () => fetchTariffRecords(gln, to))
      : Promise.resolve([]),
  ]);
  return { priceData, chargeHistory, tariffRecords };
}

// ── OpenAPI 3.1 spec (served at /api/openapi.json) ───────────────────────────
//
// One source of truth for every endpoint. Consumed by ChatGPT plugins, MCP
// clients, Postman, Bruno, openapi-generator, and now LLMs that crawl us
// looking for tool descriptions. Keep in sync when adding/changing endpoints.

// Derived from the set the route validates against, so the spec cannot drift
// from what is actually accepted.
const PRICE_MODES = [...PRICE_MODE_SET];
const STRATEGIES  = ['cheapest_n', 'cheapest_pct', 'avoid_expensive_n', 'avoid_expensive_pct', 'avoid_peak', 'night_cheap', 'smart'];

const AREA_PARAM     = { name: 'area',     in: 'query', schema: { type: 'string', enum: ['DK1','DK2'], default: 'DK1' }, description: 'Danish price zone — DK1 (Vestdanmark) or DK2 (Østdanmark).' };
const MODE_PARAM     = { name: 'mode',     in: 'query', schema: { type: 'string', enum: PRICE_MODES, default: 'inkl_alt' }, description:
  'Which price to return. `spot_ex` raw spot; `spot_inkl` spot incl. VAT; '
  + '`inkl_alt` spot + system + transmission + electricity duty, incl. VAT; '
  + '`inkl_alt_minus` the same without the duty; `net_inkl_tarif` adds the grid '
  + 'tariff but no duty; `net_inkl_alt` is the full consumer price. The two '
  + '`_elvarme` variants substitute the reduced duty that applies above '
  + '4,000 kWh/year in electrically heated homes — 0.8 vs 72.0 øre/kWh in 2025. '
  + 'The `net_` modes require `gln`. An unknown mode is rejected rather than '
  + 'silently treated as spot incl. VAT.' };
const CHARGES_PARAM  = { name: 'charges',  in: 'query', schema: { type: 'string', enum: ['historical', 'current'], default: 'historical' }, description:
  'Which tax and tariff rates to apply to a historical date. `historical` (default) '
  + 'uses the rates actually in force on that date. `current` reprices the same '
  + 'spot curve under today\'s rates, answering "what would this cost now" — '
  + 'useful for comparing years, but not what the hour cost.' };
const GLN_PARAM      = { name: 'gln',      in: 'query', schema: { type: 'string' }, description: 'Net company GLN (13 digits). Required when mode is `net_inkl_alt` or `net_inkl_tarif`.' };
const STRATEGY_PARAM = { name: 'strategy', in: 'query', schema: { type: 'string', enum: STRATEGIES, default: 'cheapest_n' }, description: 'Schedule strategy. See /automation for descriptions.' };
const HOURS_PARAM    = { name: 'hours',    in: 'query', schema: { type: 'integer', minimum: 1, maximum: 23, default: 6 }, description: 'For strategies that take an hour count.' };
const PCT_PARAM      = { name: 'pct',      in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 }, description: 'For percentage-based strategies.' };
const DATE_PARAM     = { name: 'date',     in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD. Defaults to today (DK local). Any date from 2000-01-01 onwards.' };
const START_PARAM    = { name: 'start',    in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD. With `end`, returns every day in the range instead of one. Max 1150 days.' };
const END_PARAM      = { name: 'end',      in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD, inclusive. Must be given together with `start`.' };
const MAXOFF_PARAM   = { name: 'max_off',  in: 'query', schema: { type: 'integer', minimum: 1, maximum: 12 }, description: 'For `strategy=smart`: max consecutive OFF hours.' };

// The 13 Nordic + NL bidding zones served by /api/nordic. Kept here rather
// than derived, so an unknown zone is rejected with a useful message instead
// of turning into a KV miss.
const NORDIC_ZONES = ['dk1','dk2','no1','no2','no3','no4','no5','se1','se2','se3','se4','fi','nl'];
const NORDIC_ZONE_INFO = {
  dk1: { name: 'DK1 Vestdanmark',  country: 'DK', currency: 'DKK', rate: 7.46 },
  dk2: { name: 'DK2 Østdanmark',   country: 'DK', currency: 'DKK', rate: 7.46 },
  no1: { name: 'NO1 Oslo',         country: 'NO', currency: 'NOK', rate: 11.7 },
  no2: { name: 'NO2 Kristiansand', country: 'NO', currency: 'NOK', rate: 11.7 },
  no3: { name: 'NO3 Trondheim',    country: 'NO', currency: 'NOK', rate: 11.7 },
  no4: { name: 'NO4 Tromsø',       country: 'NO', currency: 'NOK', rate: 11.7 },
  no5: { name: 'NO5 Bergen',       country: 'NO', currency: 'NOK', rate: 11.7 },
  se1: { name: 'SE1 Luleå',        country: 'SE', currency: 'SEK', rate: 11.3 },
  se2: { name: 'SE2 Sundsvall',    country: 'SE', currency: 'SEK', rate: 11.3 },
  se3: { name: 'SE3 Stockholm',    country: 'SE', currency: 'SEK', rate: 11.3 },
  se4: { name: 'SE4 Malmö',        country: 'SE', currency: 'SEK', rate: 11.3 },
  fi:  { name: 'FI Finland',       country: 'FI', currency: 'EUR', rate: 1 },
  nl:  { name: 'NL Nederland',     country: 'NL', currency: 'EUR', rate: 1 },
};

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'elpriser.org API',
    version: '1.0',
    summary: 'Live Danish electricity prices, schedules, forecasts and Tibber-compatible JSON.',
    description: [
      'Free, public API serving aktuelle elpriser (current electricity prices) for the Danish',
      'price zones DK1 (Vestdanmark) and DK2 (Østdanmark). Data is sourced daily from Energi',
      'Data Service (Energinet) and updated when Nord Pool publishes next-day prices.',
      '',
      '**No key, no rate limit, full CORS** (`Access-Control-Allow-Origin: *`). Responses are',
      'edge-cached at Cloudflare for 1–5 min so calling /api/now every minute from a Shelly',
      'or Home Assistant is free and fine.',
      '',
      'Designed to be consumed by:',
      '- Browser apps (CORS-friendly JSON, no preflight needed for simple GETs)',
      '- Home automation (Shelly Plus/Pro scripts, Home Assistant REST sensors)',
      '- LLM agents (Tibber-compatible `/api/shelly/tariff` matches the schema Tibber publishes)',
      '- Smart-home aggregators (machine-readable spec at `/api/openapi.json`)',
    ].join('\n'),
    contact: { url: 'https://elpriser.org/api' },
    license: { name: 'Free for any use', url: 'https://elpriser.org/' },
  },
  servers: [{ url: 'https://elpriser.org', description: 'Production' }],
  externalDocs: { description: 'API documentation (Danish)', url: 'https://elpriser.org/api' },
  paths: {
    '/api/now': {
      get: {
        operationId: 'getCurrentPrice',
        summary: 'Current electricity price + on/off for a schedule',
        description: 'Returns the price for the current Danish-local hour and a boolean `on` indicating whether the chosen schedule strategy says the device should be ON right now.',
        parameters: [AREA_PARAM, MODE_PARAM, GLN_PARAM, STRATEGY_PARAM, HOURS_PARAM, PCT_PARAM, MAXOFF_PARAM],
        responses: { '200': {
          description: 'Current hour status.',
          content: { 'application/json': { example: { on: true, price: 1.23, hour: 14, area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n' } } }
        } },
      },
    },
    '/api/prices': {
      get: {
        operationId: 'getDailyPrices',
        summary: 'Hourly prices for one date, or for a date range',
        description: 'Historical prices back to 2000-01-01. Pass `date` for a single day, '
          + 'or `start` and `end` together for a range — up to 1150 days in one response, '
          + 'so three years costs one request rather than a thousand. '
          + 'On a range, `days[].prices` is null for a day the market never priced. '
          + 'Historical dates are priced with the taxes and grid tariffs that were in '
          + 'force on the date, including the tariff\'s time-of-day bands and its '
          + 'summer/winter split — see `charges` to reprice under today\'s rates instead. '
          + 'For `net_` modes each day carries `grid_tariff`: "hourly", "flat" for a '
          + 'company publishing a single daily rate, or null if it published none, in '
          + 'which case that day\'s prices are null rather than silently missing the tariff.',
        parameters: [AREA_PARAM, MODE_PARAM, GLN_PARAM, DATE_PARAM, START_PARAM, END_PARAM, CHARGES_PARAM],
        responses: {
          '200': {
            description: '24 hourly prices for the date, or a day-by-day list for a range.',
            content: { 'application/json': { example: { area: 'DK1', mode: 'inkl_alt', date: '2026-05-15', unit: 'DKK/kWh', prices: [{ hour: 0, price: 0.84 }, { hour: 1, price: 0.79 }], current_hour: 14, current_price: 1.23 } } }
          },
          '400': { description: 'Malformed date, `start` without `end`, range over 1150 days, or a date before 2000-01-01.' },
          '503': { description: 'Upstream (Energi Data Service) rate-limited or unavailable for days not yet in the archive. Carries Retry-After.' },
        },
      },
    },
    '/api/schedule': {
      get: {
        operationId: 'getSchedule',
        summary: 'Full 24h on/off schedule for a strategy',
        parameters: [AREA_PARAM, MODE_PARAM, GLN_PARAM, STRATEGY_PARAM, HOURS_PARAM, PCT_PARAM, MAXOFF_PARAM, DATE_PARAM],
        responses: { '200': {
          description: 'Hour-by-hour schedule.',
          content: { 'application/json': { example: { area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n', param: 6, date: '2026-05-15', on_now: true, schedule: [{ hour: 0, price: 0.84, on: true }, { hour: 1, price: 0.79, on: true }] } } }
        } },
      },
    },
    '/api/forecast': {
      get: {
        operationId: 'getForecast',
        summary: '10-day electricity price forecast',
        description: 'Actual day-ahead prices for today/tomorrow plus an ML forecast (LightGBM quantile model trained on lead-correct weather forecasts, price lags and DK+DE weather) for days 2-9, with calibrated min/max bands.',
        parameters: [AREA_PARAM, MODE_PARAM],
        responses: { '200': {
          description: '10 days × 24 hours of forecasted prices.',
          content: { 'application/json': { example: { area: 'DK1', mode: 'inkl_alt', generated: '2026-05-15T13:00:00Z', days: [{ date: '2026-05-15', type: 'actual', weekday: 5, prices: [{ hour: 0, price: 0.84 }] }] } } }
        } },
      },
    },
    '/api/shelly/tariff': {
      get: {
        operationId: 'getShellyTariff',
        summary: 'Tibber-compatible JSON for Shelly/HA',
        description: 'Returns today + tomorrow prices in the exact GraphQL response shape Tibber publishes, so any Tibber-aware integration works as a drop-in.',
        parameters: [AREA_PARAM, MODE_PARAM, GLN_PARAM],
        responses: { '200': { description: 'Tibber-compatible response.' } },
      },
    },
    '/api/raw/prices': {
      get: {
        operationId: 'getRawPrices',
        summary: 'Raw DayAheadPrices records (passthrough)',
        description: 'CORS-proxied passthrough to Energi Data Service `DayAheadPrices`. Use when you want the un-processed records (TimeUTC, TimeDK, PriceArea, DayAheadPriceDKK, DayAheadPriceEUR).',
        parameters: [AREA_PARAM, { name: 'start', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD inclusive.' }, { name: 'end', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD exclusive.' }],
        responses: { '200': { description: 'Records array.' } },
      },
    },
    '/api/raw/encharges': {
      get: {
        operationId: 'getRawEnCharges',
        summary: 'Energinet system/transmission/elafgift charges',
        responses: { '200': { description: 'Records array.' } },
      },
    },
    '/api/raw/co2': {
      get: {
        operationId: 'getRawCo2',
        summary: 'CO₂ emission per kWh (g/kWh), hourly, today + ~1 day ahead (Energinet CO2EmisProg)',
        parameters: [AREA_PARAM],
        responses: { '200': { description: '{area, unit, records: [{date, hour, co2}]}' } },
      },
    },
    '/api/raw/tariff': {
      get: {
        operationId: 'getRawNetTariff',
        summary: 'Single net company\'s Nettarif C (24 hourly values)',
        parameters: [{ ...GLN_PARAM, required: true }],
        responses: { '200': { description: 'Records array.' } },
      },
    },
    '/api/raw/tariffs': {
      get: {
        operationId: 'getRawAllTariffs',
        summary: 'All Danish net companies\' Nettarif C (used by /tariffer page)',
        responses: { '200': { description: 'Records array — ~48 KB.' } },
      },
    },
    '/api/supplierlookup': {
      get: {
        operationId: 'lookupSupplier',
        summary: 'Lat/lng → DK address → net company',
        description: 'Reverse-geocodes coordinates via DAWA and looks up the netselskab via GreenPowerDenmark. Proxied here because GPD returns no CORS headers.',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number' } },
        ],
        responses: { '200': {
          description: 'Address + resolved net name.',
          content: { 'application/json': { example: { address: 'Hasle Ringvej 110B, 8200 Aarhus N', name: 'KONSTANT Net A/S' } } }
        } },
      },
    },
    '/api/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        summary: 'This document',
        responses: { '200': { description: 'OpenAPI 3.1 spec.' } },
      },
    },
  },
};

// ── Main handler ──────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const u    = new URL(request.url);
  const q    = u.searchParams;

  // Path segments after leading slash, e.g. /api/shelly/tariff → ['api','shelly','tariff']
  const parts = u.pathname.split('/').filter(Boolean);
  const seg1  = parts[1]; // 'now' | 'prices' | 'schedule' | 'shelly' | 'openapi.json' | …
  const seg2  = parts[2]; // 'tariff' (when seg1==='shelly')

  // Plain `/api` (no sub-path) is the human-readable docs page. Pages Functions
  // don't chain across files, so we serve the modified index.html here.
  if (!seg1) {
    const indexUrl = new URL('/', request.url);
    const res = await context.env.ASSETS.fetch(indexUrl);
    let html = await res.text();
    const title = 'elpriser.org API — Gratis JSON API for danske elpriser';
    const desc  = 'Gratis public JSON API for danske elpriser (DK1 og DK2). Aktuel pris, 24h timepriser, 7-dages prognose, Tibber-kompatibel tariff. CORS-fri, ingen nøgle, OpenAPI 3.1 spec.';
    const url   = 'https://elpriser.org/api';
    // Server-side equivalent of the client router's classList.add('active') —
    // otherwise the crawlable HTML shows the homepage section under an "API" title.
    html = html.replace('<main data-page="start" class="active">', '<main data-page="start" class="">');
    html = html.replace('<main data-page="api" class="', '<main data-page="api" class="active ');
    html = html.replace(/<title>[^<]*<\/title>/,                         `<title>${title}</title>`);
    html = html.replace(/<meta name="description" content="[^"]*">/,    `<meta name="description" content="${desc}">`);
    html = html.replace(/<link rel="canonical" href="[^"]*">/,          `<link rel="canonical" href="${url}">`);
    html = html.replace(/<meta property="og:title" content="[^"]*">/,   `<meta property="og:title" content="${title}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta property="og:url" content="[^"]*">/,     `<meta property="og:url" content="${url}">`);
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/,  `<meta name="twitter:title" content="${title}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // ── /api/openapi.json — machine-readable API spec (served before area check) ─
  if (seg1 === 'openapi.json') {
    // Spec rarely changes — cache hard at the edge; ETag enables cheap 304s.
    return jsonResponse(OPENAPI_SPEC, { maxAge: 3600, sMaxAge: 86400, request });
  }

  // ── /api/tariffs — grid tariffs for NO and SE (before the DK area check,
  //    since these are not Danish price areas) ────────────────────────────
  if (seg1 === 'tariffs') {
    const country = (q.get('country') || '').toLowerCase();
    if (!['no', 'se'].includes(country)) {
      return fail(400, 'country must be no or se (Denmark uses /api/tariffs via the DataHub pricelist)');
    }
    if (!context.env || !context.env.PRICE_CACHE) return fail(503, 'tariff store unavailable');
    try {
      const raw = await context.env.PRICE_CACHE.get(`tariffs-${country}`, 'json');
      if (!raw) return fail(404, `no tariff data for ${country}`);
      // Tariffs move at most monthly (NO) or yearly (SE) — cache hard.
      return jsonResponse(raw, { maxAge: 6 * 3600, sMaxAge: 86400, request });
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  // ── /api/nordic — 13-zone forecast (served before the DK1/DK2 area check,
  //    since its zones are Nordic bidding zones, not Danish price areas) ───
  if (seg1 === 'nordic') {
    const zone = (q.get('zone') || 'dk1').toLowerCase();
    if (!NORDIC_ZONES.includes(zone)) {
      return fail(400, `zone must be one of: ${NORDIC_ZONES.join(', ')}`);
    }
    if (!context.env || !context.env.PRICE_CACHE) return fail(503, 'forecast store unavailable');
    try {
      const raw = await context.env.PRICE_CACHE.get(`nordic-forecast-${zone}`, 'json');
      if (!raw) return fail(404, `no forecast available for ${zone}`);
      return jsonResponse({ ...raw, zoneInfo: NORDIC_ZONE_INFO[zone] },
                          { maxAge: 1800, request });
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  const area = (q.get('area') || 'DK1').toUpperCase();
  if (!['DK1', 'DK2'].includes(area)) return fail(400, 'area must be DK1 or DK2');

  const mode = q.get('mode') || 'inkl_alt';
  if (!PRICE_MODE_SET.has(mode)) {
    return fail(400, `unknown mode "${mode}". Valid: ${[...PRICE_MODE_SET].join(', ')}`);
  }
  const gln  = q.get('gln')  || null;

  // Historical dates are priced with the taxes that were actually levied then.
  // `charges=current` reprices them under today's rates instead, which answers
  // "what would this curve cost now" — a different and also useful question,
  // but not what the hour cost.
  const chargeBasis = q.get('charges') || 'historical';
  if (!['historical', 'current'].includes(chargeBasis)) {
    return fail(400, 'charges must be historical or current');
  }

  // ── /api/forecast ───────────────────────────────────────────────────────
  // Checked before the gln requirement below: a forecast covers days that have
  // not happened, so it never applies a grid tariff and has no use for a GLN.
  if (seg1 === 'forecast') {
    try {
      return await handleForecast(area, mode, request, context.env);
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  // Everything past this point does apply the tariff. A net_ mode without a
  // GLN would quietly drop it and return a number that looks like a full
  // consumer price but is not one — which is precisely the failure that made
  // net_inkl_alt and inkl_alt identical for historical dates.
  if (mode.startsWith('net_') && !gln) {
    return fail(400, `mode "${mode}" needs gln — the grid tariff depends on the network company`);
  }

  // ── /api/geo ────────────────────────────────────────────────────────────
  // Approximate visitor position from Cloudflare's IP geolocation
  // (request.cf) — city-level accuracy, used as fallback when the browser's
  // own geolocation fails or times out (e.g. desktop machines with location
  // services off). Per-user data: never cached.
  if (seg1 === 'geo') {
    const cf = request.cf || {};
    return new Response(JSON.stringify({
      lat: cf.latitude != null ? parseFloat(cf.latitude) : null,
      lng: cf.longitude != null ? parseFloat(cf.longitude) : null,
      city: cf.city || null,
      country: cf.country || null,
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
    });
  }

  // ── /api/supplierlookup ─────────────────────────────────────────────────
  // Reverse-geocodes (lat,lng) → DK address → net company. Proxied through
  // here because the upstream GreenPowerDenmark API has no CORS headers.
  if (seg1 === 'supplierlookup') {
    try {
      return await handleSupplierLookup(q.get('lat'), q.get('lng'), request);
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  // ── /api/raw/* ──────────────────────────────────────────────────────────
  // Raw passthrough to Energi Data Service. Required because EDS returns
  // empty 200 responses with no CORS headers when the browser sends an
  // Origin header — the response is then blocked client-side and surfaces
  // as "Fejl ved hentning af data". Proxying server-side bypasses this:
  // Workers don't send a browser-style Origin, so EDS replies with the
  // real body, and we tack on our own CORS + Cache-Control on the way out.
  if (seg1 === 'raw') {
    try {
      if (seg2 === 'prices')    return await handleRawPrices(area, q.get('start'), q.get('end'), request, context.env);
      if (seg2 === 'encharges') return await handleRawEnCharges(request, context.env);
      if (seg2 === 'tariff')    return await handleRawTariff(q.get('gln'), request, context.env);
      if (seg2 === 'tariffs')   return await handleRawTariffs(request, context.env);
      if (seg2 === 'co2')       return await handleRawCo2(area, request, context.env);
      return fail(404, 'Unknown raw endpoint');
    } catch (e) {
      console.error(e);
      return fail(500, String(e.message || e));
    }
  }

  // Work out which days the caller actually wants before loading anything, so
  // a historical date pulls its own range rather than being looked up in a
  // window that only ever held yesterday..+2.
  const dkNow   = danishNow();
  const today   = fmtUTC(dkNow);
  const curHour = dkNow.getUTCHours(); // Danish local hour

  const qDate  = q.get('date');
  const qStart = q.get('start');
  const qEnd   = q.get('end');
  // Shape alone is not enough: 2024-13-01 matches the pattern, then fails the
  // start<=end comparison and gets reported as an ordering problem rather than
  // as the invalid date it is. Round-trip it so only real calendar dates pass.
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v + 'T00:00:00Z')) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

  let range = null, wantDays = null;
  if (seg1 === 'prices' && (qStart || qEnd)) {
    if (!qStart || !qEnd) return fail(400, 'start and end must be given together (YYYY-MM-DD)');
    if (!isDate(qStart) || !isDate(qEnd)) return fail(400, 'start and end must be a valid YYYY-MM-DD date');
    if (qEnd < qStart) return fail(400, 'end must not be before start');
    if (qStart < EARLIEST_PRICE_DATE) return fail(400, `no prices before ${EARLIEST_PRICE_DATE}`);
    const span = (Date.parse(qEnd) - Date.parse(qStart)) / 86_400_000 + 1;
    if (span > MAX_RANGE_DAYS) return fail(400, `range too long: ${span} days, max ${MAX_RANGE_DAYS}`);
    wantDays = span;
    // `end` is inclusive for callers but exclusive upstream.
    range = { start: qStart, end: fmtUTC(new Date(Date.parse(qEnd) + 86_400_000)) };
  } else if (qDate) {
    if (!isDate(qDate)) return fail(400, 'date must be a valid YYYY-MM-DD date');
    if (qDate < EARLIEST_PRICE_DATE) return fail(400, `no prices before ${EARLIEST_PRICE_DATE}`);
    // Only leave the default window when the date sits outside it — staying on
    // the shared key keeps today's requests hitting one warm cache entry.
    const defStart = fmtUTC(new Date(Date.now() - 86_400_000));
    const defEnd   = fmtUTC(new Date(Date.now() + 2 * 86_400_000));
    if (qDate < defStart || qDate >= defEnd) {
      range = { start: qDate, end: fmtUTC(new Date(Date.parse(qDate) + 86_400_000)) };
    }
  }

  try {
    const { priceData, chargeHistory, tariffRecords } = await loadData(area, mode, gln, context.env, range);
    // Resolved per date, not once per request: a range can span several tax
    // years, and the duty changed by a factor of 90 between 2025 and 2026.
    const chargeOpts = { reduced: usesReducedTax(mode), useToday: chargeBasis === 'current' };
    const chargesFor = d => chargesOn(chargeHistory, d, chargeOpts);

    // ── /api/shelly/tariff ──────────────────────────────────────────────────
    if (seg1 === 'shelly' && seg2 === 'tariff') {
      const tomorrow = fmtUTC(new Date(dkNow.getTime() + 86_400_000));

      function makeEntries(dateStr) {
        const tariffH = (mode.startsWith('net_') && gln)
          ? getTariffHourly(tariffRecords, dateStr) : null;
        const needTariff = mode.startsWith('net_') && !tariffH;
        const en = chargesFor(dateStr);
        const prices = Array.from({ length: 24 }, (_, h) => {
          const raw = (priceData[dateStr] || {})[h];
          if (raw === undefined || needTariff) return null;
          return +cvt(raw, h, mode, en, tariffH && tariffH.hourly).toFixed(4);
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

      // Today+tomorrow entries are stable until the next ~13:00 publication.
      return jsonResponse({
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
      }, { maxAge: secondsUntilNextPublish(), request });
    }

    // ── /api/prices | /api/now | /api/schedule ──────────────────────────────
    const dateStr  = q.get('date') || today;
    const tariffH  = (mode.startsWith('net_') && gln)
      ? getTariffHourly(tariffRecords, dateStr) : null;

    const enDay = chargesFor(dateStr);
    // Without a tariff a net_ price cannot be produced. Null, not a number
    // that omits the grid tariff while claiming to include it.
    const dayNeedsTariff = mode.startsWith('net_') && !tariffH;
    const hourlyPrices = Array.from({ length: 24 }, (_, h) => {
      const raw = (priceData[dateStr] || {})[h];
      if (raw === undefined || dayNeedsTariff) return null;
      return +cvt(raw, h, mode, enDay, tariffH && tariffH.hourly).toFixed(4);
    });

    if (seg1 === 'prices' && range && wantDays) {
      // Multi-day pull. One request per day would be 1,095 round trips for
      // three years, so the range is fetched upstream in one go and returned
      // day by day. Days the market never priced are included with a null
      // array rather than dropped, so a gap is visible instead of implied.
      const days = [];
      let noTariff = 0;
      for (let i = 0; i < wantDays; i++) {
        const d = fmtUTC(new Date(Date.parse(qStart) + i * 86_400_000));
        const tH = (mode.startsWith('net_') && gln) ? getTariffHourly(tariffRecords, d) : null;
        const enD = chargesFor(d);
        const row = priceData[d];
        // A day the company published no tariff for cannot yield a net_ price.
        // Reported as null and counted, so it cannot be averaged in by mistake.
        const gap = mode.startsWith('net_') && !tH;
        if (gap) noTariff++;
        days.push({
          date: d,
          grid_tariff: mode.startsWith('net_') ? (tH ? tH.kind : null) : undefined,
          prices: (row && !gap)
            ? Array.from({ length: 24 }, (_, h) => ({
                hour: h,
                price: row[h] === undefined ? null : +cvt(row[h], h, mode, enD, tH && tH.hourly).toFixed(4),
              }))
            : null,
        });
      }
      return jsonResponse({
        area, mode, start: qStart, end: qEnd, unit: 'DKK/kWh',
        charges: chargeBasis,
        days_returned: days.length,
        days_with_data: days.filter(d => d.prices).length,
        ...(noTariff ? { days_without_grid_tariff: noTariff } : {}),
        days,
      }, { maxAge: priceTtl(range.end), request });
    }

    if (seg1 === 'prices') {
      // The 24 hourly prices are stable for the day; current_hour/current_price
      // change hourly → cap freshness at the next hour boundary.
      return jsonResponse({
        area, mode, date: dateStr, unit: 'DKK/kWh',
        charges: chargeBasis,
        ...(mode.startsWith('net_') ? { grid_tariff: tariffH ? tariffH.kind : null } : {}),
        prices: hourlyPrices.map((price, hour) => ({ hour, price })),
        // Only meaningful for today — on a historical date there is no
        // "current" hour, and reporting one invites it to be read as a price
        // for now rather than for that date.
        current_hour:  dateStr === today ? curHour : null,
        current_price: dateStr === today ? hourlyPrices[curHour] : null,
      }, { maxAge: dateStr < today ? 86400 : secondsUntilNextHour(), request });
    }

    const strategy = q.get('strategy') || 'cheapest_n';
    const param    = +(q.get('hours') ?? q.get('pct') ?? 6);
    // Second param — currently only `smart` uses it (max consecutive OFF hours).
    const param2   = q.get('max_off') != null ? +q.get('max_off') : null;
    const schedule = computeSchedule(hourlyPrices, strategy, param, param2);

    if (seg1 === 'now') {
      // Reflects the current hour → fresh until the next hour boundary.
      return jsonResponse({
        on:       schedule[curHour],
        price:    hourlyPrices[curHour],
        hour:     curHour,
        area, mode, strategy,
      }, { maxAge: secondsUntilNextHour(), request });
    }

    if (seg1 === 'schedule') {
      // schedule[] is stable for the day; on_now depends on the current hour.
      return jsonResponse({
        area, mode, strategy, param, date: dateStr,
        on_now:   schedule[curHour],
        schedule: hourlyPrices.map((price, hour) => ({ hour, price, on: schedule[hour] })),
      }, { maxAge: secondsUntilNextHour(), request });
    }

    return fail(404, 'Unknown endpoint. Try /api/now  /api/prices  /api/schedule  /api/forecast  /api/shelly/tariff');
  } catch (e) {
    console.error(e);
    return upstreamFail(e);
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

function buildForecast(historicalPrices, mode, enCharges) {
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

  // Build 10-day output (v2 model covers T+9; heuristic fills whatever the
  // model doesn't overlay, so extending this is harmless for v1-only reads)
  const days = [];
  for (let dayOffset = 0; dayOffset < 10; dayOffset++) {
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
          const forecast = stats.wSum / stats.wCount;

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
    // The net_ modes fall through to the untariffed sum on purpose: a grid
    // tariff for a day that has not happened would have to be guessed, and
    // this endpoint says so rather than inventing one.
    case 'inkl_alt_minus': return (spot + en.sys + en.trans) * 1.25;
    default:               return (spot + en.sys + en.trans + en.afg) * 1.25;
  }
}

// ── Raw passthrough endpoints (CORS-proxy for Energi Data Service) ──────────
//
// Two-layer server cache:
//   1. Cloudflare Cache API (caches.default) — persists across isolates +
//      deploys, shared by all clients hitting any edge POP.
//   2. Per-isolate in-memory `cached()` — micro-cache for hot paths within
//      a single Worker.
//
// Both honour the same TTL. Clients see a fresh-looking response with a
// short browser TTL (so revised prices propagate within minutes) but never
// hit upstream EDS for a key that's already in our edge cache.

/** Build a cache + ETag aware JSON Response. `maxAge` in seconds is used for
 *  both the browser and the edge; pass `request` to enable 304 responses. */
function cachedJson(data, maxAge, request) {
  return jsonResponse(data, { maxAge, request, pretty: false });
}

/**
 * Two-layer fetch: in-memory micro-cache → Cloudflare Cache API → upstream.
 * `key` must be a stable URL-shaped string. `ttlSec` controls both layers.
 *
 *   In-memory caches across calls within the same isolate (instant).
 *   Cache API persists across isolates within a colo (one fetch per ~ttl per
 *   POP). Upstream is hit only when both miss.
 */
// A result worth caching: a non-empty array, or a non-empty object. We must
// NEVER cache an empty array — that's the signature of a transient upstream
// (EDS) blip, and caching it poisons the key for the whole TTL, surfacing as
// "Kunne ikke hente elpriser" until the cache expires.
function isCacheable(d) {
  if (Array.isArray(d)) return d.length > 0;
  if (d && typeof d === 'object') return Object.keys(d).length > 0;
  return d != null;
}

// Writes to KV only if the key hasn't been written in the last `minIntervalMs`,
// checked via KV's own stored metadata rather than in-memory state -- an
// in-memory gate (a JS Map surviving across requests) only holds within a
// single Worker isolate, and Cloudflare runs many ephemeral isolates across
// the edge network, so it doesn't actually throttle anything globally: every
// cold isolate starts with an empty gate and happily writes again. This is
// what caused KV's daily PUT limit (1000/day free tier) to be exceeded --
// reads are far more generous (100k/day free), so paying for one read to
// decide whether a write is even needed is the fix.
async function kvPutThrottled(kv, key, body, { minIntervalMs, expirationTtl }) {
  try {
    const { metadata } = await kv.getWithMetadata(key);
    const now = Date.now();
    if (metadata && metadata.writtenAt && now - metadata.writtenAt < minIntervalMs) return false;
    await kv.put(key, body, { expirationTtl, metadata: { writtenAt: now } });
    return true;
  } catch (e) {
    console.error('kvPutThrottled failed', e);
    return false;
  }
}

async function edgeCached(key, ttlSec, build, env) {
  // 1. In-memory (peek directly — `cached()` would store the null sentinel)
  const now = Date.now(), mem = _cache.get(key);
  if (mem && now - mem.ts < ttlSec * 1000) return mem.v;

  // 2. Cloudflare Cache API (shared across isolates within a colo).
  //    `/v2/` namespace abandons any poisoned (empty) entries cached by the
  //    pre-fix code; the isCacheable guard means new poison can't form.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.local/v2/${encodeURIComponent(key)}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const data = await hit.json();
    if (isCacheable(data)) { _cache.set(key, { ts: now, v: data }); return data; }
    // Defensive: an empty slipped in somehow — drop it and re-fetch.
    await cache.delete(cacheKey);
  }

  // PRICE_CACHE (Workers KV) holds the last successfully-fetched value for
  // this key, kept for 7 days regardless of `ttlSec` — a stale-if-error
  // fallback so a transient EDS outage degrades to slightly-old data instead
  // of a 500. Unlike the Cache API above (POP-local), KV is globally
  // replicated, so this survives even a cold/never-hit colo. Never used for
  // a *valid* empty result (e.g. tomorrow's prices not yet published) — only
  // when upstream actually throws, so we don't paper over "not published
  // yet" with the wrong day's numbers.
  const kv = env && env.PRICE_CACHE;

  // 3. Upstream
  let data;
  try {
    data = await build();
  } catch (err) {
    if (kv) {
      const stale = await kv.get(key, 'json');
      if (stale != null) { _cache.set(key, { ts: now, v: stale }); return stale; }
    }
    throw err;
  }
  // Only cache real data. A transient empty is returned to this caller but
  // never stored, so the very next request retries upstream.
  if (isCacheable(data)) {
    _cache.set(key, { ts: Date.now(), v: data });
    const body = JSON.stringify(data);
    await Promise.all([
      cache.put(cacheKey, new Response(body, {
        headers: { 'Cache-Control': `public, max-age=${ttlSec}` },
      })),
      // KV backup only needs to be "recent enough" for a stale-if-error
      // fallback, not continuously fresh -- throttled to at most once per
      // 10 min per key regardless of how many colos/isolates hit a Cache
      // API miss in that window (see kvPutThrottled for why this can't be
      // an in-memory gate).
      kv ? kvPutThrottled(kv, key, body, { minIntervalMs: 10 * 60_000, expirationTtl: 604800 }) : Promise.resolve(),
    ]);
  }
  return data;
}

// The frontend's default price view requests a ROLLING window (today ± a few
// days), so `raw-prices-${area}-${start}-${end}` shifts by one day, every
// day — meaning edgeCached's per-exact-key KV backup is rarely warm on the
// FIRST request of a new day, which is exactly when an upstream hiccup is
// most costly (no prior success that day to fall back to). This second,
// per-AREA rolling backup is keyed independently of the exact requested
// range, so any request can fall back to whatever's been fetched recently
// for that area, filtered to the range actually asked for.
async function updateRollingPriceBackup(area, records, env) {
  if (!env || !env.PRICE_CACHE || !records.length) return;
  const key = `raw-prices-backup-${area}`;
  const now = Date.now();
  try {
    // Throttle check (KV-metadata-based, not in-memory -- see kvPutThrottled)
    // before doing the more expensive get+merge+put, since most calls will
    // be within the throttle window and can bail after one cheap read.
    const { value: existingRaw, metadata } = await env.PRICE_CACHE.getWithMetadata(key);
    if (metadata && metadata.writtenAt && now - metadata.writtenAt < 20 * 60_000) return;

    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const byTime = new Map(existing.map(r => [r.TimeUTC, r]));
    for (const r of records) byTime.set(r.TimeUTC, r);
    const cutoff = new Date(now - 45 * 86_400_000).toISOString();
    const merged = Array.from(byTime.values()).filter(r => r.TimeUTC >= cutoff);
    await env.PRICE_CACHE.put(key, JSON.stringify(merged), {
      expirationTtl: 60 * 86400,
      metadata: { writtenAt: now },
    });
  } catch (e) {
    console.error('rolling price backup update failed', e);
  }
}

async function fetchRollingPriceBackupFiltered(area, start, end, env) {
  if (!env || !env.PRICE_CACHE) return [];
  try {
    const all = (await env.PRICE_CACHE.get(`raw-prices-backup-${area}`, 'json')) || [];
    return all.filter(r => r.TimeUTC.slice(0, 10) >= start && r.TimeUTC.slice(0, 10) <= end);
  } catch (e) {
    console.error('rolling price backup read failed', e);
    return [];
  }
}

async function handleRawPrices(area, start, end, request, env) {
  if (!start || !end) return fail(400, 'start, end required (YYYY-MM-DD)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    return fail(400, 'start, end must be YYYY-MM-DD');

  // Past-only ranges are immutable → cache a day. Ranges touching today/future
  // only change at the next ~13:00 publication → cache until then (+ ETag means
  // even after that, an unchanged body returns 304 with no transfer).
  const today  = fmtUTC(new Date());
  const ttlSec = end < today ? 86400 : secondsUntilNextPublish();

  // Edge/in-memory key uses a fixed bucket for the volatile slice so a fetch is
  // shared across users; the TTL above controls when we re-pull from upstream.
  // Note: `env` is deliberately NOT passed to edgeCached here -- its per-
  // exact-key KV backup would rarely help anyway (this key shifts by a day,
  // every day) and would just be a second KV write on top of the per-area
  // rolling backup below, which already covers this case better. Cache API
  // (POP-local, no KV involved) is still used via the in-memory/Cache API
  // layers inside edgeCached.
  let records;
  try {
    records = await edgeCached(`raw-prices-${area}-${start}-${end}`, end < today ? 86400 : 300,
      // Spans both price datasets — before this, any range ending before
      // 2025-10-01 came back as an empty list rather than as history.
      () => fetchPriceRecords(area, start, end));
  } catch (err) {
    console.error('handleRawPrices upstream failed, trying rolling backup', err);
    records = await fetchRollingPriceBackupFiltered(area, start, end, env);
    if (!records.length) throw err;
  }

  if (records.length) await updateRollingPriceBackup(area, records, env);

  // Never tell the browser to cache an empty result — force revalidation so a
  // transient empty self-heals on the next request instead of sticking around.
  return cachedJson({ records }, records.length ? ttlSec : 0, request);
}

/**
 * CO₂-udledning pr. kWh (g/kWh) — Energinet's CO2EmisProg (prognosis, covers
 * today and ~1 day ahead in 5-min resolution). Averaged to hourly server-side
 * so the payload is 24-48 rows instead of ~576.
 */
async function handleRawCo2(area, request, env) {
  const records = await edgeCached(`raw-co2-${area}`, 900, async () => {
    const dkNow = danishNow();
    const start = fmtUTC(dkNow);
    const end = fmtUTC(new Date(dkNow.getTime() + 2 * 86_400_000));
    const f = encodeURIComponent(JSON.stringify({ PriceArea: area }));
    const r = await fetch(
      `https://api.energidataservice.dk/dataset/CO2EmisProg` +
      `?start=${start}&end=${end}&filter=${f}&limit=0&columns=Minutes5DK,CO2Emission`
    );
    const j = await r.json();
    // Average the 5-min values per Danish date+hour
    const sums = {};
    for (const rec of (j.records || [])) {
      const key = rec.Minutes5DK.slice(0, 13); // "YYYY-MM-DDTHH"
      (sums[key] ??= { s: 0, n: 0 });
      sums[key].s += rec.CO2Emission;
      sums[key].n++;
    }
    return Object.keys(sums).sort().map(k => ({
      date: k.slice(0, 10),
      hour: +k.slice(11, 13),
      co2: Math.round(sums[k].s / sums[k].n),
    }));
  }, env);
  return cachedJson({ area, unit: 'g/kWh', records }, records.length ? 900 : 0, request);
}

async function handleRawEnCharges(request, env) {
  // Energinet system/transmission/electricity-tax charges. Change rarely.
  const records = await edgeCached('raw-encharges', 3600, async () => {
    const GLN = '5790000432752';
    const f = encodeURIComponent(JSON.stringify({
      GLN_Number: GLN, ChargeType: 'D03', ResolutionDuration: 'P1D',
    }));
    const r = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=20` +
      `&columns=ChargeTypeCode,ValidFrom,ValidTo,Price1`
    );
    const j = await r.json();
    return j.records || [];
  }, env);
  return cachedJson({ records }, records.length ? 3600 : 0, request);
}

/**
 * Single-net Nettarif C for the table view — needs only the user's chosen
 * net, not all 17. Returns ~1 KB instead of ~48 KB.
 */
async function handleRawTariff(gln, request, env) {
  if (!gln || !/^\d{13}$/.test(gln)) return fail(400, 'gln required (13 digits)');

  const records = await edgeCached(`raw-tariff-${gln}`, 3600, async () => {
    const f = encodeURIComponent(JSON.stringify({
      GLN_Number: gln, ChargeType: 'D03', Note: 'Nettarif C',
    }));
    const cols = 'ValidFrom,ValidTo,ResolutionDuration,' +
      Array.from({ length: 24 }, (_, i) => 'Price' + (i + 1)).join(',');
    const r = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=200&columns=${cols}`
    );
    const j = await r.json();
    // Some nets schedule many future revisions, pushing the currently-active
    // record out of a small `limit`. We over-fetch (200) and filter to records
    // active now or within the next 3 days. Trims to a handful of rows.
    const now = new Date(), horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() + 3);
    return (j.records || []).filter(rec =>
      rec.ResolutionDuration === 'PT1H' &&
      new Date(rec.ValidFrom) <= horizon &&
      (!rec.ValidTo || new Date(rec.ValidTo) > now)
    );
  }, env);
  return cachedJson({ records }, records.length ? 3600 : 0, request);
}

/**
 * All-nets Nettarif C — used ONLY by the Tariff comparison page. The table
 * view should call /api/raw/tariff?gln=… for a single net instead.
 */
async function handleRawTariffs(request, env) {
  const records = await edgeCached('raw-tariffs', 3600, async () => {
    const f = encodeURIComponent(JSON.stringify({
      ChargeType: 'D03', Note: 'Nettarif C',
    }));
    const cols = 'GLN_Number,ValidFrom,ValidTo,ResolutionDuration,' +
      Array.from({ length: 24 }, (_, i) => 'Price' + (i + 1)).join(',');
    const r = await fetch(
      `https://api.energidataservice.dk/dataset/DatahubPricelist` +
      `?filter=${f}&sort=ValidFrom%20desc&limit=0&columns=${cols}`
    );
    const j = await r.json();
    const now = new Date(), horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() + 3);
    return (j.records || []).filter(rec =>
      rec.ResolutionDuration === 'PT1H' &&
      new Date(rec.ValidFrom) <= horizon &&
      (!rec.ValidTo || new Date(rec.ValidTo) > now)
    );
  }, env);
  return cachedJson({ records }, records.length ? 3600 : 0, request);
}

// ── Supplier lookup (GPS → address → net company) ───────────────────────────

/**
 * Build a GPD-friendly address string from DAWA structured fields.
 *
 *   DAWA's `adressebetegnelse` includes `supplerendebynavn` (parish), e.g.
 *   "P.O. Pedersens Vej 2, Skejby, 8200 Aarhus N" — GPD's API returns 404 for
 *   that. It also chokes on dots in street names ("P.O." → 404). Constructing
 *   the address from structured fields and stripping dots fixes both.
 */
function buildGpdAddress(dawa) {
  // Replace dots with spaces (not strip): "P.O." → "P O", not "PO" — GPD treats
  // those differently and "PO Pedersens Vej" returns 500 while "P O" returns 200.
  const street = (dawa?.vejstykke?.navn || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const husnr  = dawa?.husnr || '';
  const postnr = dawa?.postnummer?.nr || '';
  const town   = dawa?.postnummer?.navn || '';
  if (!street || !husnr || !postnr || !town) return null;
  return `${street} ${husnr}, ${postnr} ${town}`;
}

async function handleSupplierLookup(lat, lng, request) {
  const flat = parseFloat(lat), flng = parseFloat(lng);
  if (!isFinite(flat) || !isFinite(flng)) return fail(400, 'lat,lng required');

  // Cache by ~11m grid (5 decimals) so nearby clicks share a result.
  const key = `gps-${flat.toFixed(5)}-${flng.toFixed(5)}`;
  const result = await cached(key, 24 * 60 * 60_000, async () => {
    // 1. Reverse-geocode via DAWA (CORS-friendly upstream, but server-side
    //    here so we get structured fields and one round-trip from the client).
    const dawa = await fetch(
      `https://dawa.aws.dk/adgangsadresser/reverse?x=${flng}&y=${flat}&srid=4326`
    ).then(r => r.json()).catch(() => null);

    const fullAddr  = dawa?.adressebetegnelse || null;
    const cleanAddr = buildGpdAddress(dawa);
    if (!cleanAddr) return { address: fullAddr, name: null, error: 'no_address' };

    // 2. Look up net company. Treat 404/500 as "unknown net" rather than fatal —
    //    the client falls back to area-based navigation.
    const r = await fetch(
      `https://api.elnet.greenpowerdenmark.dk/api/supplierlookup/${encodeURIComponent(cleanAddr)}`
    );
    if (!r.ok) return { address: fullAddr, name: null, error: `gpd_${r.status}` };

    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return { address: fullAddr, name: null, error: 'gpd_nonjson' };

    const j = await r.json().catch(() => null);
    return { address: fullAddr, name: j?.name || null };
  });
  // Address → net mapping is effectively static → cache a day, ETag for 304s.
  return jsonResponse(result, { maxAge: 86400, request });
}

// Overlays a trained-model forecast (written by scripts/forecast_model/train_and_score.py
// into KV daily) onto the seasonal-heuristic days from buildForecast(). Only replaces
// 'forecast'-type days (the heuristic already handles 'actual' days by reading the
// real published price) and only when the model's own value for that day isn't null —
// so a partially-stale or partially-failed model run degrades to the heuristic
// per-day rather than all-or-nothing.
function applyModelForecast(days, modelOutput, mode, enCharges) {
  if (!modelOutput || !Array.isArray(modelOutput.days)) return days;
  const byDate = new Map(modelOutput.days.map(d => [d.date, d]));
  return days.map(day => {
    if (day.type !== 'forecast') return day;
    const modelDay = byDate.get(day.date);
    if (!modelDay || modelDay.type !== 'forecast') return day;
    const prices = day.prices.map((p, h) => {
      const mp = modelDay.prices[h];
      if (!mp || mp.spot_dkk_mwh == null) return p;
      const price = +cvtForecast(mp.spot_dkk_mwh, h, mode, enCharges).toFixed(4);
      const min = mp.spot_min_dkk_mwh != null ? +cvtForecast(mp.spot_min_dkk_mwh, h, mode, enCharges).toFixed(4) : p.min;
      const max = mp.spot_max_dkk_mwh != null ? +cvtForecast(mp.spot_max_dkk_mwh, h, mode, enCharges).toFixed(4) : p.max;
      return { hour: h, price, min, max };
    });
    return { ...day, prices, source: 'model' };
  });
}

async function handleForecast(area, mode, request, env) {
  const dkNow = danishNow();
  const start = new Date(dkNow.getTime() - 28 * 86_400_000);
  const end   = new Date(dkNow.getTime() + 2 * 86_400_000); // Include tomorrow

  const [historicalPrices, chargeHistory] = await Promise.all([
    cached(`forecast-prices-${area}-${fmtUTC(start)}-${fmtUTC(end)}`, 30 * 60_000,
      () => fetchHistoricalPrices(area, fmtUTC(start), fmtUTC(end))),
    cached('charge-history', 6 * 60 * 60_000, fetchChargeHistory),
  ]);
  // A forecast is about days that have not happened, so the rates in force
  // today are the right ones — but the reduced duty still has to follow the
  // mode, or an elvarme forecast would be priced at the ordinary duty.
  const enCharges = chargesOn(chargeHistory, fmtUTC(new Date()),
                              { reduced: usesReducedTax(mode) });

  let days = buildForecast(historicalPrices, mode, enCharges);

  // Trained-model overlay: best-effort, never blocks or fails the request.
  // Prefers v2 (Spark-trained: lead-correct weather, hybrid shape, calibrated
  // bands) over v1 (GitHub Actions), falling through to the heuristic days —
  // so a dead Spark degrades to v1, and a dead v1 degrades to the heuristic.
  // Accepts today's or yesterday's run (the daily cron may not have fired yet,
  // or DK-local vs. UTC date bucketing may be off by one near midnight).
  if (env && env.PRICE_CACHE) {
    try {
      const isFresh = r => r && (r.generated === fmtUTC(dkNow) || r.generated === fmtUTC(new Date(dkNow.getTime() - 86_400_000)));
      // v3 -> v2 -> v1 -> heuristic. Each generation writes its own KV key with
      // a short TTL, so a stopped trainer expires out of the chain on its own
      // and deleting a key is an instant rollback to the generation below.
      for (const key of [`forecast-v3-${area}`, `forecast-v2-${area}`, `forecast-model-${area}`]) {
        const m = await env.PRICE_CACHE.get(key, 'json');
        if (isFresh(m)) { days = applyModelForecast(days, m, mode, enCharges); break; }
      }
    } catch (e) {
      console.error('forecast KV read failed', e);
    }
  }

  // `generated` is bucketed to the date (not the millisecond) so the ETag is
  // stable within a caching window and conditional requests can 304.
  return jsonResponse({
    area,
    mode,
    generated: fmtUTC(dkNow),
    days,
  }, { maxAge: 1800, request });
}
