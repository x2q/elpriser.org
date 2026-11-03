#!/usr/bin/env node
/**
 * /integrationer: the one overview of plugins, API libraries and the MCP server, with the true install status of each.
 * Run: node test-integrations.mjs   (hermetic: the real Pages Function, index.html, no network)
 *
 * What this guards:
 *  - the page is served 200 with the finished list IN THE HTML (no script needed), title <= 62 and description <= 155
 *    characters, one h1, canonical, in the sitemap with a real lastmod, and in llms.txt with each status in words;
 *  - status is ONE table (functions/_integrations.js): every item has a known status, an item that does not exist yet
 *    ("Kommer") carries no link and no install line, and every other item names its repository or a page of this site;
 *  - the install lines are the ones the repositories' READMEs give (checked 2026-11-03), copyable as <pre><code>;
 *  - JSON-LD lists only the items that exist;
 *  - the pages people look at link to it: /automation, /api, the footer, llms.txt, the sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);
const M = await import(pathToFileURL(path.join(ROOT, 'functions/_integrations.js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = await res.text();
  return { status: res.status, body, page: body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '') };
};

// ── The table ──────────────────────────────────────────────────────────────
const IDS = M.INTEGRATIONS.map(i => i.id);
ok(new Set(IDS).size === IDS.length, 'table: ids are unique');
for (const want of ['home-assistant', 'node-red', 'homey', 'evcc', 'openhab', 'esphome', 'shelly', 'python', 'javascript', 'rust', 'go', 'mcp'])
  ok(IDS.includes(want), `table: ${want} is listed`);
ok(Object.keys(M.STATUS).join() === 'registry,github,applied,soon,site', 'status values: registry, github, applied, soon, site');
ok(['I registeret', 'Fra GitHub', 'Ansøgt', 'Kommer'].every(l => Object.values(M.STATUS).some(s => s.label === l)), 'the four chips the owner named exist');
const groupIds = M.GROUPS.map(g => g.id);
for (const i of M.INTEGRATIONS) {
  ok(M.STATUS[i.status], `${i.id}: known status`, i.status);
  ok(groupIds.includes(i.group), `${i.id}: known group`);
  if (i.status === 'soon') {
    ok(!i.repo && !i.links.length && !i.codes.length && !i.how, `${i.id}: "Kommer" has no link and no install line`);
  } else {
    ok(i.repo || (i.links[0] && i.links[0].href.startsWith('/')), `${i.id}: names its repository or a page of this site`);
    ok(i.coverage === null || /\S/.test(i.coverage), `${i.id}: coverage is a sentence or absent`);
  }
  if (i.status === 'registry') ok(i.codes.length && !/git\+|github:|x2q\//.test(i.codes[0].text), `${i.id}: a registry item installs from the registry, not from GitHub`);
  if (i.status === 'github') ok(i.repo, `${i.id}: "Fra GitHub" has a repository`);
}
// The install lines, as the READMEs give them (2026-11-03). A change here is a README change first.
const code = id => M.INTEGRATIONS.find(i => i.id === id).codes.map(c => c.text).join('\n');
ok(code('python') === 'pip install "git+https://github.com/x2q/elpriser-python"', 'python: install line from the README');
ok(code('javascript') === 'npm install elpriser-client', 'javascript: install line from the README');
ok(code('node-red') === 'npm install x2q/node-red-contrib-elpriser', 'node-red: install line from the README');
ok(/^npx -y elpriser-mcp\nhttps:\/\/elpriser\.org\/mcp$/.test(code('mcp')), 'mcp: npx line and the hosted URL');
ok(code('home-assistant') === 'https://github.com/x2q/ha-elpriser', 'home-assistant: the custom-repository URL');
ok(code('esphome').includes('github://x2q/esphome-elpriser/elpriser.yaml@main'), 'esphome: the package line');
ok(code('homey').includes('npx homey app install'), 'homey: install from source');
ok(M.CURL_EXAMPLE === 'curl "https://elpriser.org/api/now?area=DK1&mode=inkl_alt"', 'the curl example is the /api/now one');
// No claim the READMEs do not make.
const ha = M.INTEGRATIONS.find(i => i.id === 'home-assistant');
ok(ha.status === 'applied' && ha.links.some(l => l.href === 'https://github.com/hacs/default/pull/13196'), 'home-assistant: "Ansøgt", with the HACS pull request');
ok(!/upstream|officiel[^t]|godkendt af/i.test(M.INTEGRATIONS.find(i => i.id === 'evcc').note), 'evcc: no claim about becoming part of evcc');
for (const id of ['homey', 'openhab', 'esphome']) ok(/endnu ikke|ikke afprøvet|Uofficiel/i.test(M.INTEGRATIONS.find(i => i.id === id).note), `${id}: says it has not been run for real yet`);

// ── The served page ────────────────────────────────────────────────────────
const r = await get('/integrationer');
const body = r.body, h = r.page;
const title = (body.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
ok(r.status === 200, '/integrationer: 200', String(r.status));
ok(title.length <= 62 && /Integrationer/.test(title), '/integrationer: title <= 62 characters', `${title.length}: ${title}`);
ok(desc.length >= 80 && desc.length <= 155, '/integrationer: description 80-155 characters', String(desc.length));
ok(body.includes('<link rel="canonical" href="https://elpriser.org/integrationer">'), '/integrationer: canonical');
ok(/<html lang="da"/.test(body) && !/ class="xc"/.test(body.slice(0, 200)), '/integrationer: Danish page, no country-chrome hook');
ok((h.match(/<h1[ >]/g) || []).length === 1 && /<h1 class="page-title">Integrationer og API-biblioteker<\/h1>/.test(h), '/integrationer: exactly one h1');
ok((h.replace(/<!--[\s\S]*?-->/g, '').match(/<main\b[^>]*data-page=/g) || []).length === 1 && /<main data-page="integrationer" class="active /.test(h), '/integrationer: only its own section, activated');
ok(!h.includes('<!--SSR_INTEGRATIONER-->') && !body.includes('SSR_INTEGRATIONER'), '/integrationer: the placeholder is replaced');
for (const g of M.GROUPS) ok(h.includes(`>${g.title}</h2>`), `/integrationer: section "${g.title}"`);
ok(h.includes('>Direkte mod API’et</h2>') && h.includes('>Mangler din platform?</h2>'), '/integrationer: the API section and "Mangler din platform?"');
for (const i of M.INTEGRATIONS) {
  const li = (h.match(new RegExp(`<li class="ig-item[^"]*" id="${i.id}">[\\s\\S]*?</li>`)) || [])[0] || '';
  ok(li, `/integrationer: ${i.id} is in the HTML`);
  ok(li.includes(`>${M.STATUS[i.status].label}</span>`), `/integrationer: ${i.id} shows "${M.STATUS[i.status].label}"`);
  ok(li.includes(`<h3 class="ig-name">${i.name.replace(/&/g, '&amp;')}</h3>`), `/integrationer: ${i.id} has its h3`);
  if (i.status === 'soon') ok(!/<a |<pre|ig-copy/.test(li), `/integrationer: ${i.id} ("Kommer") has no link, no code, no button`);
  else {
    if (i.repo) ok(li.includes(`href="https://github.com/x2q/${i.repo}"`) && li.includes('>Se på GitHub</a>'), `/integrationer: ${i.id} links "Se på GitHub"`);
    for (const c of i.codes) ok(li.includes('<pre tabindex="0"') && li.includes(`<code>${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</code>`) && li.includes('data-ig-copy'), `/integrationer: ${i.id} install line is a copyable <pre><code>`);
  }
}
ok(/<pre[^>]*><code>curl &quot;https:\/\/elpriser\.org\/api\/now\?area=DK1&amp;mode=inkl_alt&quot;<\/code>/.test(h), '/integrationer: the curl example');
ok(h.includes('href="/api"') && h.includes('href="/api/openapi.json"'), '/integrationer: links /api and the OpenAPI file');
ok(h.includes('href="mailto:hello@elpriser.org"') && h.includes('href="https://github.com/x2q/elpriser.org/issues"'), '/integrationer: how to ask for a platform');
ok(h.includes('href="/automation#shelly"') && h.includes('href="/shelly-tariff"'), '/integrationer: Shelly links to the script and Live Tariff');
ok(!/href="#"|undefined|\[object/.test(h.slice(h.indexOf('<main'))), '/integrationer: no dead href and no leaked value');
// JSON-LD: only the items that exist.
const lds = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const col = lds.find(x => x['@type'] === 'CollectionPage');
ok(col && col.mainEntity['@type'] === 'ItemList', '/integrationer: CollectionPage with an ItemList');
const real = M.INTEGRATIONS.filter(i => i.status !== 'soon');
ok(col && col.mainEntity.itemListElement.length === real.length && col.mainEntity.numberOfItems === real.length, '/integrationer: JSON-LD has exactly the items that exist');
ok(col && !JSON.stringify(col).match(/Rust|Go\b/), '/integrationer: JSON-LD names no "Kommer" item');
ok(lds.some(x => x['@type'] === 'BreadcrumbList'), '/integrationer: breadcrumbs');
// Offline-readable: statuses are text, not colour only.
ok(/<span class="vh">Status: <\/span>/.test(h), '/integrationer: the chip says "Status:" to a screen reader');

// ── Wiring ────────────────────────────────────────────────────────────────
const sm = (await get('/sitemap.xml')).body;
ok(/<loc>https:\/\/elpriser\.org\/integrationer<\/loc>\s*<lastmod>2026-11-03<\/lastmod>\s*<changefreq>monthly<\/changefreq>/.test(sm), 'sitemap: /integrationer with a real lastmod');
const llms = (await get('/llms.txt')).body, llmsFull = (await get('/llms-full.txt')).body;
ok(llms.includes('https://elpriser.org/integrationer'), 'llms.txt links /integrationer');
for (const i of M.INTEGRATIONS) ok(llms.includes(`${i.name}: ${M.STATUS[i.status].label}`), `llms.txt: ${i.name} with its status in words`);
ok(llms.includes('pip install "git+https://github.com/x2q/elpriser-python"') && llms.includes('npm install elpriser-client') && llms.includes('npx -y elpriser-mcp'), 'llms.txt: the install lines');
ok(/Plugins og biblioteker[^\n]*integrationer/.test(llmsFull), 'llms-full.txt: "Åbne datasæt og værktøjer" points to /integrationer');
for (const p of ['/automation', '/download']) {
  const x = await get(p);
  ok(/<li><a href="\/integrationer">Integrationer<\/a><\/li>/.test(x.body), `${p}: the footer links /integrationer`);
}
const auto = INDEX.slice(INDEX.search(/<main[^>]*data-page="automation"/));
ok(auto.indexOf('class="ig-box"') > 0 && auto.indexOf('class="ig-box"') < auto.indexOf('<!-- Strategy config'), '/automation: the boxed link sits at the top');
const api = INDEX.slice(INDEX.search(/<main[^>]*data-page="api"/));
ok(api.indexOf('class="ig-box"') > 0 && api.indexOf('class="ig-box"') < api.indexOf('<article'), '/api: the boxed link sits at the top');
ok((INDEX.match(/class="ig-box"/g) || []).length === 2 && (INDEX.match(/href="\/integrationer" class="ig-box"/g) || []).length === 2, 'exactly two boxes, both to /integrationer');
ok(!/data-page="shelly-tariff"[\s\S]{0,4000}class="ig-box"/.test(INDEX.slice(INDEX.indexOf('data-page="shelly-tariff"'), INDEX.indexOf('data-page="prognose"'))), 'no box on other pages');

console.log(`\nintegrationer: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
