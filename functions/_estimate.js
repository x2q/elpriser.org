/**
 * The ESTIMATE of the hours of a settled day that have no price yet (elpriser.org's own statistical model, never a price a licence attributes to somebody
 * else). One code path for every zone that has such a gap; the zone list is the one constant below.
 *
 *   gb  Great Britain: the Elexon Market Index Price appears hour by hour, so today has only the hours that have traded and tomorrow does not exist.
 *   pt  Portugal, ie Ireland: one hour behind CET, so the day-ahead auction leaves the LAST local hour (23) of the day to the next auction (published
 *       around 11:45-12:45 UTC): the newest day has 23 priced hours.
 *
 * KV `eu-estimate-<zone>` (scripts/forecast_model/gb for gb, .../hour23 for pt and ie; written by their Spark jobs, short TTL):
 *   { zone, generatedAt (ISO), date: 'YYYY-MM-DD' (the day with the gap), model, method, unit,
 *     hours: [{ hour, eur_mwh, min_eur_mwh?, max_eur_mwh? }], accuracy: {...} }
 *
 * What /api/nordic does with it (withEstimate) - the days[] of the answer are NEVER changed:
 *   - the answer gets a top-level `estimate` { date, type: 'forecast', scope: 'partial-day', model, generatedAt, prices: [...], accuracy };
 *     a client that has never heard of it (the apps, the Shelly and Home Assistant scripts, the golden parsers) sees exactly the answer it saw before;
 *   - only hours that the settled day lists as null (or does not list) are kept: a settled price always replaces an estimate;
 *   - every kept hour is a well-formed number, and a band (min_eur_mwh / max_eur_mwh = P10 / P90) is on every kept hour or on none, min <= price <= max;
 *   - the run is at most MAX_AGE_MS old (a job that stopped makes the estimate vanish, hours after the last one it wrote), and not from the future;
 *   - the estimate's day must be a day of the answer (a day the settled prices have).
 * Nothing else a run carries is passed on.
 */
export const ESTIMATE_ZONES = ['gb', 'pt', 'ie'];
export const ESTIMATE_MAX_AGE_MS = 3 * 3600 * 1000;

export function withEstimate(priced, est, nowMs) {
  if (!est || typeof est !== 'object' || !priced || !Array.isArray(priced.days) || !Array.isArray(est.hours) || !est.hours.length) return priced;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const num = v => typeof v === 'number' && Number.isFinite(v);
  if (typeof est.date !== 'string' || !DATE.test(est.date)) return priced;
  const at = Date.parse(est.generatedAt);
  if (!Number.isFinite(at) || at > nowMs + 5 * 60000 || nowMs - at > ESTIMATE_MAX_AGE_MS) return priced;
  const day = priced.days.find(d => d && d.type === 'actual' && d.date === est.date && Array.isArray(d.prices));
  if (!day) return priced;
  const settled = new Set(day.prices.filter(p => p && Number.isInteger(p.hour) && num(p.eur_mwh)).map(p => p.hour));
  const seen = new Set();
  const rows = [];
  for (const p of est.hours) {
    if (!p || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23 || !num(p.eur_mwh) || settled.has(p.hour) || seen.has(p.hour)) continue;
    const hasLo = p.min_eur_mwh !== undefined && p.min_eur_mwh !== null, hasHi = p.max_eur_mwh !== undefined && p.max_eur_mwh !== null;
    if (hasLo !== hasHi) continue;
    const row = { hour: p.hour, eur_mwh: p.eur_mwh };
    if (hasLo) {
      if (!num(p.min_eur_mwh) || !num(p.max_eur_mwh) || p.min_eur_mwh > p.eur_mwh || p.max_eur_mwh < p.eur_mwh) continue;
      row.min_eur_mwh = p.min_eur_mwh; row.max_eur_mwh = p.max_eur_mwh;
    }
    seen.add(p.hour);
    rows.push(row);
  }
  if (!rows.length) return priced;
  rows.sort((a, b) => a.hour - b.hour);
  // a band on some hours only is not a band: drop it from all
  if (rows.some(r => 'min_eur_mwh' in r) && !rows.every(r => 'min_eur_mwh' in r)) for (const r of rows) { delete r.min_eur_mwh; delete r.max_eur_mwh; }
  const out = { date: est.date, type: 'forecast', scope: 'partial-day', model: typeof est.model === 'string' ? est.model : null,
                generatedAt: new Date(at).toISOString(), prices: rows };
  if (typeof est.method === 'string') out.method = est.method;
  if (est.accuracy && typeof est.accuracy === 'object' && !Array.isArray(est.accuracy)) out.accuracy = est.accuracy;
  return { ...priced, estimate: out };
}
