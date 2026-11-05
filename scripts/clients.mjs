#!/usr/bin/env node
// Which versions of the apps and which Shelly / Home Assistant installs are calling the API,
// from the anonymous counts functions/_usage.js writes to Analytics Engine (dataset elpriser_usage).
// No ids are stored, so this counts calls, not devices; read it as a trend per version.
// Needs a token with Account > Account Analytics > Read (CLOUDFLARE_ANALYTICS_TOKEN or
// CLOUDFLARE_API_TOKEN in .env.deploy) and CLOUDFLARE_ACCOUNT_ID.
//   npm run clients          last 7 days
//   npm run clients -- 30    last 30 days
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env.deploy'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* the variables may come from the environment */ }

const days = Math.max(1, Math.min(+process.argv[2] || 7, 90));
const account = env.CLOUDFLARE_ACCOUNT_ID;
const tokens = [env.CLOUDFLARE_ANALYTICS_TOKEN, env.CLOUDFLARE_API_TOKEN].filter(Boolean);
if (!account || !tokens.length) { console.error('CLOUDFLARE_ACCOUNT_ID and a token are needed (see .env.deploy)'); process.exit(1); }

async function sql(query) {
  let last = '';
  for (const token of tokens) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: query,
    });
    const text = await r.text();
    if (r.ok) return JSON.parse(text).data;
    last = `${r.status} ${text.slice(0, 200)}`;
  }
  console.error(`Analytics Engine afviste forespørgslen (${last}).\nTokenet skal have Account > Account Analytics > Read, og datasættet elpriser_usage findes først, når sitet er deployet med USAGE-bindingen.`);
  process.exit(1);
}

const num = n => Math.round(n).toLocaleString('da-DK');
const where = `timestamp > NOW() - INTERVAL '${days}' DAY`;
const calls = 'SUM(_sample_interval * double1)';
const print = (title, rows, cols) => {
  console.log(`\n${title}`);
  if (!rows.length) { console.log('  (ingen data endnu)'); return; }
  for (const r of rows) console.log('  ' + cols.map(([k, w]) => String(k === 'calls' ? num(+r.calls) : (r[k] || '–')).padEnd(w)).join(' '));
};

const [versions, hosts, endpoints, errors, strategies, areas] = await Promise.all([
  sql(`SELECT blob1 AS client, blob2 AS version, ${calls} AS calls FROM elpriser_usage WHERE ${where} GROUP BY client, version ORDER BY client, calls DESC FORMAT JSON`),
  sql(`SELECT blob1 AS client, blob3 AS host, ${calls} AS calls FROM elpriser_usage WHERE ${where} AND blob3 != '' GROUP BY client, host ORDER BY client, calls DESC FORMAT JSON`),
  sql(`SELECT blob1 AS client, blob4 AS endpoint, ${calls} AS calls FROM elpriser_usage WHERE ${where} GROUP BY client, endpoint ORDER BY client, calls DESC FORMAT JSON`),
  sql(`SELECT blob1 AS client, blob2 AS version, blob7 AS status, blob8 AS reason, ${calls} AS calls FROM elpriser_usage WHERE ${where} AND blob7 != '2xx' GROUP BY client, version, status, reason ORDER BY calls DESC FORMAT JSON`),
  sql(`SELECT blob1 AS client, blob6 AS strategy, ${calls} AS calls FROM elpriser_usage WHERE ${where} AND blob1 IN ('shelly', 'homeassistant') AND blob4 IN ('now', 'schedule') GROUP BY client, strategy ORDER BY client, calls DESC FORMAT JSON`),
  sql(`SELECT blob1 AS client, blob5 AS area, ${calls} AS calls FROM elpriser_usage WHERE ${where} GROUP BY client, area ORDER BY calls DESC LIMIT 60 FORMAT JSON`),
]);

console.log(`Apps, Shelly og Home Assistant — sidste ${days} dage (kald, ikke enheder)`);
print('Version pr. klient (Shelly/HA: "script N" er den genererede version fra /automation; tom = ældre script)', versions, [['client', 14], ['version', 14], ['calls', 10]]);
print('Platformens egen version (Shelly-firmware / Home Assistant)', hosts, [['client', 14], ['host', 22], ['calls', 10]]);
print('Endpoints', endpoints, [['client', 14], ['endpoint', 16], ['calls', 10]]);
print('Fejl (4xx/5xx)', errors, [['client', 14], ['version', 14], ['status', 6], ['reason', 18], ['calls', 10]]);
print('Strategi / visning (Shelly og HA)', strategies, [['client', 14], ['strategy', 22], ['calls', 10]]);
print('Prisområde / zone (DK1, DK2 og, fra 2026-11-05, øvrige zoner via /api/nordic; tom = ingen zone i kaldet)', areas, [['client', 14], ['area', 10], ['calls', 10]]);
console.log('\nKun kald tælles. Der gemmes intet id, ingen IP og intet netselskab, så et kald kan ikke føres tilbage til en enhed.');
