// The price zones the apps know, and the rules around them: one table for the web test, the Android app (Zones.kt) and the iOS app (Zones.swift).
// app-contract.json carries it; test-golden.mjs checks it against the API (functions/api/[[catchall]].js), the web's ZONES and both apps' sources.
//
//   key       the `zone` of /api/nordic (lower case) — dk1 and dk2 are served by /api/forecast (net companies, Danish taxes) in the apps
//   country   ISO 3166 code, as in the API's zoneInfo.country
//   tz        IANA time zone: the API's days and hours are by the zone's own wall clock
//   currency  zoneInfo.currency (the local currency; prices are published in EUR and converted with zoneInfo.rate)
//   sub       the sub-unit the app shows per kWh: 'øre' (DKK, NOK), 'öre' (SEK), 'gr' (PLN) 'p' (GBP: pence) or 'ct' (EUR: the app writes the euro cent as its language does)
//   city      the place the zone is named for, only where a country has several zones (NO, SE); null otherwise
//   forecast  true when the feed carries a model forecast after the settled days (the 13 Nordic zones and NL); false: settled day-ahead prices only
//   apps      false: the API and the web serve the zone but the Android and iOS tables do not list it yet (test-golden.mjs compares their Zones files with the
//             zones that are not `apps: false`); the app follow-up adds the rows, the country names and the language rules, and deletes the flag

export const ZONES = [
  { key: 'dk1', country: 'DK', tz: 'Europe/Copenhagen', currency: 'DKK', sub: 'øre', city: null, forecast: true },
  { key: 'dk2', country: 'DK', tz: 'Europe/Copenhagen', currency: 'DKK', sub: 'øre', city: null, forecast: true },
  { key: 'no1', country: 'NO', tz: 'Europe/Oslo', currency: 'NOK', sub: 'øre', city: 'Oslo', forecast: true },
  { key: 'no2', country: 'NO', tz: 'Europe/Oslo', currency: 'NOK', sub: 'øre', city: 'Kristiansand', forecast: true },
  { key: 'no3', country: 'NO', tz: 'Europe/Oslo', currency: 'NOK', sub: 'øre', city: 'Trondheim', forecast: true },
  { key: 'no4', country: 'NO', tz: 'Europe/Oslo', currency: 'NOK', sub: 'øre', city: 'Tromsø', forecast: true },
  { key: 'no5', country: 'NO', tz: 'Europe/Oslo', currency: 'NOK', sub: 'øre', city: 'Bergen', forecast: true },
  { key: 'se1', country: 'SE', tz: 'Europe/Stockholm', currency: 'SEK', sub: 'öre', city: 'Luleå', forecast: true },
  { key: 'se2', country: 'SE', tz: 'Europe/Stockholm', currency: 'SEK', sub: 'öre', city: 'Sundsvall', forecast: true },
  { key: 'se3', country: 'SE', tz: 'Europe/Stockholm', currency: 'SEK', sub: 'öre', city: 'Stockholm', forecast: true },
  { key: 'se4', country: 'SE', tz: 'Europe/Stockholm', currency: 'SEK', sub: 'öre', city: 'Malmö', forecast: true },
  { key: 'fi', country: 'FI', tz: 'Europe/Helsinki', currency: 'EUR', sub: 'ct', city: null, forecast: true },
  { key: 'nl', country: 'NL', tz: 'Europe/Amsterdam', currency: 'EUR', sub: 'ct', city: null, forecast: true },
  { key: 'de', country: 'DE', tz: 'Europe/Berlin', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'fr', country: 'FR', tz: 'Europe/Paris', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'pl', country: 'PL', tz: 'Europe/Warsaw', currency: 'PLN', sub: 'gr', city: null, forecast: false },
  { key: 'it-n', country: 'IT', tz: 'Europe/Rome', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'at', country: 'AT', tz: 'Europe/Vienna', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'be', country: 'BE', tz: 'Europe/Brussels', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'ch', country: 'CH', tz: 'Europe/Zurich', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'cz', country: 'CZ', tz: 'Europe/Prague', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'hu', country: 'HU', tz: 'Europe/Budapest', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'si', country: 'SI', tz: 'Europe/Ljubljana', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'es', country: 'ES', tz: 'Europe/Madrid', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'pt', country: 'PT', tz: 'Europe/Lisbon', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'sk', country: 'SK', tz: 'Europe/Bratislava', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'gr', country: 'GR', tz: 'Europe/Athens', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'ro', country: 'RO', tz: 'Europe/Bucharest', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'bg', country: 'BG', tz: 'Europe/Sofia', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'hr', country: 'HR', tz: 'Europe/Zagreb', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'rs', country: 'RS', tz: 'Europe/Belgrade', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'ee', country: 'EE', tz: 'Europe/Tallinn', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'lv', country: 'LV', tz: 'Europe/Riga', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'lt', country: 'LT', tz: 'Europe/Vilnius', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'ie', country: 'IE', tz: 'Europe/Dublin', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'me', country: 'ME', tz: 'Europe/Podgorica', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'mk', country: 'MK', tz: 'Europe/Skopje', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'al', country: 'AL', tz: 'Europe/Tirane', currency: 'EUR', sub: 'ct', city: null, forecast: false },
  { key: 'xk', country: 'XK', tz: 'Europe/Belgrade', currency: 'EUR', sub: 'ct', city: null, forecast: false, apps: false },
  // Great Britain: the Market Index Price (within-day) from Elexon BMRS, NOT a day-ahead price. Already in pounds: the feed's `eur_mwh` holds GBP/MWh
  // and zoneInfo.rate is 1, so price * rate / 10 is pence per kWh. Today is never complete (an hour appears once both half hours have traded) and
  // there is no tomorrow: a client that drops incomplete days (parseZone) would show nothing current for this zone. The ESTIMATE of today's unpriced hours (and of the missing hour 23 of pt and ie) is a
  // separate top-level `estimate` of the answer (functions/_estimate.js), never part of days[]: parseZone / daysFrom make the same of the answer with and without it (test-api.mjs).
  { key: 'gb', country: 'GB', tz: 'Europe/London', currency: 'GBP', sub: 'p', city: null, forecast: false, apps: false },
];

