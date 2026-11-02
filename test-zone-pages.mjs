#!/usr/bin/env node
/**
 * The foreign-area pages: the four Nordic ones (/no/strompris, /sv/elpris, /fi/sahkon-hinta, /nl/stroomprijs), the nine of actual EU day-ahead
 * prices (de fr pl it-n at ch be[nl] be[fr] ie) and /norden.
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
import vm from 'node:vm';
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
const NOW_H = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const RATE = { dk1: 7.5, dk2: 7.5, no: 10, se: 11, eur: 1, pl: 4.4 };
const rateOf = z => /^dk/.test(z) ? RATE.dk1 : z.startsWith('no') ? RATE.no : z.startsWith('se') ? RATE.se : z === 'pl' ? RATE.pl : 1;
// A zone without a base price (a page added to PRIS_COUNTRIES, docs/add-a-country.md) is priced at 70 EUR/MWh.
const BASE = { no1: 80, no2: 120, no3: 60, no4: 30, no5: 100, se1: 25, se2: 35, se3: 70, se4: 110, fi: 45, nl: 95, dk1: 90, dk2: 100,
  de: 95, fr: 62, pl: 118, 'it-n': 118, at: 105, ch: 110, be: 88, ie: 140, cz: 99 };
BASE.sk = 88;
const NORDIC = ['no1', 'no2', 'no3', 'no4', 'no5', 'se1', 'se2', 'se3', 'se4', 'fi', 'nl', 'dk1', 'dk2'];
let noTomorrow = false;   // the EU job has not published tomorrow yet
// Ireland's days are Dublin's: one hour behind Copenhagen (the EU changes the clocks at one instant), so its "today" is yesterday for the first Danish hour of a day.
const hourBack = new Date(Date.now() - 3600000);
const dublinToday = new Intl.DateTimeFormat('en-CA', cph).format(hourBack), DUB_H = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(hourBack);
let nullHours = {};   // zone -> [[day index, hour] …]: an hour the source did not price (Ireland and Portugal have 23 hours on one day of the market's calendar)
/** Ten days from YESTERDAY, like the live feed; EUR/MWh with a daily swing so there is a cheapest hour. */
const nordic = zone => !NORDIC.includes(zone) ? ({
  // The EU jobs' value: yesterday, today (and tomorrow once published), all `actual`, no model — in the zone's own local days.
  zone, generated: today, trainedThrough: null, unit: 'EUR/MWh',
  zoneInfo: { name: zone.toUpperCase(), currency: zone === 'pl' ? 'PLN' : 'EUR', rate: rateOf(zone), rateSource: 'test' },
  days: Array.from({ length: noTomorrow ? 2 : 3 }, (_, i) => ({
    date: addDays(zone === 'ie' ? dublinToday : today, i - 1), type: 'actual',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: ((nullHours[zone] || []).some(([d, hh]) => d === i && hh === h)) ? null : +((BASE[zone] ?? 70) + 25 * Math.sin(h / 24 * 6.2832) + i * 2).toFixed(2) })),
  })),
}) : ({
  zone, generated: today, unit: 'EUR/MWh',
  zoneInfo: { name: zone.toUpperCase(), currency: 'X', rate: rateOf(zone), rateSource: 'test' },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i - 1), type: i < 3 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +((BASE[zone] ?? 70) + 25 * Math.sin(h / 24 * 6.2832) + i * 2).toFixed(2) })),
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
const PB = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const a = src.indexOf('// ═══ Pris-skærmen (Design A: ét svar) ═══'), b = src.indexOf('// ═══ /Pris-skærmen ═══');
  const ctx = vm.createContext({ console, Date, Math });
  vm.runInContext(src.slice(a, b), ctx);
  return ctx;
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
  ok((five.match(/<span class="pc[ "]/g) || []).length === 120 - (NOW_H > 0 ? NOW_H - Math.min(6, NOW_H) : 0), `${p}: 5 døgn er fem døgn fra seks timer før nu`, String((five.match(/<span class="pc[ "]/g) || []).length));
  // One <tbody> per period over the hours its chart shows: 2 døgn reaches into day three (from hour 1 on), 5 døgn is the five days there are.
  ok((h.match(/<tr><th scope="row">/g) || []).length === (NOW_H > 0 ? 3 : 2) + 5 && !/class="r10"/.test(h), `${p}: dagslisten har tre (to) rækker for 2 døgn og fem for 5 døgn, ingen skjult dag seks-ti`);
  ok(!TEN.test(h), `${p}: ingen tekst om 10 døgn`, (h.match(TEN) || [])[0]);
  // No tab row: the zone is picked in the place dialog (data-zone links there), the page itself carries no tablist.
  ok(!/id="zt-|id="zTabs"|class="zt"|id="zPanel" role="tabpanel"/.test(h.replace(/<script[\s\S]*?<\/script>/g, '')) && (h.match(/<dialog id="netDialog"[\s\S]*?<\/dialog>/)[0].match(/data-zone="/g) || []).length === w.tabs, `${p}: ingen zone-faner på siden, og ${w.tabs} zonelinks i stedsdialogen`);
  // The crawlable text block: every zone, its city, and prices.
  const list = h.slice(h.indexOf('<section class="zl"'), h.indexOf('</section>', h.indexOf('<section class="zl"')));
  ok(w.zones.every(c => list.includes(`<b>${c}</b>`)), `${p}: tekstblokken nævner alle byer`, list.slice(0, 200));
  ok((list.match(/<li>/g) || []).length === w.zones.length && (list.match(new RegExp(`${w.unit}/kWh`, 'g')) || []).length >= w.zones.length, `${p}: ét punkt pr. zone med pris`);
  ok(!/NaN|undefined|Infinity/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), `${p}: ingen NaN/undefined`);
  ok(new RegExp(`<meta property="og:locale" content="${{ nb: 'nb_NO', sv: 'sv_SE', fi: 'fi_FI', nl: 'nl_NL' }[w.lang]}">`).test(raw), `${p}: og:locale på sidens sprog`);
  // The chrome: the globe in the page's language, a slim footer, and none of the Danish site's.
  {
    const hd = h.slice(h.indexOf('<header'), h.indexOf('</header>')), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>')), X = chromeI18n[w.lang];
    ok(/<html lang="[a-z]+" class="xc">/.test(h) && /<a href="\/" class="site-logo" aria-label="[^"]+">[\s\S]*<\/svg><\/span>Elpriser<\/a>/.test(hd), `${p}: logoet viser ordmærket Elpriser og linker til /`);
    ok(!/class="site-links"|<nav|countryBtn/.test(hd) && /id="netChip"/.test(hd) && !/Vestdanmark|DK1|Netselskab|netselskab/.test(hd), `${p}: headeren har stedschippen, ingen globus og ingen landerække`);
    ok(hd.includes(`aria-label="${X.home}"`) && hd.includes(`aria-label="${X.place}"`), `${p}: logoets og vælgerens navne på ${w.lang}`);
    ok(!/app-btn|Hent appen|Smart hjem|>Om<|Hovedmenu|href="\/automation"|href="\/om-elpriser"|href="\/download"/.test(hd), `${p}: ingen netchip, ingen app-knap, ingen dansk menu i headeren`);
    ok(!/class="tabbar|Mobilnavigation|Netselskab og indstillinger|id="gpsBtn|netDlgDK/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/<dialog id="netDialog"/g) || []).length === 1 && h.includes(`id="netDialogTitle">${X.place}</h2>`), `${p}: ingen dansk mobilbar og ingen danske netselskaber, men stedsdialogen på ${w.lang}`);
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
// Nederland among the other price areas (footer), and the place chip and place dialog (Land, then net) that replaced the net chip, the net dialog and the country picker.
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
  ok(r2.status === 200 && !r2.page.includes('<div class="pris"') && /data-zone="no2"/.test(r2.page) && store.size === 0, 'uden NO1 (førstevalget) ingen skærm, men zonerne i stedsdialogen og teksten er der, og intet huskes');
  missing = new Set();
}

