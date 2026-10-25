#!/usr/bin/env node
/**
 * The five foreign-area pages: /no/strompris, /sv/elpris, /fi/sahkon-hinta, /nl/stroomprijs and /norden.
 * Run: npm run test:zone   (hermetic: the real Pages Function, index.html, a fake /api/nordic)
 *
 * They replaced eleven thin zone pages (/no1 … /nl). What this guards:
 *  - each page is served 200 with its own title, description, html lang and h1, and with the
 *    SAME Pris screen as the Danish pages drawn into the HTML, in the page's language;
 *  - nothing on them can show the feed's longer horizon: the feed carries ten days, these pages two and five;
 *  - /norden draws all thirteen areas in DKK with the basis stated;
 *  - the render is cached under its own versioned key, and an incomplete render is never remembered;
 *  - the four country pages wear their own chrome (a country navigation and a slim footer in their language; no Danish
 *    menu, net chip, app button, tab bar, net dialog or footer) and the Danish pages' chrome is the fixture, byte for byte;
 *  - the thirteen old URLs answer 301 to the right place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── A fake edge: ASSETS serves index.html, /api/nordic answers from a fixture, caches.default is a Map ──
const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const RATE = { dk1: 7.5, dk2: 7.5, no: 10, se: 11, eur: 1 };
const rateOf = z => /^dk/.test(z) ? RATE.dk1 : z.startsWith('no') ? RATE.no : z.startsWith('se') ? RATE.se : 1;
const BASE = { no1: 80, no2: 120, no3: 60, no4: 30, no5: 100, se1: 25, se2: 35, se3: 70, se4: 110, fi: 45, nl: 95, dk1: 90, dk2: 100 };
/** Ten days from YESTERDAY, like the live feed; EUR/MWh with a daily swing so there is a cheapest hour. */
const nordic = zone => ({
  zone, generated: today, unit: 'EUR/MWh',
  zoneInfo: { name: zone.toUpperCase(), currency: 'X', rate: rateOf(zone), rateSource: 'test' },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i - 1), type: i < 3 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(BASE[zone] + 25 * Math.sin(h / 24 * 6.2832) + i * 2).toFixed(2) })),
  })),
});
const store = new Map();
globalThis.caches = { default: { match: async k => { const r = store.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { store.set(k.url, r); } } };
let upstream = [], missing = new Set();
globalThis.fetch = async u => {
  const url = new URL(String(u));
  upstream.push(url.pathname + url.search);
  const z = url.searchParams.get('zone');
  if (url.pathname === '/api/nordic' && z && !missing.has(z)) return new Response(JSON.stringify(nordic(z)), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};
// The words of the chrome, lifted from the Pris block of the real file (the same block index.html carries).
const chromeI18n = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const a = src.indexOf('var CHROME_I18N={'), b = src.indexOf('\n};', a) + 3;
  return new Function(src.slice(a, b) + '\nreturn CHROME_I18N;')();
})();
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = res.status === 301 ? '' : await res.text();
  // `page`: what the page SAYS — without the script and style (index.html carries the whole app's code,
  // markup strings included). The dialogs stay: on a country page there is none, and that is asserted.
  const page = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return { status: res.status, headers: res.headers, body, page };
};

