#!/usr/bin/env node
// Near-real-time traffic for the elpriser.org zone from Cloudflare's GraphQL
// analytics. Counts every request that reaches Cloudflare, including apps,
// Home Assistant/Shelly devices and bots (GA4 and the RUM beacon only see
// browsers running JavaScript). Needs CLOUDFLARE_ANALYTICS_TOKEN (Zone >
// Analytics > Read) in .env.deploy.
//   npm run traffic            last 60 minutes
//   node scripts/traffic.mjs 15   last 15 minutes
//   node scripts/traffic.mjs 1440 last 24 hours (data is sampled; counts are estimates)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env.deploy'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* the variable may come from the environment */ }
const token = env.CLOUDFLARE_ANALYTICS_TOKEN;
if (!token) { console.error('CLOUDFLARE_ANALYTICS_TOKEN is needed (Zone > Analytics > Read, see .env.deploy)'); process.exit(1); }

const minutes = Math.max(1, Math.min(+process.argv[2] || 60, 1440));
const since = new Date(Date.now() - minutes * 60_000).toISOString();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = 'https://api.cloudflare.com/client/v4';

const zones = await (await fetch(`${api}/zones?name=elpriser.org`, { headers: H })).json();
const zone = zones.result?.[0]?.id;
if (!zone) { console.error('zone elpriser.org not visible to this token', JSON.stringify(zones.errors || [])); process.exit(1); }

// Early-hints replays are Cloudflare talking to itself, not visitors.
const filter = `datetime_geq:"${since}", requestSource:"eyeball"`;
async function groups(dims, limit = 1000, order = 'count_DESC') {
  const q = `{viewer{zones(filter:{zoneTag:"${zone}"}){httpRequestsAdaptiveGroups(limit:${limit},filter:{${filter}},orderBy:[${order}]){count dimensions{${dims}}}}}}`;
  const r = await (await fetch(`${api}/graphql`, { method: 'POST', headers: H, body: JSON.stringify({ query: q }) })).json();
  if (r.errors) { console.error(JSON.stringify(r.errors)); process.exit(1); }
  return r.data.viewer.zones[0].httpRequestsAdaptiveGroups.map(g => ({ n: g.count, ...g.dimensions }));
}

// Who is asking. The order matters: devices and tools before the generic browser test.
function kind(ua, verified) {
  if (verified) return 'bot (verificeret)';
  if (/HomeAssistant/i.test(ua)) return 'Home Assistant';
  if (/shelly/i.test(ua)) return 'Shelly';
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|headless/i.test(ua)) return 'bot';
  if (/curl|python|aiohttp|node|axios|go-http|java|wget|okhttp|CFNetwork.*Elpriser|^$/i.test(ua)) return 'værktøj/app';
  if (/Mozilla\//.test(ua)) return 'browser';
  return 'andet';
}
function pageClass(p) {
  if (p.startsWith('/api/')) return 'api';
  if (p.startsWith('/cdn-cgi/')) return 'cdn-cgi (rum m.m.)';
  if (/\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ico|json|txt|xml)$/.test(p)) return 'statisk';
  return 'side (html)';
}
const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
const top = (m, k = 8) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
const pad = (s, n) => String(s).padEnd(n);
const num = n => n.toLocaleString('da-DK');
const bar = (n, max) => '█'.repeat(Math.max(n ? 1 : 0, Math.round(n / max * 30)));

const [perMin, byUa, byPath, byCountry, byStatus, byCache] = await Promise.all([
  groups('datetimeMinute', 1440, 'datetimeMinute_ASC'),
  groups('userAgent verifiedBotCategory', 2000),
  groups('clientRequestPath edgeResponseStatus', 2000),
  groups('clientCountryName', 30),
  groups('edgeResponseStatus', 30),
  groups('cacheStatus', 10),
]);

const total = byStatus.reduce((s, r) => s + r.n, 0);
console.log(`elpriser.org — sidste ${minutes} min (siden ${since.slice(11, 16)} UTC), ${num(total)} forespørgsler\n`);
if (!total) process.exit(0);

// Timeline, bucketed so it stays one screen tall.
const bucket = minutes <= 90 ? 1 : minutes <= 360 ? 5 : 30;
const tl = new Map();
for (const r of perMin) bump(tl, Math.floor(Date.parse(r.datetimeMinute) / (bucket * 60_000)), r.n);
const keys = [...tl.keys()].sort((a, b) => a - b);
const tmax = Math.max(...tl.values());
console.log(`pr. ${bucket} min (UTC)`);
for (const k of keys.slice(-24)) console.log(`  ${new Date(k * bucket * 60_000).toISOString().slice(11, 16)} ${pad(num(tl.get(k)), 7)} ${bar(tl.get(k), tmax)}`);

const kinds = new Map(), classes = new Map();
for (const r of byUa) bump(kinds, kind(r.userAgent, r.verifiedBotCategory), r.n);
const paths = new Map(), pages = new Map();
let errors = 0;
for (const r of byPath) {
  bump(classes, pageClass(r.clientRequestPath), r.n);
  bump(paths, r.clientRequestPath, r.n);
  if (r.clientRequestPath.startsWith('/api/') === false && pageClass(r.clientRequestPath) === 'side (html)') bump(pages, r.clientRequestPath, r.n);
  if (r.edgeResponseStatus >= 500) errors += r.n;
}
const section = (title, m, k = 8) => { console.log(`\n${title}`); for (const [key, n] of top(m, k)) console.log(`  ${pad(num(n), 7)} ${(n / total * 100).toFixed(0).padStart(3)} %  ${key}`); };
section('hvem spørger', kinds);
section('hvad bliver spurgt om', classes);
section('mest besøgte sider (html)', pages, 10);
section('mest brugte stier (alt)', paths, 8);
section('lande', new Map(byCountry.map(r => [r.clientCountryName, r.n])), 6);
section('status', new Map(byStatus.map(r => [String(r.edgeResponseStatus), r.n])), 6);
section('cache', new Map(byCache.map(r => [r.cacheStatus, r.n])), 6);
if (errors) {
  console.log(`\n⚠ ${num(errors)} svar med 5xx (${(errors / total * 100).toFixed(1)} %):`);
  for (const [p, n] of top(new Map(byPath.filter(r => r.edgeResponseStatus >= 500).map(r => [`${r.clientRequestPath} (${r.edgeResponseStatus})`, r.n])), 6)) console.log(`  ${pad(num(n), 7)} ${p}`);
}
