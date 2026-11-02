#!/usr/bin/env node
// Daily unique IPs (counts only, no addresses are printed or stored) from Cloudflare's edge log, plus the anonymous
// client counts from scripts/clients.mjs. Compares the last 7 full days with the baseline week of 2026-10-26..11-01.
//   node scripts/usage-report.mjs [days=14] [--write]     --write saves docs/usage/<date>.md
// Baseline = mean of the 7 days before the Europe release (web 1403, API 934, apps 130 unique IPs/day).
// Needs CLOUDFLARE_ANALYTICS_TOKEN (Zone > Analytics > Read) in .env.deploy. IP != person (NAT, mobile IP churn);
// the adaptive log is sampled, so call counts are approximate.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env.deploy'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* variables may come from the environment */ }
const token = env.CLOUDFLARE_ANALYTICS_TOKEN || env.CLOUDFLARE_API_TOKEN;
const ZONE = '37b289023547cd8f1a3441d5fe96baf3';   // elpriser.org
if (!token) { console.error('CLOUDFLARE_ANALYTICS_TOKEN missing (.env.deploy)'); process.exit(1); }

const BASELINE = { api: 934, apps: 130, web: 1403, label: '2026-10-26..11-01 (mean per day)' };   // computed 2026-11-02
const days = Math.max(2, Math.min(+process.argv[2] || 14, 30));
const write = process.argv.includes('--write');

async function gql(query) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data.viewer.zones[0];
}
const iso = d => d.toISOString().slice(0, 10);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const dayList = Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 864e5));

const web = Object.fromEntries((await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){httpRequests1dGroups(limit:40,filter:{date_geq:"${iso(dayList[0])}"},orderBy:[date_ASC]){dimensions{date} uniq{uniques}}}}}`)).httpRequests1dGroups.map(x => [x.dimensions.date, x.uniq.uniques]));

async function uniq(d, extra = '') {
  const f = `datetime_geq:"${iso(d)}T00:00:00Z",datetime_lt:"${iso(new Date(+d + 864e5))}T00:00:00Z",clientRequestPath_like:"/api/%"${extra}`;
  const g = (await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){httpRequestsAdaptiveGroups(limit:10000,filter:{${f}}){count dimensions{clientIP}}}}}`)).httpRequestsAdaptiveGroups;
  return { ips: g.length, calls: g.reduce((s, x) => s + x.count, 0) };
}
const rows = [];
for (const d of dayList) rows.push({ day: iso(d), web: web[iso(d)], api: await uniq(d), apps: await uniq(d, ',userAgent_like:"Elpriser%"') });

const full = rows.filter(r => r.day !== iso(today));            // today is partial
const last7 = full.slice(-7), mean = k => Math.round(last7.reduce((s, r) => s + (k === 'web' ? r.web : r[k].ips), 0) / last7.length);
const pct = (v, b) => `${v} (${v >= b ? '+' : ''}${Math.round((v / b - 1) * 100)} % mod baseline ${b})`;
let out = `# Brug: unikke IP pr. dag, ${iso(today)}\n\n| Dato | Web, unikke IP | API, unikke IP | API-kald | Apps, unikke IP | App-kald |\n|---|---|---|---|---|---|\n`;
for (const r of rows) out += `| ${r.day}${r.day === iso(today) ? ' (delvis)' : ''} | ${r.web ?? '–'} | ${r.api.ips} | ${r.api.calls} | ${r.apps.ips} | ${r.apps.calls} |\n`;
out += `\nSeneste 7 hele dage, gennemsnit pr. dag mod baseline ${BASELINE.label}:\n- Web: ${pct(mean('web'), BASELINE.web)}\n- API: ${pct(mean('api'), BASELINE.api)}\n- Apps: ${pct(mean('apps'), BASELINE.apps)}\n`;
let clients = '';
try { clients = execFileSync('node', [path.join(root, 'scripts/clients.mjs'), '7'], { encoding: 'utf8', env }); } catch (e) { clients = `(clients.mjs fejlede: ${e.message.split('\n')[0]})`; }
out += `\n## Klienter (kald pr. version, anonym måling)\n\n\`\`\`\n${clients}\n\`\`\`\n\nEn IP er ikke en person (NAT, mobilnet). Log-data er stikprøvebaseret. Der gemmes ingen adresser.\n`;
console.log(out);
if (write) { fs.mkdirSync(path.join(root, 'docs/usage'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs/usage', `${iso(today)}.md`), out); }