// ── The four pages ──────────────────────────────────────────────────────────
const PAGES = {
  '/no/strompris': { lang: 'nb', title: /^Strømpris prognose Norge/, tabs: 5, zones: ['Oslo', 'Kristiansand', 'Trondheim', 'Tromsø', 'Bergen'], unit: 'øre', now: 'Strømpris akkurat nå', p5: '5 døgn', first: 'no1' },
  '/sv/elpris': { lang: 'sv', title: /^Elpris prognos Sverige/, tabs: 4, zones: ['Luleå', 'Sundsvall', 'Stockholm', 'Malmö'], unit: 'öre', now: 'Elpris just nu', p5: '5 dygn', first: 'se3' },
  '/fi/sahkon-hinta': { lang: 'fi', title: /^Sähkön hinta ennuste/, tabs: 0, zones: ['Suomi'], unit: 'snt', now: 'Sähkön hinta juuri nyt', p5: '5 vrk', first: 'fi' },
  '/nl/stroomprijs': { lang: 'nl', title: /^Stroomprijs vandaag en morgen/, tabs: 0, zones: ['Nederland'], unit: 'cent', now: 'Stroomprijs nu', p5: '5 dagen', first: 'nl' },
};
const TEN = /10 (døgn|dager|dage|dygn|vrk|vuorokautta|days)|10-day|tio dygn|kymmenen/i;
for (const [p, w] of Object.entries(PAGES)) {
  store.clear(); upstream = [];
  const r = await get(p), h = r.page, raw = r.body;
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(w.title.test(title) && title.length <= 62, `${p}: titel under 62 tegn`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155, `${p}: beskrivelse 80-155 tegn`, String(desc.length));
  ok(new RegExp(`<html lang="${w.lang}"`).test(h), `${p}: <html lang="${w.lang}">`);
  ok(!/<link rel="alternate"/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/hreflang=/g) || []).length === 1 && /<a href="\/privatliv" hreflang="da">/.test(h), `${p}: ingen hreflang-klynge; det eneste hreflang er privatlivslinkets da`);
  ok(new RegExp(`<link rel="canonical" href="https://elpriser.org${p}">`).test(h), `${p}: canonical peger på siden selv`);
  ok(/"@type":"WebPage"[^<]*"inLanguage":"/.test(raw) && raw.includes(`"@type":"WebPage"`) && /"inLanguage":"(nb|sv|fi|nl)"/.exec(raw.slice(raw.indexOf('"@type":"WebPage"')))[1] === w.lang, `${p}: JSON-LD WebPage med inLanguage ${w.lang}`);
  ok((h.match(/<h1[ >]/g) || []).length === 1 && new RegExp(`<h1 class="vh" id="zH1">[^<&]{20,}</h1>`).test(h), `${p}: én h1, skrevet af serveren`);
  // The very Pris screen of the Danish pages, in this language.
  ok(h.includes('<div class="pris" data-period="2"') && h.includes(`data-key="${w.first}"`), `${p}: Pris-skærmen er tegnet for ${w.first}`);
  ok(h.includes(w.now) && h.includes(`>${w.unit}/kWh</span>`), `${p}: etiket og enhed på sidens sprog`);
  ok(!/data-pris-view|pris-seg|Din pris|kr\/kWh/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), `${p}: ingen Din pris/Spotpris-kontakt og ingen kroner`);
  ok(h.includes(`>${PAGES[p].p5}</button>`) && h.includes('data-pris-period="2"'), `${p}: kun to perioder: 2 og 5`);
  ok((h.match(/data-pris-period="/g) || []).length === 2, `${p}: præcis to periodeknapper`);
  // Five days at most: 120 bars in the five-day card, five rows in the day list, no hidden sixth to tenth day.
  const five = h.slice(h.indexOf('pris-card pp5'), h.indexOf('pris-tiles pp2'));
  ok((five.match(/<span class="pc[ "]/g) || []).length === 120, `${p}: 5 døgn er 120 søjler`, String((five.match(/<span class="pc[ "]/g) || []).length));
  ok((h.match(/<tr class="r\d+">/g) || []).length === 5 && !/class="r10"/.test(h), `${p}: dagslisten har fem rækker og ingen skjult dag seks-ti`);
  ok(!TEN.test(h), `${p}: ingen tekst om 10 døgn`, (h.match(TEN) || [])[0]);
  // The tab row.
  ok((h.match(/role="tab" id="zt-/g) || []).length === w.tabs, `${p}: ${w.tabs} zone-faner`);
  if (w.tabs) ok(/role="tablist" aria-label="[^"]+"/.test(h) && (h.match(/aria-selected="true" tabindex="0"/g) || []).length === 1 && (h.match(/tabindex="-1"/g) || []).length === w.tabs - 1 && /id="zPanel" role="tabpanel" aria-labelledby="zt-/.test(h),
    `${p}: tablist-semantik med roving tabindex og et tabpanel`);
  // The crawlable text block: every zone, its city, and prices.
  const list = h.slice(h.indexOf('<section class="zl"'), h.indexOf('</section>', h.indexOf('<section class="zl"')));
  ok(w.zones.every(c => list.includes(`<b>${c}</b>`)), `${p}: tekstblokken nævner alle byer`, list.slice(0, 200));
  ok((list.match(/<li>/g) || []).length === w.zones.length && (list.match(new RegExp(`${w.unit}/kWh`, 'g')) || []).length >= w.zones.length, `${p}: ét punkt pr. zone med pris`);
  ok(!/NaN|undefined|Infinity/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), `${p}: ingen NaN/undefined`);
  ok(new RegExp(`<meta property="og:locale" content="${{ nb: 'nb_NO', sv: 'sv_SE', fi: 'fi_FI', nl: 'nl_NL' }[w.lang]}">`).test(raw), `${p}: og:locale på sidens sprog`);
  // The chrome: the country navigation in the page's language, a slim footer, and none of the Danish site's.
  {
    const hd = h.slice(h.indexOf('<header'), h.indexOf('</header>')), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>')), X = chromeI18n[w.lang];
    const nav = [...hd.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].filter(m => m[1] !== '/');
    ok(/<html lang="[a-z]+" class="xc">/.test(h) && /<a href="\/" class="site-logo" aria-label="[^"]+">[\s\S]*<\/svg><\/span>Elpriser<\/a>/.test(hd), `${p}: logoet viser ordmærket Elpriser og linker til /`);
    ok(nav.map(m => m[3]).join() === Object.values(X.cn).join() && nav.map(m => m[1]).join() === '/dk1,/no/strompris,/sv/elpris,/fi/sahkon-hinta,/nl/stroomprijs', `${p}: landenavigationen på ${w.lang}`, nav.map(m => m[3]).join());
    ok(nav.filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]).join() === p, `${p}: den aktuelle side er aria-current i menuen`);
    ok(hd.includes(`aria-label="${X.menu}"`) && hd.includes(`aria-label="${X.home}"`), `${p}: menuens og logoets navne på ${w.lang}`);
    ok(!/id="netChip|class="chip-btn|app-btn|Hent appen|Smart hjem|>Om<|Hovedmenu|href="\/automation"|href="\/om-elpriser"|href="\/download"/.test(hd), `${p}: ingen netchip, ingen app-knap, ingen dansk menu i headeren`);
    ok(!/class="tabbar|Mobilnavigation|id="netDialog|Netselskab og indstillinger|id="netChip/.test(h.replace(/<!--[\s\S]*?-->/g, '')), `${p}: ingen dansk mobilbar, ingen netdialog og ingen netchip`);
    ok((h.match(/<footer\b/g) || []).length === 1 && ft.includes('class="sf sf-x"') && ft.includes(`id="sfLand">${X.land}<`) && ft.includes(X.privacy) && !/Privatliv|Hent appen|Hent til|Netselskab|Alle guides|Tariffer|Prognose<|Forstå din elpris|Åbne datasæt|class="sf-apps|class="sf-all|<details/.test(ft), `${p}: sidefoden er den slanke på ${w.lang}`);
    ok(ft.includes('&copy; Elpriser.org') && ft.includes(X.src) && ft.includes(X.open) && /href="\/privatliv" hreflang="da"/.test(ft), `${p}: ophavsret, kilder og privatlivslink på ${w.lang}`);
    ok(!/href="\/(automation|om-elpriser|download|tariffer|prognose|blog|api|shelly-tariff|norden)"/.test(hd + ft) && !/href="\/(dk[12]|elpris)\/[a-z]/.test(hd + ft), `${p}: header og fod linker ingen danske undersider, kun landesiderne og /privatliv`);
  }
  ok(upstream.length === (PAGES[p].tabs || 1) && upstream.every(x => x.startsWith('/api/nordic?zone=')), `${p}: serveren henter præcis landets zoner`, upstream.join(' '));
  // The edge cache: a second request is served without touching the feed again, under its own versioned key.
  const n = upstream.length;
  const again = await get(p);
  ok(again.page === h && upstream.length === n, `${p}: andet svar kommer fra cachen`);
  ok([...store.keys()].some(k => new RegExp(`cache\\.local/zone-ssr-v\\d+${p}$`).test(k)), `${p}: egen versioneret cache-nøgle`, [...store.keys()].join(' '));
}
// Norway: prices are the fixture's, converted at the response's rate (÷10 × rate): NO1 hour 0 → 80 EUR/MWh + the day's swing.
{
  store.clear();
  const h = (await get('/no/strompris')).page, d0 = nordic('no1').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const expect = Math.round(d0[nowH].eur_mwh * 10 / 10);
  ok(new RegExp(`class="pris-now">${expect}<`).test(h), 'NO1: prisen nu er EUR/MWh × kurs ÷ 10 i øre (kurs 10 fra svaret)', `${expect} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/data-tip="I dag kl\. \d\d · \d+ øre\/kWh"/.test(h) && /data-tip="[a-zæøå]{3} \d+\. [a-z]{3} kl\. \d\d · \d+ øre\/kWh"/.test(h), 'NO1: tooltips på norsk i øre');
}
// Netherlands: EUR, so the rate is 1 and the unit is cent: NL hour h of today is EUR/MWh ÷ 10, in Dutch words.
{
  store.clear();
  const r = await get('/nl/stroomprijs'), h = r.page, d0 = nordic('nl').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const v = d0[nowH].eur_mwh / 10, dec = Math.max(...nordic('nl').days.slice(1, 6).flatMap(d => d.prices.map(p => p.eur_mwh / 10))) >= 10 ? 1 : 2;
  const expect = v.toFixed(dec).replace('.', ',');
  ok(new RegExp(`class="pris-now">${expect}<`).test(h), 'NL: prisen nu er EUR/MWh ÷ 10 i cent, med komma', `${expect} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/<h1 class="vh" id="zH1">Stroomprijs in Nederland: vandaag en prognose voor de komende 5 dagen<\/h1>/.test(h) && h.includes('Spotprijs zonder btw, belastingen en netkosten') && /Goedkoop|Gemiddeld|Duur/.test(h) && /Komende 5 dagen/.test(h) && h.includes('Beursprijs') && h.includes('Prognose'), 'NL: h1, billedtekst, niveauer, periodekort og typer på hollandsk');
  ok(/data-tip="Vandaag om \d\d · [\d,]+ cent\/kWh"/.test(h) && /data-tip="Morgen om \d\d · [\d,]+ cent\/kWh"/.test(h) && /data-tip="[a-z]{2} \d+ [a-z]{3} om \d\d · [\d,]+ cent\/kWh"/.test(h), 'NL: tooltips på hollandsk i cent (Vandaag, Morgen, og senere dage som "wo 29 okt")');
  ok(!/\b(øre|snt|kr\/kWh|døgn|dager|dygn|vrk)\b/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), 'NL: ingen ord eller enheder fra de andre sprog i sidens indhold');
  ok(/<li><a href="\/nl\/stroomprijs" data-zone="nl"><b>Nederland<\/b> \(NL\)<\/a>: gem\. vandaag [\d,]+ cent\/kWh, gem\. morgen/.test(h), 'NL: tekstblokken har Nederland med dagens og morgendagens gennemsnit');
}
// The Danish pages' chrome is the fixture, byte for byte: header, phone tab bar, footer and net dialog.
// The fixture is index.html's chrome as it was before the country pages got their own, plus the one intended change:
// Nederland among the other price areas (footer and net dialog).
{
  const FIX = fs.readFileSync(path.join(ROOT, 'tests/fixtures/chrome-da.html'), 'utf8');
  const part = n => FIX.split(`<!--@@${n}@@-->\n`)[1].split('\n<!--@@')[0].replace(/\n$/, '');
  const BL = { header: ['<header class="site-nav">', '</header>'], tabbar: ['<nav class="tabbar"', '</nav>'], footer: ['<footer class="sf">', '</footer>'], dialog: ['<dialog id="netDialog"', '</dialog>'] };
  const cut = (html, n) => { const a = html.indexOf(BL[n][0]); return a < 0 ? null : html.slice(a, html.indexOf(BL[n][1], a) + BL[n][1].length); };
  for (const n of Object.keys(BL)) ok(cut(INDEX, n) === part(n), `index.html: ${n} er fixturen, tegn for tegn`, 'ret tests/fixtures/chrome-da.html bevidst hvis den danske chrome skal ændres');
  for (const p of ['/', '/tariffer', '/prognose', '/norden', '/automation', '/blog', '/om-elpriser', '/download', '/api']) {
    store.clear();
    const r = await get(p);
    for (const n of Object.keys(BL)) if (n !== 'header' || p !== '/dk1') ok(cut(r.body, n) === part(n), `${p}: dansk ${n} er uændret, tegn for tegn`);
    ok(/<html lang="da">/.test(r.body) && !/ class="xc"/.test(r.body.slice(0, 200)), `${p}: dansk side uden xc-kroge`);
  }
  // The per-net and per-city pages change only the text of the net chip (their own net), nothing else in the header.
  for (const p of ['/dk1', '/dk2/radius', '/elpris/aarhus']) {
    store.clear();
    const r = await get(p), hd = cut(r.body, 'header');
    ok(hd.replace(/(id="netChip(?:Long|Short)">)[^<]*</g, '$1<') === part('header').replace(/(id="netChip(?:Long|Short)">)[^<]*</g, '$1<'), `${p}: headeren er den danske, kun netchippens tekst er sidens egen`);
    ok(cut(r.body, 'footer') === part('footer') && cut(r.body, 'tabbar') === part('tabbar') && cut(r.body, 'dialog') === part('dialog'), `${p}: fod, mobilbar og netdialog er uændrede`);
  }
}
// A missing zone: the page still renders (the others show) but is NOT remembered.
{
  store.clear(); missing = new Set(['no3']);
  const r = await get('/no/strompris');
  ok(r.status === 200 && r.page.includes('<div class="pris"') && !r.page.includes('<b>Trondheim</b>: '), 'Norge uden NO3: siden kommer stadig, uden NO3-priser');
  ok(store.size === 0, 'en ufuldstændig side huskes ikke i cachen');
  missing = new Set(['no1']);
  store.clear();
  const r2 = await get('/no/strompris');
  ok(r2.status === 200 && !r2.page.includes('<div class="pris"') && /role="tablist"/.test(r2.page) && store.size === 0, 'uden NO1 (førstevalget) ingen skærm, men fanerne og teksten er der, og intet huskes');
  missing = new Set();
}

