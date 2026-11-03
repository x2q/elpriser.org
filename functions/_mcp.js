/**
 * Remote MCP server for elpriser.org — https://elpriser.org/mcp
 *
 * The same six tools as the npm package `elpriser-mcp` (get_current_price, get_today_prices, get_cheapest_hours,
 * get_price_forecast, get_european_prices, find_net_company), reachable over MCP "Streamable HTTP" so that Claude,
 * ChatGPT and other clients can use them by URL, with nothing to install.
 *
 * Stateless by construction: no session id is ever minted, no SSE stream is offered, nothing is kept between requests.
 *   POST /mcp          one JSON-RPC request or notification per call → application/json (or 202 for a notification)
 *   GET/DELETE/HEAD    405 (the spec's answer for "this server offers no SSE stream and no sessions")
 *   OPTIONS            CORS preflight
 *
 * Two protocol eras are served on the same endpoint (the spec calls this "dual-era"):
 *   modern  2026-07-28   no handshake; every request carries _meta.io.modelcontextprotocol/{protocolVersion,clientCapabilities}
 *                        and the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers; results carry resultType; server/discover
 *   legacy  2025-11-25, 2025-06-18, 2025-03-26   `initialize` → `notifications/initialized` → requests; the initialize answer
 *                        names no Mcp-Session-Id, which the spec allows ("MAY assign"), so every later request stands alone.
 *
 * The tools call the site's own API IN-PROCESS (the exported onRequest of functions/api/[[catchall]].js) rather than over HTTP:
 * a same-origin fetch would be a second Pages Function invocation per tool call (the free plan allows 100,000 a day), and the
 * in-process path reuses the API's own layers in front of Workers KV (isolate Map, Cache API), so a tool call adds no KV read
 * that /api/now, /api/prices, … would not have made anyway.
 *
 * Files starting with an underscore are not routes: the routes are functions/mcp.js, functions/mcp/server-card.js and the
 * two files under functions/.well-known/.
 */
import { onRequest as apiRequest } from './api/[[catchall]].js';

export const SERVER_INFO = { name: 'elpriser', title: 'elpriser.org', version: '1.0.0', websiteUrl: 'https://elpriser.org' };
export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const ALL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

const INSTRUCTIONS = [
  'Electricity prices from elpriser.org: Denmark (price zones DK1 and DK2, with grid tariffs, electricity tax and VAT) and 40 European bidding zones.',
  'Danish prices are in DKK/kWh; European spot prices are in EUR/MWh without VAT, taxes or grid fees.',
  "Tomorrow's prices are published around 13:00 Danish time. All tools are read-only and need no key.",
].join(' ');

const MAX_BODY = 32 * 1024;           // a tool call is a few hundred bytes
const API_TIMEOUT_MS = 25_000;
const API_UA = 'elpriser-mcp-remote/1.0 (+https://elpriser.org/mcp)';

// ── HTTP envelope ─────────────────────────────────────────────────────────────

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
// Public, read-only, no credentials: any origin the Origin check below lets through may read the answer.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID, Authorization',
  'Access-Control-Max-Age': '86400',
};

function reply(status, body, { cors = true, headers = {} } = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }), ...BASE_HEADERS, ...(cors ? CORS : {}), ...headers },
  });
}

const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Origins that may call the endpoint from a browser. A request without an Origin header (every server-side client: Claude, ChatGPT,
// the SDKs, curl) is not a browser and is let through; anything else must be on this list or the answer is 403, as the spec's
// DNS-rebinding rule requires. Our own site and local development tools (MCP Inspector on localhost) are always allowed.
const ORIGIN_SUFFIXES = ['claude.ai', 'claude.com', 'anthropic.com', 'chatgpt.com', 'openai.com', 'modelcontextprotocol.io'];
export function originAllowed(origin, requestUrl) {
  let o;
  try { o = new URL(origin); } catch { return false; }          // includes the literal "null" of sandboxed iframes and file://
  if (o.protocol !== 'https:' && o.protocol !== 'http:') return false;
  const h = o.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]') return true;
  if (o.protocol !== 'https:') return false;
  if (h === 'elpriser.org' || h === 'www.elpriser.org') return true;
  try { if (o.host === new URL(requestUrl).host && !/^(localhost|127\.|\[::1\])/.test(o.hostname)) return true; } catch { /* fall through */ }
  return ORIGIN_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
}

const acceptsJson = accept => !accept || accept.split(',').some(p => {
  const t = p.split(';')[0].trim().toLowerCase();
  return t === 'application/json' || t === 'application/*' || t === '*/*';
});