/** The zone a device gets before the user chooses: by the device's region, else by its language. Luxembourg shares DE-LU; Italy is offered as IT-North only. */
export const REGION_ZONE = {
  DK: 'dk1', NO: 'no1', SE: 'se3', FI: 'fi', NL: 'nl', DE: 'de', LU: 'de', FR: 'fr', PL: 'pl', IT: 'it-n', AT: 'at', BE: 'be', CH: 'ch', CZ: 'cz', HU: 'hu',
  SI: 'si', ES: 'es', PT: 'pt', SK: 'sk', GR: 'gr', RO: 'ro', BG: 'bg', HR: 'hr', RS: 'rs', EE: 'ee', LV: 'lv', LT: 'lt', IE: 'ie', ME: 'me', MK: 'mk', AL: 'al',
};
export const LANGUAGE_ZONE = {
  da: 'dk1', nb: 'no1', nn: 'no1', no: 'no1', sv: 'se3', fi: 'fi', nl: 'nl', de: 'de', fr: 'fr', pl: 'pl', it: 'it-n', cs: 'cz', hu: 'hu', sl: 'si', es: 'es', pt: 'pt',
  sk: 'sk', el: 'gr', ro: 'ro', bg: 'bg', hr: 'hr', sr: 'rs', et: 'ee', lv: 'lv', lt: 'lt', mk: 'mk', sq: 'al',
};
/** No region, no known language (English in the UK or the US, Japanese …): Germany, the largest market in the list. Owner decision. */
export const FALLBACK_ZONE = 'de';

/** Region (ISO code, any case, may be empty) and language (BCP 47 primary subtag, any case) -> zone key. */
export function defaultZone(region, language) {
  const r = String(region || '').toUpperCase();
  const l = String(language || '').toLowerCase().split(/[-_]/)[0];
  return REGION_ZONE[r] || LANGUAGE_ZONE[l] || FALLBACK_ZONE;
}

export const countryOf = key => ZONES.find(z => z.key === key)?.country ?? null;
/** The countries in table order with their zones. */
export function countries() {
  const out = [];
  for (const z of ZONES) {
    let c = out.find(x => x.country === z.country);
    if (!c) out.push(c = { country: z.country, zones: [] });
    c.zones.push(z.key);
  }
  return out;
}

/** The ECB reference rates the apps fall back to when a response carries no rate (the API's own FX_FALLBACK). */
export const FX_FALLBACK = { EUR: 1, DKK: 7.4755, NOK: 10.84, SEK: 11.29, PLN: 4.39 };

/**
 * What a client must make of /api/nordic: complete days only (24 hours with a price), prices in the zone's sub-unit per kWh
 * (EUR/MWh × rate / 10), the band from min_eur_mwh / max_eur_mwh when both are there, `actual` from the day's type.
 * Rounded to six decimals so every platform compares exactly.
 */
export function parseZone(resp) {
  const info = resp.zoneInfo || {};
  const rate = info.rate > 0 ? info.rate : (FX_FALLBACK[info.currency] ?? 1);
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const days = [];
  for (const d of resp.days || []) {
    const price = Array(24).fill(null), lo = Array(24).fill(null), hi = Array(24).fill(null);
    let band = false;
    for (const p of d.prices || []) {
      if (!(p.hour >= 0 && p.hour <= 23) || p.eur_mwh == null) continue;
      price[p.hour] = r6(p.eur_mwh * rate / 10);
      if (p.min_eur_mwh != null && p.max_eur_mwh != null) { lo[p.hour] = r6(p.min_eur_mwh * rate / 10); hi[p.hour] = r6(p.max_eur_mwh * rate / 10); band = true; }
    }
    if (price.some(v => v === null)) continue;
    days.push({ date: d.date, actual: d.type === 'actual', price, lo: band ? lo : null, hi: band ? hi : null });
  }
  return { zone: resp.zone || null, currency: info.currency || null, rate, days };
}

/** The days from `today` on, consecutive: the feed opens on yesterday, and a hole must not close up (it would put "tomorrow" on the wrong date). */
export function daysFrom(days, today) {
  const t = Date.parse(today + 'T12:00:00Z');
  const out = [];
  for (const d of days.filter(x => x.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const n = Math.round((Date.parse(d.date + 'T12:00:00Z') - t) / 86400000);
    if (n !== out.length) break;
    out.push(d);
  }
  return out;
}