// ── /norden ─────────────────────────────────────────────────────────────────
{
  store.clear(); upstream = [];
  const r = await get('/norden'), h = r.page;
  const title = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (r.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200 && /^Elpriser i Norden/.test(title) && title.length <= 62 && desc.length >= 80 && desc.length <= 155, '/norden: 200, titel og beskrivelse', `${title.length}/${desc.length}`);
  ok(/<html lang="da"/.test(h) && (h.match(/<h1[ >]/g) || []).length === 1 && /<h1 class="page-title">Elpriser i Norden/.test(h), '/norden: dansk, én h1');
  ok(upstream.length === 13, '/norden: serveren henter alle 13 områder', String(upstream.length));
  const rows = [...h.matchAll(/<tr id="(\w+)"><th scope="row">(?:<a href="([^"]+)">)?([^<]+)(?:<\/a>)?<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
  ok(rows.length === 13, '/norden: tabellen har 13 rækker (11 udenlandske + DK1 og DK2 til sammenligning)', String(rows.length));
  ok(rows.map(m => m[1]).join(',') === 'no1,no2,no3,no4,no5,se1,se2,se3,se4,fi,nl,dk1,dk2', '/norden: rækkefølgen er NO, SE, FI, NL, DK');
  const href = Object.fromEntries(rows.map(m => [m[1], m[2]]));
  ok(href.no2 === '/no/strompris#no2' && href.se4 === '/sv/elpris#se4' && href.fi === '/fi/sahkon-hinta' && href.nl === '/nl/stroomprijs' && href.dk1 === '/dk1' && href.dk2 === '/dk2', '/norden: rækkerne linker til landesidens anker', JSON.stringify(href));
  ok(href.nl === '/nl/stroomprijs', '/norden: NL-rækken linker til /nl/stroomprijs ligesom de andre lande', String(href.nl));
  // DKK/kWh = EUR/MWh ÷ 1000 × 7,5 (kursen i DK1-svaret): NO2 hour h of today.
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const no2 = rows.find(m => m[1] === 'no2'), eur = nordic('no2').days[1].prices[nowH].eur_mwh;
  ok(no2[4] === (eur / 1000 * RATE.dk1).toFixed(2).replace('.', ','), '/norden: NO2 nu i kr/kWh med DK1-svarets eurokurs', `${no2[4]} vs ${(eur / 1000 * RATE.dk1).toFixed(2)}`);
  ok(rows.every(m => /^\d+,\d\d$/.test(m[4]) && /^\d+,\d\d$/.test(m[5]) && /^\d+,\d\d$/.test(m[6]) && /^\d+,\d\d–\d+,\d\d$/.test(m[7])), '/norden: alle tal er kr med komma og to decimaler, og 5 døgn er et spænd', rows.map(m => m[7]).join(' '));
  ok(/<p class="nt-cap">Spotpris i DKK\/kWh uden moms, afgifter og nettariffer/.test(h) && /Centralbanks dagskurs \(7,50 kr pr\. euro\)/.test(h), '/norden: grundlaget står i teksten, med kursen');
  ok(!TEN.test(h), '/norden: ingen tekst om 10 døgn');
  const n = upstream.length; const again = await get('/norden');
  ok(again.page === h && upstream.length === n && [...store.keys()].some(k => /zone-ssr-v\d+\/norden$/.test(k)), '/norden: cachet som forsiden, med egen nøgle');
  // One area down: the table still draws, the row shows dashes, and nothing is cached.
  store.clear(); missing = new Set(['nl']);
  const part = (await get('/norden')).page;
  ok(/<tr id="nl"><th scope="row"><a href="\/nl\/stroomprijs">NL Nederland<\/a><\/th><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/.test(part) && store.size === 0, '/norden uden NL: en tom række og ingen cache');
  missing = new Set();
}

// ── The old URLs, the sitemap, the language of the rest of the site ───────────────
const OLD = { '/no1': '/no/strompris#no1', '/no2': '/no/strompris#no2', '/no3': '/no/strompris#no3', '/no4': '/no/strompris#no4', '/no5': '/no/strompris#no5',
  '/se1': '/sv/elpris#se1', '/se2': '/sv/elpris#se2', '/se3': '/sv/elpris#se3', '/se4': '/sv/elpris#se4', '/fi': '/fi/sahkon-hinta', '/nl': '/nl/stroomprijs',
  // the first spelling of the country pages (live for a day) goes straight to the final URL too
  '/norge': '/no/strompris', '/sverige': '/sv/elpris', '/finland': '/fi/sahkon-hinta' };
for (const [from, to] of Object.entries(OLD)) {
  const r = await get(from + '?utm_source=x');
  ok(r.status === 301 && r.headers.get('location') === 'https://elpriser.org' + to.replace(/(#.*)?$/, m => '?utm_source=x' + m), `${from} → 301 ${to}`, `${r.status} ${r.headers.get('location')}`);
}
{
  const sm = (await get('/sitemap.xml')).body;
  const locs = [...sm.matchAll(/<loc>https:\/\/elpriser\.org([^<]*)<\/loc>/g)].map(m => m[1]);
  ok(['/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/norden'].every(p => locs.includes(p)), 'sitemap: de fem sider');
  ok(Object.keys(OLD).every(p => !locs.includes(p)), 'sitemap: ingen af de 11 gamle zone-adresser eller de tre første sidenavne');
  const prio = p => +sm.match(new RegExp(`<loc>https://elpriser\\.org${p}</loc>[\\s\\S]*?<priority>([\\d.]+)`))[1];
  ok(['/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/norden'].every(p => prio(p) < prio('/dk1') && prio(p) < prio('/dk1/n1') + 0.01), 'sitemap: de fem ligger under de danske sider i prioritet');
  const llms = (await get('/llms.txt')).body;
  ok(['/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs'].every(p => llms.includes(`https://elpriser.org${p})`)) && Object.keys(OLD).every(p => !llms.includes(`elpriser.org${p})`)) && !/10 døgn[^.]*(Norge|Sverige|Finland|prisområder)/.test(llms.slice(llms.indexOf('[Elpriser i Norden]'), llms.indexOf('[Automation]'))),
    'llms.txt: de fem sider, ingen gamle adresser og ingen 10 døgn om dem');
  ok((await get('/no6')).status === 404, 'et ukendt zone-nummer er stadig 404');
  ok((await get('/no')).status === 404 && (await get('/sv')).status === 404 && (await get('/no/strompris/')).status === 301 && (await get('/no/ukendt')).status === 404, 'sprogmapperne alene er 404, en skråstreg efter siden er 301, en ukendt side under mappen er 404');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