function decodeMcpName(v) {
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); } catch { return null; }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

class InputError extends Error {}

// The 40 bidding zones /api/nordic serves (NORDIC_ZONES + EU_ZONES in api/[[catchall]].js; test-mcp.mjs pins the two to each other).
export const ZONES = ['dk1', 'dk2', 'no1', 'no2', 'no3', 'no4', 'no5', 'se1', 'se2', 'se3', 'se4', 'fi', 'nl',
  'de', 'fr', 'pl', 'it-n', 'at', 'be', 'ch', 'cz', 'hu', 'si', 'es', 'pt', 'sk', 'gr', 'ro', 'bg', 'hr', 'rs',
  'ee', 'lv', 'lt', 'me', 'mk', 'al', 'ie', 'gb', 'xk'];
export const MODES = ['spot_ex', 'spot_inkl', 'inkl_alt', 'inkl_alt_minus'];

const AREA_PROP = { type: 'string', enum: ['DK1', 'DK2'], default: 'DK1',
  description: 'Danish price zone: DK1 = Vestdanmark (Jylland og Fyn), DK2 = Østdanmark (Sjælland, Lolland-Falster, Bornholm).' };
const MODE_PROP = { type: 'string', enum: MODES, default: 'inkl_alt',
  description: 'Price view: spot_ex = raw spot price (no VAT); spot_inkl = spot incl. 25% VAT; inkl_alt = total price incl. system/transmission tariffs + electricity tax + VAT (what you actually pay); inkl_alt_minus = total without electricity tax.' };
const DATE_PROP = desc => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: desc });

const READ_ONLY = title => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });

function dkToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

function pickArea(v) {
  if (v === undefined || v === null) return 'DK1';
  if (typeof v === 'string' && /^dk[12]$/i.test(v)) return v.toUpperCase();
  throw new InputError('area must be "DK1" or "DK2"');
}
function pickMode(v) {
  if (v === undefined || v === null) return 'inkl_alt';
  if (typeof v === 'string' && MODES.includes(v)) return v;
  throw new InputError(`mode must be one of: ${MODES.join(', ')}`);
}
// Prices exist from the start of the archive (four calendar years back) to the end of tomorrow, Danish time.
function pickDate(v) {
  if (v === undefined || v === null) return undefined;
  const bad = () => new InputError('date must be a real calendar date written YYYY-MM-DD, e.g. ' + dkToday());
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad();
  const t = Date.parse(v + 'T00:00:00Z');
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) throw bad();
  const today = dkToday();
  const min = `${+today.slice(0, 4) - 4}-01-01`, max = addDays(today, 1);
  if (v < min) throw new InputError(`no prices before ${min}`);
  if (v > max) throw new InputError(`no prices after ${max}: only today and tomorrow are published (get_price_forecast covers the days beyond)`);
  return v;
}
function pickHours(v) {
  if (v === undefined || v === null) return 4;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 23) return v;
  throw new InputError('hours must be a whole number from 1 to 23');
}
function pickZone(v) {
  const z = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (ZONES.includes(z)) return z;
  throw new InputError(`zone must be one of: ${ZONES.join(', ')}`);
}
// Net companies are looked up for Danish addresses only. Rejecting the rest here, and rounding to ~11 m, keeps a sweep of
// coordinates from becoming a sweep of OpenStreetMap Nominatim requests (1 per second is its policy) made in our name.
const DK_BOX = { lat: [54.5, 57.8], lng: [7.9, 15.3] };
function pickCoord(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`${name} must be a number (WGS84 decimal degrees)`);
  return +v.toFixed(4);
}

const kr = v => v.toFixed(2).replace('.', ',');
const hh = h => String(h).padStart(2, '0');

// find_net_company is the one tool that reaches a third party (Nominatim, then Green Power Denmark; up to ~17 probes a miss).
// A per-isolate ceiling on top of the API's own 24 h cache bounds what any one client can make us send onward.
const NET_LOOKUPS = [];
const NET_SEEN = new Map();            // position (rounded to ~11 m) → the answer, for ten minutes
const NET_LOOKUPS_PER_MIN = 10;
function netLookupBudget(now = Date.now()) {
  while (NET_LOOKUPS.length && now - NET_LOOKUPS[0] > 60_000) NET_LOOKUPS.shift();
  if (NET_LOOKUPS.length >= NET_LOOKUPS_PER_MIN) return false;
  NET_LOOKUPS.push(now);
  return true;
}

