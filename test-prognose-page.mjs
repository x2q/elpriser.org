#!/usr/bin/env node
/**
 * /prognose, server-rendered through the real Pages Function.
 * Run: npm run test:prognose   (hermetic: the real function, index.html, a fake /api/forecast and a fake edge cache)
 *
 * The page is the canonical Pris screen of the front page, configured with PRIS_FC (2, 5 and 7 døgn, opening on 7,
 * seven days, an extra column "Usikkerhed"), with a head above it and two text blocks below. What these tests guard:
 *  - 200, ONE h1 ("Elprisprognose"), <html lang="da">, canonical, a title with "7 dage", valid JSON-LD;
 *  - the screen is drawn into the HTML for DK1, Din pris, no net — period 7, 168 bars, seven day rows, Usikkerhed;
 *  - the feed carries ten days, the page shows seven: "10 døgn" / "10 dage" is nowhere in what the page says
 *    (title, description, headings, text, dialogs, JSON-LD, llms.txt's line about it);
 *  - nothing of the old page is left over (the two-line chart "Nu og 2 døgn frem", the selects, the hour grid);
 *  - the text blocks make no accuracy claim with a number;
 *  - the render has its own versioned edge-cache key and never keeps a render without data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── A fake edge: ASSETS serves index.html, /api/forecast answers from a fixture (ten days, like the real one) ──
const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let downFeed = false;
const price = (h, day) => +(1.2 + Math.sin(h / 24 * 6.28) * 0.6 + (h >= 17 && h <= 20 ? 0.9 : 0) + day * 0.03).toFixed(4);
const forecast = (area, mode) => ({
  area, mode, generated: today, charges: { sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25 },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i), type: i === 0 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: price(h, i) })),
  })),
});
const store = new Map();
globalThis.caches = { default: { match: async k => { const r = store.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { store.set(k.url, r); } } };
let upstream = [];
globalThis.fetch = async u => {
  const url = new URL(String(u));
  upstream.push(url.pathname + url.search);
  if (url.pathname === '/api/forecast' && !downFeed) return new Response(JSON.stringify(forecast(url.searchParams.get('area'), url.searchParams.get('mode'))), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = await res.text();
  // `page`: what the page SAYS — without the app's script and style (index.html carries the whole site's code); dialogs stay in.
  const page = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const main = (page.match(/<main[\s\S]*?<\/main>/) || [''])[0];
  return { status: res.status, headers: res.headers, body, page, main };
};
const TEN = /10 (døgn|dage|dager|days)|10-dages|ti døgn/i;
const txt = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

store.clear(); upstream = [];
const r = await get('/prognose');
const raw = r.body, h = r.page;
const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';

// ── The document ──────────────────────────────────────────────────────────────────────────────
ok(r.status === 200, '/prognose: 200', String(r.status));
ok(/<html lang="da"/.test(h), '/prognose: <html lang="da">');
ok(/^Elpriser prognose 7 dage — /.test(title) && title.length <= 62 && !/10/.test(title), '/prognose: titlen har "7 dage" og højst 62 tegn og ingen 10', `${title.length}: ${title}`);
ok(/7 dage/.test(desc) && desc.length >= 80 && desc.length <= 155 && !TEN.test(desc), '/prognose: beskrivelsen har "7 dage", 80-155 tegn og ingen 10 døgn', `${desc.length}: ${desc}`);
ok(h.includes('<link rel="canonical" href="https://elpriser.org/prognose">') && h.includes('<meta property="og:url" content="https://elpriser.org/prognose">'), '/prognose: canonical og og:url peger på siden selv');
ok(new RegExp(`<meta property="og:title" content="${title}">`).test(h) && new RegExp(`<meta name="twitter:title" content="${title}">`).test(h), '/prognose: og- og twitter-titlen er sidens titel');
const h1s = [...h.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map(m => m[1]);
ok(h1s.length === 1 && h1s[0] === 'Elprisprognose', '/prognose: præcis én h1, "Elprisprognose"', JSON.stringify(h1s));
const mains = [...h.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<main[^>]*>/g)].map(m => m[0]);
ok(mains.length === 1 && mains[0].startsWith('<main data-page="prognose" class="active'), '/prognose: én <main data-page="prognose"> og den er aktiv', mains.join(' '));
// Structured data parses: the shared WebApplication and WebSite, the breadcrumb, and this page's FAQ — nothing invented.
const lds = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parsed = []; try { parsed = lds.map(x => JSON.parse(x)); } catch (e) { fails.push(`/prognose: JSON-LD kan ikke læses: ${e.message}`); }
ok(parsed.map(x => x['@type']).sort().join() === 'BreadcrumbList,FAQPage,WebApplication,WebSite', '/prognose: JSON-LD er WebApplication, WebSite, BreadcrumbList og FAQPage', parsed.map(x => x['@type']).join());
ok(!TEN.test(lds.join(' ')), '/prognose: ingen 10 døgn i JSON-LD');
const faq = parsed.find(x => x['@type'] === 'FAQPage') || { mainEntity: [] };
const visibleQ = [...h.matchAll(/<summary[^>]*>([^<]*)<svg/g)].map(m => m[1]);
ok(faq.mainEntity.length === 3 && faq.mainEntity.map(q => q.name).join('|') === visibleQ.join('|'), '/prognose: FAQPage-spørgsmålene er de synlige', visibleQ.join('|'));
ok((parsed.find(x => x['@type'] === 'BreadcrumbList').itemListElement || []).map(x => x.name).join('>') === 'Elpriser>Elpriser prognose 7 dage', '/prognose: brødkrummer Elpriser › Elpriser prognose 7 dage');

// ── The head above the screen ─────────────────────────────────────────────────────────────────
ok(h.indexOf('class="page-eyebrow"') < h.indexOf('<h1') && h.indexOf('<h1') < h.indexOf('class="pris-hero"'), '/prognose: eyebrow og h1 står over Pris-skærmen');
ok(txt(h.match(/<p class="page-eyebrow">[\s\S]*?<\/p>/)[0]) === 'Forventede elpriser · DK1 Vest', '/prognose: eyebrow "Forventede elpriser · DK1 Vest"');
ok(txt(h.match(/<p class="mt-2 text-sm[^"]*">Nu og[\s\S]*?<\/p>/)[0]) === 'Nu og 7 døgn frem, time for time: faktiske børspriser, så langt de er afregnet, og en prognose for resten. Jo længere frem, jo mere usikker er den.', '/prognose: indledningen siger "Nu og 7 døgn frem …"');

// ── The screen, drawn for DK1, Din pris, no net, seven days ───────────────────────────────────
ok(h.includes('<div class="pris" data-period="7" data-view="din" data-key="DK1|din|"'), '/prognose: Pris-skærmen er tegnet for DK1, Din pris, uden netselskab, på 7 døgn');
ok(!h.includes('<!--SSR_PRIS-->'), '/prognose: pladsholderen er erstattet');
ok(upstream.filter(u => u.startsWith('/api/forecast')).join() === '/api/forecast?area=DK1&mode=inkl_alt', '/prognose: ét kald til prognosen, DK1 inkl alt som på forsiden', upstream.join());
ok([...h.matchAll(/<button type="button" role="tab" aria-selected="(\w+)" data-pris-period="(\d)">([^<]*)</g)].map(m => `${m[2]}:${m[1]}:${m[3]}`).join('|') === '2:false:2 døgn|5:false:5 døgn|7:true:7 døgn', '/prognose: pillen er 2 døgn | 5 døgn | 7 døgn med 7 valgt');
const c7 = h.slice(h.indexOf('pris-card pp7'), h.indexOf('pris-tiles pp2'));
ok((c7.match(/<span class="pc[ "]/g) || []).length === 168, '/prognose: 7 døgn er 168 søjler', String((c7.match(/<span class="pc[ "]/g) || []).length));
ok(/aria-label="Elpris lige nu — DK1 Vest"/.test(h) && /<p class="pris-ct">Næste 7 døgn<\/p>/.test(h), '/prognose: skærmen navngiver området, og kortet hedder Næste 7 døgn');
const rows = h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>')).split('<tr class=').slice(1);
ok(rows.length === 7, '/prognose: dagslisten har syv rækker i HTML\'en', String(rows.length));
ok(/<th scope="col">Type<\/th><th scope="col">Usikkerhed<\/th>/.test(h) && rows.map(x => x.match(/<td[^>]*>([^<]*)<\/td><\/tr>/)[1]).join() === '—,Lav,Lav,Middel,Middel,Middel,Høj', '/prognose: kolonnen Usikkerhed er — Lav Lav Middel Middel Middel Høj');
ok(rows[0].includes('class="real">Børspris') && rows[1].includes('class="fc">Prognose'), '/prognose: Type er Børspris for i dag og Prognose for resten');
// The fixture has ten days; days 8-10 must not be anywhere: not a bar's tip, not a row.
const d8 = new Date(addDays(today, 7) + 'T12:00:00Z'), WS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'], MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
ok(!h.includes(`data-tip="${WS[d8.getUTCDay()]} ${d8.getUTCDate()}. ${MON[d8.getUTCMonth()]} kl.`), '/prognose: dag otte er ikke tegnet');

// ── Ten days is nowhere ───────────────────────────────────────────────────────────────────────
ok(!TEN.test(h), '/prognose: hverken "10 døgn", "10 dage" eller "ti døgn" i sidens tekst, overskrifter, dialoger eller kortenes tekst', (h.match(TEN) || [])[0]);
ok(!/Nu og 2 døgn frem|Næste 10|Næste 7 dage, dag for dag|id="fcArea"|id="fcMode"|id="fcTable|prognoseForecast|prognoseWeek|class="fcweek"|id="fcCurve"|<select/.test(raw.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, '')), '/prognose: intet af den gamle side er tilbage');
const llms = await get('/llms.txt');
const llmsLine = (llms.body.split('\n').find(l => l.includes('elpriser.org/prognose)')) || '');
ok(/7 døgn/.test(llmsLine) && !TEN.test(llmsLine), 'llms.txt: linjen om /prognose siger 7 døgn og ikke 10', llmsLine.slice(0, 160));
const sitemap = await get('/sitemap.xml');
ok(sitemap.body.includes('<loc>https://elpriser.org/prognose</loc>'), 'sitemap: /prognose er med');

// ── The text blocks below the screen ──────────────────────────────────────────────────────────
const blocks = txt(h.slice(h.indexOf('Sådan laves prognosen') - 60, h.indexOf('Ofte stillede spørgsmål')));
ok(h.indexOf('class="pris-days"') < h.indexOf('Sådan laves prognosen') && h.indexOf('Sådan laves prognosen') < h.indexOf('Det kan prognosen ikke') && /<h2[^>]*>Sådan laves prognosen<\/h2>/.test(h) && /<h2[^>]*>Det kan prognosen ikke<\/h2>/.test(h), '/prognose: to tekstblokke under skærmen, som overskrifter og i HTML\'en');
ok(/åben maskinlæringsmodel/.test(blocks) && /vejrprognoser for vind og sol/.test(blocks) && /udlandsforbindelserne/.test(blocks) && /dagligt/.test(blocks), '/prognose: "Sådan laves prognosen" nævner modellen, vejrprognoserne, udlandsforbindelserne og at den kører dagligt');
ok(/uplanlagte udfald/.test(blocks) && /ekstrem kulde/.test(blocks) && /gaspriserne/.test(blocks) && /planlægge, ikke som garanti/.test(blocks), '/prognose: "Det kan prognosen ikke" nævner udfald, kulde og gaspriser');
ok(!/\d\s*%|MAE|backtest|træffer|rammer|nøjagtig|præcis/i.test(blocks + ' ' + txt(h.slice(h.indexOf('Ofte stillede spørgsmål'), h.indexOf('</main>')))), '/prognose: teksten under skærmen har ingen nøjagtighedstal og ingen løfter om præcision');
ok(/huggingface\.co\/Elpriser\/denmark-price-forecast/.test(h), '/prognose: modellen er linket på Hugging Face');

// ── The edge cache ────────────────────────────────────────────────────────────────────────────
ok([...store.keys()].join() === 'https://cache.local/prognose-ssr-v1/prognose', '/prognose: renderen er gemt under sin egen versionerede nøgle', [...store.keys()].join());
upstream = [];
const again = await get('/prognose');
ok(again.status === 200 && again.body === raw && upstream.length === 0, '/prognose: anden visning kommer fra cachen uden kald til prognosen', String(upstream.length));
store.clear(); upstream = []; downFeed = true;
const down = await get('/prognose');
ok(down.status === 200 && store.size === 0 && /<h1[^>]*>Elprisprognose<\/h1>/.test(down.page) && /Sådan laves prognosen/.test(down.page), '/prognose: uden data serveres siden (hoved og tekst), men gemmes aldrig');
downFeed = false;
// The other pages are untouched by the configuration: the same screen, two periods, no Usikkerhed.
store.clear();
const bare = x => x.replace(/<!--[\s\S]*?-->/g, '');
const home = await get('/');
ok(home.page.includes('<div class="pris" data-period="2"') && (home.page.match(/data-pris-period="/g) || []).length === 2 && !/Usikkerhed|pp7/.test(bare(home.page)), '/: forsiden har stadig 2 døgn | 5 døgn og ingen Usikkerhed');
const dk1 = await get('/dk1');
ok(dk1.page.includes('<div class="pris" data-period="2"') && (dk1.page.match(/data-pris-period="/g) || []).length === 2 && !/Usikkerhed|pp7/.test(bare(dk1.page)), '/dk1: samme');

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
