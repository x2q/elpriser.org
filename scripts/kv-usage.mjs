#!/usr/bin/env node
// Workers KV operations per day for this account, from Cloudflare's GraphQL
// analytics, against the free-plan limits. Uses the deploy token in .env.deploy
// (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
//   npm run kv:usage            last 7 days
//   node scripts/kv-usage.mjs 3 last 3 days
import fs from 'node:fs';
import path from 'node:path';

const LIMITS = { read: 100_000, write: 1_000, delete: 1_000, list: 1_000 };
const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env.deploy'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* the variables may come from the environment */ }
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed (see .env.deploy)');
  process.exit(1);
}

const days = +process.argv[2] || 7;
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const query = `{ viewer { accounts(filter:{accountTag:"${env.CLOUDFLARE_ACCOUNT_ID}"}) {
  kvOperationsAdaptiveGroups(limit:1000, filter:{date_geq:"${since}"}, orderBy:[date_ASC]) {
    dimensions { date actionType } sum { requests } } } } }`;
const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const j = await res.json();
if (j.errors) { console.error(JSON.stringify(j.errors)); process.exit(1); }
const rows = j.data.viewer.accounts[0].kvOperationsAdaptiveGroups;
const byDate = {};
for (const r of rows) (byDate[r.dimensions.date] ??= {})[r.dimensions.actionType] = r.sum.requests;

const pct = (n, lim) => `${String(n).padStart(7)} (${String(Math.round(n / lim * 100)).padStart(3)} %)`;
console.log('date        reads                 writes             lists   deletes');
for (const [d, o] of Object.entries(byDate)) {
  console.log(`${d}  ${pct(o.read || 0, LIMITS.read)}   ${pct(o.write || 0, LIMITS.write)}   ${String(o.list || 0).padStart(5)}   ${String(o.delete || 0).padStart(5)}`);
}
console.log(`\nfree plan: ${LIMITS.read.toLocaleString('en')} reads, ${LIMITS.write.toLocaleString('en')} writes/lists/deletes per day (UTC).`);
