#!/usr/bin/env node
/**
 * The remote MCP server at https://elpriser.org/mcp (functions/mcp.js → functions/_mcp.js) and its discovery documents.
 * Run: npm run test:mcp   (hermetic: the real Pages Functions, with the same fake edge as test-api.mjs — fake Energi Data Service,
 *                          Nominatim, Green Power Denmark and ECB, an in-memory KV and Cache API; no network, no server)
 *
 * What is pinned here and why:
 *   - the protocol: initialize (three legacy revisions, and no session id minted), notifications → 202, ping, tools/list, tools/call,
 *     the 2026-07-28 "modern" shape (server/discover, resultType, _meta, the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers),
 *     JSON-RPC and HTTP error codes, 405 for everything that is not POST, the Origin rule, CORS, no-store;
 *   - the six tools against the real API handler: output text, input validation, errors as isError results, nothing logged from inputs;
 *   - the cost: a repeated call adds no Workers KV read (the free plan allows 100,000 a day), the third party behind find_net_company
 *     is never reached for a position outside Denmark, and there is a ceiling on how often it is reached at all;
 *   - the discovery documents (Server Card, AI Catalog) agree with the endpoint they describe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi, makeKv, priceArchiveYear } from './tests/upstream.mjs';

const ROOT = import.meta.dirname;
const load = f => import(pathToFileURL(path.join(ROOT, f)).href);

// ── the fake edge ─────────────────────────────────────────────────────────────

const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const dayOf = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const Y = +today.slice(0, 4);
const ECB = { DKK: 7.4748, NOK: 10.4665, SEK: 11.131, PLN: 4.3945, date: '2026-10-23' };
const feed = (zone, dates, type = 'actual') => ({
  zone, generated: today, trainedThrough: null, unit: 'EUR/MWh',
  days: dates.map((d, i) => ({ date: d, type, ...(type === 'forecast' ? { horizon: i } : {}), prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 50 + h + i })) })),
});

const realSetTimeout = globalThis.setTimeout;
const kv = makeKv({
  [`prices-archive-DK1-${Y - 1}`]: priceArchiveYear(Y - 1), [`prices-archive-DK1-${Y}`]: priceArchiveYear(Y), [`prices-archive-DK1-${Y + 1}`]: priceArchiveYear(Y + 1),
  [`prices-archive-DK2-${Y - 1}`]: priceArchiveYear(Y - 1), [`prices-archive-DK2-${Y}`]: priceArchiveYear(Y), [`prices-archive-DK2-${Y + 1}`]: priceArchiveYear(Y + 1),
  'nordic-forecast-se3': feed('se3', [dayOf(-1), dayOf(0)]),
  'nordic-forecast-fi': feed('fi', [dayOf(-1), dayOf(0)]),       // indexed by the Copenhagen hour, like the Nordic job's; /api/nordic serves it on Helsinki's clock
  'eu-prices-de': feed('de', [dayOf(0), dayOf(1)]),
  'eu-forecast-de': feed('de', [dayOf(2), dayOf(3)], 'forecast'),
});
const env = { PRICE_CACHE: kv };

const api = await createApi({
  kv, ecb: ECB,
  nominatim: (lat, lon) => (lat > 55 && lat < 56 ? { display_name: 'Rådhuspladsen 1, 1550 København, Danmark', address: { road: 'Rådhuspladsen', house_number: '1', postcode: '1550', city: 'København', country_code: 'dk' } } : null),
  gpd: () => ({ status: 200, body: { name: 'Radius Elnet A/S' } }),
});
// createApi squeezes every setTimeout to 0 ms so the supplier lookup need not wait between probes; the tool call's 25 s ceiling must not be squeezed with it.
const squeezed = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => (ms >= 10_000 ? realSetTimeout(fn, ms, ...a) : squeezed(fn, ms, ...a));

const mcp = await load('functions/_mcp.js');
const { onRequest: mcpRoute } = await load('functions/mcp.js');
const { onRequest: cardRoute } = await load('functions/mcp/server-card.js');
const { onRequest: wellKnownCardRoute } = await load('functions/.well-known/mcp/server-card.json.js');
const { onRequest: catalogRoute } = await load('functions/.well-known/ai-catalog.json.js');

const MODERN = '2026-07-28';
const ACCEPT = 'application/json, text/event-stream';

/** POST (or another method) to /mcp through the real route. `body` is serialised unless `raw` is given. */
async function post(body, { headers = {}, method = 'POST', raw } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', accept: ACCEPT, ...headers } };
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') init.body = raw ?? JSON.stringify(body);
  const res = await mcpRoute({ request: new Request('https://elpriser.org/mcp', init), env, waitUntil() {} });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 202 and 204 have no body */ }
  return { status: res.status, headers: res.headers, text, json };
}
let nextId = 1;
const rpc = (method, params, o = {}) => post({ jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) }, o);
const legacyCall = (name, args, o) => rpc('tools/call', { name, arguments: args }, o);
const META = { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } };
const modernHeaders = (method, name) => ({ 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}) });
const modernCall = (method, params = {}, name) => rpc(method, { ...params, ...META }, { headers: modernHeaders(method, name) });
const modernTool = (name, args) => modernCall('tools/call', { name, arguments: args }, name);
const textOf = r => r.json.result.content.map(c => c.text).join('\n');

// ── the protocol, legacy era (2025-03-26 … 2025-11-25) ───────────────────────

