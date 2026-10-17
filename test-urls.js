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
  return { status: res.status, location: res.headers.get('location'), cache: res.headers.get('cache-control'), type, body, url };
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
  // What a results page shows whole: ~60 characters of title, ~155 of snippet.
  check(!title || title.trim().length <= 66, label, `title is ${title.trim().length} characters, longer than a results page shows`);
  const desc = one(r.body, /<meta name="description" content="([^"]*)"/);
  check(!!desc && desc.length >= 60 && desc.length <= 160, label, `description is ${desc ? desc.length : 0} characters, wanted 60-160`);

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
    ['/dk1/', '/dk1'], ['/no/strompris/', '/no/strompris'], ['/tariffer/', '/tariffer'],
    ['/dk1/n1/', '/dk1/n1'], ['/DK1', '/dk1'], ['/blog/', '/blog'],
  ];
  await pool(redirects, async ([from, to]) => {
    const r = await get(from);
    check(r.status === 301 && r.location === BASE + to, `redirect ${from}`,
          `status ${r.status} -> ${r.location}`);
  });

  console.log('\n5a. NEDLAGTE SIDER — 301 til siden, der afløste dem (2026-10-17)');
  // Five pages were folded into others. They must redirect permanently, stay out of the sitemap, and
  // no page may still link to them. The Shelly/Home Assistant guides live on as anchors on /automation.
  const retired = [
    ['/blog/v2g-v2h-bidirektional-opladning', '/blog'],
    ['/blog/biler-ladere-v2h-v2g', '/blog'],
    ['/blog/shelly-elpris-automation', '/automation#shelly'],
    ['/blog/home-assistant-elpriser', '/automation#home-assistant'],
    ['/blog/forsta-din-elpris', '/om-elpriser'],
  ];
  for (const [from, to] of retired) {
    const r = await get(from);
    check(r.status === 301 && r.location === CANONICAL_ORIGIN + to, `nedlagt ${from}`, `status ${r.status} -> ${r.location}`);
    check(r.cache === 'public, max-age=3600', `nedlagt ${from}: cache-control`, String(r.cache));
    check(!sitemap.includes(from), `nedlagt ${from}: ikke i sitemap`);
    check(!extra.includes(from), `nedlagt ${from}: ingen side linker til den`);
  }
  // The eleven foreign zone pages became /no/strompris, /sv/elpris, /fi/sahkon-hinta and /norden (2026-10-17).
  const zoneRetired = [
    ['/no1', '/no/strompris#no1'], ['/no2', '/no/strompris#no2'], ['/no3', '/no/strompris#no3'], ['/no4', '/no/strompris#no4'], ['/no5', '/no/strompris#no5'],
    ['/se1', '/sv/elpris#se1'], ['/se2', '/sv/elpris#se2'], ['/se3', '/sv/elpris#se3'], ['/se4', '/sv/elpris#se4'],
    ['/fi', '/fi/sahkon-hinta'], ['/nl', '/norden#nl'],
    ['/norge', '/no/strompris'], ['/sverige', '/sv/elpris'], ['/finland', '/fi/sahkon-hinta'],   // the first spelling of the three pages
  ];
  for (const [from, to] of zoneRetired) {
    const r = await get(from);
    check(r.status === 301 && r.location === CANONICAL_ORIGIN + to, `nedlagt ${from}`, `status ${r.status} -> ${r.location}`);
    check(!sitemap.includes(from), `nedlagt ${from}: ikke i sitemap`);
    check(!extra.includes(from), `nedlagt ${from}: ingen side linker til den`);
  }
  const autoPage = await get('/automation');
  check(/<section id="shelly"/.test(autoPage.body) && /<section id="home-assistant"/.test(autoPage.body), '/automation: sektionerne #shelly og #home-assistant står i HTML\'en');
  check(/<h1 class="page-title">Forstå din elpris<\/h1>/.test((await get('/om-elpriser')).body), '/om-elpriser: h1 er "Forstå din elpris"');
  const blogIdx = await get('/blog');
  check(JSON.stringify(all(blogIdx.body, /<a href="(\/blog\/[^"]+)" class="card/g).sort()) ===
        JSON.stringify(['/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/blog/groennest-og-dyrest', '/blog/hvornaar-er-stroemmen-billigst']), '/blog: kun de fire tilbageværende indlæg');
  const homeLd = [...(await get('/')).body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return {}; } }).find(j => j['@type'] === 'FAQPage');
  check(homeLd && homeLd.mainEntity.length === 5, 'forside: FAQ-markup med præcis 5 spørgsmål', homeLd && String(homeLd.mainEntity.length));
  const homeHtml = (await get('/')).body.replace(/<script[\s\S]*?<\/script>/g, '');
  check((homeHtml.match(/<details class="group faq"/g) || []).length === 5 && !/nøgletal/i.test(homeHtml) && !/id="dk1-nets"/.test(homeHtml), 'forside: 5 synlige FAQ, ingen nøgletal, ingen områdekort');

  console.log('\n5b. PRISVISNINGER (?pris=) ER EN VARIANT AF SIDEN, IKKE EN NY SIDE');
  // A view of the same page — spot price, tariff view — is addressed with ?pris=.
  // It must answer 200 and name the plain page as its canonical, or Google sees
  // a dozen near-duplicates of every price page.
  for (const [p, canon] of [
    ['/dk1?pris=spot', '/dk1'], ['/dk1?pris=spot-ex', '/dk1'], ['/dk2?pris=alt-uden-afgift', '/dk2'],
    ['/dk1/trefor?pris=tarif', '/dk1/trefor'],
  ]) {
    const r = await get(p);
    if (!check(r.status === 200, `variant ${p}`, `status ${r.status}`)) continue;
    const c = one(r.body, /<link rel="canonical" href="([^"]*)"/);
    check(c === CANONICAL_ORIGIN + canon, `variant ${p}`, `canonical is ${c}, expected ${CANONICAL_ORIGIN + canon}`);
  }

  console.log('\n6. UKENDTE STIER SKAL 404');
  const gone = ['/no6', '/no', '/sv', '/findes-ikke', '/dk1/ukendt-net', '/blog/ukendt-indlaeg'];
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
    '/ElpriserIOS/Sources/ElpriserApp.swift',
    '/ElpriserAndroid/app/build.gradle.kts',
  ];
  await pool(secret, async p => {
    const r = await get(p);
    check(r.status === 404, `ikke publiceret ${p}`, `status ${r.status}`);
  });

  console.log('\n9. FORSIDEN — prognosen skal stå i HTML\'en, ikke kun efter JS');
  const home = await get('/');
  // The front page is the Pris screen, drawn by prisHTML on the server: the
  // bars' numbers, the sentence and the day list are text in the HTML.
  check(/<div class="pris" data-period="2" data-view="din"/.test(home.body), 'forside: Pris-skærmen står i HTML\'en');
  check(!home.body.includes('<!--SSR_PRIS--></div>'), 'forside: placeholder er erstattet');
  check(/<p class="pris-ct">Næste 2 døgn<\/p>/.test(home.body) && /<p class="pris-ct">Næste 5 døgn<\/p>/.test(home.body), 'forside: begge korttitler');
  check((home.body.match(/data-tip="[^"]+ kl\. \d\d · -?\d+,\d\d kr\/kWh"/g) || []).length >= 48 + 120, 'forside: hver times pris står i HTML\'en');
  check(/class="pris-now">-?\d+,\d\d</.test(home.body), 'forside: prisen lige nu står som tekst');
  check(/class="pris-pill t[012]"/.test(home.body), 'forside: dommen billig / middel / dyr');
  // The hero must never print NaN/undefined and must carry a real hour (a phone once showed "kl. NaN").
  for (const p of ['/', '/dk1', '/dk2', '/dk1/n1', '/prognose']) {
    const r = await get(p);
    const visible = r.body.replace(/<script[\s\S]*?<\/script>/g, '');
    check(!/\bNaN\b|\bundefined\b|\[object /.test(visible), `${p}: ingen NaN/undefined i den synlige HTML`);
    if (p !== '/prognose') check(/data-hour="(?:\d|1\d|2[0-3])" data-date="\d{4}-\d{2}-\d{2}"/.test(r.body), `${p}: data-hour er en rigtig time`);
  }
  // The caption folds out into what the price is made of. On a net page: six parts and a total that
  // adds up, in the HTML and closed; on the front page (no net): five parts, no Nettarif.
  const bdN1 = await get('/dk1/n1');
  const panel1 = (bdN1.body.match(/<details class="pris-bd">[\s\S]*?<\/details>/) || [''])[0];
  check(/^<details class="pris-bd"><summary class="pris-cap">Inkl\. nettarif, afgifter og moms</.test(panel1), '/dk1/n1: billedteksten er en lukket <details>');
  // Only the markup counts: the page's own script contains the template '(open?\' open\':\'\')'.
  check(!/<details[^>]* open/.test(bdN1.body.replace(/<script[\s\S]*?<\/script>/g, '')), '/dk1/n1: åbnes først af besøgende');
  for (const label of ['Spotpris \\(Nord Pool\\)', 'Systemtarif \\(Energinet\\)', 'Transmissionstarif \\(Energinet\\)', 'Nettarif \\(N1, kl\\. \\d\\d\\)', 'Elafgift', 'Moms \\(25 %\\)', 'I alt'])
    check(new RegExp(`<span class="l">${label}</span><b>-?\\d+,\\d`).test(panel1), `/dk1/n1: rækken ${label.replace(/\\/g, '')} står i HTML'en`);
  check(/Sådan er prisen kl\. \d\d sammensat/.test(panel1) && !/NaN|undefined|Infinity/.test(panel1), '/dk1/n1: overskriften for nu, ingen NaN');
  {
    const vals = [...panel1.matchAll(/<span class="l">(?!I alt)[^<]*<\/span><b>(-?\d+,\d) øre<\/b>/g)].map(m => Math.round(parseFloat(m[1].replace(',', '.')) * 10));
    const total = (panel1.match(/<span class="l">I alt<\/span><b>(-?\d+,\d\d) kr\/kWh<\/b>/) || [])[1];
    const hero = (bdN1.body.match(/class="pris-now">(-?\d+,\d\d)</) || [])[1];
    check(vals.length === 6 && total && total === hero, '/dk1/n1: seks led, og I alt er det store tal', `${vals.length} led, ${total} vs ${hero}`);
    // The rows sum to the price rounded to 0,1 øre, so to within 0,5 øre of the 2-decimal total.
    check(vals.length === 6 && Math.abs(vals.reduce((a, b) => a + b, 0) - Math.round(parseFloat(total.replace(',', '.')) * 1000)) <= 5, '/dk1/n1: leddene summer til prisen', vals.join('+'));
  }
  const panelHome = (home.body.match(/<details class="pris-bd">[\s\S]*?<\/details>/) || [''])[0];
  check(/^<details class="pris-bd"><summary class="pris-cap">Inkl\. Energinets tariffer, afgifter og moms</.test(panelHome) && !/Nettarif \(/.test(panelHome)
    && (panelHome.match(/<span class="l">/g) || []).length === 6, 'forside: uden net, fem led plus I alt og ingen Nettarif-række');

  const dayRows = (home.body.match(/<tr class="r\d+"><th scope="row">/g) || []).length;
  check(dayRows >= 8, 'forside: dagslisten står som tekst', `fandt ${dayRows} rækker`);
  check(/class="(real|fc)">(Børspris|Prognose)</.test(home.body), 'forside: døgnene er mærket børspris eller prognose');
  check(/<td>\d,\d\d–\d,\d\d<\/td>/.test(home.body), 'forside: døgnenes spænd står som tekst');
  check(!home.body.includes('href="/${k}"'), 'forside: intet skabelon-link i HTML');
  check(!home.body.includes('href="$') && !home.body.includes("href='$"), 'forside: ingen href="$… i den serverede HTML (skabelon-literal læses som relativt link)');
  const footerOf = body => (body.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
  const homeFooter = footerOf(home.body);
  const netLinks = [...homeFooter.matchAll(/<a href="\/dk[12]\/[a-z0-9-]+"/g)].length;
  check(netLinks === 14, 'forside: sidefoden linker alle 14 netselskaber som rigtige links', `fandt ${netLinks}`);
  check(/<details class="sf-all">/.test(homeFooter) && !/<details[^>]*\bopen\b/.test(homeFooter), 'forside: netselskaberne ligger i en lukket details');
  check(/apps\.apple\.com\/dk\/app\/id6820474476/.test(homeFooter) && /play\.google\.com\/store\/apps\/details\?id=org\.elpriser\.app/.test(homeFooter), 'forside: sidefoden linker begge app-butikker');

  const prog = await get('/prognose');
  check(/<svg id="fcCurve"/.test(prog.body), '/prognose: kurven står i HTML\'en');
  check(!prog.body.includes('<div id="prognoseForecast"><!--SSR_PROGNOSE_CHART-->'), '/prognose: placeholder er erstattet');
  check(/<div class="v">\d,\d\d–\d,\d\d<\/div>/.test(prog.body), '/prognose: døgnenes spænd står som tekst');

  const se3 = await get('/sv/elpris');
  check(!/hreflang=/.test(se3.body.replace(/<!--[\s\S]*?-->/g, '')), '/sv/elpris: ingen hreflang-klynge');
  check(/<html lang="sv"/.test(se3.body), '/sv/elpris: html lang="sv"');
  // The four foreign-area pages: own language, the canonical Pris screen drawn into the HTML, and only 2 and 5 døgn.
  for (const [p, lang, unit] of [['/no/strompris', 'nb', 'øre'], ['/sv/elpris', 'sv', 'öre'], ['/fi/sahkon-hinta', 'fi', 'snt'], ['/norden', 'da', null]]) {
    const r = p === '/sv/elpris' ? se3 : await get(p);
    const page = r.body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<dialog[\s\S]*?<\/dialog>/g, '');
    const title = one(r.body, /<title>([^<]*)<\/title>/), desc = one(r.body, /<meta name="description" content="([^"]*)"/);
    check(r.status === 200 && title.length <= 62 && desc.length <= 155, `${p}: 200, titel ≤ 62 og beskrivelse ≤ 155 tegn`, `${r.status} ${title.length}/${desc.length}`);
    check(new RegExp(`<html lang="${lang}"`).test(r.body), `${p}: html lang="${lang}"`);
    check((page.match(/<h1[ >]/g) || []).length === 1, `${p}: præcis én h1`);
    check(unit ? (/<div class="pris" data-period="2"/.test(page) && page.includes(`>${unit}/kWh</span>`) && !/kr\/kWh/.test(page.slice(page.indexOf('<main')))) : (page.match(/<tr id="/g) || []).length === 13, `${p}: ${unit ? 'Pris-skærmen er tegnet i HTML\'en' : 'tabellen har 13 områder'}`);
    check(!/\b10 (døgn|dager|dage|dygn|vrk)/i.test(page), `${p}: ingen tekst om 10 døgn`);
    check(sitemap.includes(p), `${p}: i sitemap`);
  }
  check(/<title>Elpriser prognose 7 dage — time for time, op til 10 døgn frem<\/title>/.test(prog.body), '/prognose: titel har "7 dage" og de sande 10 døgn');
  // Count inside the week container: the page's own script carries the same
  // markup as a string literal, which is not a row anyone can read.
  const weekHtml = prog.body.slice(prog.body.indexOf('id="prognoseWeek">'), prog.body.indexOf('id="prognoseWeek">') + 4000);
  check((weekHtml.match(/<tr><th scope="row">/g) || []).length === 7, '/prognose: syv dage som tekst i HTML\'en');
  check(/<title>Elafgift 2028: Elafgiften stiger igen/.test((await get('/blog/elafgift-2028')).body), 'elafgift-indlægget: titlen svarer ja');
  check(/<title>Elpris Vest \(DK1\) i dag/.test((await get('/dk1')).body), '/dk1: titlen starter med "Elpris Vest"');
  const llms = await get('/llms.txt');
  check(!/7 dage|7-day/.test(llms.body) && /elpriser\.org\/sv\/elpris\)/.test(llms.body) && /elpriser\.org\/norden\)/.test(llms.body), 'llms.txt: 10 døgn og de fire nordiske sider');
  const home2 = await get('/');
  check(!/name="description" content="[^"]*inkl\. nettariffer/.test(home2.body), 'forside: beskrivelsen påstår ikke nettarif');

  const ldOf = body => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => { try { return JSON.parse(m[1]); } catch { return { '@type': 'INVALID' }; } });
  const types = body => ldOf(body).flatMap(j => j['@graph'] ? j['@graph'].map(x => x['@type']) : [j['@type']]);
  const se3t = types(se3.body);
  check(!se3t.some(t => ['FAQPage', 'Article', 'BlogPosting', 'Dataset', 'INVALID'].includes(t)), '/sv/elpris: ingen fremmed struktureret data', se3t.join(','));
  check(ldOf(se3.body).some(j => j['@type'] === 'WebPage' && j.inLanguage === 'sv'), '/sv/elpris: WebPage med inLanguage sv');
  const post = await get('/blog/elafgift-2028');
  const bp = ldOf(post.body).filter(j => j['@type'] === 'BlogPosting');
  check(bp.length === 1 && bp[0].url.endsWith('/blog/elafgift-2028'), 'blogindlæg: præcis sit eget BlogPosting');
  const n1 = await get('/dk1/n1');
  check(!n1.body.includes('href="$') && !n1.body.includes("href='$"), '/dk1/n1: ingen href="$… i den serverede HTML');
  check((footerOf(n1.body).match(/<a href="\/dk[12]\/[a-z0-9-]+"/g) || []).length === 14, '/dk1/n1: sidefoden linker alle 14 netselskaber');
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
