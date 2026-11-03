/**
 * A zone's days on the zone's OWN wall clock, from a feed that is indexed on another clock.
 *
 * The Nordic job (scripts/forecast_model/nordic/fetch_prices.py) floors every one of its 13 zones to the COPENHAGEN hour, because the market
 * day (CET) is the same for all of them. Denmark, Norway, Sweden and the Netherlands are on Copenhagen's clock, so for them index h of a
 * day is the zone's own hour h. Finland is not: Helsinki is one hour ahead at every instant (the EU changes both clocks at the same
 * UTC instant, so the difference is always exactly +1 h), and day D hour 0 of the feed (00:00 CET) is 01:00 in Helsinki. Verified
 * against ENTSO-E A44 (2026-11-03: feed hour 0 = 2026-11-02T23:00Z) and Energy-Charts, test-fi-clock.mjs pins it.
 *
 * /api/nordic promises "the zone's own wall clock, hour 0-23" (the OpenAPI text, tests/golden/app-contract.json `tz`; the Android and iOS apps
 * and the web's ZONES[k].shift read their days that way, as do the EU-path zones ee/lv/lt/ro/bg/gr). This module makes the feed keep that
 * promise for `fi`: ONE function, rebucketToLocalDays, and the table of the zones it is applied to.
 */

/** Hours from Copenhagen to the zone's own clock, for the Nordic-feed zones that are not on Copenhagen's. Pinned to the contract's `tz` by test-golden.mjs. */
export const NORDIC_LOCAL_SHIFT = { fi: 1 };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const ord = d => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const iso = o => new Date(o * DAY_MS).toISOString().slice(0, 10);
const num = v => typeof v === 'number' && Number.isFinite(v);

/** A day needs this many priced hours to be served, as in the EU job (energy_charts_parse.MIN_HOURS): the last, one-hour day of the window is not a day. */
export const LOCAL_DAY_MIN_HOURS = 12;

/**
 * `feed` with days[] re-cut to the clock `offsetHours` ahead of the one it is indexed by (whole hours, 1..23).
 *
 * A feed day is 24 rows, hour 0-23 of the SOURCE clock's date; DST days keep 24 rows too (the repeated hour is the mean of both, the skipped one
 * is null), so the feed is a flat sequence of 24 slots per date and the target clock is that sequence shifted by `offsetHours` slots:
 * target (date, h) = source (date, h - offset), and for h < offset the source's previous date. Because the two clocks change at the same
 * instant, the repeated / skipped hour lands in the same place on both (Copenhagen 02, Helsinki 03), so no DST special case is needed and
 * none is made; test-fi-clock.mjs checks it against Intl for 2026-03-29 and 2026-10-25.
 *
 *   type     a target day is `forecast` as soon as ONE of its priced hours comes from a forecast day, `actual` only when every priced hour is settled:
 *            a day whose last hours are still the model's must not pass for settled (Helsinki day D ends with source D hour 22 and begins with
 *            the source day before).
 *   band     a `forecast` day carries min_eur_mwh/max_eur_mwh on every priced hour or on none (as the apps and withEuForecast require): a settled hour
 *            inside a forecast day gets min = max = its price (no uncertainty), and only when some hour of the day has a band at all.
 *   holes    an hour with no source (the first target day when the feed does not start the day before) is `eur_mwh: null`, as the EU job does for an
 *            hour without a price; a target day with fewer than LOCAL_DAY_MIN_HOURS priced hours is not served (the window's tail: one hour).
 *   other    `horizon` is taken from the source day of the same date when it has one; nothing else of a day is passed on. Everything outside days[]
 *            (generated, trainedThrough, unit, ...) is the feed's own. `offsetHours` 0 (or an unusable feed) returns the very same object.
 */
export function rebucketToLocalDays(feed, offsetHours) {
  if (!feed || !Array.isArray(feed.days) || !Number.isInteger(offsetHours) || offsetHours < 1 || offsetHours > 23) return feed;
  // source slot (ordinal * 24 + hour) -> row + the type of the day it came from
  const slots = new Map();
  const horizon = new Map();
  for (const d of feed.days) {
    if (!d || (d.type !== 'actual' && d.type !== 'forecast') || typeof d.date !== 'string' || !DATE.test(d.date) || !Array.isArray(d.prices)) continue;
    const o = ord(d.date);
    if (Number.isInteger(d.horizon)) horizon.set(o, d.horizon);
    for (const p of d.prices) {
      if (!p || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) continue;
      slots.set(o * 24 + p.hour, { p, type: d.type });
    }
  }
  if (!slots.size) return feed;
  const first = Math.min(...[...slots.keys()].map(k => Math.floor(k / 24)));
  const last = Math.max(...[...slots.keys()].map(k => Math.floor(k / 24))) + 1;     // the source's last date spills into the next target date
  const days = [];
  for (let o = first; o <= last; o++) {
    const rows = [];
    let forecast = false, banded = false, priced = 0;
    for (let h = 0; h < 24; h++) {
      const s = slots.get(o * 24 + h - offsetHours);
      if (!s || !num(s.p.eur_mwh)) { rows.push({ hour: h, eur_mwh: null }); continue; }
      priced++;
      const row = { hour: h, eur_mwh: s.p.eur_mwh };
      if (num(s.p.min_eur_mwh) && num(s.p.max_eur_mwh)) { row.min_eur_mwh = s.p.min_eur_mwh; row.max_eur_mwh = s.p.max_eur_mwh; banded = true; }
      if (s.type === 'forecast') forecast = true;
      rows.push(row);
    }
    if (priced < LOCAL_DAY_MIN_HOURS) continue;
    if (forecast && banded) for (const r of rows) if (r.eur_mwh !== null && !('min_eur_mwh' in r)) { r.min_eur_mwh = r.eur_mwh; r.max_eur_mwh = r.eur_mwh; }
    const day = { date: iso(o), type: forecast ? 'forecast' : 'actual' };
    if (forecast && horizon.has(o)) day.horizon = horizon.get(o);
    day.prices = rows;
    days.push(day);
  }
  return { ...feed, days };
}
