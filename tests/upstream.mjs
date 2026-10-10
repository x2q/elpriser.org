// Hermetic harness for the Pages Function behind /api/*.
//
// The function talks to three outside services (Energi Data Service, OpenStreetMap
// Nominatim and Green Power Denmark). Running it against the real ones makes a
// test depend on the network, on rate limits and on what happens to be published
// today, so a red run could mean "the code is wrong" or "the internet is" with no
// way to tell. This loads the real handler in-process and answers its outbound
// fetch() calls from a deterministic fake, so a failure always means the code.
//
// Unknown hosts throw rather than being passed through: a new upstream shows up
// as a loud test failure instead of a silent live call.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HANDLER = path.resolve(import.meta.dirname, '../functions/api/[[catchall]].js');
let instance = 0;

const dkFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Copenhagen', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const toDK = d => dkFmt.format(d).replace(' ', 'T');
const iso = d => d.toISOString().slice(0, 19);
const dayStr = d => d.toISOString().slice(0, 10);

/** DKK/MWh for one hour: a morning bump, an evening peak, a slow drift by date. */
export function spotAt(date) {
  const h = date.getUTCHours();
  const dayIdx = Math.floor(date.getTime() / 86_400_000) % 7;
  return Math.round(500 + 300 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + dayIdx * 15 + (h >= 17 && h <= 20 ? 250 : 0));
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const GLNS = { '5790000704842': 'Konstant', '5790001089030': 'N1', '5790000705689': 'Radius' };

function tariffRecord(gln) {
  const rec = {
    ValidFrom: '2025-01-01T00:00:00', ValidTo: null, ResolutionDuration: 'PT1H',
    ChargeTypeCode: 'T-' + gln.slice(-4),
  };
  for (let i = 1; i <= 24; i++) rec['Price' + i] = (i >= 17 && i <= 20) ? 0.5 : 0.2;
  if (gln) rec.GLN_Number = gln;
  return rec;
}

function chargeRecords() {
  return [
    { ChargeTypeCode: '41000',  ValidFrom: '2025-01-01T00:00:00', ValidTo: null, Price1: 0.072 },
    { ChargeTypeCode: '40000',  ValidFrom: '2025-01-01T00:00:00', ValidTo: null, Price1: 0.043 },
    { ChargeTypeCode: 'EA-001', ValidFrom: '2025-01-01T00:00:00', ValidTo: '2026-01-01T00:00:00', Price1: 0.761 },
    { ChargeTypeCode: 'EA-001', ValidFrom: '2026-01-01T00:00:00', ValidTo: null, Price1: 0.008 },
    { ChargeTypeCode: 'EA-002', ValidFrom: '2025-01-01T00:00:00', ValidTo: null, Price1: 0.008 },
  ];
}

/** Hourly day-ahead rows for [start, end), published up to the end of tomorrow. */
function priceRows(dataset, area, start, end) {
  const lastPublished = Date.parse(dayStr(new Date(Date.now() + 86_400_000)) + 'T00:00:00Z') + 86_400_000;
  const rows = [];
  for (let t = Date.parse(start + 'T00:00:00Z'); t < Date.parse(end + 'T00:00:00Z') && t < lastPublished; t += 3_600_000) {
    const d = new Date(t), dkk = spotAt(d);
    rows.push(dataset === 'Elspotprices'
      ? { HourUTC: iso(d), HourDK: toDK(d), PriceArea: area, SpotPriceEUR: +(dkk / 7.46).toFixed(2), SpotPriceDKK: dkk }
      : { TimeUTC: iso(d), TimeDK: toDK(d), PriceArea: area, DayAheadPriceEUR: +(dkk / 7.46).toFixed(2), DayAheadPriceDKK: dkk });
  }
  return rows;
}

function eds(url) {
  const dataset = url.pathname.split('/').pop();
  const q = url.searchParams;
  const filter = JSON.parse(q.get('filter') || '{}');
  if (dataset === 'Elspotprices' || dataset === 'DayAheadPrices') {
    return { records: priceRows(dataset, filter.PriceArea || 'DK1', q.get('start'), q.get('end')) };
  }
  if (dataset === 'DatahubPricelist') {
    if (filter.Note === 'Nettarif C') {
      if (filter.GLN_Number) return { records: GLNS[filter.GLN_Number] ? [tariffRecord(filter.GLN_Number)] : [] };
      return { records: Object.keys(GLNS).map(tariffRecord) };
    }
    return { records: chargeRecords() };
  }
  if (dataset === 'CO2EmisProg') {
    const rows = [];
    const from = Date.parse(q.get('start') + 'T00:00:00Z');
    for (let t = from; t < from + 36 * 3_600_000; t += 300_000) {
      rows.push({ Minutes5DK: toDK(new Date(t)), CO2Emission: 80 + (new Date(t).getUTCHours() % 12) * 8 });
    }
    return { records: rows };
  }
  throw new Error('fake EDS: unknown dataset ' + dataset);
}

/**
 * Load a fresh copy of the handler (own module-level cache) with a fake network.
 *   nominatim(lat, lon) -> object | null   body for /reverse, null = HTTP 500
 *   gpd(address)        -> {status, body?, contentType?}
 */
export async function createApi({ nominatim = () => null, gpd = () => ({ status: 404 }) } = {}) {
  const calls = [];
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async req => { const r = store.get(req.url); return r ? r.clone() : undefined; },
      put: async (req, res) => { store.set(req.url, res); },
      delete: async req => store.delete(req.url),
    },
  };
  // The supplier lookup spaces its probes one second apart for Nominatim's
  // policy; nothing needs to wait for that here.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...a) => realSetTimeout(fn, 0, ...a);

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.href);
    if (url.hostname === 'api.energidataservice.dk') return json(eds(url));
    if (url.hostname === 'nominatim.openstreetmap.org') {
      const body = nominatim(+url.searchParams.get('lat'), +url.searchParams.get('lon'));
      return body ? json(body) : json({ error: 'fake' }, 500);
    }
    if (url.hostname === 'api.elnet.greenpowerdenmark.dk') {
      const addr = decodeURIComponent(url.pathname.split('/').pop());
      const r = gpd(addr);
      return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
        status: r.status, headers: { 'content-type': r.contentType || 'application/json' },
      });
    }
    throw new Error('hermetic test reached an unexpected upstream: ' + url.href);
  };

  const mod = await import(pathToFileURL(HANDLER).href + '?instance=' + (++instance));
  const env = {};
  return {
    calls,
    async get(pathAndQuery, headers = {}) {
      const res = await mod.onRequest({
        request: new Request('https://elpriser.org' + pathAndQuery, { headers }),
        env, waitUntil() {},
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* not JSON (e.g. a 304) */ }
      return { status: res.status, headers: res.headers, body };
    },
  };
}