test('initialize: each legacy revision is echoed, an unknown one gets the newest; no session id is minted; the answer is no-store and CORS-open', async () => {
  for (const v of ['2025-11-25', '2025-06-18', '2025-03-26']) {
    const r = await rpc('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'c', version: '1' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.jsonrpc, '2.0');
    assert.equal(r.json.result.protocolVersion, v);
    assert.deepEqual(r.json.result.capabilities, { tools: { listChanged: false } });
    assert.equal(r.json.result.serverInfo.name, 'elpriser');
    assert.match(r.json.result.instructions, /DKK\/kWh/);
    assert.equal(r.json.result.resultType, undefined, 'a legacy answer has no resultType');
  }
  const odd = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.equal(odd.json.result.protocolVersion, '2025-11-25', 'a revision we do not serve is answered with the newest legacy one; the client decides');
  assert.equal(odd.headers.get('mcp-session-id'), null, 'stateless: no Mcp-Session-Id');
  assert.equal(odd.headers.get('cache-control'), 'no-store');
  assert.equal(odd.headers.get('access-control-allow-origin'), '*');
  assert.match(odd.headers.get('content-type'), /^application\/json/);
  assert.equal((await rpc('initialize', {})).json.error.code, -32602, 'protocolVersion is required');
});

test('the request id is echoed as sent: a number and a string alike; a null or object id is an invalid request', async () => {
  assert.equal((await post({ jsonrpc: '2.0', id: 'abc-1', method: 'ping' })).json.id, 'abc-1');
  assert.equal((await post({ jsonrpc: '2.0', id: 0, method: 'ping' })).json.id, 0);
  for (const id of [null, {}, [], true]) {
    const r = await post({ jsonrpc: '2.0', id, method: 'ping' });
    assert.equal(r.status, 400, JSON.stringify(id));
    assert.equal(r.json.error.code, -32600);
  }
});

test('notifications and client responses are accepted with 202 and no body', async () => {
  for (const m of [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', method: 'notifications/something-new' }, { jsonrpc: '2.0', id: 7, result: {} }, { jsonrpc: '2.0', id: 7, error: { code: -1, message: 'x' } }]) {
    const r = await post(m);
    assert.equal(r.status, 202, JSON.stringify(m));
    assert.equal(r.text, '');
  }
});

test('ping answers {} and the legacy MCP-Protocol-Version header is checked: a known one passes, an unknown one is 400 with the list', async () => {
  const ok = await rpc('ping', undefined, { headers: { 'mcp-protocol-version': '2025-06-18' } });
  assert.deepEqual(ok.json.result, {});
  const none = await rpc('ping');
  assert.deepEqual(none.json.result, {}, 'no header: assume 2025-03-26, the spec says');
  const bad = await rpc('ping', undefined, { headers: { 'mcp-protocol-version': '1999-01-01' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, -32022);
  assert.deepEqual(bad.json.error.data.supported, [MODERN, '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.equal(bad.json.error.data.requested, '1999-01-01');
});

test('a session id sent by an older client is ignored, not echoed', async () => {
  const r = await rpc('tools/list', undefined, { headers: { 'mcp-session-id': 'abc', 'last-event-id': '5' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('mcp-session-id'), null);
});

test('unknown methods are -32601 (200 in the legacy era); resources, prompts and logging are not offered', async () => {
  for (const m of ['resources/list', 'prompts/list', 'logging/setLevel', 'completion/complete', 'nope', 'server/discover']) {
    const r = await rpc(m, {});
    assert.equal(r.status, 200, m);
    assert.equal(r.json.error.code, -32601, m);
    assert.equal(r.json.id, nextId - 1);
  }
});

// ── tools/list ───────────────────────────────────────────────────────────────

const TOOL_NAMES = ['get_current_price', 'get_today_prices', 'get_cheapest_hours', 'get_price_forecast', 'get_european_prices', 'find_net_company'];
const KEYWORDS = new Set(['type', 'enum', 'default', 'description', 'pattern', 'minimum', 'maximum', 'properties', 'required']);

/** The part of JSON Schema these tools use, enough to hold the schemas to account. Returns a list of problems. */
function validate(schema, v, at = 'args') {
  const bad = [];
  if (schema.type === 'object') {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${at}: not an object`];
    for (const k of schema.required || []) if (!(k in v)) bad.push(`${at}.${k}: required`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) bad.push(...validate(s, v[k], `${at}.${k}`));
    return bad;
  }
  if (schema.type === 'string' && typeof v !== 'string') return [`${at}: not a string`];
  if (schema.type === 'integer' && !Number.isInteger(v)) return [`${at}: not an integer`];
  if (schema.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) return [`${at}: not a number`];
  if (schema.enum && !schema.enum.includes(v)) bad.push(`${at}: not in enum`);
  if (schema.pattern && !new RegExp(schema.pattern).test(v)) bad.push(`${at}: pattern`);
  if (schema.minimum !== undefined && v < schema.minimum) bad.push(`${at}: below minimum`);
  if (schema.maximum !== undefined && v > schema.maximum) bad.push(`${at}: above maximum`);
  return bad;
}

test('tools/list: the six tools of the npm package, in order, each with a valid JSON Schema and read-only annotations', async () => {
  const r = await rpc('tools/list');
  assert.equal(r.status, 200);
  const tools = r.json.result.tools;
  assert.deepEqual(tools.map(t => t.name), TOOL_NAMES);
  assert.deepEqual((await rpc('tools/list')).json.result.tools, tools, 'deterministic');
  for (const t of tools) {
    assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(t.title && t.description.length > 40, `${t.name}: title and description`);
    assert.deepEqual(t.annotations, { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    const s = t.inputSchema;
    assert.equal(s.type, 'object', `${t.name}: inputSchema is an object schema`);
    assert.ok(s.properties && typeof s.properties === 'object');
    for (const k of s.required || []) assert.ok(k in s.properties, `${t.name}: required ${k} is a property`);
    for (const [k, p] of Object.entries(s.properties)) {
      assert.ok(['string', 'integer', 'number'].includes(p.type), `${t.name}.${k}: type`);
      assert.ok(p.description, `${t.name}.${k}: described`);
      for (const kw of Object.keys(p)) assert.ok(KEYWORDS.has(kw), `${t.name}.${k}: keyword ${kw}`);
      if (p.enum) assert.ok(p.enum.length > 0 && new Set(p.enum).size === p.enum.length && p.enum.every(e => typeof e === p.type), `${t.name}.${k}: enum`);
      if (p.default !== undefined) assert.deepEqual(validate(p, p.default), [], `${t.name}.${k}: the default satisfies its own schema`);
      if (p.pattern) new RegExp(p.pattern);
    }
    JSON.parse(JSON.stringify(t));
  }
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  assert.deepEqual(byName.get_cheapest_hours.inputSchema.properties.hours, { type: 'integer', minimum: 1, maximum: 23, default: 4, description: 'How many cheapest hours to return.' });
  assert.deepEqual(byName.get_european_prices.inputSchema.required, ['zone']);
  assert.deepEqual(byName.find_net_company.inputSchema.required, ['lat', 'lng']);
  assert.deepEqual(byName.get_current_price.inputSchema.properties.mode.enum, ['spot_ex', 'spot_inkl', 'inkl_alt', 'inkl_alt_minus']);
});

test('the schemas and the server-side checks agree: whatever a schema rejects the tool rejects, and the other way round', async () => {
  const schemaOf = Object.fromEntries((await rpc('tools/list')).json.result.tools.map(t => [t.name, t.inputSchema]));
  const cases = [
    ['get_current_price', {}, true], ['get_current_price', { area: 'DK2', mode: 'spot_ex' }, true], ['get_current_price', { area: 'DK3' }, false], ['get_current_price', { mode: 'net_inkl_alt' }, false],
    ['get_today_prices', { date: dayOf(0) }, true], ['get_today_prices', { date: 'today' }, false], ['get_today_prices', { date: 20261103 }, false],
    ['get_cheapest_hours', { hours: 1 }, true], ['get_cheapest_hours', { hours: 23 }, true], ['get_cheapest_hours', { hours: 0 }, false], ['get_cheapest_hours', { hours: 24 }, false],
    ['get_cheapest_hours', { hours: 2.5 }, false], ['get_cheapest_hours', { hours: '4' }, false],
    ['get_european_prices', { zone: 'de' }, true], ['get_european_prices', { zone: 'it-n' }, true], ['get_european_prices', { zone: 'xx' }, false], ['get_european_prices', {}, false],
    ['find_net_company', { lat: 55.68, lng: 12.57 }, true], ['find_net_company', { lat: '55.68', lng: 12.57 }, false], ['find_net_company', { lat: 55.68 }, false],
    ['find_net_company', { lat: 48.1, lng: 11.5 }, false],   // Munich: a number, but outside Denmark (the schema's minimum/maximum say so too)
  ];
  for (const [name, args, good] of cases) {
    assert.equal(validate(schemaOf[name], args).length === 0, good, `schema: ${name} ${JSON.stringify(args)}`);
    // A tool that fails to validate answers isError; one that validates must not complain about the arguments (it may still fail upstream, hence the fake edge).
    const r = await legacyCall(name, args);
    const complainsAboutInput = !!r.json.result.isError && /must be|outside Denmark|no prices (before|after)|too many/.test(textOf(r));
    assert.equal(!complainsAboutInput, good, `tool: ${name} ${JSON.stringify(args)} → ${textOf(r).slice(0, 100)}`);
  }
});

test('the 40 zones of get_european_prices are exactly the ones /api/nordic serves (NORDIC_ZONES + the four EU_ZONES_* lists)', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
  const arr = name => (src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) || [])[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
  const served = [...arr('NORDIC_ZONES'), ...arr('EU_ZONES_ENERGY_CHARTS'), ...arr('EU_ZONES_ENTSOE'), ...arr('EU_ZONES_ELEXON'), ...arr('EU_ZONES_SEMOPX')];
  assert.equal(served.length, 40);
  assert.deepEqual([...mcp.ZONES].sort(), [...served].sort());
  const t = (await rpc('tools/list')).json.result.tools.find(x => x.name === 'get_european_prices');
  assert.deepEqual(t.inputSchema.properties.zone.enum, mcp.ZONES);
  assert.match(t.description, /40 European bidding zones/);
  const modes = (src.match(/const PRICE_MODE_SET = new Set\(\[([^\]]*)\]/) || [])[1];
  for (const m of mcp.MODES) assert.ok(modes.includes(`'${m}'`), `/api accepts the mode ${m}`);
});

// ── tools/call, against the real API handler ─────────────────────────────────

test('get_current_price: the price of this hour in Danish, with the API answer appended', async () => {
  const r = await legacyCall('get_current_price', { area: 'DK1', mode: 'spot_inkl' });
  assert.equal(r.status, 200);
  assert.ok(!r.json.result.isError, textOf(r));
  assert.match(textOf(r), /^Elprisen i DK1 lige nu \(kl\. \d\d:00\): \d+,\d\d kr\/kWh \(spot_inkl\)\.\n\n\{/);
  const body = JSON.parse(textOf(r).slice(textOf(r).indexOf('{')));
  assert.equal(body.area, 'DK1'); assert.equal(body.mode, 'spot_inkl'); assert.equal(typeof body.price, 'number');
  const dflt = await legacyCall('get_current_price', {});
  assert.match(textOf(dflt), /^Elprisen i DK1 lige nu .*\(inkl_alt\)/, 'the defaults are DK1 and inkl_alt');
  const dk2 = await legacyCall('get_current_price', { area: 'dk2' });
  assert.match(textOf(dk2), /^Elprisen i DK2/, 'a lower-case zone is accepted');
});

test('get_today_prices: 24 lines for today, and for a day in the archive', async () => {
  const r = await legacyCall('get_today_prices', { area: 'DK2', mode: 'spot_ex' });
  assert.ok(!r.json.result.isError, textOf(r));
  const lines = textOf(r).split('\n');
  assert.equal(lines[0], `Elpriser DK2 ${today} (spot_ex, DKK/kWh):`);
  assert.equal(lines.length, 25);
  assert.match(lines[1], /^00:00  \d+,\d\d kr\/kWh$/);
  const old = `${Y - 1}-06-15`;
  const h = await legacyCall('get_today_prices', { date: old });
  assert.equal(textOf(h).split('\n')[0], `Elpriser DK1 ${old} (inkl_alt, DKK/kWh):`);
  assert.ok(!/—/.test(textOf(h)), 'a day in the archive has a price for every hour');
});

test('get_cheapest_hours: N hours, cheapest first; the date is optional', async () => {
  const r = await legacyCall('get_cheapest_hours', { area: 'DK1', hours: 5, mode: 'spot_ex' });
  assert.ok(!r.json.result.isError, textOf(r));
  const lines = textOf(r).split('\n');
  assert.equal(lines[0], `De 5 billigste timer i DK1 (${today}, spot_ex):`);
  const prices = lines.slice(1).map(l => +l.split('  ')[1].replace(' kr/kWh', '').replace(',', '.'));
  assert.equal(prices.length, 5);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'cheapest first');
  const d = await legacyCall('get_cheapest_hours', { hours: 3, date: `${Y - 1}-03-01` });
  assert.equal(textOf(d).split('\n')[0], `De 3 billigste timer i DK1 (${Y - 1}-03-01, inkl_alt):`);
  assert.equal(textOf(d).split('\n').length, 4);
});

test('get_price_forecast: one line per day with average, low and high', async () => {
  const r = await legacyCall('get_price_forecast', { area: 'DK1' });
  assert.ok(!r.json.result.isError, textOf(r));
  const lines = textOf(r).split('\n');
  assert.equal(lines[0], '7-dages prognose DK1 (inkl_alt):');
  assert.ok(lines.length >= 4);
  assert.match(lines[1], /^\d{4}-\d\d-\d\d \((actual|forecast)\): snit \d+,\d\d · lav \d+,\d\d · høj \d+,\d\d kr\/kWh$/);
});

test('get_european_prices: a Nordic zone and an EU zone with its forecast days, in EUR/MWh; a zone without data is an error result', async () => {
  const se = await legacyCall('get_european_prices', { zone: 'SE3' });
  assert.ok(!se.json.result.isError, textOf(se));
  assert.match(textOf(se), /^Spotpriser SE3 \(EUR\/MWh, uden moms, afgifter og nettarif\):\n/);
  assert.match(textOf(se), new RegExp(`${dayOf(0)} \\(actual\\): snit 62\\.5 · billigste time 00:00 51 · 24 timer`));
  assert.match(textOf(se), /Fuld timeserie: https:\/\/elpriser\.org\/api\/nordic\?zone=se3$/);
  const de = await legacyCall('get_european_prices', { zone: 'de' });
  assert.ok(!de.json.result.isError, textOf(de));
  assert.match(textOf(de), new RegExp(`${dayOf(2)} \\(forecast\\).*\\n${dayOf(3)} \\(forecast D\\+1\\)`), 'forecast days follow the settled ones, labelled as such');
  const none = await legacyCall('get_european_prices', { zone: 'fr' });
  assert.equal(none.json.result.isError, true);
  assert.match(textOf(none), /^Fejl: elpriser\.org API: no prices available for fr$/);
});

test('get_european_prices: fi is on Helsinki\'s clock — the cheapest hour of the feed (Copenhagen 00:00 = 51) is Finnish 01:00, and a first day without the day before has 23 hours', async () => {
  const fi = await legacyCall('get_european_prices', { zone: 'fi' });
  assert.ok(!fi.json.result.isError, textOf(fi));
  // the feed's two days are yesterday (50+h) and today (51+h): Helsinki today = yesterday's hour 23 (73) at 00:00, then today's hours 0-22 (51..73) at 01:00..23:00
  assert.match(textOf(fi), new RegExp(`${dayOf(0)} \\(actual\\): snit 62\\.\\d · billigste time 01:00 51 · 24 timer`));
  assert.match(textOf(fi), new RegExp(`${dayOf(-1)} \\(actual\\): snit [\\d.]+ · billigste time 01:00 50 · 23 timer`), 'the first day has no source for 00:00');
  const se = await legacyCall('get_european_prices', { zone: 'se3' });
  assert.match(textOf(se), new RegExp(`${dayOf(0)} \\(actual\\): snit 62\\.5 · billigste time 00:00 51 · 24 timer`), 'a Copenhagen-clock zone is as it was');
});

test('find_net_company: the net company of a Danish position, through Nominatim and Green Power Denmark', async () => {
  const r = await legacyCall('find_net_company', { lat: 55.6761, lng: 12.5683 });
  assert.ok(!r.json.result.isError, textOf(r));
  assert.equal(textOf(r), 'Netselskab for Rådhuspladsen 1, 1550 København, Danmark: Radius Elnet A/S');
});

// ── input validation and error results ───────────────────────────────────────

test('bad input is an error RESULT (isError, with the reason) so the model can correct itself — not a protocol error', async () => {
  const before = api.calls.length;
  const bad = [
    ['get_european_prices', { zone: 'xx' }, /zone must be one of: dk1, dk2, .*, xk$/],
    ['get_european_prices', {}, /zone must be one of/],
    ['get_current_price', { area: 'DK3' }, /area must be "DK1" or "DK2"/],
    ['get_current_price', { mode: 'net_inkl_alt' }, /mode must be one of: spot_ex, spot_inkl, inkl_alt, inkl_alt_minus/],
    ['get_today_prices', { date: '03-11-2026' }, /date must be a real calendar date written YYYY-MM-DD/],
    ['get_today_prices', { date: `${Y}-02-30` }, /real calendar date/],
    ['get_today_prices', { date: `${Y}-13-01` }, /real calendar date/],
    ['get_today_prices', { date: 20261103 }, /real calendar date/],
    ['get_today_prices', { date: dayOf(5) }, /no prices after/],
    ['get_today_prices', { date: '1999-01-01' }, /no prices before/],
    ['get_cheapest_hours', { hours: 0 }, /hours must be a whole number from 1 to 23/],
    ['get_cheapest_hours', { hours: 24 }, /hours must be a whole number from 1 to 23/],
    ['get_cheapest_hours', { hours: 1.5 }, /hours must be/],
    ['get_cheapest_hours', { hours: '4' }, /hours must be/],
    ['find_net_company', { lat: 'x', lng: 12 }, /lat must be a number/],
    ['find_net_company', { lat: 55 }, /lng must be a number/],
    ['find_net_company', { lat: null, lng: null }, /lat must be a number/],
    ['find_net_company', { lat: 48.14, lng: 11.58 }, /outside Denmark/],
    ['find_net_company', { lat: 1e9, lng: 12 }, /outside Denmark/],
  ];
  for (const [name, args, re] of bad) {
    const r = await legacyCall(name, args);
    assert.equal(r.status, 200, name);
    assert.equal(r.json.result.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(r.json.error, undefined);
    assert.match(textOf(r), /^Fejl: /);
    assert.match(textOf(r), re, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(api.calls.length, before, 'invalid input never reaches an upstream (and a position outside Denmark never reaches Nominatim)');
});

test('protocol errors: unknown tool, missing name, arguments that are not an object', async () => {
  const unknown = await legacyCall('delete_everything', {});
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.error.code, -32602);
  assert.match(unknown.json.error.message, /^Unknown tool: delete_everything$/);
  assert.equal((await rpc('tools/call', {})).json.error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 7 })).json.error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'get_current_price', arguments: 'DK1' })).json.error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'get_current_price', arguments: [] })).json.error.code, -32602);
  assert.equal((await rpc('tools/call', 'x')).json.error.code, -32602, 'params must be an object');
  assert.ok(!(await rpc('tools/call', { name: 'get_current_price' })).json.result.isError, 'arguments may be left out when every field has a default');
  assert.ok(!(await rpc('tools/call', { name: 'get_current_price', arguments: null })).json.result.isError);
});

test('an upstream that fails becomes an error result, with the API\'s own reason', async () => {
  const r = await legacyCall('get_european_prices', { zone: 'pl' });   // no eu-prices-pl in the KV: the API answers 404
  assert.equal(r.status, 200);
  assert.equal(r.json.result.isError, true);
  assert.equal(textOf(r), 'Fejl: elpriser.org API: no prices available for pl');
});

// ── the HTTP envelope ────────────────────────────────────────────────────────

test('malformed bodies: not JSON → 400 -32700; not JSON-RPC → 400 -32600; a batch → 400 -32600; too large → 413', async () => {
  const notJson = await post(null, { raw: '{"jsonrpc": ' });
  assert.equal(notJson.status, 400); assert.equal(notJson.json.error.code, -32700); assert.equal(notJson.json.id, null);
  assert.equal((await post(null, { raw: '' })).json.error.code, -32700);
  for (const m of [{ method: 'ping', id: 1 }, { jsonrpc: '1.0', method: 'ping', id: 1 }, 'ping', 42, null, {}, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: 1, method: 5 }]) {
    const r = await post(m);
    assert.equal(r.status, 400, JSON.stringify(m));
    assert.equal(r.json.error.code, -32600, JSON.stringify(m));
  }
  const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
  assert.equal(batch.status, 400); assert.equal(batch.json.error.code, -32600); assert.match(batch.json.error.message, /batch/i);
  assert.equal((await post([])).status, 400);
  const big = await post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(40_000) } });
  assert.equal(big.status, 413);
  const bigDeclared = await post(null, { raw: '{}', headers: { 'content-length': '999999' } });
  assert.equal(bigDeclared.status, 413);
});

test('only POST: GET, DELETE, PUT, HEAD and PATCH are 405 with Allow (no SSE stream, no session to end)', async () => {
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH', 'HEAD']) {
    const r = await post(null, { method, headers: { accept: 'text/event-stream', 'mcp-session-id': 'x' } });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'POST, OPTIONS', method);
    if (method !== 'HEAD') assert.equal(r.json.error.code, -32600, method);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('Accept and Content-Type: JSON is served to anything that accepts it; an SSE-only client gets 406; another body type 415', async () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const accept of [undefined, '*/*', 'application/json', 'application/json, text/event-stream', 'text/event-stream, application/json;q=0.9', 'application/*']) {
    const h = accept === undefined ? { accept: '' } : { accept };
    const r = await post(ping, { headers: h });
    assert.equal(r.status, 200, String(accept));
  }
  assert.equal((await post(ping, { headers: { accept: 'text/event-stream' } })).status, 406);
  assert.equal((await post(ping, { headers: { accept: 'text/html' } })).status, 406);
  assert.equal((await post(ping, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await post(ping, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
});

test('Origin (DNS rebinding): none → fine; our own site, localhost, Claude and ChatGPT → fine with CORS; anything else, and "null", → 403 with no CORS headers', async () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const origin of ['https://elpriser.org', 'https://www.elpriser.org', 'http://localhost:6274', 'http://127.0.0.1:3000', 'http://[::1]:8080', 'https://claude.ai', 'https://app.claude.ai',
    'https://chatgpt.com', 'https://chat.openai.com', 'https://inspector.modelcontextprotocol.io']) {
    const r = await post(ping, { headers: { origin } });
    assert.equal(r.status, 200, origin);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', origin);
  }
  for (const origin of ['https://evil.example', 'https://elpriser.org.evil.example', 'https://notclaude.ai', 'https://claude.ai.evil.example', 'http://elpriser.org', 'null', 'file://', 'not a url',
    'https://localhost.evil.example', 'http://localhost.evil.example:80', 'chrome-extension://abc']) {
    const r = await post(ping, { headers: { origin } });
    assert.equal(r.status, 403, origin);
    assert.equal(r.json.error.code, -32600);
    assert.equal(r.json.id, null);
    assert.equal(r.headers.get('access-control-allow-origin'), null, `${origin}: a refused origin gets no CORS grant`);
  }
  // The same rule holds for a GET and for a preflight: nothing is looked at before the Origin.
  assert.equal((await post(null, { method: 'GET', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(null, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })).status, 403);
  assert.ok(mcp.originAllowed('http://localhost:9', 'https://elpriser.org/mcp'));
  assert.ok(!mcp.originAllowed('https://staging.example', 'https://elpriser.org/mcp'));
  assert.ok(mcp.originAllowed('https://abc123.elpriser-org.pages.dev', 'https://abc123.elpriser-org.pages.dev/mcp'), 'a preview deployment may call itself');
});

test('CORS preflight: 204, POST and the MCP headers allowed, cached for a day', async () => {
  for (const origin of [undefined, 'https://claude.ai', 'http://localhost:6274']) {
    const r = await post(null, { method: 'OPTIONS', headers: { ...(origin ? { origin } : {}), 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,mcp-protocol-version' } });
    assert.equal(r.status, 204);
    assert.equal(r.text, '');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-methods'), /POST/);
    for (const h of ['Content-Type', 'Accept', 'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Mcp-Session-Id']) assert.ok(r.headers.get('access-control-allow-headers').includes(h), h);
    assert.equal(r.headers.get('access-control-max-age'), '86400');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('every answer is Cache-Control: no-store and not indexable, whatever its status', async () => {
  const answers = [await rpc('ping'), await post(null, { raw: '{' }), await post({ jsonrpc: '2.0', method: 'notifications/initialized' }), await post(null, { method: 'GET' }),
    await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { origin: 'https://evil.example' } }), await legacyCall('get_current_price', {}), await legacyCall('nope', {})];
  for (const r of answers) {
    assert.equal(r.headers.get('cache-control'), 'no-store', String(r.status));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
  }
});

// ── the modern era (2026-07-28) ──────────────────────────────────────────────

test('modern: server/discover lists the versions, tools capability and cache hints; every result has resultType and serverInfo', async () => {
  const r = await modernCall('server/discover');
  assert.equal(r.status, 200);
  const res = r.json.result;
  assert.equal(res.resultType, 'complete');
  assert.deepEqual(res.supportedVersions, [MODERN, '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.deepEqual(res.capabilities, { tools: {} });
  assert.equal(res._meta['io.modelcontextprotocol/serverInfo'].name, 'elpriser');
  assert.ok(res.ttlMs >= 0 && res.cacheScope === 'public');
  assert.ok(res.instructions);
  const list = await modernCall('tools/list');
  assert.equal(list.json.result.resultType, 'complete');
  assert.deepEqual(list.json.result.tools.map(t => t.name), TOOL_NAMES);
  assert.ok(list.json.result.ttlMs >= 0 && list.json.result.cacheScope === 'public');
  assert.deepEqual((await modernCall('ping')).json.result.resultType, 'complete');
});

test('modern: tools/call needs no handshake; the tool answer carries resultType, an input error is still an isError result', async () => {
  const r = await modernTool('get_cheapest_hours', { area: 'DK1', hours: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.resultType, 'complete');
  assert.match(textOf(r), /^De 2 billigste timer i DK1/);
  const bad = await modernTool('get_cheapest_hours', { hours: 99 });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.result.isError, true);
  assert.equal(bad.json.result.resultType, 'complete');
  const unknown = await modernTool('nope', {});
  assert.equal(unknown.json.error.code, -32602);
  // A tool name that is not plain ASCII travels base64-encoded in Mcp-Name.
  const enc = Buffer.from('get_current_price').toString('base64');
  const r2 = await rpc('tools/call', { name: 'get_current_price', arguments: {}, ...META }, { headers: { ...modernHeaders('tools/call'), 'mcp-name': `=?base64?${enc}?=` } });
  assert.equal(r2.status, 200);
});

test('modern: a missing or wrong header, version or capabilities is a 400 with the spec\'s error code', async () => {
  const send = (headers, params = { ...META }, method = 'ping') => rpc(method, params, { headers });
  const full = modernHeaders('ping');
  const ok = await send(full);
  assert.equal(ok.status, 200);
  let r = await send({ ...full, 'mcp-protocol-version': undefined });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020);
  r = await send({ ...full, 'mcp-protocol-version': '2025-11-25' });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, 'header and body disagree');
  r = await send({ 'mcp-protocol-version': MODERN });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, 'Mcp-Method missing');
  r = await send({ ...full, 'mcp-method': 'tools/list' });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, 'Mcp-Method names another method');
  r = await rpc('tools/call', { name: 'get_current_price', arguments: {}, ...META }, { headers: modernHeaders('tools/call') });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, 'Mcp-Name missing on tools/call');
  r = await rpc('tools/call', { name: 'get_current_price', arguments: {}, ...META }, { headers: modernHeaders('tools/call', 'get_today_prices') });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, 'Mcp-Name names another tool');
  r = await send(full, {});
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32602, 'the header says modern, the body has no _meta');
  const noCaps = { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } };
  r = await send(full, noCaps);
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32602, 'clientCapabilities are required');
  const future = { _meta: { ...META._meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } };
  r = await send({ ...full, 'mcp-protocol-version': '2099-01-01' }, future);
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32022);
  assert.deepEqual(r.json.error.data, { supported: [MODERN, '2025-11-25', '2025-06-18', '2025-03-26'], requested: '2099-01-01' });
});

test('modern: initialize does not exist and an unknown method is a 404 with -32601 (the spec tells it apart from a legacy server\'s 404 by the body)', async () => {
  let r = await modernCall('initialize', { protocolVersion: MODERN, capabilities: {} });
  assert.equal(r.status, 404); assert.equal(r.json.error.code, -32601);
  r = await modernCall('resources/list');
  assert.equal(r.status, 404); assert.equal(r.json.error.code, -32601);
});

// ── cost and privacy ─────────────────────────────────────────────────────────

test('a repeated tool call adds no Workers KV read and no upstream request: the API\'s own layers answer it', async () => {
  const calls = [['get_current_price', { area: 'DK1' }], ['get_today_prices', { area: 'DK1' }], ['get_cheapest_hours', { area: 'DK1', hours: 4 }], ['get_price_forecast', { area: 'DK1' }],
    ['get_european_prices', { zone: 'se3' }], ['get_european_prices', { zone: 'de' }], ['find_net_company', { lat: 55.6761, lng: 12.5683 }]];
  for (const [n, a] of calls) await legacyCall(n, a);        // warm
  const reads = kv.reads(), up = api.calls.length, upAt = [...api.calls];
  for (let i = 0; i < 10; i++) for (const [n, a] of calls) assert.ok(!(await legacyCall(n, a)).json.result.isError);
  assert.equal(kv.reads(), reads, '70 repeated calls: 0 KV reads');
  // The one request that is repeated is /api/nordic's ECB reference-rate fetch, which production sends with cf.cacheEverything (6 h at the edge).
  assert.deepEqual(api.calls.slice(upAt.length).filter(u => !u.startsWith('https://www.ecb.europa.eu/')), [], '70 repeated calls: 0 upstream requests');
  // The protocol messages themselves touch nothing at all.
  const upNow = api.calls.length;
  for (const m of ['initialize', 'tools/list', 'ping']) await rpc(m, m === 'initialize' ? { protocolVersion: '2025-11-25' } : undefined);
  assert.equal(kv.reads(), reads);
  assert.equal(api.calls.length, upNow, 'the protocol messages make no request at all');
});

test('nothing a caller sends is logged: not on success, not on a rejected input, not on an upstream failure', async () => {
  const logged = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { saved[k] = console[k]; console[k] = (...a) => logged.push(a.map(String).join(' ')); }
  try {
    await legacyCall('get_today_prices', { area: 'DK1', date: '2023-04-17zzSECRETDATE' });
    await legacyCall('find_net_company', { lat: 55.123456, lng: 12.654321 });
    await legacyCall('get_cheapest_hours', { hours: 987654 });
    await legacyCall('get_european_prices', { zone: 'sk' });         // fails upstream
    await post(null, { raw: '{"secret": "SECRETBODY"' });
    await legacyCall('SECRETTOOL', { x: 'SECRETARG' });
  } finally { for (const k of Object.keys(saved)) console[k] = saved[k]; }
  const all = logged.join('\n');
  for (const s of ['SECRET', '55.1234', '12.6543', '987654']) assert.ok(!all.includes(s), `"${s}" was logged:\n${all}`);
  assert.ok(!/console\.(log|info|warn|debug)/.test(fs.readFileSync(path.join(ROOT, 'functions/_mcp.js'), 'utf8')), 'the module logs nothing on its own');
});

test('no secrets, no auth and no state in the module: no env reads, no storage, no session', () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/_mcp.js'), 'utf8');
  assert.ok(!/context\.env|\benv\b|PRICE_CACHE|FLEX_DB|USAGE|caches\.|localStorage|writeDataPoint|waitUntil|crypto\.randomUUID|Set-Cookie|Authorization:/.test(src.replace(/'Content-Type, Accept[^']*'/, '')), 'no binding, write, cookie or token');
  assert.ok(!/Mcp-Session-Id'?\s*:/.test(src.replace(/'Content-Type, Accept[^']*'/, '')), 'a session id is never set');
});

test('find_net_company reaches the third parties at most 10 times a minute per isolate, and says so', async () => {
  let refused = null;
  for (let i = 0; i < 12 && !refused; i++) {
    const r = await legacyCall('find_net_company', { lat: 55 + i / 1000, lng: 12.5 });
    if (r.json.result.isError) refused = textOf(r);
  }
  assert.match(refused || '', /^Fejl: too many net-company lookups at the moment — wait a minute and try again$/);
  // The other tools are not rationed by it.
  assert.ok(!(await legacyCall('get_current_price', {})).json.result.isError);
});

// ── discovery ────────────────────────────────────────────────────────────────

const getDoc = async (route, p, headers = {}, method = 'GET') => {
  const res = await route({ request: new Request('https://elpriser.org' + p, { method, headers }), env });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
};

test('Server Card at /mcp/server-card and /.well-known/mcp/server-card.json, AI Catalog at /.well-known/ai-catalog.json: they describe this endpoint', async () => {
  const card = await getDoc(cardRoute, '/mcp/server-card');
  assert.equal(card.status, 200);
  assert.equal(card.headers.get('content-type'), 'application/mcp-server-card+json; charset=utf-8');
  const c = card.json;
  assert.equal(c.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
  assert.match(c.name, /^[a-z0-9.-]+\/[A-Za-z0-9._-]+$/); assert.ok(c.name.length >= 3 && c.name.length <= 200);
  assert.ok(c.version && c.version.length <= 255);
  assert.ok(c.description.length >= 1 && c.description.length <= 100, 'description is 1–100 characters: ' + c.description.length);
  assert.ok(c.title.length <= 100);
  assert.equal(c.remotes.length, 1);
  assert.equal(c.remotes[0].type, 'streamable-http');
  assert.equal(c.remotes[0].url, 'https://elpriser.org/mcp');
  assert.deepEqual(c.remotes[0].supportedProtocolVersions, [MODERN, '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.equal(c.remotes[0].headers, undefined, 'no authentication');
  assert.equal(c.version, (await rpc('initialize', { protocolVersion: '2025-11-25' })).json.result.serverInfo.version, 'the card and the live serverInfo agree');
  assert.ok(!('tools' in c), 'a card carries no tool list');
  assert.equal(card.headers.get('access-control-allow-origin'), '*');
  assert.match(card.headers.get('cache-control'), /max-age=3600/);
  assert.equal(card.headers.get('access-control-expose-headers'), 'ETag');
  const wk = await getDoc(wellKnownCardRoute, '/.well-known/mcp/server-card.json');
  assert.deepEqual(wk.json, c, 'the same card at the well-known path');
  assert.match(wk.headers.get('content-type'), /^application\/json/);

  const cat = await getDoc(catalogRoute, '/.well-known/ai-catalog.json');
  assert.equal(cat.status, 200);
  assert.equal(cat.headers.get('content-type'), 'application/ai-catalog+json; charset=utf-8');
  assert.equal(cat.json.specVersion, '1.0');
  assert.equal(cat.json.entries.length, 1);
  const e = cat.json.entries[0];
  assert.equal(e.type, 'application/mcp-server-card+json');
  assert.match(e.identifier, /^urn:air:elpriser\.org:/);
  assert.equal(e.url, 'https://elpriser.org/mcp/server-card', 'the catalog points at the card');
});

test('discovery documents: ETag and 304, preflight, HEAD, and 405 for a write', async () => {
  for (const [route, p] of [[cardRoute, '/mcp/server-card'], [wellKnownCardRoute, '/.well-known/mcp/server-card.json'], [catalogRoute, '/.well-known/ai-catalog.json']]) {
    const first = await getDoc(route, p);
    const etag = first.headers.get('etag');
    assert.match(etag, /^"[0-9a-f]{8}"$/);
    const again = await getDoc(route, p, { 'if-none-match': etag });
    assert.equal(again.status, 304); assert.equal(again.text, '');
    assert.equal((await getDoc(route, p, { 'if-none-match': '"stale"' })).status, 200);
    const pre = await getDoc(route, p, { origin: 'https://example.com' }, 'OPTIONS');
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*'); assert.match(pre.headers.get('access-control-allow-headers'), /If-None-Match/);
    const head = await route({ request: new Request('https://elpriser.org' + p, { method: 'HEAD' }), env });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await route({ request: new Request('https://elpriser.org' + p, { method: 'POST', body: '{}' }), env })).status, 405);
  }
});

// ── the pieces around it ─────────────────────────────────────────────────────

test('the routes: /mcp is a Pages Function file of its own, helpers start with an underscore, the card and catalog have their files', () => {
  const fn = f => fs.existsSync(path.join(ROOT, 'functions', f));
  for (const f of ['mcp.js', 'mcp/server-card.js', '.well-known/mcp/server-card.json.js', '.well-known/ai-catalog.json.js', '_mcp.js']) assert.ok(fn(f), f);
  assert.ok(/export const onRequest = handleMcp;/.test(fs.readFileSync(path.join(ROOT, 'functions/mcp.js'), 'utf8')));
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '_routes.json'), 'utf8'));
  assert.ok(routes.include.includes('/*') && !routes.exclude.some(p => p === '/mcp' || p.startsWith('/mcp/') || p.startsWith('/.well-known')), '_routes.json sends /mcp and /.well-known through the functions');
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build-dist.sh'), 'utf8');
  assert.ok(/cp -R functions "\$DIST\/functions"/.test(build), 'the deploy copies the whole functions directory, dot-directories included');
});

test('the endpoint is announced where agents and people look: llms.txt, llms-full.txt, the OpenAPI description and the API page', async () => {
  const path_ = 'functions/[[path]].js';
  const SRV = fs.readFileSync(path.join(ROOT, path_), 'utf8');
  const llms = SRV.slice(SRV.indexOf('const LLMS_TXT = `'), SRV.indexOf('/** "Elpriser lige nu" for llms-full.txt'));
  assert.ok(llms.includes('**MCP server**: [elpriser-mcp](https://github.com/x2q/elpriser-mcp)') && llms.includes('npx -y elpriser-mcp'), 'the npm paragraph stays');
  assert.ok(llms.includes('remote: https://elpriser.org/mcp'), 'llms.txt names the remote endpoint');
  // ...and the served files parse (a backtick in a template literal once broke the whole module) and say it.
  const { onRequest: site } = await load('functions/[[path]].js');
  const served = async p => (await site({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response('<html></html>') } } })).text();
  const lt = await served('/llms.txt'), lf = await served('/llms-full.txt');
  assert.ok(lt.includes('remote: https://elpriser.org/mcp') && lt.includes('npx -y elpriser-mcp'), '/llms.txt');
  assert.ok(lf.includes('remote: https://elpriser.org/mcp') && lf.includes('`https://elpriser.org/mcp`'), '/llms-full.txt');
  assert.ok(llms.includes('https://elpriser.org/mcp/server-card'), 'and the card');
  assert.ok(/MCP-server[^\n]*npx -y elpriser-mcp[^\n]*https:\/\/elpriser\.org\/mcp/.test(SRV), 'llms-full.txt too');
  assert.ok(fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8').includes('https://elpriser.org/mcp'), 'OpenAPI info.description');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(idx.includes('<code>https://elpriser.org/mcp</code>'), 'the API page tells how to add it');
});
