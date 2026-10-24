#!/usr/bin/env node
/**
 * /llms-full.txt = a static text plus an "Elpriser lige nu" section built from four /api calls per area.
 * Run: node test-llms-now.mjs   (hermetic: the real Pages Function with a fake edge)
 *
 * The section is a bonus: whatever an upstream does — 404, null, an empty object, a list that is not a list,
 * JSON that does not parse, a rejected or a synchronously throwing fetch — the file must still be a 200 with
 * all of its static text, and only the lines that depend on the broken source may be missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const hours = f => Array.from({ length: 24 }, (_, h) => ({ hour: h, price: f(h) }));

// What each endpoint answers when it is healthy; a case overrides some of them.
const healthy = {
  now: u => json({ on: true, price: u.searchParams.get('mode') === 'spot_inkl' ? 0.8 : 1.5, hour: 12, area: u.searchParams.get('area') }),
  prices: () => json({ prices: hours(h => 1 + h / 100) }),
  forecast: () => json({ days: [{ date: today, type: 'actual', prices: hours(() => 1) }, { date: tomorrow, type: 'forecast', prices: hours(h => 1 + h / 50) }] }),
};
let api = healthy;
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async u => {
  const url = new URL(String(u));
  const kind = url.pathname.replace('/api/', '');
  const h = api[kind];
  if (!h) return json({}, 404);
  return h(url);
};
const get = async p => {
  let res;
  try { res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } }); }
  catch (e) { return { status: 500, type: 'error', body: String(e.message) }; }   // an uncaught throw is a 500 at the edge
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
};
const STATIC_MARK = '## Netselskaber (GLN-numre)', SECTION = '## Elpriser lige nu';

// The reference: the section with every source healthy.
const base = await get('/llms-full.txt');
ok(base.status === 200 && base.body.includes(STATIC_MARK) && base.body.includes(SECTION), 'healthy: 200, the static text and the "lige nu" section');
ok(/- DK1 \(Vestdanmark\), kl\. \d\d:00: spotpris 0,80 kr\/kWh/.test(base.body) && /- DK1 i dag \(\d{4}-\d\d-\d\d\): billigst kl\. 00–01/.test(base.body) && base.body.includes(`- DK2 i morgen (${tomorrow}): 1,00–1,46 kr/kWh`), 'healthy: now, today and tomorrow lines for the areas');
const staticPart = base.body.slice(0, base.body.indexOf(SECTION)).trimEnd();

const cases = [
  ['prices answer 404', { ...healthy, prices: undefined }, { today: false }],
  ['prices answer null', { ...healthy, prices: () => new Response('null', { headers: { 'content-type': 'application/json' } }) }, { today: false }],
  ['prices answer {}', { ...healthy, prices: () => json({}) }, { today: false }],
  ['prices is not a list', { ...healthy, prices: () => json({ prices: 'x' }) }, { today: false }],
  ['prices hold nulls', { ...healthy, prices: () => json({ prices: [null, 1, null] }) }, { today: false }],
  ['prices answer 500', { ...healthy, prices: () => json({ error: 'x' }, 500) }, { today: false }],
  ['prices answer HTML', { ...healthy, prices: () => new Response('<html>', { status: 200 }) }, { today: false }],
  ['prices reject', { ...healthy, prices: () => Promise.reject(new Error('down')) }, { today: false }],
  ['prices throw at once', { ...healthy, prices: () => { throw new Error('boom'); } }, { today: false }],
  ['forecast without days', { ...healthy, forecast: () => json({}) }, { tomorrow: false }],
  ['forecast day without prices', { ...healthy, forecast: () => json({ days: [{ date: tomorrow, type: 'forecast' }] }) }, { tomorrow: false }],
  ['forecast days is not a list', { ...healthy, forecast: () => json({ days: 5 }) }, { tomorrow: false }],
  ['forecast prices hold nulls', { ...healthy, forecast: () => json({ days: [{ date: tomorrow, prices: [null, { price: null }] }] }) }, { tomorrow: false }],
  ['now answers null', { ...healthy, now: () => new Response('null') }, { now: false }],
  ['now answers without price', { ...healthy, now: () => json({}) }, { now: false }],
  ['every source is down (404)', {}, { now: false, today: false, tomorrow: false, section: false }],
  ['every source rejects', { now: () => Promise.reject(new Error('x')), prices: () => Promise.reject(new Error('x')), forecast: () => Promise.reject(new Error('x')) }, { now: false, today: false, tomorrow: false, section: false }],
  ['every source throws at once', { now: () => { throw new Error('x'); }, prices: () => { throw new Error('x'); }, forecast: () => { throw new Error('x'); } }, { now: false, today: false, tomorrow: false, section: false }],
];
for (const [name, impl, want] of cases) {
  api = impl;
  const r = await get('/llms-full.txt');
  const t = r.body;
  ok(r.status === 200 && /^text\/plain/.test(r.type || ''), `${name}: 200 text/plain`, `${r.status} ${r.type}`);
  ok(t.startsWith(staticPart) && t.includes(STATIC_MARK) && t.includes('| Dinel | DK1 |'), `${name}: all the static text is there`);
  ok(!/NaN|undefined|\[object/.test(t), `${name}: no NaN or undefined`);
  ok((want.section === false) === !t.includes(SECTION), `${name}: the "lige nu" section is ${want.section === false ? 'left out' : 'kept'}`);
  if (want.section !== false) {
    ok((want.now === false) === !/ spotpris /.test(t.slice(t.indexOf(SECTION))), `${name}: the "nu" line is ${want.now === false ? 'dropped' : 'kept'}`);
    ok((want.today === false) === !/ i dag \(/.test(t.slice(t.indexOf(SECTION))), `${name}: the "i dag" line is ${want.today === false ? 'dropped' : 'kept'}`);
    ok((want.tomorrow === false) === !/ i morgen \(/.test(t.slice(t.indexOf(SECTION))), `${name}: the "i morgen" line is ${want.tomorrow === false ? 'dropped' : 'kept'}`);
  }
}
// One area failing leaves the other area's lines.
api = { ...healthy, prices: u => u.searchParams.get('area') === 'DK1' ? Promise.reject(new Error('x')) : healthy.prices(u) };
{
  const t = (await get('/llms-full.txt')).body;
  ok(!/- DK1 i dag/.test(t) && /- DK2 i dag/.test(t) && /- DK1 \(Vestdanmark\)/.test(t), 'DK1 prices down: DK2 keeps its lines, DK1 keeps its other lines');
}
// llms.txt does not use the section at all: static, whatever the upstreams do.
for (const impl of [healthy, {}]) {
  api = impl;
  const r = await get('/llms.txt');
  ok(r.status === 200 && r.body.includes('# elpriser.org') && !r.body.includes(SECTION), 'llms.txt: 200 and static');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