const TOOLS = [
  {
    name: 'get_current_price',
    title: 'Current Danish electricity price',
    description: 'Get the current Danish electricity price (this hour) for a price zone. Use for "hvad er elprisen lige nu / hvad koster strøm nu".',
    inputSchema: { type: 'object', properties: { area: AREA_PROP, mode: MODE_PROP } },
    parse: a => ({ area: pickArea(a.area), mode: pickMode(a.mode) }),
    async run({ area, mode }, api) {
      const d = await api(`/api/now?area=${area}&mode=${mode}`);
      const price = d.price == null ? 'ukendt' : `${kr(d.price)} kr/kWh`;
      return `Elprisen i ${area} lige nu (kl. ${hh(d.hour)}:00): ${price} (${mode}).\n\n${JSON.stringify(d, null, 2)}`;
    },
  },
  {
    name: 'get_today_prices',
    title: 'Hourly Danish prices for a day',
    description: 'Get all 24 hourly electricity prices for a given date (default: today) in a price zone. Use for "elpriser i dag / time for time".',
    inputSchema: { type: 'object', properties: { area: AREA_PROP, mode: MODE_PROP, date: DATE_PROP('Date as YYYY-MM-DD. Defaults to today (Danish local time).') } },
    parse: a => ({ area: pickArea(a.area), mode: pickMode(a.mode), date: pickDate(a.date) }),
    async run({ area, mode, date }, api) {
      const d = await api(`/api/prices?area=${area}&mode=${mode}${date ? `&date=${date}` : ''}`);
      const list = Array.isArray(d.prices) ? d.prices : [];
      const rows = list.map(p => `${hh(p.hour)}:00  ${p.price == null ? '—' : kr(p.price) + ' kr/kWh'}`).join('\n');
      const none = list.length && list.every(p => p.price == null) ? "\n\n(No prices are published for this date yet — tomorrow's come out around 13:00 Danish time.)" : '';
      return `Elpriser ${area} ${d.date} (${mode}, ${d.unit}):\n${rows}${none}`;
    },
  },
  {
    name: 'get_cheapest_hours',
    title: 'Cheapest hours of the day',
    description: 'Find the N cheapest hours of the day for a price zone — for scheduling EV charging, heat pump, dishwasher etc. Use for "hvornår er strøm billigst i dag/i morgen".',
    inputSchema: { type: 'object', properties: {
      area: AREA_PROP, mode: MODE_PROP,
      hours: { type: 'integer', minimum: 1, maximum: 23, default: 4, description: 'How many cheapest hours to return.' },
      date: DATE_PROP('Date as YYYY-MM-DD. Defaults to today.'),
    } },
    parse: a => ({ area: pickArea(a.area), mode: pickMode(a.mode), hours: pickHours(a.hours), date: pickDate(a.date) }),
    async run({ area, mode, hours, date }, api) {
      const d = await api(`/api/schedule?area=${area}&mode=${mode}&strategy=cheapest_n&hours=${hours}${date ? `&date=${date}` : ''}`);
      const on = (d.schedule || []).filter(s => s.on && s.price != null).sort((a, b) => a.price - b.price);
      if (!on.length) return `Ingen priser for ${area} ${d.date} endnu (morgendagens kommer ca. kl. 13:00 dansk tid).`;
      const list = on.map(s => `${hh(s.hour)}:00  ${kr(s.price)} kr/kWh`).join('\n');
      return `De ${hours} billigste timer i ${area} (${d.date}, ${mode}):\n${list}`;
    },
  },
  {
    name: 'get_price_forecast',
    title: 'Danish price forecast',
    description: 'Get a 7-day electricity price forecast for a price zone (actual day-ahead prices for today/tomorrow, weather-corrected estimate beyond). Use for "elpriser de næste dage / prognose".',
    inputSchema: { type: 'object', properties: { area: AREA_PROP, mode: MODE_PROP } },
    parse: a => ({ area: pickArea(a.area), mode: pickMode(a.mode) }),
    async run({ area, mode }, api) {
      const d = await api(`/api/forecast?area=${area}&mode=${mode}`);
      const f = v => v == null ? '—' : kr(v);
      const days = (d.days || []).map(day => {
        const vals = (day.prices || []).map(p => p.price).filter(p => p != null);
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        return `${day.date} (${day.type}): snit ${f(avg)} · lav ${f(vals.length ? Math.min(...vals) : null)} · høj ${f(vals.length ? Math.max(...vals) : null)} kr/kWh`;
      }).join('\n');
      return `7-dages prognose ${area} (${mode}):\n${days}`;
    },
  },
  {
    name: 'get_european_prices',
    title: 'European spot prices',
    description: 'Get spot electricity prices (day-ahead, hourly) for any of 40 European bidding zones: Norway NO1-NO5, Sweden SE1-SE4, Finland, the Netherlands, Germany (de), France, Poland, Northern Italy (it-n), Austria, Belgium, Switzerland, Czechia, Hungary, Slovenia, Spain, Portugal, Slovakia, Greece, Romania, Bulgaria, Croatia, Serbia, Estonia, Latvia, Lithuania, Montenegro, North Macedonia, Albania, Ireland (ie), Kosovo (xk), Great Britain (gb) and Denmark (dk1, dk2). Prices are in EUR/MWh without VAT, taxes or grid fees (Poland and Great Britain also give the local currency in zoneInfo; gb is the within-day Market Index Price in GBP/MWh, not a day-ahead price). Days of type "forecast" are elpriser.org\'s own statistical estimate, not an official forecast. Use for "what is the electricity price in Germany / Spain / Norway today".',
    inputSchema: { type: 'object', properties: { zone: { type: 'string', enum: ZONES, description: 'Bidding zone key, e.g. de, fr, es, no1, se3, it-n, gb.' } }, required: ['zone'] },
    parse: a => ({ zone: pickZone(a.zone) }),
    async run({ zone }, api) {
      const d = await api(`/api/nordic?zone=${zone}`);
      const f = v => v == null ? '—' : (Math.round(v * 10) / 10).toString();
      const days = (d.days || []).map(day => {
        const hrs = (day.prices || []).filter(p => p.eur_mwh != null);
        const avg = hrs.length ? hrs.reduce((a, p) => a + p.eur_mwh, 0) / hrs.length : null;
        const lo = hrs.length ? hrs.reduce((a, b) => (b.eur_mwh < a.eur_mwh ? b : a)) : null;
        return `${day.date} (${day.type}${day.horizon ? ` D+${day.horizon}` : ''}): snit ${f(avg)} · billigste time ${lo ? hh(lo.hour) + ':00 ' + f(lo.eur_mwh) : '—'} · ${hrs.length} timer`;
      }).join('\n');
      return `Spotpriser ${zone.toUpperCase()} (${d.unit || 'EUR/MWh'}, uden moms, afgifter og nettarif):\n${days}\n\nFuld timeserie: https://elpriser.org/api/nordic?zone=${zone}`;
    },
  },
  {
    name: 'find_net_company',
    title: 'Find the Danish net company',
    description: 'Look up the Danish net company (netselskab) for a location by latitude/longitude — needed to compute the exact total price for an address. Use for "hvilket netselskab har jeg".',
    inputSchema: { type: 'object', properties: {
      lat: { type: 'number', minimum: DK_BOX.lat[0], maximum: DK_BOX.lat[1], description: 'Latitude (WGS84).' },
      lng: { type: 'number', minimum: DK_BOX.lng[0], maximum: DK_BOX.lng[1], description: 'Longitude (WGS84).' },
    }, required: ['lat', 'lng'] },
    parse: a => {
      const lat = pickCoord(a.lat, 'lat'), lng = pickCoord(a.lng, 'lng');
      if (lat < DK_BOX.lat[0] || lat > DK_BOX.lat[1] || lng < DK_BOX.lng[0] || lng > DK_BOX.lng[1]) {
        throw new InputError('the position is outside Denmark — net companies are only looked up for Danish addresses');
      }
      return { lat, lng };
    },
    async run({ lat, lng }, api) {
      const key = `${lat},${lng}`, seen = NET_SEEN.get(key);
      if (seen && seen.exp > Date.now()) return seen.text;          // asked again: no budget spent, nothing sent onward
      if (!netLookupBudget()) throw new InputError('too many net-company lookups at the moment — wait a minute and try again');
      const d = await api(`/api/supplierlookup?lat=${lat}&lng=${lng}`);
      const text = d.name
        ? `Netselskab for ${d.address || key}: ${d.name}`
        : `Kunne ikke bestemme netselskab for ${d.address || key}.`;
      if (NET_SEEN.size >= 64) NET_SEEN.delete(NET_SEEN.keys().next().value);
      NET_SEEN.set(key, { text, exp: Date.now() + 10 * 60_000 });
      return text;
    },
  },
].map(t => ({ ...t, annotations: READ_ONLY(t.title) }));

