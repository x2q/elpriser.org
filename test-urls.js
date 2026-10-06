#!/usr/bin/env node
/**
 * Live URL health check for elpriser.org.
 * Run: npm run test:urls            (against production)
 *      BASE_URL=http://localhost:8788 npm run test:urls
 *
 * The other suites check the source. This one checks what is actually being
 * served, which is where a whole class of problem lives: a page can be built
 * correctly and still be routed wrong, canonicalised at the homepage, served
 * with every section of the SPA attached, or quietly published alongside the
 * repository it was built from. None of that is visible in the source.
 *
 * URLs are discovered, not listed: the sitemap plus every internal link found
 * on the pages it names. A page that stops being linked, or one that appears
 * without being added here, is then still covered.
 */
'use strict';

const BASE = (process.env.BASE_URL || 'https://elpriser.org').replace(/\/$/, '');
// Canonical tags name the production origin whatever host serves the page —
// that is the point of a canonical — so they are checked against this, not
// against BASE. Otherwise every page "fails" when run against a preview
// deployment or localhost, and the check becomes noise you learn to ignore.
const CANONICAL_ORIGIN = 'https://elpriser.org';
const UA = 'elpriser-urltest/1.0 (+https://elpriser.org)';
const CONCURRENCY = 6;

let passed = 0;
const failures = [];

function check(ok, name, detail) {
  if (ok) { passed++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
}

async function get(path, redirect = 'manual') {
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await fetch(url, { redirect, headers: { 'User-Agent': UA } });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('text') || type.includes('json') || type.includes('xml')
    ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), type, body, url };
}

/** Run `fn` over `items` with a small pool, so a 60-URL sweep is not 60 round trips. */
async function pool(items, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) out.push(await fn(items[i++]));
  }));
  return out;
}

const one = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const all = (html, re) => [...html.matchAll(re)].map(m => m[1]);

// ── discovery ───────────────────────────────────────────────────────────────

async function discover() {
  const sm = await get('/sitemap.xml');
  if (sm.status !== 200) throw new Error(`sitemap.xml returned ${sm.status}`);
  const sitemap = all(sm.body, /<loc>([^<]+)<\/loc>/g)
    .map(u => u.replace(/^https?:\/\/[^/]+/, '') || '/');

  // Follow the links the pages actually carry, so an unlisted page still gets
  // checked and a link to a page that no longer exists is caught.
  const linked = new Set();
  await pool(sitemap, async p => {
    const r = await get(p);
    if (r.status !== 200) return;
    for (const href of all(r.body, /href="(\/[^"#?]*)"/g)) {
      if (/\.(css|png|ico|svg|json|xml|txt)$/.test(href)) continue;
      if (href.startsWith('/api/')) continue;          // covered explicitly below
      if (href.includes('${')) continue;               // template literal in inline JS
      linked.add(href);
    }
  });
  const extra = [...linked].filter(p => !sitemap.includes(p));
  return { sitemap, extra };
}

// ── checks ──────────────────────────────────────────────────────────────────

async function checkPage(path, { expectStart = false } = {}) {
  const r = await get(path);
  const label = `page ${path}`;
  if (!check(r.status === 200, label, `status ${r.status}`)) return null;

  const canonical = one(r.body, /<link rel="canonical" href="([^"]*)"/);
  const wantCanonical = CANONICAL_ORIGIN + (path === '/' ? '/' : path);
  check(canonical === wantCanonical, label,
        `canonical is ${canonical}, expected ${wantCanonical}`);

  const title = one(r.body, /<title>([^<]*)<\/title>/);
  check(!!title && title.trim().length > 0, label, 'empty <title>');

  const h1s = (r.body.match(/<h1[\s>]/g) || []).length;
  check(h1s === 1, label, `${h1s} <h1> elements, expected 1`);

  // The server keeps only the section the URL belongs to. More than one main
  // means the page ships every other page's body too — which Google reads as
  // near-identical duplicates across the site.
  const mains = all(r.body, /<main[^>]*data-page="([^"]+)"/g);
  check(mains.length === 1, label, `${mains.length} <main> sections: ${mains.join(', ')}`);

  // A page rendering the start section under its own title is the signature of
  // a missing HASH_TO_DATA_PAGE entry: URL right, canonical right, body wrong.
  if (!expectStart) {
    check(mains[0] !== 'start', label, 'serves the start section instead of its own');
  }
  return { title, mains, body: r.body };
}