// ── The nine EU pages: actual day-ahead prices only ─────────────────────────────────────────
// Germany, France, Poland, Italy (north), Austria, Switzerland, Belgium (Dutch and French) and Ireland, each in its own language, on the very same Pris
// screen but with ONE period (no pill), no forecast anywhere, the source named (Energy-Charts: Bundesnetzagentur | SMARD.de CC BY 4.0; Ireland: ENTSO-E), and the first zone drawn by the server.
const ACT = {
  '/de/strompreis': { lang: 'de', title: /^Strompreis aktuell und morgen/, zones: ['Deutschland'], unit: 'ct', now: 'Strompreis jetzt', first: 'de', card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', loc: 'de_DE', h1: 'Strompreis in Deutschland: heute und morgen' },
  '/fr/prix-electricite': { lang: 'fr', title: /^Prix de l’électricité aujourd’hui et demain/, zones: ['France'], unit: 'c€', now: 'Prix de l’électricité maintenant', first: 'fr', card: 'Aujourd’hui et demain', one: 'Aujourd’hui', kind: 'Prix day-ahead', loc: 'fr_FR', h1: 'Prix de l’électricité en France\u00a0: aujourd’hui et demain' },
  '/pl/ceny-pradu': { lang: 'pl', title: /^Cena prądu dziś i jutro/, zones: ['Polska'], unit: 'gr', now: 'Cena prądu teraz', first: 'pl', card: 'Dziś i jutro', one: 'Dziś', kind: 'Cena RDN', loc: 'pl_PL', h1: 'Cena prądu w Polsce: dziś i jutro' },
  '/it/prezzo-luce': { lang: 'it', title: /^Prezzo dell’energia elettrica oggi e domani – Italia del Nord/, zones: ['Italia del Nord'], unit: 'c€', now: 'Prezzo della luce adesso', first: 'it-n', card: 'Oggi e domani', one: 'Oggi', kind: 'Prezzo day-ahead', loc: 'it_IT', h1: 'Prezzo dell’energia elettrica in Italia del Nord: oggi e domani' },
  '/at/strompreis': { lang: 'de', title: /^Strompreis aktuell und morgen – Börsenstrompreis Österreich/, zones: ['Österreich'], unit: 'ct', now: 'Strompreis jetzt', first: 'at', card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', loc: 'de_AT', h1: 'Strompreis in Österreich: heute und morgen', src: 'ec', note: 'Österreich bildet eine eigene Gebotszone. Quelle:' },
  '/ch/strompreis': { lang: 'de', title: /^Strompreis aktuell und morgen – Börsenstrompreis Schweiz/, zones: ['Schweiz'], unit: 'ct', now: 'Strompreis jetzt', first: 'ch', card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', loc: 'de_CH', h1: 'Strompreis in der Schweiz: heute und morgen', src: 'ec', note: 'Die Schweiz hat eine eigene Gebotszone; die Preise sind in Euro-Cent angegeben, nicht in Rappen. Quelle:', cap: 'Börsenstrompreis (Day-Ahead) in Euro-Cent, ohne MwSt., Abgaben und Netzentgelte' },
  '/be/stroomprijs': { lang: 'nl', title: /^Stroomprijs vandaag en morgen – beursprijs België/, zones: ['België'], unit: 'cent', now: 'Stroomprijs nu', first: 'be', card: 'Vandaag en morgen', one: 'Vandaag', kind: 'Beursprijs', loc: 'nl_BE', h1: 'Stroomprijs in België: vandaag en morgen', src: 'ec', note: 'Prijzen in euro, uitgedrukt in cent per kWh. Bron:' },
  '/be/prix-electricite': { lang: 'fr', title: /^Prix de l’électricité aujourd’hui et demain en Belgique/, zones: ['Belgique'], unit: 'c€', now: 'Prix de l’électricité maintenant', first: 'be', card: 'Aujourd’hui et demain', one: 'Aujourd’hui', kind: 'Prix day-ahead', loc: 'fr_BE', h1: 'Prix de l’électricité en Belgique\u00a0: aujourd’hui et demain', src: 'ec', note: 'Source\u00a0:' },
  '/ie/electricity-price': { lang: 'en', title: /^Electricity price today and tomorrow – Ireland \(SEM\)/, zones: ['Ireland'], unit: 'c', now: 'Electricity price now', first: 'ie', card: 'Today and tomorrow', one: 'Today', kind: 'Day-ahead price', loc: 'en_IE', h1: 'Electricity price in Ireland: today and tomorrow', src: 'entsoe', note: 'Ireland and Northern Ireland trade as one market, the all-island Single Electricity Market (SEM). Prices are in euro cent. Source:' },
  '/cz/ceny-elektriny': { lang: 'cs', title: /^Cena elektřiny dnes a zítra – burzovní cena v Česku/, zones: ['Česko'], unit: 'ct', now: 'Cena elektřiny právě teď', first: 'cz', card: 'Dnes a zítra', one: 'Dnes', kind: 'Cena na denním trhu', loc: 'cs_CZ', h1: 'Cena elektřiny v Česku: dnes a zítra', src: 'ec', cap: 'Burzovní cena z denního trhu v eurocentech, bez DPH, daní a poplatků za distribuci' },
  '/sk/ceny-elektriny': { lang: 'sk', title: /^Cena elektriny dnes a zajtra – burzová cena na Slovensku/, zones: ['Slovensko'], unit: 'c', now: 'Cena elektriny práve teraz', first: 'sk', card: 'Dnes a zajtra', one: 'Dnes', kind: 'Cena na dennom trhu', loc: 'sk_SK', h1: 'Cena elektriny na Slovensku: dnes a zajtra', src: 'entsoe', cap: 'Burzová cena z denného trhu v eurocentoch, bez DPH, daní a poplatkov za distribúciu' },
};
// What the text block says about the data's change and its source, per language (the words before the credit links).
const PRISNOTE = {
  de: 'Stundenmittel der Viertelstundenpreise, von elpriser.org berechnet (gegenüber den Originaldaten verändert). Deutschland und Luxemburg bilden eine gemeinsame Gebotszone. Quelle:',
  fr: 'Moyennes horaires des prix au quart d’heure, calculées par elpriser.org (données modifiées par rapport à l’original). Source\u00a0:',
  pl: 'Średnie godzinowe z cen kwadransowych, przeliczone z euro według dziennego kursu referencyjnego EBC przez elpriser.org (dane zmienione względem oryginału). Źródło:',
  it: 'Zona di mercato Nord. Medie orarie dei prezzi al quarto d’ora, calcolate da elpriser.org (dati modificati rispetto all’originale). Fonte:',
  nl: 'Uurgemiddelden van de kwartierprijzen, berekend door elpriser.org (gegevens gewijzigd ten opzichte van het origineel). Prijzen in euro, uitgedrukt in cent per kWh. Bron:',
  en: 'Hourly means of the 15-minute prices, calculated by elpriser.org (changed from the original data). Ireland and Northern Ireland trade as one market, the all-island Single Electricity Market (SEM). Prices are in euro cent. Source:' };
const CZNOTE = 'Hodinové průměry čtvrthodinových cen vypočítal elpriser.org (údaje jsou oproti originálu upraveny). Ceny jsou v eurocentech za kWh, nikoli v korunách. Zdroj:';
// Austria, Switzerland and Belgium (French) say it in their language's words with their own country: the note of a page is `PAGENOTE[page]` when it has one.
const PAGENOTE = {
  '/at/strompreis': 'Stundenmittel der Viertelstundenpreise, von elpriser.org berechnet (gegenüber den Originaldaten verändert). Österreich bildet eine eigene Gebotszone. Quelle:',
  '/ch/strompreis': 'Stundenmittel der Viertelstundenpreise, von elpriser.org berechnet (gegenüber den Originaldaten verändert). Die Schweiz hat eine eigene Gebotszone; die Preise sind in Euro-Cent angegeben, nicht in Rappen. Quelle:',
  '/be/prix-electricite': 'Moyennes horaires des prix au quart d’heure, calculées par elpriser.org (données modifiées par rapport à l’original). Source\u00a0:',
  '/cz/ceny-elektriny': CZNOTE };
PAGENOTE['/sk/ceny-elektriny'] = 'Hodinové priemery štvrťhodinových cien vypočítal elpriser.org (údaje sú oproti originálu upravené). Ceny sú v eurocentoch za kWh. Zdroj:';
const PRISCAP = {
  de: 'Börsenstrompreis (Day-Ahead) ohne MwSt., Steuern, Abgaben und Netzentgelte', fr: 'Prix spot day-ahead hors TVA, taxes et frais de réseau',
  pl: 'Cena giełdowa na rynku dnia następnego (RDN) bez VAT, podatków i opłat sieciowych', it: 'Prezzo day-ahead al netto di IVA, imposte e costi di rete',
  nl: 'Spotprijs zonder btw, belastingen en netkosten', en: 'Wholesale day-ahead price excluding VAT, taxes, levies and network charges',
  cs: 'Burzovní cena z denního trhu bez DPH, daní a poplatků za distribuci' };
// "<avg word> <tomorrow word> <number>" — what a text block would say about tomorrow.
const PRISTOM = { de: 'Ø morgen', fr: 'moy\\. demain', pl: 'śr\\. jutro', it: 'media domani', nl: 'gem\\. morgen', en: 'avg\\. tomorrow', cs: 'prům\\. zítra' };
// The language's own word for "average" (a regex source: its dot is escaped), whatever languages are added.
const AVGW = l => PB.PRIS_I18N[l].avg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
PRISTOM.sk = 'priem\\. zajtra';
PRISCAP.sk = 'Burzová cena z denného trhu bez DPH, daní a poplatkov za distribúciu';
const FORECAST = /prognos|vorhersage|vorschau|prévision|previsi|prognoz|przewid|forecast|prediction|predict|modell?o?\b|machine|maskinl|hugging/i;
// The attribution of the pages and the note that the site changed the data: Energy-Charts pages credit Bundesnetzagentur | SMARD.de (CC BY 4.0) and name ENTSO-E nowhere; Ireland credits ENTSO-E.
const CREDIT_ENTSOE = '<a href="https://transparency.entsoe.eu" target="_blank" rel="noopener">ENTSO-E Transparency Platform</a>';
const CREDIT = '<a href="https://www.smard.de" target="_blank" rel="noopener">Bundesnetzagentur | SMARD.de</a> (<a href="https://www.energy-charts.info" target="_blank" rel="noopener">Energy-Charts.info</a>), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
const CHANGED = { de: 'Änderung: Stundenmittel von elpriser.org berechnet', fr: 'Modifié\u00a0: moyennes horaires calculées par elpriser.org', pl: 'Zmiany: średnie godzinowe i przeliczenie na grosze wykonane przez elpriser.org', it: 'Modifiche: medie orarie calcolate da elpriser.org', nl: 'Wijziging: uurgemiddelden berekend door elpriser.org', en: 'Changed: hourly means calculated by elpriser.org', cs: 'Změna: hodinové průměry vypočítal elpriser.org' };
CHANGED.sk = 'Zmena: hodinové priemery vypočítal elpriser.org';
const X9 = ['dk', ...PB.PRIS_PICK.slice(1).map(c => c[0])];   // the countries of the footer list, in order (the old name said nine; it is every country of PRIS_COUNTRIES)
for (const [p, w] of Object.entries(ACT)) {
  store.clear(); upstream = []; noTomorrow = false;
  const r = await get(p), h = r.page, raw = r.body, X = chromeI18n[w.lang];
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const noc = h.replace(/<!--[\s\S]*?-->/g, ''), main = noc.slice(noc.indexOf('<main'), noc.indexOf('</main>'));
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(w.title.test(title) && title.length <= 62, `${p}: titel under 62 tegn`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155, `${p}: beskrivelse 80-155 tegn`, String(desc.length));
  ok(new RegExp(`<html lang="${w.lang}" class="xc"`).test(h) || new RegExp(`<html lang="${w.lang}"`).test(h), `${p}: <html lang="${w.lang}">`);
  ok(new RegExp(`<link rel="canonical" href="https://elpriser.org${p}">`).test(h), `${p}: canonical peger på siden selv`);
  ok(new RegExp(`<meta property="og:locale" content="${w.loc}">`).test(raw), `${p}: og:locale ${w.loc}`);
  const ld = raw.slice(raw.indexOf('"@type":"WebPage"') - 40, raw.indexOf('"@type":"WebPage"') + 600);
  ok(new RegExp(`"inLanguage":"${w.lang}"`).test(ld), `${p}: JSON-LD WebPage med inLanguage ${w.lang}`);
  ok(!/<link rel="alternate"/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/hreflang=/g) || []).length === 1, `${p}: ingen hreflang-klynge`);
  ok((h.match(/<h1[ >]/g) || []).length === 1 && h.includes(`<h1 class="vh" id="zH1">${w.h1}</h1>`), `${p}: én h1 på sidens sprog`);
  // The Pris screen, drawn by the server: one period, so NO period pill (not even a disabled one).
  ok(h.includes('<div class="pris" data-period="2"') && h.includes(`data-key="${w.first}"`) && h.includes(w.now) && h.includes(`>${w.unit}/kWh</span>`), `${p}: Pris-skærmen er tegnet for ${w.first}, med etiket og enhed på sidens sprog`);
  ok(!/data-pris-period|pris-period|role="tab" aria-selected="(true|false)" data-pris/.test(h), `${p}: ingen periodeknap`);
  ok(h.includes(`aria-label="${w.card}"`) && h.includes(`<p class="pris-ct">${w.card}</p>`) && !h.includes('pris-card pp5') && !h.includes('pris-card pp7'), `${p}: ét kort, "${w.card}"`);
  ok(!/class="pris-fc/.test(h) && !/<td class="fc">/.test(h) && (h.match(/<td class="real">/g) || []).length === 2 && (h.match(new RegExp(`<td class="real">${w.kind}</td>`, 'g')) || []).length === 2, `${p}: ingen prognose-skillelinje, to rækker med typen "${w.kind}"`);
  ok((h.match(/<tr><th scope="row">/g) || []).length === 2 && !/class="r10"/.test(h), `${p}: dagslisten har to rækker (i dag og i morgen)`);
  const bars = (h.slice(h.indexOf('pris-card pp2'), h.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
  ok(bars === 48, `${p}: 48 søjler for to døgn`, String(bars));
  ok(!FORECAST.test(main) && !FORECAST.test(desc) && !FORECAST.test(title) && !FORECAST.test(ld), `${p}: ingen prognose-ord i indhold, titel, beskrivelse eller JSON-LD`, (main.match(FORECAST) || [])[0]);
  ok(!new RegExp('\\b(øre|kr\\/kWh|døgn|snt|' + (w.unit === 'cent' ? '' : 'cent\\/kWh|') + 'Prognose|Børspris|Spotpris)\\b').test(main.replace(/Spotpr/g, '')), `${p}: ingen danske ord eller enheder i indholdet`, (main.match(/\b(øre|kr\/kWh|døgn|snt)\b/) || [])[0]);
  ok(!/NaN|undefined|Infinity/.test(main), `${p}: ingen NaN/undefined`);
  ok(!/data-pris-view|pris-seg|Din pris/.test(main), `${p}: ingen Din pris/Spotpris-kontakt`);
  // The honest basis, in the page's language, with the source named and linked.
  const list = h.slice(h.indexOf('<section class="zl"'), h.indexOf('</section>', h.indexOf('<section class="zl"')));
  const credit = w.src === 'entsoe' ? CREDIT_ENTSOE : CREDIT, note = PAGENOTE[p] || PRISNOTE[w.lang];
  ok(h.includes(w.cap || PRISCAP[w.lang]) && list.includes(credit.replace(/ target="_blank"/g, '')) === false && list.includes(credit) && list.includes(note), `${p}: billedtekst og tekstblok siger hvad prisen er, at dataene er ændret, og har kilden med licenslink`, list.slice(-420));
  const visible = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  ok(w.src === 'entsoe' ? /ENTSO-E Transparency Platform/.test(visible) && !/SMARD|CC BY|Energy-Charts/.test(visible) : !/ENTSO/.test(visible), `${p}: ${w.src === 'entsoe' ? 'kun ENTSO-E nævnes som kilde, ikke Bundesnetzagentur/Energy-Charts' : 'ENTSO-E nævnes ikke noget sted på siden'}`);
  ok(w.zones.every(c => list.includes(`<b>${c}</b>`)) && (list.match(/<li>/g) || []).length === w.zones.length, `${p}: tekstblokken nævner zonen`, list.slice(0, 160));
  ok(new RegExp(`${w.unit}/kWh`).test(list) && new RegExp(`${AVGW(w.lang)} \\S+ [\\d.,]+`).test(list), `${p}: tekstblokken har dagens og morgendagens gennemsnit`);
  ok(!/data-zone="/.test(h.match(/<dialog id="netDialog"[\s\S]*?<\/dialog>/)[0]), `${p}: ingen zonevalg i stedsdialogen (én zone)`);
  // The chrome: the nine countries (footer list) in the page's language, a slim footer whose data line names ENTSO-E and not Energi Data Service.
  const hd = h.slice(h.indexOf('<header'), h.indexOf('</header>')), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>'));
  const nav = [...ft.matchAll(/<li><a href="([^"]+)"([^>]*)>([^<]+)<\/a><\/li>/g)];
  ok(!/class="site-links"/.test(hd) && nav.length === X9.length && nav.map(m => m[3]).join() === X9.map(c => PB.prisCn(X, c)).join() && nav.filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]).join() === p, `${p}: headeren har ingen landerække; fodens landeliste har ${X9.length} lande på ${w.lang}, den aktuelle er aria-current`, nav.map(m => m[3]).join());
  ok(ft.includes(`&copy; Elpriser.org &mdash; ${X.src} ${credit} &mdash; ${CHANGED[w.lang]}. ${X.open}`) && !/Energi Data Service|energidataservice/.test(ft + hd) && (w.src === 'entsoe' ? !/SMARD|CC BY/.test(ft + hd) : !/ENTSO/.test(ft + hd)) && ft.includes(X.privacy), `${p}: fodens kilde er ${w.src === 'entsoe' ? 'ENTSO-E Transparency Platform' : 'Bundesnetzagentur | SMARD.de (CC BY 4.0, med licenslink)'} og siger at dataene er ændret — ikke Energi Data Service og ikke den anden kilde`, ft.slice(ft.indexOf('sf-legal')));
  ok(!/class="tabbar|id="gpsBtn|netDlgDK|Hent appen|Smart hjem/.test(h.replace(/<!--[\s\S]*?-->/g, '')), `${p}: ingen dansk chrome`);
  ok(upstream.length === 1 && upstream.every(x => x.startsWith('/api/nordic?zone=')), `${p}: serveren henter præcis landets zone`, upstream.join(' '));
  const n = upstream.length, again = await get(p);
  ok(again.page === h && upstream.length === n && [...store.keys()].some(k => new RegExp(`cache\\.local/zone-ssr-v\\d+${p}$`).test(k)), `${p}: andet svar kommer fra cachen, under egen versioneret nøgle`);
  // Tomorrow not published yet: one day, and the text and the chart title stay true.
  store.clear(); noTomorrow = true;
  const one = (await get(p)).page.replace(/<!--[\s\S]*?-->/g, ''), om = one.slice(one.indexOf('<main'), one.indexOf('</main>'));
  const oneBars = (om.slice(om.indexOf('pris-card pp2'), om.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
  ok(om.includes(`<p class="pris-ct">${w.one}</p>`) && !om.includes(`<p class="pris-ct">${w.card}</p>`) && oneBars === 24 && (om.match(/<tr><th scope="row">/g) || []).length === 1, `${p}: uden i morgen: titlen er "${w.one}", 24 søjler og én række`, `${oneBars}`);
  ok(!/NaN|undefined/.test(om) && !FORECAST.test(om) && new RegExp(AVGW(w.lang).replace(/\\\.$/, '')).test(om) && !new RegExp(`${PRISTOM[w.lang]}`).test(om), `${p}: uden i morgen: ingen i-morgen-tal i tekstblokken, ingen NaN`, (om.match(new RegExp(PRISTOM[w.lang])) || [])[0]);
  noTomorrow = false;
}
// A page added to PRIS_COUNTRIES without a row above (docs/add-a-country.md) is still checked, from its own entry: 200, title, language, h1, locale, canonical,
// no forecast words, the credit of its zone's source, the footer's country list, one fetch — what a row above would pin by hand.
for (const pg of Object.keys(PB.PRIS_COUNTRIES)) {
  const p = '/' + pg, C = PB.PRIS_COUNTRIES[pg];
  if (ACT[p] || !C.act) continue;
  store.clear(); upstream = []; noTomorrow = false;
  const r = await get(p), h = r.page, X = chromeI18n[C.lang], src = PB.ZONES[C.def].src, noc = h.replace(/<!--[\s\S]*?-->/g, ''), main = noc.slice(noc.indexOf('<main'), noc.indexOf('</main>'));
  const L = PB.prisPageL(pg), title = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '', visible = r.body.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  ok(r.status === 200 && title === C.title && h.includes(`<h1 class="vh" id="zH1">${L.h1}</h1>`) && new RegExp(`<html lang="${C.lang}"`).test(h) && r.body.includes(`<meta property="og:locale" content="${C.loc}">`) && h.includes(`<link rel="canonical" href="https://elpriser.org${p}">`), `${p}: (ikke i tabellen) 200, titel, h1, lang, og:locale og canonical fra PRIS_COUNTRIES`);
  ok(h.includes(`data-key="${C.def}"`) && h.includes(L.now) && h.includes(`>${PB.prisSub(pg, C.def)}/kWh</span>`) && !FORECAST.test(main) && !/NaN|undefined|Infinity/.test(main) && upstream.length === C.zones.length, `${p}: (ikke i tabellen) skærmen, enheden, ingen prognose-ord, ingen NaN, én hentning pr. zone`);
  ok(src === 'entsoe' ? /ENTSO-E Transparency Platform/.test(visible) && !/SMARD|CC BY/.test(visible) : visible.includes(CREDIT) && !/ENTSO/.test(visible), `${p}: (ikke i tabellen) kilden er ${src === 'entsoe' ? 'ENTSO-E' : 'Bundesnetzagentur | SMARD.de med CC BY 4.0-linket'}`);
  const ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>')), nav = [...ft.matchAll(/<li><a href="([^"]+)"([^>]*)>([^<]+)<\/a><\/li>/g)];
  ok(nav.length === X9.length && nav.map(m => m[3]).join() === X9.map(c => PB.prisCn(X, c)).join() && nav.filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]).join() === p, `${p}: (ikke i tabellen) fodens landeliste har alle ${X9.length} lande, sidens eget markeret`);
}
// Poland: PLN, grosze, at the response's rate (÷10 × 4,4): the zone's hour h of today is EUR/MWh × 4,4 ÷ 10 gr/kWh.
{
  store.clear();
  const h = (await get('/pl/ceny-pradu')).page, d0 = nordic('pl').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const v = d0[nowH].eur_mwh * 4.4 / 10, all = nordic('pl').days.slice(1).flatMap(d => d.prices.map(q => q.eur_mwh * 4.4 / 10));
  const dec = Math.max(...all) >= 100 ? 0 : Math.max(...all) >= 10 ? 1 : 2;
  ok(new RegExp(`class="pris-now">${v.toFixed(dec).replace('.', ',')}<`).test(h), 'PL: prisen nu er EUR/MWh × PLN-kursen ÷ 10 i grosze', `${v.toFixed(dec)} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/data-tip="Dziś godz\. \d\d · [\d,]+ gr\/kWh"/.test(h) && /data-tip="Jutro godz\. \d\d · [\d,]+ gr\/kWh"/.test(h), 'PL: tooltips på polsk i grosze');
}
// Germany: ct with a comma and "Uhr" after the hour.
{
  store.clear();
  const de = (await get('/de/strompreis')).page;
  ok(/data-tip="Heute um \d\d Uhr · -?\d+,\d ct\/kWh"/.test(de) && /<td>um \d\d–\d\d Uhr<\/td>/.test(de) && /<small>ct · um \d\d Uhr<\/small>/.test(de), 'DE: tooltips, dagsliste og felter på tysk, med "Uhr" efter timen');
}
// Italy is ONE zone, IT-North: no tabs, and the page says "Nord" — it never claims to be all of Italy.
{
  store.clear(); upstream = [];
  const r = await get('/it/prezzo-luce'), h = r.page;
  ok((h.match(/role="tab"/g) || []).length === 0 && upstream.length === 1 && upstream[0] === '/api/nordic?zone=it-n' && h.includes('data-key="it-n"'), 'IT: én zone (it-n), ingen faner, serveren henter kun den');
  const t = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1], d = (r.body.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  ok(/Nord/.test(t) && /Nord Italia/.test(d) && /Nord/.test(h.slice(h.indexOf('<h1'), h.indexOf('</h1>'))), 'IT: titel, beskrivelse og h1 siger Nord');
  ok(!/\b(it-cn|it-cs|it-sic|it-sar|it-cal)\b/.test(h.replace(/<!--[\s\S]*?-->/g, '')), 'IT: ingen rester af de andre italienske zoner');
}
// Ireland is served again (ENTSO-E, the Single Electricity Market of Ireland and Northern Ireland) on its own clock: Dublin is an hour behind Copenhagen.
{
  store.clear(); upstream = [];
  const r = await get('/ie/electricity-price'), h = r.page;
  ok(r.status === 200 && upstream.length === 1 && upstream[0] === '/api/nordic?zone=ie', '/ie/electricity-price: 200, og serveren henter kun zonen ie');
  // The screen is drawn for IRELAND's today and hour, not Copenhagen's: data-hour is (Danish hour - 1) mod 24, data-date Dublin's date.
  ok(h.includes(`data-hour="${DUB_H}"`) && h.includes(`data-date="${dublinToday}"`), `IE: skærmen er tegnet for Dublins time (${DUB_H}) og dato (${dublinToday}), ikke Københavns`, (h.match(/data-hour="\d+" data-date="[\d-]+"/) || [])[0]);
  ok(new RegExp(`class="pris-label">Electricity price now · <span class="pris-wd">[A-Za-z]+ </span>at ${String(DUB_H).padStart(2, '0')}:00<`).test(h), 'IE: "at 12:00" — timen skrives som 13:00 med :00 efter hvert klokkeslæt, ugedagen er engelsk');
  const expect = nordic('ie').days[1].prices[DUB_H].eur_mwh / 10;
  const dec = Math.max(...nordic('ie').days.slice(1).flatMap(d => d.prices.map(p => p.eur_mwh / 10))) >= 10 ? 1 : 2;
  ok(new RegExp(`class="pris-now">${expect.toFixed(dec)}<`).test(h) && /data-tip="Today at \d\d:00 · \d+\.\d c\/kWh"/.test(h) && /<td>at \d\d:00–\d\d:00<\/td>/.test(h) && /<small>c · at \d\d:00<\/small>/.test(h), 'IE: prisen nu er EUR/MWh ÷ 10 i cent med DECIMALPUNKTUM (8.8, ikke 8,8), og tooltips, dagsliste og felter skriver "at 13:00" og "c/kWh"', `${expect.toFixed(dec)} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(!/\d,\d/.test(mainOf(h).replace(/data-tip="[^"]*"/g, '')) && !/\d,\d/.test(mainOf(h)), 'IE: ingen decimalkomma i indholdet');
  ok(/Ireland and Northern Ireland trade as one market/.test(h) && />ENTSO-E Transparency Platform<\/a>/.test(h) && /<a href="\/ie\/electricity-price" aria-current="page">Ireland<\/a>/.test(h), 'IE: siden siger at Irland og Nordirland er ét marked og krediterer ENTSO-E; Irland er markeret i landelisten');
  // The feed is Dublin's: when it is the first Danish hour of a day the date in the feed is YESTERDAY's Danish date, and the page still shows today (Dublin's) and tomorrow.
  ok((h.match(/<tr><th scope="row">/g) || []).length === 2, 'IE: to dagsrækker (i dag og i morgen) uanset forskellen til København');
  // An hour the source did not price (23-hour day): the bar is empty, nothing says NaN, the day still has its cheapest and dearest hour.
  nullHours = { ie: [[2, 23], [1, 3]] }; store.clear();
  const nh = (await get('/ie/electricity-price')).page, nm = nh.slice(nh.indexOf('<main'), nh.indexOf('</main>'));
  const nb = (nm.slice(nm.indexOf('pris-card pp2'), nm.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
  ok(nb === 48 && (nm.match(/<span class="pc"><\/span>/g) || []).length >= 1 && !/NaN|undefined|Infinity|null/.test(nm) && /class="pris-now">[\d.]+</.test(nm), 'IE: en time uden pris giver en tom søjle, 48 i alt, ingen NaN/null og stadig en pris nu');
  // The CURRENT hour has no price: the big number is a dash, there is no verdict and no sentence — and still no NaN.
  nullHours = { ie: [[1, DUB_H]] }; store.clear();
  const nn = (await get('/ie/electricity-price')).page, nnm = nn.slice(nn.indexOf('<main'), nn.indexOf('</main>'));
  ok(/class="pris-now">—</.test(nnm) && !/pris-pill/.test(nnm) && !/NaN|undefined|Infinity|null/.test(nnm) && /class="pris-sent"><\/p>/.test(nnm), 'IE: uden pris i den nuværende time er tallet "—", uden dom og uden sætning, og ingen NaN');
  nullHours = {}; store.clear();
}
// Belgium has two pages, one per language, of ONE zone (be): each says its own unit and name, and each country list links to the page in ITS language.
{
  store.clear(); upstream = [];
  const nl = await get('/be/stroomprijs'), fr = await get('/be/prix-electricite');
  ok(nl.status === 200 && fr.status === 200 && nl.page.includes('data-key="be"') && fr.page.includes('data-key="be"'), 'BE: begge sider tegner zonen be');
  ok(nl.page.includes('>cent/kWh</span>') && fr.page.includes('>c€/kWh</span>') && !/c€/.test(nl.page.slice(nl.page.indexOf('<main'), nl.page.indexOf('</main>'))) && !/>cent\/kWh<\/span>/.test(fr.page), 'BE: enheden er cent på hollandsk og c€ på fransk');
  ok(/<b>België<\/b> \(BE\)/.test(nl.page) && /<b>Belgique<\/b> \(BE\)/.test(fr.page) && nl.page.includes('Stroomprijs in België') && fr.page.includes('Prix de l’électricité en Belgique'), 'BE: hver side kalder zonen ved sit eget navn');
  ok(/<a href="\/be\/stroomprijs" aria-current="page">België<\/a>/.test(nl.page) && /<a href="\/be\/prix-electricite" aria-current="page">Belgique<\/a>/.test(fr.page) && !/href="\/be\/prix-electricite"/.test(nl.page.slice(nl.page.indexOf('<footer'))) && !/href="\/be\/stroomprijs"/.test(fr.page.slice(fr.page.indexOf('<footer'))), 'BE: landelisten har ét Belgien-link, til sidens eget sprog, markeret aria-current');
  ok(/<a href="\/be\/stroomprijs"[^>]*>België · Belgique<\/a>/.test(get_dialog(await get('/de/strompreis'))) , 'BE: en anden sides stedsvælger viser Belgien som "België · Belgique" og linker til den hollandske side');
  ok(!/\b(prognose|Prognose)\b/.test(mainOf(nl.page)), 'BE (nl): ingen prognose på den hollandske act-side, selv om nl-tabellen har ordet til NL-siden');
  // Austria and Switzerland read the German table but say their own country everywhere — never Deutschland / Luxemburg.
  for (const [p, own, other] of [['/at/strompreis', 'Österreich', /Deutschland|Luxemburg|Schweiz/], ['/ch/strompreis', 'Schweiz', /Deutschland|Luxemburg|Österreich/]]) {
    const a = await get(p), m = a.page.slice(a.page.indexOf('<main'), a.page.indexOf('</main>')), hd = a.page.slice(a.page.indexOf('<header'), a.page.indexOf('</header>'));
    ok(m.includes(own) && !other.test(m) && !other.test(a.body.match(/<title>[^<]*<\/title>/)[0] + a.body.match(/<meta name="description" content="[^"]*"/)[0]) && hd.includes(own), `${p}: siger ${own} i h1, tekstblok, titel, beskrivelse og stedschip og aldrig det tyske lands navn`);
  }
  ok(/Euro-Cent, ohne MwSt\./.test((await get('/ch/strompreis')).page) && /nicht in Rappen/.test((await get('/ch/strompreis')).page), 'CH: siger at priserne er i euro-cent, ikke Rappen');
}
function mainOf(html) { const n = html.replace(/<!--[\s\S]*?-->/g, ''); return n.slice(n.indexOf('<main'), n.indexOf('</main>')); }
function get_dialog(r) { return (r.page.match(/<dialog id="netDialog"[\s\S]*?<\/dialog>/) || [''])[0]; }
// The sitemap and llms.txt list every page of PRIS_COUNTRIES, at foreign-page priority; the Europe bullet says who the source is, per source.
{
  const sm = (await get('/sitemap.xml')).body, llms = (await get('/llms.txt')).body, full = (await get('/llms-full.txt')).body;
  const NEW = ['/at/strompreis', '/ch/strompreis', '/be/stroomprijs', '/be/prix-electricite', '/ie/electricity-price', '/cz/ceny-elektriny'];
  NEW.push('/sk/ceny-elektriny');
  const prio = p => +sm.match(new RegExp(`<loc>https://elpriser\\.org${p}</loc>[\\s\\S]*?<priority>([\\d.]+)`))[1];
  ok(NEW.every(p => sm.includes(`<loc>https://elpriser.org${p}</loc>`) && prio(p) === 0.5 && llms.includes(`https://elpriser.org${p})`) && full.includes(`https://elpriser.org${p})`)), 'sitemap og llms.txt: de nye sider er med, i udenlandsk prioritet');
  const bullet = llms.slice(llms.indexOf('- [Elpriser i Europa]'), llms.indexOf('- [Automation]'));
  const nAct = new Set(Object.values(PB.PRIS_COUNTRIES).filter(c => c.act).map(c => c.cc)).size;
  ok(bullet.includes(`i ${nAct} europæiske lande`) && /Kun faktiske børspriser — ingen prognose/.test(bullet) && /Kilde: Bundesnetzagentur \| SMARD\.de via Energy-Charts\.info, licens CC BY 4\.0; Irland[^;:]*: ENTSO-E Transparency Platform; vi har ændret dataene \(timegennemsnit/.test(bullet), 'llms.txt: Europa-punktet siger otte lande, kun faktiske priser, de to kilder (Irland: ENTSO-E) og at dataene er ændret', bullet.slice(0, 700));
  ok(/\[Belgien\]\(https:\/\/elpriser\.org\/be\/stroomprijs\) \(hollandsk, \[fransk\]\(https:\/\/elpriser\.org\/be\/prix-electricite\)\)/.test(bullet) && /\[Irland\]\(https:\/\/elpriser\.org\/ie\/electricity-price\) \(prisområdet SEM: Irland og Nordirland\)/.test(bullet) && /\[Schweiz\]\([^)]*\) \(priserne er i euro, ikke franc\)/.test(bullet) && /\[Tjekkiet\]\(https:\/\/elpriser\.org\/cz\/ceny-elektriny\)/.test(bullet) && /\[Slovakiet\]\(https:\/\/elpriser\.org\/sk\/ceny-elektriny\)/.test(bullet) && !/\{\{/.test(llms + full), 'llms.txt: Belgien med begge sprog, Irland som SEM, Schweiz i euro; ingen ubrugt skabelon');
  ok(/elpriser\.org\/(de\/strompreis|fr\/prix-electricite|pl\/ceny-pradu|it\/prezzo-luce)\)/.test(bullet) && /Tyskland\]\([^)]*\) \(DE-LU, fælles prisområde med Luxembourg\)/.test(bullet) && /Italien\]\([^)]*\) \(kun prisområdet Nord\)/.test(bullet), 'llms.txt: de fire første lande har stadig deres noter');
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

// ── Location data: spatialCoverage on the WebPage of every foreign page ─────────────────────────────────────────
// A Place (never a Country: Google flagged that on /api), the country's Wikidata entity, the page's own zone labels,
// no coordinates and no boundary. DE-LU is Germany and Luxembourg; IT-Nord is the north of Italy only.
{
  const QID = { no: 'Q20', sv: 'Q34', fi: 'Q33', nl: 'Q55', de: 'Q183', fr: 'Q142', pl: 'Q36', it: 'Q38', dk: 'Q35', lu: 'Q32', at: 'Q40', ch: 'Q39', be: 'Q31', ie: 'Q27', ni: 'Q26', cz: 'Q213' };
  QID.sk = 'Q214';   // checked against Wikidata's English labels 2026-11-02
  const ldOf = body => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).find(x => x['@type'] === 'WebPage');
  const wd = c => `https://www.wikidata.org/wiki/${QID[c]}`;
  const walk = (n, f) => { f(n); for (const c of [].concat(n.containsPlace || [], n.containedInPlace || [])) walk(c, f); };
  const WANT = {
    '/no/strompris': { name: 'Norge', q: 'no', zones: ['Prisområde NO1 Oslo', 'Prisområde NO2 Kristiansand', 'Prisområde NO3 Trondheim', 'Prisområde NO4 Tromsø', 'Prisområde NO5 Bergen'] },
    '/sv/elpris': { name: 'Sverige', q: 'sv', zones: ['Elområde SE1 Luleå', 'Elområde SE2 Sundsvall', 'Elområde SE3 Stockholm', 'Elområde SE4 Malmö'] },
    '/fi/sahkon-hinta': { name: 'Suomi', q: 'fi', zones: [] },
    '/nl/stroomprijs': { name: 'Nederland', q: 'nl', zones: [] },
    '/fr/prix-electricite': { name: 'France', q: 'fr', zones: [] },
    '/pl/ceny-pradu': { name: 'Polska', q: 'pl', zones: [] },
    '/at/strompreis': { name: 'Österreich', q: 'at', zones: [] },
    '/ch/strompreis': { name: 'Schweiz', q: 'ch', zones: [] },
    '/be/stroomprijs': { name: 'België', q: 'be', zones: [] },
    '/be/prix-electricite': { name: 'Belgique', q: 'be', zones: [] },
    '/cz/ceny-elektriny': { name: 'Česko', q: 'cz', zones: [] },
    '/sk/ceny-elektriny': { name: 'Slovensko', q: 'sk', zones: [] },
  };
  for (const [p, w] of Object.entries(WANT)) {
    store.clear();
    const r = await get(p), sc = (ldOf(r.body) || {}).spatialCoverage;
    ok(sc && sc['@type'] === 'Place' && sc.name === w.name && sc.sameAs === wd(w.q), `${p}: spatialCoverage er stedet ${w.name} med sit Wikidata-id`, JSON.stringify(sc));
    ok(JSON.stringify((sc && sc.containsPlace || []).map(z => z.name)) === JSON.stringify(w.zones), `${p}: containsPlace er sidens egne prisområder`, JSON.stringify(sc && sc.containsPlace));
    ok(!JSON.stringify(sc).includes('"Country"') && !/geo|latitude|longitude|GeoShape/.test(JSON.stringify(sc)), `${p}: ingen Country, ingen koordinater, ingen opfunden grænse`);
  }
  {
    store.clear();
    const sc = ldOf((await get('/de/strompreis')).body).spatialCoverage;
    ok(sc['@type'] === 'Place' && sc.name === 'Preiszone DE-LU' && JSON.stringify(sc.containsPlace.map(x => [x.name, x.sameAs])) === JSON.stringify([['Deutschland', wd('de')], ['Luxemburg', wd('lu')]]), '/de/strompreis: DE-LU er Tyskland og Luxembourg', JSON.stringify(sc));
    store.clear();
    const ie = ldOf((await get('/ie/electricity-price')).body).spatialCoverage;
    ok(ie['@type'] === 'Place' && ie.name === 'Price zone IE-SEM' && JSON.stringify(ie.containsPlace.map(x => [x.name, x.sameAs])) === JSON.stringify([['Ireland', wd('ie')], ['Northern Ireland', wd('ni')]]) && !JSON.stringify(ie).includes('"Country"'), '/ie/electricity-price: SEM er Irland og Nordirland', JSON.stringify(ie));
    store.clear();
    const it = ldOf((await get('/it/prezzo-luce')).body).spatialCoverage;
    ok(it['@type'] === 'Place' && /Nord Italia/.test(it.name) && it.sameAs === undefined && it.containedInPlace && it.containedInPlace.sameAs === wd('it') && it.containedInPlace.name === 'Italia', '/it/prezzo-luce: kun Nord-Italien, i Italien', JSON.stringify(it));
  }
  {
    store.clear();
    const r = await get('/norden'), sc = ldOf(r.body).spatialCoverage, names = [];
    walk(sc, n => names.push(n.name));
    const zoneNames = names.filter(n => /^Prisområde /.test(n));
    ok(sc['@type'] === 'Place' && sc.name === 'Norden og Holland' && sc.containsPlace.length === 5, '/norden: ét sted med fem lande', JSON.stringify(sc).slice(0, 300));
    ok(zoneNames.length === 11 && ['NO1', 'NO5', 'SE1', 'SE4', 'DK1', 'DK2'].every(z => zoneNames.some(n => n.includes(` ${z} `))), `/norden: elleve navngivne prisområder (Finland og Holland er hele landet)`, zoneNames.join(' | '));
    ok(sc.containsPlace.map(c => c.sameAs).join() === ['no', 'sv', 'fi', 'nl', 'dk'].map(wd).join(), '/norden: landene med deres Wikidata-id, i sidens rækkefølge', sc.containsPlace.map(c => c.sameAs).join());
    ok(!JSON.stringify(sc).includes('"Country"') && !/latitude|GeoShape/.test(JSON.stringify(sc)), '/norden: ingen Country og ingen koordinater');
  }
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
