#!/usr/bin/env node
/**
 * The ten pilot city pages, /elpris/<by>.
 * Run: npm run test:city   (hermetic: the real Pages Function, index.html, a fake /api/forecast)
 *
 * They exist to find out whether location-specific pages rank for local searches, so what these tests guard
 * is that each one is an honest page and not a doorway page:
 *  - 200, one h1, <html lang="da">, canonical, BreadcrumbList and a WebPage about a City — and NO Dataset,
 *    spatialCoverage or FAQPage (Search Console flagged spatialCoverage on /api);
 *  - the Pris screen is drawn for the city's main net company, and the text states only facts that come from
 *    the table of sampled addresses or from the forecast response (tariff profile, cheapest and dearest hour);
 *  - titles and descriptions fit a results page and are unique; the text of every page is unique;
 *  - where the net company varies by address the page says so and links the others;
 *  - five days at most, nowhere a ten-day horizon;
 *  - the unknown, the hub (/elpris) and the trailing slash behave like the rest of the site;
 *  - the edge cache has its own versioned key and never keeps a render without data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);
const { CITIES } = await import(pathToFileURL(path.join(ROOT, 'functions/_cities.js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── A fake edge: ASSETS serves index.html, /api/forecast answers from a fixture, caches.default is a Map ──
const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
// The nettarif of every net company in the fixture: 0.20 kr from 00 to 06, 0.40 by day, 1.00 from 17 to 21.
let flatTariff = false, tomorrowType = 'forecast', downFeed = false;
const tariff = h => flatTariff ? 0.4 : h < 6 ? 0.2 : h < 17 ? 0.4 : h < 21 ? 1.0 : 0.4;
// All-in price: 0.50 + 1.25 × nettarif, with the cheapest hour at 13 and the dearest at 19, a little dearer each day on.
const price = (h, day) => +(0.5 + 1.25 * tariff(h) + (h === 13 ? -0.45 : 0) + (h === 19 ? 0.3 : 0) + day * 0.01).toFixed(4);
const forecast = (area, gln) => ({
  area, mode: 'net_inkl_alt', gln, generated: today, charges: { sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25 },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i), type: i === 0 || (i === 1 && tomorrowType === 'actual') ? 'actual' : 'forecast',
    grid_tariff: Array.from({ length: 24 }, (_, h) => tariff(h)),
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: price(h, i) })),
  })),
});
const store = new Map();
globalThis.caches = { default: { match: async k => { const r = store.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { store.set(k.url, r); } } };
let upstream = [];
globalThis.fetch = async u => {
  const url = new URL(String(u));
  upstream.push(url.pathname + url.search);
  if (url.pathname === '/api/forecast' && !downFeed) return new Response(JSON.stringify(forecast(url.searchParams.get('area'), url.searchParams.get('gln'))), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = res.status === 301 ? '' : await res.text();
  // `page`: what the page SAYS — without the script and style (index.html carries the whole app's code) and the dialogs.
  const page = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  const mainHtml = (page.match(/<main[\s\S]*?<\/main>/) || [''])[0];
  const text = (mainHtml.match(/<div class="text-sm text-gray-600[\s\S]*<\/div>/) || [''])[0];
  return { status: res.status, headers: res.headers, body, page, main: mainHtml, text };
};
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const hh = n => String(n).padStart(2, '0');
const fmt = v => v.toFixed(2).replace('.', ',');
const TEN = /10 (døgn|dage|dager|days)|10-dages|ti døgn/i;

ok(CITIES.length === 10, 'ti byer i tabellen', String(CITIES.length));

// ── Every city ─────────────────────────────────────────────────────────────────
const seen = { title: new Map(), desc: new Map(), text: new Map(), h1: new Map() };
const pages = {};
for (const c of CITIES) {
  const p = '/elpris/' + c.slug, main = c.nets[0];
  store.clear(); upstream = [];
  const r = await get(p), h = r.page, raw = r.body; pages[c.slug] = r;
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(title.length >= 30 && title.length <= 62 && title.includes(c.name), `${p}: titel ≤ 62 tegn og med byens navn`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155 && desc.includes(c.name) && desc.includes(main.name), `${p}: beskrivelse 80-155 tegn med by og netselskab`, `${desc.length}: ${desc}`);
  for (const [k, v] of [['title', title], ['desc', desc]]) { if (seen[k].has(v)) fails.push(`${p}: ${k} er ikke unik (samme som ${seen[k].get(v)})`); else seen[k].set(v, p); }
  ok(/<html lang="da"/.test(h), `${p}: <html lang="da">`);
  ok(new RegExp(`<link rel="canonical" href="https://elpriser.org${p}">`).test(h) && new RegExp(`<meta property="og:url" content="https://elpriser.org${p}">`).test(h), `${p}: canonical og og:url peger på siden selv`);
  // One h1, the one the generator writes, above the Pris screen.
  const h1s = [...h.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map(m => m[1]);
  ok(h1s.length === 1 && h1s[0] === `Elpris i ${c.name} i dag — time for time`, `${p}: én h1`, JSON.stringify(h1s));
  ok(h.indexOf('<h1') < h.indexOf('class="pris-hero"'), `${p}: h1 står over Pris-skærmen`);
  // One main, the city section, carrying what the router needs.
  const mains = [...h.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<main[^>]*>/g)].map(m => m[0]);
  ok(mains.length === 1 && mains[0].startsWith('<main data-page="city" data-area="' + c.area + '" data-net="' + main.slug + '" class="active'), `${p}: én <main data-page="city"> med område og netselskab`, mains.join(' '));
  // Structured data parses; BreadcrumbList + WebPage about a City; nothing else.
  const lds = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let parsed = []; try { parsed = lds.map(x => JSON.parse(x)); } catch (e) { fails.push(`${p}: JSON-LD kan ikke læses: ${e.message}`); }
  // The shared head carries WebApplication and WebSite on every page; the city adds BreadcrumbList and WebPage and nothing else.
  const types = parsed.map(x => x['@type']).sort().join(',');
  ok(types === 'BreadcrumbList,WebApplication,WebPage,WebSite', `${p}: JSON-LD er den fælles WebApplication/WebSite plus BreadcrumbList og WebPage`, types);
  const web = parsed.find(x => x['@type'] === 'WebPage') || {}, crumbs = parsed.find(x => x['@type'] === 'BreadcrumbList') || {};
  ok(web.inLanguage === 'da' && web.url === 'https://elpriser.org' + p && web.about && web.about['@type'] === 'City' && web.about.name === c.name
    && web.about.containedInPlace && web.about.containedInPlace['@type'] === 'Country' && web.about.containedInPlace.name === 'Danmark', `${p}: WebPage om en City i Danmark`, JSON.stringify(web.about));
  ok((crumbs.itemListElement || []).map(x => x.name).join('>') === `Elpriser>${c.name}`, `${p}: brødkrummer Elpriser › ${c.name}`, JSON.stringify(crumbs.itemListElement));
  ok(!/"Dataset"|spatialCoverage|FAQPage|"Question"|PriceSpecification/.test(raw.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, '')), `${p}: ingen Dataset, spatialCoverage, FAQPage eller PriceSpecification`);
  // The Pris screen, drawn for the main net's all-in price; the chip says the same.
  ok(h.includes('<div class="pris" data-period="2"') && h.includes(`data-key="${c.area}|din|${main.slug}"`), `${p}: Pris-skærmen er tegnet for ${main.name} (Din pris)`);
  ok(new RegExp(`aria-label="Elpris lige nu — ${c.area === 'DK1' ? 'DK1 Vest' : 'DK2 Øst'} · ${main.name}"`).test(h), `${p}: skærmen navngiver prisområde og netselskab`);
  ok(h.includes(`id="netChipLong">${main.name} · ${c.area === 'DK2' ? 'Østdanmark' : 'Vestdanmark'}<`), `${p}: netselskabs-chippen i toppen viser ${main.name}`);
  ok(h.includes('Inkl. nettarif, afgifter og moms'), `${p}: billedteksten siger at prisen er inkl. nettarif`);
  ok((h.match(/data-pris-period="/g) || []).length === 2 && h.includes('>5 døgn</button>') && !TEN.test(h), `${p}: kun 2 og 5 døgn, intet 10-dages`, (h.match(TEN) || [])[0]);
  ok(!/NaN|undefined|Infinity/.test(r.main), `${p}: ingen NaN/undefined`);
  ok(upstream.length === 1 && upstream[0] === `/api/forecast?area=${c.area}&mode=net_inkl_alt&gln=${main.gln}`, `${p}: ét kald: prognosen for netselskabet`, upstream.join(' '));
  // The text block: only facts from the table and the forecast.
  const t = strip(r.text);
  ok(t.includes(`${c.name} ligger i prisområde ${c.area === 'DK1' ? 'DK1 Vest' : 'DK2 Øst'}`), `${p}: teksten nævner prisområdet`);
  ok(t.includes(main.name), `${p}: teksten nævner netselskabet`);
  const n = c.samples, cnt = Math.round(main.share * n);
  ok(t.includes(`${cnt === n ? `alle de ${n}` : `${cnt} af de ${n}`} adresser`) || t.includes(`hørte ${cnt} til ${main.name}`), `${p}: teksten oplyser stikprøven (${cnt} af ${n} hørte til ${main.name})`, t.slice(0, 300));
  ok(t.includes(`Hos ${main.name} er nettariffen i dag lavest kl. 00–06 (0,20 kr/kWh) og højest kl. 17–21 (1,00 kr/kWh), ekskl. moms.`), `${p}: nettarif-profilen for i dag er regnet ud af prognosesvaret`, t.slice(300, 700));
  const p0 = Array.from({ length: 24 }, (_, x) => price(x, 0)), lo0 = Math.min(...p0), hi0 = Math.max(...p0);
  ok(t.includes(`den billigste time i dag kl. ${hh(p0.indexOf(lo0))}–${hh(p0.indexOf(lo0) + 1)} (${fmt(lo0)} kr/kWh) og den dyreste kl. ${hh(p0.indexOf(hi0))}–${hh(p0.indexOf(hi0) + 1)} (${fmt(hi0)} kr/kWh)`), `${p}: billigste og dyreste time i dag`, t);
  ok(/I morgen forventes den billigste kl\. 13–14 \(0,56 kr\/kWh\) og den dyreste kl\. 19–20 \(2,06 kr\/kWh\)/.test(t), `${p}: i morgen (prognose) står som "forventes"`, t);
  ok(/Set over de næste 5 døgn er den billigste time i dag kl\. 13–14 \(0,55 kr\/kWh\) og den dyreste \S+ \d+\. kl\. 19–20 \(2,09 kr\/kWh\)/.test(t), `${p}: femdøgnsudsigt med ugedag og dato`, t);
  ok(/class="text-brand-500 underline">Læs mere i Forstå din elpris<\/a>/.test(r.text) && r.text.includes('href="/om-elpriser"') && t.includes('Sådan regnes prisen'), `${p}: "sådan regnes prisen" linker til /om-elpriser`);
  // The button that opens the net chooser, with its words.
  ok(/<button type="button" class="gps-light" onclick="openNetDialog\(\)" aria-haspopup="dialog">Er dit netselskab et andet\? Skift<\/button>/.test(r.text), `${p}: knappen "Er dit netselskab et andet? Skift" åbner netvælgeren`);
  // Other net companies: a link to each page of theirs when the table has any.
  for (const o of c.nets.slice(1)) ok(new RegExp(`href="/dk[12]/${o.slug}"`).test(r.text), `${p}: link til ${o.name}s side`);
  ok((c.nets[0].share < 0.75) === t.includes('afhænger af adressen'), `${p}: "afhænger af adressen" står hvis og kun hvis hovednettets andel er under 0,75`, `${main.share}`);
  for (const o of c.other || []) ok(t.includes(o.name) && t.includes('har vi endnu ikke tariffer for'), `${p}: ${o.name} nævnes som netselskab uden tariffer`);
  // The text is unique to the city.
  if (seen.text.has(t)) fails.push(`${p}: teksten er identisk med ${seen.text.get(t)}`); else seen.text.set(t, p);
  // Crawl hygiene: no templated href, no empty link.
  ok(!/href="[^"]*(\$\{|undefined|\[object)/.test(r.main) && !/href=""/.test(r.main), `${p}: ingen skabelon- eller tomme links`);
  // Cached under its own versioned key; a second request does not ask the feed again.
  ok([...store.keys()].some(k => k === `https://cache.local/city-ssr-v4${p}`), `${p}: egen versioneret cache-nøgle`, [...store.keys()].join(' '));
  const again = await get(p);
  ok(again.page === h && upstream.length === 1, `${p}: andet svar kommer fra cachen`);
}
// The shared parts of the pages must not be all there is: every page has a paragraph no other page has.
{
  const paras = c => (pages[c.slug].text.match(/<p[ >][\s\S]*?<\/p>/g) || []).map(strip);
  const count = new Map(); for (const c of CITIES) for (const x of new Set(paras(c))) count.set(x, (count.get(x) || 0) + 1);
  for (const c of CITIES) {
    const own = paras(c).filter(x => count.get(x) === 1);
    ok(own.length >= 1 && own.join(' ').length >= 150, `/elpris/${c.slug}: mindst ét afsnit (≥ 150 tegn) der kun findes her`, `${own.length} afsnit`);
  }
}

// ── Tariff profile, cheapest hour, wording: variations of the feed ────────────────────────────────
{
  const c = CITIES[0], p = '/elpris/' + c.slug;
  flatTariff = true; store.clear();
  let t = strip((await get(p)).text);
  ok(t.includes(`Hos ${c.nets[0].name} er nettariffen den samme hele døgnet i dag: 0,40 kr/kWh ekskl. moms.`) && !t.includes('lavest kl.'), 'flad nettarif: "den samme hele døgnet" og ingen billigste/dyreste timer');
  flatTariff = false; tomorrowType = 'actual'; store.clear();
  t = strip((await get(p)).text);
  ok(/I morgen er den billigste kl\. 13–14/.test(t) && !/I morgen forventes/.test(t), 'i morgen med børspriser står som "er", ikke "forventes"');
  tomorrowType = 'forecast';
  // The feed is down: the page is still a page, with the table's facts and no figures, and is not kept.
  downFeed = true; store.clear();
  const r = await get(p);
  ok(r.status === 200 && r.page.includes(`Elpris i ${c.name} i dag`) && strip(r.text).includes(`${c.name} ligger i prisområde`) && !/Hos \S+ er (nettariffen|den billigste)/.test(strip(r.text)) && !/NaN|undefined/.test(r.main),
    'uden prognose: siden kommer stadig, med tabellens fakta og uden tal');
  ok(!r.page.includes('<div class="pris" data-period="2"') && store.size === 0, 'uden prognose: ingen Pris-skærm og intet huskes i cachen');
  downFeed = false;
}
// Multi-net wording, on copies of the table's own rows: below 0.75 the page says it varies and links the others; above, it does not.
{
  const c = CITIES.find(x => x.nets.length > 1 || (x.other || []).length) || CITIES[0], saved = JSON.stringify(c);
  const p = '/elpris/' + c.slug, orig = JSON.parse(saved);
  const set = (share, extra) => { c.nets[0].share = share; c.nets.length = 1; c.other = []; if (extra) { c.nets.push({ name: 'Radius', gln: '5790000705689', slug: 'radius', share: 1 - share }); } c.samples = 20; };
  store.clear(); set(0.6, true);
  let t = strip((await get(p)).text), r = await get(p);
  ok(t.includes('afhænger af adressen') && t.includes('hørte 12 til ') && t.includes('8 til Radius') && /href="\/dk2\/radius"/.test(r.text), 'under 0,75: "afhænger af adressen", fordelingen og et link til det andet netselskab');
  store.clear(); set(0.9, true);
  t = strip((await get(p)).text);
  ok(!t.includes('afhænger af adressen') && t.includes('18 af de 20 adresser') && t.includes('de sidste hørte 2 til Radius') && t.includes('Netselskabet følger adressen, så tjek dit eget'), 'over 0,75: ingen "afhænger", men stikprøven og de sidste nævnt');
  store.clear(); set(1, false);
  t = strip((await get(p)).text);
  ok(t.includes('alle de 20 adresser') && !t.includes('de sidste hørte'), 'alle adresser: "alle de 20"');
  Object.assign(c, orig);   // c is the very object SEO_PAGES holds
  store.clear();
}

// ── Address behaviour ───────────────────────────────────────────────────────────────
{
  const slug = CITIES[0].slug;
  ok((await get('/elpris')).status === 404, '/elpris er 404: der er ingen oversigtsside');
  const tr = await get('/elpris/');
  ok(tr.status === 301 && tr.headers.get('location') === 'https://elpriser.org/elpris', '/elpris/ → 301 /elpris');
  const sl = await get(`/elpris/${slug}/?utm_source=x`);
  ok(sl.status === 301 && sl.headers.get('location') === `https://elpriser.org/elpris/${slug}?utm_source=x`, `/elpris/${slug}/ → 301 uden skråstreg`, sl.headers.get('location'));
  const up = await get(`/elpris/${slug[0].toUpperCase()}${slug.slice(1)}`);
  ok(up.status === 301 && up.headers.get('location') === `https://elpriser.org/elpris/${slug}`, 'forkert versal → 301 til den rigtige by');
  for (const bad of ['/elpris/findes-ikke', '/elpris/koebenhavn/x', '/elpris/k%C3%B8benhavn', '/elpris/0', '/Elpris/ukendt']) {
    const r = await get(bad);
    ok(r.status === 404 && /noindex/.test(r.body) && !r.body.includes('data-page="city"'), `${bad} er 404`, String(r.status));
  }
}

// ── The rest of the site points at the cities ────────────────────────────────────────
{
  const sm = (await get('/sitemap.xml')).body;
  for (const c of CITIES) {
    const m = sm.match(new RegExp(`<loc>https://elpriser\\.org/elpris/${c.slug}</loc>\\s*<lastmod>([^<]+)</lastmod>\\s*<changefreq>([^<]+)</changefreq>\\s*<priority>([\\d.]+)</priority>`));
    ok(m && m[1] === new Date().toISOString().slice(0, 10) && m[3] === '0.5', `sitemap: /elpris/${c.slug} med lastmod i dag og prioritet 0,5`, m && m.slice(1).join(' '));
  }
  ok(!/<loc>https:\/\/elpriser\.org\/elpris<\/loc>/.test(sm), 'sitemap: ingen /elpris-oversigt');
  const llms = (await get('/llms.txt')).body;
  ok(CITIES.every(c => llms.includes(`[${c.name}](https://elpriser.org/elpris/${c.slug})`)) && !TEN.test(llms.slice(llms.indexOf('Elpris pr. by'), llms.indexOf('- [Nettariffer]'))), 'llms.txt: en linje med alle byerne og uden 10-dages');
  // Net pages: "Byer i området" for the cities whose main net company this is and those where it has at least a
  // quarter of the sampled addresses (Dinel in Aarhus, Radius in Roskilde) — and no others (Nord Energi's 6 % of Aalborg).
  const LINKED = 0.25, linked = (c, slug) => c.nets.some((x, i) => x.slug === slug && (i === 0 || x.share >= LINKED));
  for (const area of ['dk1', 'dk2']) {
    const nets = [...new Set(CITIES.filter(c => c.area.toLowerCase() === area).flatMap(c => c.nets.map(x => x.slug)))];
    for (const slug of nets) {
      const r = await get(`/${area}/${slug}`), mine = CITIES.filter(c => c.area.toLowerCase() === area && linked(c, slug));
      const line = ((strip(r.page).match(/Byer i området: ([^.]*)\./) || [])[1] || '').replace(/\s+,/g, ',').trim();
      if (mine.length) ok(line === mine.map(c => c.name).join(', ') && mine.every(c => r.page.includes(`href="/elpris/${c.slug}"`)), `/${area}/${slug}: "Byer i området: ${mine.map(c => c.name).join(', ')}"`, line);
      else ok(!strip(r.page).includes('Byer i området'), `/${area}/${slug}: ingen "Byer i området" (højst en lille andel af en bys adresser)`, line);
    }
  }
  const none = ['n1', 'trefor', 'konstant', 'dinel', 'vores-elnet', 'rah-net', 'elvaerk', 'nord-energi', 'noe-net', 'elnet-midt', 'flow-elnet', 'lnet'].filter(s => !CITIES.some(c => c.area === 'DK1' && c.nets.some(x => x.slug === s)))[0];
  if (none) ok(!strip((await get('/dk1/' + none)).page).includes('Byer i området'), `/dk1/${none}: ingen "Byer i området" når ingen by har det som netselskab`);
  ok(strip((await get('/dk1/konstant')).page).includes('Byer i området: Aarhus'), '/dk1/konstant: Aarhus (hovednet)');
  ok(strip((await get('/dk1/dinel')).page).includes('Byer i området: Aarhus'), '/dk1/dinel: Aarhus (40 % af adresserne, selv om Konstant er hovednet)');
  ok(!strip((await get('/dk1/nord-energi')).page).includes('Byer i området'), '/dk1/nord-energi: Aalborg (6 %) er ikke "i området"');
}

// ── Dinel, the 15th net company: GLN 5790000610099, DK1, named "Dinel A/S" by Green Power Denmark's lookup ──────
{
  const GLN = '5790000610099', p = '/dk1/dinel';
  // index.html knows it (name, GLN, the string the lookup is matched with), in DK1 only.
  const entry = INDEX.match(/\{name:'Dinel',slug:'dinel',gln:'(\d{13})',match:\[([^\]]*)\]\}/);
  ok(entry && entry[1] === GLN && entry[2] === "'Dinel'", 'index.html: NETS har Dinel med GLN 5790000610099 og match-strengen "Dinel"', entry && entry.slice(1).join(' '));
  ok(INDEX.indexOf("slug:'dinel'") < INDEX.indexOf('],DK2:['), 'index.html: Dinel står i DK1-listen');
  // The page: its own title and description, and the Pris screen drawn for Dinel's all-in price.
  store.clear(); upstream = [];
  const r = await get(p), raw = r.body, h = r.page;
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(title.length >= 30 && title.length <= 62 && title.includes('Dinel') && title.includes('DK1'), `${p}: titel ≤ 62 tegn med Dinel og DK1`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155 && desc.includes('Dinel'), `${p}: beskrivelse 80-155 tegn med Dinel`, `${desc.length}: ${desc}`);
  ok(h.includes('<link rel="canonical" href="https://elpriser.org/dk1/dinel">'), `${p}: canonical peger på siden selv`);
  ok(/<h1[^>]*>Elpris hos Dinel i dag — DK1 Vest<\/h1>/.test(h), `${p}: h1 "Elpris hos Dinel i dag — DK1 Vest"`);
  ok(h.includes('<div class="pris" data-period="2"') && h.includes('data-key="DK1|din|dinel"'), `${p}: Pris-skærmen er tegnet for Dinel (Din pris)`);
  ok(h.includes('aria-label="Elpris lige nu — DK1 Vest · Dinel"') && h.includes('id="netChipLong">Dinel · Vestdanmark<'), `${p}: skærmen og netchippen navngiver Dinel`);
  ok(upstream.includes(`/api/forecast?area=DK1&mode=net_inkl_alt&gln=${GLN}`), `${p}: prognosen hentes med Dinels GLN`, upstream.join(' '));
  ok(strip(r.main).includes('Dinel er et lokalt netselskab') && !/NaN|undefined/.test(r.main), `${p}: egen dækningstekst om Dinel, ingen NaN/undefined`);
  ok(/data-pris-period="/.test(h) && !TEN.test(h), `${p}: ingen 10-dages`);
  // Not in DK2: the area is part of the address.
  const wrong = await get('/dk2/dinel');
  ok(wrong.status === 404 && !wrong.body.includes('data-key="DK2|din|dinel"'), '/dk2/dinel er 404 (Dinel er DK1)', String(wrong.status));
  // The sitemap, with the net priority (llms-full.txt's GLN table is pinned in test-static.js).
  const sm = (await get('/sitemap.xml')).body;
  ok(/<loc>https:\/\/elpriser\.org\/dk1\/dinel<\/loc>\s*<lastmod>[^<]+<\/lastmod>\s*<changefreq>[^<]+<\/changefreq>\s*<priority>0\.6<\/priority>/.test(sm), 'sitemap: /dk1/dinel med prioritet 0,6');
  // Aarhus: Konstant stays the main net company, Dinel is a net we price and so has a page and is no longer "without tariffs".
  const a = pages.aarhus, at = strip(a.text);
  ok(CITIES.find(c => c.slug === 'aarhus').nets.map(x => x.slug + ':' + x.share).join() === 'konstant:0.6,dinel:0.4', 'Aarhus: Konstant 0,6 og Dinel 0,4 i tabellen');
  ok(a.text.includes('<a href="/dk1/dinel" class="text-brand-500 underline">Dinel</a>') && at.includes('hørte 12 til Konstant, 8 til Dinel') && at.includes('afhænger af adressen'), '/elpris/aarhus: "hørte 12 til Konstant, 8 til Dinel", Dinel linket, og "afhænger af adressen"', at.slice(0, 300));
  ok(!at.includes('har vi endnu ikke tariffer for'), '/elpris/aarhus: ingen netselskab uden tariffer tilbage');
  ok(a.page.includes('data-key="DK1|din|konstant"') && a.page.includes('data-net="konstant"'), '/elpris/aarhus: Pris-skærmen er stadig tegnet for Konstant');
  // Dinel's page names the city it serves; the footer links the page on every city page too.
  ok(strip(r.page).includes('Byer i området: Aarhus') && r.page.includes('href="/elpris/aarhus"'), `${p}: "Byer i området: Aarhus" med link`);
  ok(a.page.includes('href="/dk1/dinel"'), '/elpris/aarhus: sidefoden/teksten linker /dk1/dinel');
}

// ── Ravdex, the 16th: GLN 5790000836727, DK1, named "Ravdex" by the lookup; 2 of 20 Odense addresses ─────────────
{
  const GLN = '5790000836727', p = '/dk1/ravdex';
  const entry = INDEX.match(/\{name:'Ravdex',slug:'ravdex',gln:'(\d{13})',match:\[([^\]]*)\]\}/);
  ok(entry && entry[1] === GLN && entry[2] === "'Ravdex'" && INDEX.indexOf("slug:'ravdex'") < INDEX.indexOf('],DK2:['), 'index.html: NETS har Ravdex i DK1 med GLN 5790000836727 og match-strengen "Ravdex"', entry && entry.slice(1).join(' '));
  store.clear(); upstream = [];
  const r = await get(p), raw = r.body, h = r.page;
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(title.length >= 30 && title.length <= 62 && title.includes('Ravdex') && title.includes('DK1'), `${p}: titel ≤ 62 tegn med Ravdex og DK1`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155 && desc.includes('Ravdex'), `${p}: beskrivelse 80-155 tegn med Ravdex`, `${desc.length}: ${desc}`);
  ok(h.includes('<link rel="canonical" href="https://elpriser.org/dk1/ravdex">') && /<h1[^>]*>Elpris hos Ravdex i dag — DK1 Vest<\/h1>/.test(h), `${p}: canonical og h1`);
  ok(h.includes('<div class="pris" data-period="2"') && h.includes('data-key="DK1|din|ravdex"') && h.includes('aria-label="Elpris lige nu — DK1 Vest · Ravdex"'), `${p}: Pris-skærmen er tegnet for Ravdex`);
  ok(upstream.includes(`/api/forecast?area=DK1&mode=net_inkl_alt&gln=${GLN}`), `${p}: prognosen hentes med Ravdex' GLN`, upstream.join(' '));
  ok(strip(r.main).includes('Ravdex er et lokalt netselskab') && strip(r.main).includes('dele af Odense') && !/NaN|undefined/.test(r.main), `${p}: egen dækningstekst, ingen NaN/undefined`);
  // 10 % of Odense is below the "Byer i området" share: the net page does not claim Odense, the city page links the net in its own text.
  ok(!strip(r.page).includes('Byer i området'), `${p}: ingen "Byer i området" (10 % af Odense)`);
  const ot = strip(pages.odense.text);
  ok(pages.odense.text.includes('<a href="/dk1/ravdex" class="text-brand-500 underline">Ravdex</a>') && ot.includes('de sidste hørte 2 til Ravdex') && !ot.includes('har vi endnu ikke tariffer for') && ot.includes('18 af de 20 adresser'), '/elpris/odense: "de sidste hørte 2 til Ravdex" med link, og ingen netselskab uden tariffer', ot.slice(0, 400));
  ok(pages.odense.page.includes('data-key="DK1|din|vores-elnet"'), '/elpris/odense: Pris-skærmen er stadig tegnet for Vores Elnet');
  ok(strip(pages.esbjerg.text).includes('Hjerting Transformatorforening har vi endnu ikke tariffer for'), '/elpris/esbjerg: Hjerting står stadig som netselskab uden tariffer (dets husholdningstarif ligger ikke i arkivet)');
  ok((await get('/dk2/ravdex')).status === 404, '/dk2/ravdex er 404');
  ok((await get('/dk1/hjerting-transformatorforening')).status === 404, '/dk1/hjerting-transformatorforening er 404: ikke en understøttet net');
  const sm = (await get('/sitemap.xml')).body;
  ok(/<loc>https:\/\/elpriser\.org\/dk1\/ravdex<\/loc>\s*<lastmod>[^<]+<\/lastmod>\s*<changefreq>[^<]+<\/changefreq>\s*<priority>0\.6<\/priority>/.test(sm), 'sitemap: /dk1/ravdex med prioritet 0,6');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