export const toolList = () => TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));

/** GET `pathAndQuery` from the site's own API without leaving the process. */
async function callApi(context, pathAndQuery) {
  const req = new Request('https://elpriser.org' + pathAndQuery, { method: 'GET', headers: { 'User-Agent': API_UA, Accept: 'application/json' } });
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('elpriser.org API timed out — retry shortly')), API_TIMEOUT_MS); });
  let res;
  try { res = await Promise.race([apiRequest({ ...context, request: req }), timeout]); } finally { clearTimeout(timer); }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`elpriser.org API: ${body && body.error ? body.error : 'HTTP ' + res.status}`);
  if (!isObj(body)) throw new Error('elpriser.org API: unexpected answer');
  return body;
}

async function callTool(tool, args, context) {
  const text = s => ({ content: [{ type: 'text', text: s }] });
  const fail = s => ({ isError: true, content: [{ type: 'text', text: `Fejl: ${s}` }] });
  try {
    const value = tool.parse(args);
    return text(await tool.run(value, p => callApi(context, p)));
  } catch (e) {
    if (!(e instanceof InputError)) console.error('mcp tool failed:', tool.name, e && e.message);   // never the arguments
    return fail(e instanceof InputError ? e.message : (e && e.message) || 'internal error');
  }
}

// ── JSON-RPC dispatch ─────────────────────────────────────────────────────────