async function main() {
  console.log(`URL-tjek mod ${BASE}\n`);
  const { sitemap, extra } = await discover();

  console.log(`1. SIDER I SITEMAP (${sitemap.length})`);
  const pages = await pool(sitemap, p => checkPage(p, { expectStart: p === '/' }));

  const titles = new Map();
  pages.forEach((r, i) => {
    if (!r) return;
    const prev = titles.get(r.title);
    // Two URLs with one title is how duplicate content starts.
    check(!prev, `title ${sitemap[i]}`, `same <title> as ${prev}`);
    titles.set(r.title, sitemap[i]);
  });

  console.log(`\n2. SIDER LINKET, MEN IKKE I SITEMAP (${extra.length})`);
  if (extra.length) {
    // Not automatically wrong — but a linked page missing from the sitemap is
    // usually an oversight, and a link to a dead page is always a bug.
    for (const p of extra) {
      const r = await get(p);
      check(r.status === 200, `linket side ${p}`, `status ${r.status}`);
    }
    console.log(`   ${extra.join(', ')}`);
  }

  console.log('\n3. STATISKE FILER');
  const assets = [
    ['/style.css', 'text/css'], ['/favicon.ico', 'image'], ['/favicon.svg', 'image/svg'],
    ['/favicon-32.png', 'image/png'], ['/favicon-192.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'], ['/og-image.png', 'image/png'],
    ['/og-image', 'image/svg'], ['/sitemap.xml', 'xml'], ['/robots.txt', 'text/plain'],
    ['/llms.txt', 'text/plain'], ['/llms-full.txt', 'text/plain'],
  ];
  await pool(assets, async ([p, type]) => {
    const r = await get(p);
    check(r.status === 200 && r.type.includes(type), `asset ${p}`,
          `status ${r.status}, type ${r.type}`);
  });

  console.log('\n4. API');
  const apis = [
    '/api/now?area=DK1', '/api/prices?area=DK1', '/api/prices?area=DK2&date=2025-01-15',
    '/api/schedule?area=DK1&hours=6', '/api/forecast?area=DK1',
    '/api/shelly/tariff?area=DK1', '/api/openapi.json',
    '/api/nordic?zone=se3', '/api/tariffs?country=no', '/api/tariffs?country=se',
  ];
  await pool(apis, async p => {
    const r = await get(p);
    if (!check(r.status === 200, `api ${p}`, `status ${r.status}`)) return;
    try { JSON.parse(r.body); } catch { check(false, `api ${p}`, 'ugyldig JSON'); }
  });

  console.log('\n5. NORMALISERING — dubletter må ikke svare 200');
  const redirects = [
    ['/dk1/', '/dk1'], ['/se1/', '/se1'], ['/tariffer/', '/tariffer'],
    ['/dk1/n1/', '/dk1/n1'], ['/DK1', '/dk1'], ['/blog/', '/blog'],
  ];
  await pool(redirects, async ([from, to]) => {
    const r = await get(from);
    check(r.status === 301 && r.location === BASE + to, `redirect ${from}`,
          `status ${r.status} -> ${r.location}`);
  });

  console.log('\n6. UKENDTE STIER SKAL 404');
  const gone = ['/norden', '/findes-ikke', '/dk1/ukendt-net', '/blog/ukendt-indlaeg'];
  await pool(gone, async p => {
    const r = await get(p);
    check(r.status === 404, `404 ${p}`, `status ${r.status}`);
  });

  console.log('\n7. REPO-FILER MÅ IKKE VÆRE PÅ SITET');
  // `wrangler pages deploy .` once uploaded the whole working directory, which
  // served the iOS app's sources, every script and wrangler.toml over HTTPS.
  const secret = [
    '/package.json', '/server.js', '/wrangler.toml', '/DESIGN.md',
    '/test-static.js', '/package-lock.json', '/tailwind.config.cjs',
    '/scripts/forecast_model/train_and_score.py',
    '/scripts/forecast_model/nordic/fetch_prices.py',
    '/ElpriserApp/ElpriserApp/ElpriserApp.swift',
  ];
  await pool(secret, async p => {
    const r = await get(p);
    check(r.status === 404, `ikke publiceret ${p}`, `status ${r.status}`);
  });

  console.log('\n9. FORSIDEN — prognosen skal stå i HTML\'en, ikke kun efter JS');
  const home = await get('/');
  const fcSection = home.body.slice(home.body.indexOf('id="homeForecast"'));
  const days = (fcSection.match(/<div class="mini[ "]/g) || []).length;
  check(days === 3, 'forside: server-renderede døgntal', `fandt ${days}, forventer 3`);
  check(/<svg id="fcCurve"/.test(home.body), 'forside: kurven står i HTML\'en');
  check(home.body.includes('Nu og 2 døgn frem'), 'forside: sektionsoverskrift');
  // The explanatory HTML comment names the placeholder too, so match the tag.
  check(!home.body.includes('<!--SSR_FORECAST_CHART-->'), 'forside: placeholder er erstattet');
  check(/Børspris|Prognose/.test(home.body), 'forside: døgnene er mærket børspris eller prognose');
  // The numbers are the reason the section is server-rendered at all.
  check(/<div class="v">\d,\d\d–\d,\d\d<\/div>/.test(home.body),
        'forside: døgnenes spænd står som tekst');
  check(!home.body.includes('href="/${k}"'), 'forside: intet skabelon-link i HTML');

  const prog = await get('/prognose');
  check(/<svg id="fcCurve"/.test(prog.body), '/prognose: kurven står i HTML\'en');
  check(!prog.body.includes('<div id="prognoseForecast"><!--SSR_PROGNOSE_CHART-->'), '/prognose: placeholder er erstattet');
  check(/<div class="v">\d,\d\d–\d,\d\d<\/div>/.test(prog.body), '/prognose: døgnenes spænd står som tekst');

  const se3 = await get('/se3');
  check(!/hreflang=/.test(se3.body.replace(/<!--[\s\S]*?-->/g, '')), '/se3: ingen hreflang-klynge');
  check(/<html lang="sv"/.test(se3.body), '/se3: html lang="sv"');
  check(/<title>Elpriser prognose 7 dage — time for time, op til 10 døgn frem<\/title>/.test(prog.body), '/prognose: titel har "7 dage" og de sande 10 døgn');
  // Count inside the week container: the page's own script carries the same
  // markup as a string literal, which is not a row anyone can read.
  const weekHtml = prog.body.slice(prog.body.indexOf('id="prognoseWeek">'), prog.body.indexOf('id="prognoseWeek">') + 4000);
  check((weekHtml.match(/<tr><th scope="row">/g) || []).length === 7, '/prognose: syv dage som tekst i HTML\'en');
  check(/<title>Elafgift 2028: Elafgiften stiger igen/.test((await get('/blog/elafgift-2028')).body), 'elafgift-indlægget: titlen svarer ja');
  check(/<title>Elpris Vest \(DK1\) i dag/.test((await get('/dk1')).body), '/dk1: titlen starter med "Elpris Vest"');
  const llms = await get('/llms.txt');
  check(!/7 dage|7-day/.test(llms.body) && /elpriser\.org\/se3\)/.test(llms.body), 'llms.txt: 10 døgn og zone-siderne');
  const home2 = await get('/');
  check(!/name="description" content="[^"]*inkl\. nettariffer/.test(home2.body), 'forside: beskrivelsen påstår ikke nettarif');

  const ldOf = body => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => { try { return JSON.parse(m[1]); } catch { return { '@type': 'INVALID' }; } });
  const types = body => ldOf(body).flatMap(j => j['@graph'] ? j['@graph'].map(x => x['@type']) : [j['@type']]);
  const se3t = types(se3.body);
  check(!se3t.some(t => ['FAQPage', 'Article', 'BlogPosting', 'Dataset', 'INVALID'].includes(t)), '/se3: ingen fremmed struktureret data', se3t.join(','));
  const post = await get('/blog/forsta-din-elpris');
  const bp = ldOf(post.body).filter(j => j['@type'] === 'BlogPosting');
  check(bp.length === 1 && bp[0].url.endsWith('/blog/forsta-din-elpris'), 'blogindlæg: præcis sit eget BlogPosting');
  const n1 = await get('/dk1/n1');
  const bc = ldOf(n1.body).find(j => j['@type'] === 'BreadcrumbList');
  check(bc && bc.itemListElement.map(i => i.name).join(' › ') === 'Elpriser › DK1 Vest › N1', '/dk1/n1: brødkrummer', bc && JSON.stringify(bc.itemListElement.map(i => i.name)));
  check(types(home2.body).includes('FAQPage'), 'forside: FAQ-markup');
  const apiPage = await get('/api');
  check(types(apiPage.body).includes('Dataset') && types(apiPage.body).includes('BreadcrumbList'), '/api: Dataset og brødkrummer');
  check(/hreflang="da" href="https:\/\/elpriser\.org\/api"/.test(apiPage.body) && !/7-dages/.test(apiPage.body), '/api: hreflang peger på sig selv, 10-dages prognose');
  const full = await get('/llms-full.txt');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
  check(full.body.includes(`## Elpriser lige nu (${today}`) && /DK1 \(Vestdanmark\), kl\. \d\d:00: spotpris -?\d+,\d\d kr\/kWh/.test(full.body), 'llms-full.txt: dagens tal med dato');

  // IndexNow re-fetches this to validate submissions; if it breaks, every
  // later submission is rejected with 403 and nothing says so on the site.
  const inKey = await get('/ede0d7c16ca973f60282b7079da12804.txt');
  check(inKey.status === 200 && inKey.body.trim() === 'ede0d7c16ca973f60282b7079da12804', 'IndexNow: nøglefilen serveres');

  // /api/forecast with a grid company. A user planning a heat pump against N1 saw
  // the forecast sit short of /api/prices by exactly N1's nettarif: net_ modes
  // returned the untariffed sum. On a published day the two must agree.
  const N1 = '5790001089030';
  const jget = async u => { const r = await get(u); try { return { status: r.status, j: JSON.parse(r.body) }; } catch { return { status: r.status, j: null }; } };
  const fcNoGln = await jget('/api/forecast?area=DK1&mode=net_inkl_alt');
  check(fcNoGln.status === 400, '/api/forecast: net_-mode uden gln afvises', `status ${fcNoGln.status}`);
  const fcBadGln = await jget('/api/forecast?area=DK1&mode=net_inkl_alt&gln=123');
  check(fcBadGln.status === 400, '/api/forecast: ugyldig gln afvises', `status ${fcBadGln.status}`);
  const fcN1 = await jget(`/api/forecast?area=DK1&mode=net_inkl_alt&gln=${N1}`);
  const fcPlain = await jget('/api/forecast?area=DK1&mode=inkl_alt');
  check(fcN1.status === 200 && fcN1.j && fcN1.j.gln === N1, '/api/forecast: gln virker og gentages i svaret');
  if (fcN1.j && fcPlain.j) {
    const d0 = fcN1.j.days.find(d => d.type === 'actual');
    const pr = await jget(`/api/prices?area=DK1&mode=net_inkl_alt&gln=${N1}&date=${d0.date}`);
    const diffs = d0.prices.map((p, h) => Math.abs(p.price - pr.j.prices[h].price)).filter(x => !Number.isNaN(x));
    check(diffs.length >= 20 && Math.max(...diffs) < 0.0006, '/api/forecast = /api/prices for N1 på en offentliggjort dag', `største afvigelse ${Math.max(...diffs).toFixed(4)} kr`);
    const plain0 = fcPlain.j.days.find(d => d.date === d0.date);
    check(d0.prices[19].price > plain0.prices[19].price + 0.1, '/api/forecast: net_inkl_alt ligger over inkl_alt med nettariffen', `${d0.prices[19].price} vs ${plain0.prices[19].price}`);
    check(fcN1.j.days.every(d => d.tariff === 'published' || d.tariff === 'last_known'), '/api/forecast: hver dag oplyser sin tarifbasis');
    const mdays = fcN1.j.days.filter(d => d.source === 'model');
    check(!mdays.length || (fcN1.j.model && fcN1.j.model.generatedAt), '/api/forecast: model.generatedAt oplyses når modellen er brugt');
    check(fcPlain.j.days.filter(d => d.type === 'forecast').every(d => d.source === 'model' || d.source === 'heuristic'), '/api/forecast: forecast-dage er mærket model eller heuristic');
  }
  // The archive: lists the runs, returns one as issued, rejects nonsense.
  const arcList = await jget('/api/forecast/archive?area=DK1');
  check(arcList.status === 200 && Array.isArray(arcList.j.issued) && arcList.j.issued.includes('2026-10-06'), '/api/forecast/archive: lister de gemte kørsler', JSON.stringify(arcList.j).slice(0, 120));
  const arcRun = await jget('/api/forecast/archive?area=DK1&issued=2026-10-06');
  check(arcRun.status === 200 && arcRun.j.days.length === 10 && arcRun.j.days.some(d => d.prices.some(p => p.spot_dkk_mwh != null)) && /DKK\/MWh/.test(arcRun.j.unit),
        '/api/forecast/archive: en kørsel som den lød, i DKK/MWh', arcRun.status);
  check((await jget('/api/forecast/archive?area=DK1&issued=1999-01-01')).status === 404, '/api/forecast/archive: ukendt dato giver 404');
  check((await jget('/api/forecast/archive?area=DK1&issued=igaar')).status === 400, '/api/forecast/archive: ugyldig dato giver 400');
  const oa = await jget('/api/openapi.json');
  const oaFc = oa.j && oa.j.paths['/api/forecast'].get;
  check(oaFc && oaFc.parameters.some(p => p.name === 'gln') && /P10/.test(oaFc.description), 'OpenAPI: /api/forecast har gln og forklarer min/max');
  check(oa.j && oa.j.paths['/api/forecast/archive'], 'OpenAPI: arkivet er beskrevet');
  check(oa.j && /User-Agent/.test(oa.j.info.description), 'OpenAPI: User-Agent-kravet står i dokumentationen');

  console.log('\n8. REGULERBAR KAPACITET — endpoints lever og afviser forkert input');
  // Only payloads that are refused before anything is stored, so a scheduled
  // run against production never writes a row.
  const flexPost = body => fetch(BASE + '/api/flex/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
  });
  const fakeId = 'f'.repeat(32);
  let fr = await flexPost({ v: 1, id: fakeId, platform: 'shelly', category: 'jacuzzi', area: 'DK1', on: true });
  check(fr.status === 400, 'flex: ukendt kategori afvises', `status ${fr.status}`);
  fr = await flexPost({ v: 1, id: fakeId, platform: 'shelly', category: 'drain_pump', area: 'DK1', on: true });
  check(fr.status === 422, 'flex: drænpumpe afvises som uegnet', `status ${fr.status}`);
  fr = await flexPost({ v: 1, id: 'AA:BB:CC', platform: 'shelly', category: 'freezer', area: 'DK1', on: true });
  check(fr.status === 400, 'flex: id der ligner en MAC-adresse afvises', `status ${fr.status}`);
  fr = await fetch(BASE + '/api/flex/summary', { headers: { 'User-Agent': UA } });
  check(fr.status === 401, 'flex: summary kræver token', `status ${fr.status}`);

  console.log('\n10. TARIFFER OG MOBIL');
  const tar = await get('/tariffer');
  for (const term of ['Transmissions', 'Systemtarif', 'lavlast', 'spidslast']) {
    check(tar.body.includes(term), `tariffer: dækker "${term}"`);
  }
  check((home.body.match(/id="tabBar"/g) || []).length === 1, 'forside: mobil tab-bar er med');
  const sub = await get('/prognose');
  check(sub.body.includes('id="tabBar"'), 'undersider: tab-baren overlever sektionsfjernelsen');

  console.log('\n' + '─'.repeat(60));
  console.log(`${passed} beståede, ${failures.length} fejl`);
  if (failures.length) {
    console.log('\nFEJL:');
    failures.forEach(f => console.log(`  ✗ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
