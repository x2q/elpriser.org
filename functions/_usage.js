/**
 * Anonymous usage counts for the apps and for Shelly / Home Assistant installs.
 *
 * One Analytics Engine data point per request from a recognised client: which
 * client and version, which endpoint, price area or zone, strategy and whether it
 * succeeded. Nothing that identifies a person or a device is written — no IP
 * address, no device id, no grid company (gln), no query string — so a count
 * cannot be traced back to anyone. Browsers and unknown clients are not
 * recorded at all.
 *
 * Who is recognised:
 *   ElpriserAndroid/<version> (<build>)   the Android app's User-Agent
 *   ElpriserIOS/<version> (<build>)       the iOS app's User-Agent
 *   Shelly/<firmware>                     Shelly's own User-Agent
 *   HomeAssistant/<version>               Home Assistant's own User-Agent
 *   ?client=shelly-script-2               the version of the script /automation generated
 *   ?client=ha-plan-2                     … and of the Home Assistant YAML
 *
 * `/api/now` from Shelly and Home Assistant is 3/4 of all calls, so it is
 * sampled 1 in 5 and each written point carries that weight in double1 —
 * the free Analytics Engine plan caps writes at 100k points a day.
 */

const ENDPOINTS = new Set(['now', 'prices', 'schedule', 'forecast', 'raw', 'supplierlookup', 'shelly', 'flex', 'nordic']);
// A bidding-zone code as /api/nordic takes it (dk1, se3, de, gb, ...): a short word, never free text.
const ZONE = /^[a-z]{2}[a-z0-9]?$/;
const WORD = /^[a-z0-9_]{1,24}$/;
const VERSION = /^[0-9][0-9.]{0,15}(?: \([0-9]{1,5}\))?$/;
const SCRIPT_CLIENT = /^(shelly-script|ha-plan)-([0-9]{1,3})$/;
const NOW_SAMPLE = 5;

/**
 * Why a request got 400, as one fixed word, worked out from the shape of the query
 * alone (the values are never written): a net_ mode without a gln is what the apps'
 * and Home Assistant sensors most often get wrong. The checks mirror the API's own
 * order (area, then mode/gln, then dates); anything else is 'other'.
 */
export function badRequestReason(q) {
  const area = q.get('area');
  if (area !== null && !['DK1', 'DK2'].includes(area.toUpperCase())) return 'area_invalid';
  const mode = q.get('mode') || '';
  const gln = q.get('gln');
  if (mode.startsWith('net_') && !gln) return 'gln_missing';
  if (gln && !/^\d{13}$/.test(gln)) return 'gln_invalid';
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  for (const k of ['date', 'start', 'end']) { const v = q.get(k); if (v && !DATE.test(v)) return 'date_invalid'; }
  if (q.has('start') !== q.has('end')) return 'range_incomplete';
  return 'other';
}

/** { client, version, host } for a recognised caller, else null. */
export function usageClient(request, query) {
  const ua = request.headers.get('user-agent') || '';
  let m;
  let client = null, version = '', host = '';
  if ((m = ua.match(/^ElpriserAndroid\/([0-9][0-9.]*)(?: \(([0-9]+)\))?/))) { client = 'android'; version = m[1] + (m[2] ? ` (${m[2]})` : ''); }
  else if ((m = ua.match(/^ElpriserIOS\/([0-9][0-9.]*)(?: \(([0-9]+)\))?/))) { client = 'ios'; version = m[1] + (m[2] ? ` (${m[2]})` : ''); }
  else if ((m = ua.match(/^Shelly\/([0-9A-Za-z.\-]{1,24})/))) { client = 'shelly'; host = m[1]; }
  else if ((m = ua.match(/^HomeAssistant\/([0-9A-Za-z.\-]{1,24})/))) { client = 'homeassistant'; host = m[1]; }
  const tag = (query.get('client') || '').match(SCRIPT_CLIENT);
  if (tag) {
    // The query tag wins over the User-Agent: it names our generated script, the
    // User-Agent only names the platform it runs on.
    client = tag[1] === 'shelly-script' ? 'shelly' : 'homeassistant';
    version = `script ${tag[2]}`;
  }
  if (!client) return null;
  if (version && !VERSION.test(version) && !/^script [0-9]{1,3}$/.test(version)) version = '';
  return { client, version, host };
}