/** The modern era's per-request checks (spec 2026-07-28: Streamable HTTP "Request Metadata"). Returns a Response or null. */
function modernCheck(request, msg, params, metaVersion, headerVersion) {
  const err = (status, code, message, data) => reply(status, rpcError(msg.id, code, message, data));
  const meta = isObj(params._meta) ? params._meta : null;
  if (metaVersion === undefined) return err(400, -32602, `Missing _meta["${META_VERSION}"]: requests for protocol ${headerVersion} carry their protocol version and client capabilities in _meta`);
  if (typeof metaVersion !== 'string' || !MODERN_VERSIONS.includes(metaVersion)) {
    return err(400, -32022, 'Unsupported protocol version', { supported: ALL_VERSIONS, requested: metaVersion });
  }
  if (!isObj(meta[META_CAPS])) return err(400, -32602, `Missing _meta["${META_CAPS}"]`);
  if (headerVersion !== metaVersion) return err(400, -32020, `Header mismatch: MCP-Protocol-Version is ${headerVersion === null ? 'missing' : `"${headerVersion}"`}, the body says "${metaVersion}"`);
  if (request.headers.get('mcp-method') !== msg.method) return err(400, -32020, `Header mismatch: Mcp-Method must be "${msg.method}"`);
  if (msg.method === 'tools/call') {
    const n = request.headers.get('mcp-name');
    if (n === null || decodeMcpName(n) !== params.name) return err(400, -32020, 'Header mismatch: Mcp-Name must equal params.name');
  }
  return null;
}

