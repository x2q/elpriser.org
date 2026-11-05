/**
 * /api/slots — a zone's prices as ABSOLUTE time slots, `[{ start, end, ... }]` in UTC, instead of local-clock hours.
 *
 * The other endpoints give "date + hour 0-23 of the zone's wall clock" (what the apps and pages draw). A consumer that plans against the
 * clock - evcc's rates, a scheduler - needs instants, and turning wall-clock hours into instants means knowing the zone's daylight-saving
 * rule: that is done here, once, with the platform's time zone database (Intl), and not by every client with its own copy of the rule.
 *
 * Resolution. The day-ahead market has had 15-minute slots since 2025-10-01. The EU jobs (scripts/eu_prices/) keep those 15-minute prices in KV
 * `eu-slots-<zone>` next to the hourly means of `eu-prices-<zone>`. Where the 15-minute prices exist, the slots are 15 minutes; everything else
 * (the model's forecast days, a settled day that has no 15-minute record, zones whose source is hourly or half-hourly) is returned as the hourly
 * (or half-hourly) slots it is. Every slot carries its own `start` and `end`, so a consumer never has to assume a step.
 *
 * KV `eu-slots-<zone>` = { zone, generated, unit, slots: [[unixSeconds, minutes, eur_mwh], ...] } (one row per settled slot, sorted).
 */

/** The IANA zone each served bidding zone keeps its day on. The Nordic feed is indexed by Copenhagen's clock for every zone but `fi`
 *  (functions/_localdays.js re-cuts Finland to Helsinki), and Norway and Sweden follow the same EU rule as Denmark. */
export const ZONE_TZ = {
  dk1: 'Europe/Copenhagen', dk2: 'Europe/Copenhagen', no1: 'Europe/Copenhagen', no2: 'Europe/Copenhagen', no3: 'Europe/Copenhagen',
  no4: 'Europe/Copenhagen', no5: 'Europe/Copenhagen', se1: 'Europe/Copenhagen', se2: 'Europe/Copenhagen', se3: 'Europe/Copenhagen',
  se4: 'Europe/Copenhagen', fi: 'Europe/Helsinki', nl: 'Europe/Amsterdam',
  de: 'Europe/Berlin', fr: 'Europe/Paris', pl: 'Europe/Warsaw', 'it-n': 'Europe/Rome', at: 'Europe/Vienna', be: 'Europe/Brussels',
  ch: 'Europe/Zurich', cz: 'Europe/Prague', hu: 'Europe/Budapest', si: 'Europe/Ljubljana',
  es: 'Europe/Madrid', pt: 'Europe/Lisbon', sk: 'Europe/Bratislava', gr: 'Europe/Athens', ro: 'Europe/Bucharest', bg: 'Europe/Sofia',
  hr: 'Europe/Zagreb', rs: 'Europe/Belgrade', ee: 'Europe/Tallinn', lv: 'Europe/Riga', lt: 'Europe/Vilnius', me: 'Europe/Podgorica',
  mk: 'Europe/Skopje', al: 'Europe/Tirane', xk: 'Europe/Belgrade', gb: 'Europe/London', ie: 'Europe/Dublin',
};

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = v => typeof v === 'number' && Number.isFinite(v);

const _fmt = new Map();
/** Minutes the zone's wall clock is ahead of UTC at the instant `ms`. */
export function tzOffsetMin(tz, ms) {
  let f = _fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    _fmt.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = +x.value;
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant (ms) of 00:00 local time on `date` ('YYYY-MM-DD') in `tz`. Local midnight is never inside a clock change in any zone served
 *  (the EU changes at 01:00 UTC, which is 02:00-04:00 local), so the offset at 00:00 UTC of that date is the one in force at midnight. */
export function localMidnight(date, tz) {
  const t = Date.parse(`${date}T00:00:00Z`);
  return t - tzOffsetMin(tz, t) * 60000;
}

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const WHOLESALE_KEYS = { v: 'eur_mwh', lo: 'min_eur_mwh', hi: 'max_eur_mwh' };
/** Field names of /api/forecast's days (DKK per kWh), for the Danish price modes. */
export const FORECAST_KEYS = { v: 'price', lo: 'min', hi: 'max' };

/**
 * The hourly rows of one local day as absolute one-hour slots `{ start, end, value, min?, max? }` (ms).
 *
 * `day` is { date, prices: [{ hour, <keys.v>, <keys.lo>?, <keys.hi>? }] } on the zone's wall clock (the wholesale feed's names by default). A day is 23, 24 or 25 hours long: on the
 * day the clocks go back the local hour 2 happens twice and the feed's hour-2 price (the mean of both) is used for both slots; on the day they go
 * forward hour 2 does not exist and no slot has it. An hour without a price (null) has no slot.
 */
export function hourlySlots(day, tz, keys = WHOLESALE_KEYS) {
  if (!day || typeof day.date !== 'string' || !DATE.test(day.date) || !Array.isArray(day.prices)) return [];
  const byHour = new Map();
  for (const p of day.prices) if (p && Number.isInteger(p.hour) && p.hour >= 0 && p.hour <= 23 && num(p[keys.v])) byHour.set(p.hour, p);
  const from = localMidnight(day.date, tz);
  const to = localMidnight(addDays(day.date, 1), tz);
  const out = [];
  for (let s = from; s < to; s += HOUR_MS) {
    const local = new Date(s + tzOffsetMin(tz, s) * 60000);
    const p = byHour.get(local.getUTCHours());
    if (!p) continue;
    const slot = { start: s, end: s + HOUR_MS, value: p[keys.v] };
    if (num(p[keys.lo]) && num(p[keys.hi])) { slot.min = p[keys.lo]; slot.max = p[keys.hi]; }
    out.push(slot);
  }
  return out;
}

/** The stored 15-minute record as validated slots. Anything off (not an array, a step that is not a whole number of minutes, a price that is not
 *  a number, overlapping rows) is dropped, never repaired; a record older than `maxAgeDays` by its `generated` date is not used. */
export function storedSlots(rec, nowMs, maxAgeDays = 3) {
  if (!rec || !Array.isArray(rec.slots)) return [];
  const gen = typeof rec.generated === 'string' && DATE.test(rec.generated) ? Date.parse(`${rec.generated}T00:00:00Z`) : NaN;
  if (!Number.isFinite(gen) || nowMs - gen > (maxAgeDays + 1) * DAY_MS) return [];
  const rows = [];
  for (const r of rec.slots) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const [t, min, price] = r;
    if (!Number.isInteger(t) || !Number.isInteger(min) || min < 5 || min > 60 || 60 % min || !num(price)) continue;
    rows.push({ start: t * 1000, end: (t + min * 60) * 1000, value: price });
  }
  rows.sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of rows) {
    if (out.length && r.start < out[out.length - 1].end) continue;     // overlap: the first one wins
    out.push(r);
  }
  return out;
}

/**
 * One timeline from the settled 15-minute slots and the hourly ones.
 *
 * A hourly slot is kept only where no settled slot covers any part of it, so a day that has its 15-minute prices is never mixed with its own
 * hourly means, and a forecast day (which no settled slot covers) stays. The result is sorted and has no overlap.
 * `settled` hourly slots come with type 'actual', the model's with 'forecast' (the caller sets it per slot).
 */
export function mergeSlots(quarters, hourly) {
  const q = quarters.map(s => ({ ...s, type: 'actual' }));
  const covered = hourly.filter(h => !q.some(s => s.start < h.end && s.end > h.start));
  return [...q, ...covered].sort((a, b) => a.start - b.start);
}

export const isoZ = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