/**
 * Writes one data point. `env.USAGE` is the Analytics Engine binding; without
 * it (local server, tests) this does nothing. Never throws.
 */
export function recordUsage(env, request, status, random = Math.random, ctx = null) {
  try {
    if (!env || !(env.USAGE || env.GA_API_SECRET) || request.method !== 'GET') return false;
    const u = new URL(request.url);
    const c = usageClient(request, u.searchParams);
    if (!c) return false;
    const parts = u.pathname.split('/').filter(Boolean);
    const endpoint = ENDPOINTS.has(parts[1]) ? parts[1] : 'other';
    let weight = 1;
    if (endpoint === 'now' && (c.client === 'shelly' || c.client === 'homeassistant')) {
      if (random() * NOW_SAMPLE >= 1) return false;
      weight = NOW_SAMPLE;
    }
    // DK1/DK2 come in as ?area=, every other zone as /api/nordic?zone= — both are public codes, not a place.
    const area = u.searchParams.get('area');
    const zone = (u.searchParams.get('zone') || '').toLowerCase();
    const where = endpoint === 'nordic' && ZONE.test(zone) ? zone.toUpperCase()
      : area === 'DK1' || area === 'DK2' ? area : '';
    const strat = u.searchParams.get('strategy') || u.searchParams.get('mode') || '';
    const strategy = WORD.test(strat) ? strat : (strat ? 'other' : '');
    const cls = status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
    const reason = status === 400 ? badRequestReason(u.searchParams) : '';
    if (env.USAGE) env.USAGE.writeDataPoint({
      indexes: [c.client],
      blobs: [c.client, c.version, c.host, endpoint, where, strategy, cls, ...(status === 400 ? [reason] : [])],
      doubles: [weight],
    });
    if (env.GA_API_SECRET && ctx && ctx.waitUntil) ctx.waitUntil(sendGa(env, { c, endpoint, where, strategy, cls, reason, weight }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The same anonymous point as one GA4 event (Measurement Protocol), so the apps' and the
 * integrations' API calls can be read next to the site's page views. Off unless the secret
 * GA_API_SECRET is set (Admin > Data streams > Measurement Protocol API secrets).
 *
 * What GA gets: event `api_request` with client, client_version, host (the platform's version),
 * endpoint, area (DK1/DK2/zone code), strategy, status_class, reason (only for a 400) and
 * `weight` (the sampling weight: sum it, do not count the events). The client_id is the fixed
 * word `api.<client>` — it names an app, never a person or a device, so GA's "users" for these
 * events are client kinds. No IP, no User-Agent, no gln and no query string is sent: the hit
 * reaches Google from Cloudflare's edge, not from the caller.
 * Only requests that reach the Function count: an answer the edge cache serves never does.
 */
export function gaPayload(rec) {
  const { c, endpoint, where, strategy, cls, reason, weight } = rec;
  const params = { engagement_time_msec: 1, client: c.client, endpoint, status_class: cls, weight };
  if (c.version) params.client_version = c.version;
  if (c.host) params.host = c.host;
  if (where) params.area = where;
  if (strategy) params.strategy = strategy;
  if (reason) params.reason = reason;
  return { client_id: `api.${c.client}`, events: [{ name: 'api_request', params }] };
}

export async function sendGa(env, rec, doFetch = fetch) {
  try {
    const id = env.GA_MEASUREMENT_ID || 'G-3WE5CL1ZTV';
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(env.GA_API_SECRET)}`;
    const res = await doFetch(url, { method: 'POST', body: JSON.stringify(gaPayload(rec)) });
    return res.status;
  } catch {
    return 0;
  }
}