export async function handleMcp(context) {
  const { request } = context;

  // 1. Origin (DNS rebinding): present and not on the list → 403, before anything else is looked at.
  const origin = request.headers.get('origin');
  if (origin !== null && !originAllowed(origin, request.url)) {
    return reply(403, rpcError(null, -32600, 'Forbidden: this Origin may not call the MCP endpoint'), { cors: false });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...CORS } });
  if (request.method !== 'POST') {
    return reply(405, rpcError(null, -32600, 'Method not allowed: this MCP endpoint is stateless and accepts POST only (no SSE stream, no sessions). Docs: https://elpriser.org/api'),
      { headers: { Allow: 'POST, OPTIONS' } });
  }

  // 2. Envelope: Accept, Content-Type, size, JSON.
  if (!acceptsJson(request.headers.get('accept'))) {
    return reply(406, rpcError(null, -32600, 'Not acceptable: this server answers with application/json'));
  }
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('json')) return reply(415, rpcError(null, -32600, 'Unsupported media type: send application/json'));
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY) return reply(413, rpcError(null, -32600, 'Request body too large'));
  let raw;
  try { raw = await request.text(); } catch { return reply(400, rpcError(null, -32700, 'Parse error')); }
  if (raw.length > MAX_BODY) return reply(413, rpcError(null, -32600, 'Request body too large'));
  let msg;
  try { msg = JSON.parse(raw); } catch { return reply(400, rpcError(null, -32700, 'Parse error: the body is not valid JSON')); }
  if (Array.isArray(msg)) {
    return reply(400, rpcError(null, -32600, 'JSON-RPC batches are not supported (removed from MCP in 2025-06-18): send one message per POST'));
  }
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return reply(400, rpcError(null, -32600, 'Invalid request: not a JSON-RPC 2.0 message'));

  // 3. Messages that need no answer: a response from the client (we never ask) or a notification → 202, no body.
  if (typeof msg.method !== 'string') {
    if ((('result' in msg) || ('error' in msg)) && msg.id !== undefined) return reply(202, null);
    return reply(400, rpcError(null, -32600, 'Invalid request: "method" is missing'));
  }
  if (!('id' in msg)) return reply(202, null);
  if (typeof msg.id !== 'string' && typeof msg.id !== 'number') return reply(400, rpcError(null, -32600, 'Invalid request: "id" must be a string or a number'));

  // 4. A request. Which era?
  const params = msg.params === undefined ? {} : msg.params;
  if (!isObj(params)) return reply(200, rpcError(msg.id, -32602, 'Invalid params: must be an object'));
  const headerVersion = request.headers.get('mcp-protocol-version');
  const metaVersion = isObj(params._meta) ? params._meta[META_VERSION] : undefined;
  const modern = metaVersion !== undefined || (headerVersion !== null && MODERN_VERSIONS.includes(headerVersion));

  if (modern) {
    const bad = modernCheck(request, msg, params, metaVersion, headerVersion);
    if (bad) return bad;
  } else if (headerVersion !== null && !LEGACY_VERSIONS.includes(headerVersion)) {
    return reply(400, rpcError(msg.id, -32022, 'Unsupported protocol version', { supported: ALL_VERSIONS, requested: headerVersion }));
  }

  const done = result => reply(200, {
    jsonrpc: '2.0', id: msg.id,
    result: modern ? { resultType: 'complete', ...result, _meta: { ...(result._meta || {}), [META_SERVER]: { name: SERVER_INFO.name, version: SERVER_INFO.version } } } : result,
  });
  const protocolError = (status, code, message) => reply(modern ? status : 200, rpcError(msg.id, code, message));

  switch (msg.method) {
    case 'initialize': {
      if (modern) break;                                   // not part of the modern era → method not found below
      if (typeof params.protocolVersion !== 'string') return protocolError(200, -32602, 'Invalid params: protocolVersion is required');
      const protocolVersion = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0];
      return done({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return done({});
    case 'server/discover':
      if (!modern) break;
      return done({ supportedVersions: ALL_VERSIONS, capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'public' });
    case 'tools/list':
      return done(modern ? { tools: toolList(), ttlMs: 3_600_000, cacheScope: 'public' } : { tools: toolList() });
    case 'tools/call': {
      if (typeof params.name !== 'string') return protocolError(400, -32602, 'Invalid params: "name" is required');
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return protocolError(200, -32602, `Unknown tool: ${String(params.name).slice(0, 64)}`);
      const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
      if (!isObj(args)) return protocolError(200, -32602, 'Invalid params: "arguments" must be an object');
      return done(await callTool(tool, args, context));
    }
  }
  return protocolError(404, -32601, `Method not found: ${String(msg.method).slice(0, 64)}`);
}

// ── Discovery documents ───────────────────────────────────────────────────────

export const SERVER_CARD = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: 'org.elpriser/elpriser',
  version: SERVER_INFO.version,
  title: 'elpriser.org — electricity prices',
  description: 'Electricity prices: Denmark (DK1/DK2, with tariffs) and 40 European zones. Read-only, no key.',
  websiteUrl: 'https://elpriser.org',
  icons: [{ src: 'https://elpriser.org/favicon-192.png', mimeType: 'image/png', sizes: ['192x192'] }],
  remotes: [{ type: 'streamable-http', url: 'https://elpriser.org/mcp', supportedProtocolVersions: ALL_VERSIONS }],
};
export const AI_CATALOG = {
  specVersion: '1.0',
  entries: [{ identifier: 'urn:air:elpriser.org:mcp:elpriser', type: 'application/mcp-server-card+json', url: 'https://elpriser.org/mcp/server-card' }],
};

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A public, cacheable GET document with the CORS, ETag and 304 behaviour the Server Card extension asks for. */
export function serveDocument(request, doc, contentType) {
  const body = JSON.stringify(doc, null, 2);
  const etag = `"${fnv(body)}"`;
  const headers = {
    'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600', ETag: etag,
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept', 'Access-Control-Expose-Headers': 'ETag',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD, OPTIONS' } });
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
