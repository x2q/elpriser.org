#!/usr/bin/env node
/**
 * The Pris screen (prisHTML) — the one price screen of the front page, the price pages, the city pages, the foreign-area
 * pages and /prognose.
 * Run: npm run test:forecast   (offline, no server)
 *
 * prisHTML is drawn by the server so a crawler gets the numbers, and redrawn by the client when the visitor switches
 * Din pris / Spotpris or the area. Neither runtime can import from the other, so the block exists verbatim in both
 * files — and the first thing this file checks is that the two copies are still byte for byte the same. That is the
 * whole reason the duplication is tolerable. /prognose draws the SAME block with a configuration (PRIS_FC: 2, 5 and
 * 7 døgn, seven days, an extra column); everything about that configuration is tested here too.
 *
 * Worth testing rather than eyeballing: the geometry divides by the price span, which is zero on a flat stretch; the
 * feed opens on YESTERDAY, so "I dag" is a date match and not row 0; a hole in the feed ends the list instead of
 * closing up; and the figures must stay text, because they are what the pages answer "elpriser prognose" with.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const ROUTES = fs.readFileSync(new URL('./functions/[[path]].js', import.meta.url), 'utf8');
const INDEX  = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── The Pris screen (prisHTML): Design A ───────────────────────────────────
// It exists verbatim in index.html and functions/[[path]].js.
{
  const PM = '// ═══ Pris-skærmen (Design A: ét svar) ═══', PE = '// ═══ /Pris-skærmen ═══';
  const liftPris = (src, what) => {
    const a = src.indexOf(PM), b = src.indexOf(PE);
    if (a < 0 || b < a) throw new Error(`the Pris block was not found in ${what}`);
    return src.slice(a, b + PE.length);
  };
  const ps = liftPris(ROUTES, 'functions/[[path]].js'), pc = liftPris(INDEX, 'index.html');
  ok(ps === pc, 'server- og klientudgaven af Pris-skærmen er tegn for tegn ens', ps === pc ? '' : `${ps.length} vs ${pc.length} tegn`);
  ok(ps.length > 5000, 'Pris-blokken blev faktisk hentet ud', `${ps.length} tegn`);
  const pctx = { console, Date, Math };
  vm.createContext(pctx);
  vm.runInContext(ps + '\nglobalThis.pris = prisHTML; globalThis.parts = prisParts; globalThis.panel = prisPanel; globalThis.days = prisDays; globalThis.summary = prisSummary; globalThis.ctx = prisCtx;', pctx);
  const pris = pctx.pris;

  // The numbers of the A-Desktop mock (N1, 14 Oct, 21:00).
  const T = [1.32,1.37,1.35,1.31,1.30,1.43,1.78,1.92,2.11,1.97,1.86,1.74,1.52,1.39,1.44,1.63,1.98,3.21,3.68,3.90,3.67,2.67,2.43,2.20];
  const M = [1.73,1.69,1.69,1.69,1.64,1.63,1.95,2.23,2.45,2.18,2.07,1.84,1.53,1.38,1.42,1.63,2.00,3.03,3.33,3.34,2.98,2.15,2.10,2.09];
  const dayOf = (date, vals, type) => ({ date, type, prices: vals.map((p, hour) => ({ hour, price: p })) });
  const D0 = '2026-10-14';
  const nextDate = n => new Date(Date.UTC(2026, 9, 14 + n)).toISOString().slice(0, 10);
  const feed = [dayOf(D0, T, 'actual'), dayOf(nextDate(1), M, 'actual'),
    ...Array.from({ length: 8 }, (_, i) => dayOf(nextDate(i + 2), M.map(v => +(v + 0.01 * i).toFixed(2)), 'forecast'))];
  const o = { view: 'din', period: 2, net: 'N1', where: 'DK1 Vest · N1', key: 'DK1|din|n1' };
  const h = pris(feed, D0, 21, o);
  const text = re => (h.match(re) || [])[1];

  ok(text(/class="pris-now">([^<]+)</) === '2,67', 'den store pris er 2,67 med komma', text(/class="pris-now">([^<]+)</));
  ok(/<p class="pris-label">Elpris lige nu · <span class="pris-wd">onsdag <\/span>kl\. 21<\/p>/.test(h), 'etiketten: Elpris lige nu · (ugedag) kl. 21');
  ok(/class="pris-pill t2"><i><\/i>Dyr lige nu</.test(h), '2,67 er dyrt i forhold til dagens timer');
  ok(/<p class="pris-sent">Billigere i morgen kl\. 13 — <b>1,38 kr<\/b><\/p>/.test(h), 'sætningen: billigere i morgen kl. 13 — 1,38 kr', text(/class="pris-sent">([^<]*<b>[^<]*<\/b>)/));
  ok(/<div class="k">Billigst i morgen<\/div><div class="v">1,38 <small>kr · kl\. 13<\/small>/.test(h), 'felt 1: Billigst i morgen 1,38 kr · kl. 13');
  ok(/<div class="k">Dyrest i morgen<\/div><div class="v">3,34 <small>kr · kl\. 19<\/small>/.test(h), 'felt 2: dyrest af de kommende timer er i morgen kl. 19');
  ok(/Inkl\. nettarif, afgifter og moms/.test(h), 'billedtekst med net');
  ok(/data-pris-view="din" aria-pressed="true" class="on">Din pris/.test(h) && /data-pris-view="spot" aria-pressed="false">Kun spotpris/.test(h) && />Spotpris<\/button>/.test(h),
     'omskifteren har præcis Din pris og Spotpris (Kun spotpris på bred)');
  ok(/<section class="pris-card pp2" aria-label="Næste 2 døgn">/.test(h) && /<p class="pris-ct">Næste 2 døgn<\/p>/.test(h) && /<section class="pris-card pp5" aria-label="Næste 5 døgn">/.test(h) && /<p class="pris-ct">Næste 5 døgn<\/p>/.test(h), 'korttitlerne er Næste 2 døgn og Næste 5 døgn');
  ok(!/3–10|Døgn 3/.test(h), 'skærmen nævner ikke længere 3–10 døgn');
  ok(/role="tablist" aria-label="Periode"/.test(h) && (h.match(/role="tab"/g) || []).length === 2 && />2 døgn</.test(h) && />5 døgn</.test(h), 'periodepillen er en tablist med 2 døgn og 5 døgn');
  ok([...h.matchAll(/<button type="button" role="tab"[^>]*>([^<]*)</g)].map(m => m[1]).join('|') === '2 døgn|5 døgn', 'pillernes tekst er præcis 2 døgn og 5 døgn');
  const two = h.slice(h.indexOf('pris-card pp2'), h.indexOf('pris-card pp5'));
  ok((two.match(/<span class="pc[ "]/g) || []).length === 54, 'to døgn er 6 timer før nu plus 48 frem, 54 søjler');
  ok((two.match(/class="pc past"/g) || []).length === 6, 'de 6 timer før nu er dæmpet');
  ok((two.match(/<b class="pd"/g) || []).length === 1 && two.indexOf('<b class="pd"') > two.indexOf('data-tip="I dag kl. 20') && two.indexOf('<b class="pd"') < two.indexOf('data-tip="I dag kl. 22'), 'prikken sidder på kl. 21, efter de 6 dæmpede'); 
  ok((two.match(/<b class="pd"/g) || []).length === 1, 'én prik over den nuværende time');
  ok(/data-tip="I dag kl\. 21 · 2,67 kr\/kWh"/.test(two) && /data-tip="I morgen kl\. 13 · 1,38 kr\/kWh"/.test(two) && /data-tip="I dag kl\. 15 ·/.test(two) && !/data-tip="I dag kl\. 14 ·/.test(two), 'den præcise pris står i tip-teksten, de 6 timer før nu er med og ikke flere');
  ok((two.match(/data-tip="I dag/g) || []).length === 9 && (two.match(/data-tip="I morgen/g) || []).length === 24 && (two.match(/data-tip="fre 16\. okt/g) || []).length === 21, 'fra kl. 15 til 48 timer efter kl. 21: 9 i dag, 24 i morgen og 21 af dagen efter');
  ok(/<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d<\/span>){4}<\/div>/.test(two), 'y-aksen er 0 1 2 3 4', text(/class="pris-yl">([\s\S]*?)<\/div>/));
  ok(/class="pris-unit">kr\/kWh</.test(two), 'enhedsmærket kr/kWh står over aksen');
  ok(!/>I dag 00<\/span>/.test(two) && />I morgen 00<\/span>/.test(two) && />fre 00<\/span>/.test(two) && />12<\/span>/.test(two), 'x-aksen følger uret fra nu: I morgen 00, 06 12 18, fre 00');
  // The tallest bar (3,90 at 19:00, six hours before the window ends) on an axis to 4,5 is 86,7 % high — never touching the top.
  ok(/height:86\.7%/.test(two), 'aksen når 4,5, så den højeste søjle er 86,7 %');
  // Tiers by the same verdict the apps use: the current bar is the pill's colour.
  const nowCol = two.match(/<span class="pc"[^>]*><i class="pb t(\d)"[^>]*><\/i><b class="pd"/);
  ok(nowCol && nowCol[1] === '2', 'den nuværende søjle har pillens farve', nowCol && nowCol[1]);
  // 5 døgn: from the same hour as 2 døgn (six before now, 15:00 on the 14th), five days on — 126 bars (14.-19. okt in this feed).
  const five = h.slice(h.indexOf('pris-card pp5'), h.indexOf('pris-tiles pp2'));
  ok((five.match(/<span class="pc[ "]/g) || []).length === 126, '5 døgn er 6 timer før nu plus 120 frem, 126 søjler');
  ok((five.match(/class="pc past"/g) || []).length === 6 && (five.match(/<b class="pd"/g) || []).length === 1, 'de 6 timer før nu er dæmpet, og der er én prik');
  ok(/data-tip="I dag kl\. 19 · 3,90 kr\/kWh"/.test(five) && /data-tip="I morgen kl\. 13 · 1,38 kr\/kWh"/.test(five), 'tip for i dag og i morgen i 5 døgn');
  ok(/data-tip="fre 16\. okt kl\. 13 · \d,\d\d kr\/kWh"/.test(five) && /data-tip="søn 18\. okt kl\. 04 · /.test(five), 'tip for senere dage har ugedag og dato');
  ok(!/data-tip="[^"]*(tir) 20\. okt/.test(five) && /data-tip="man 19\. okt kl\. 20 · /.test(five) && !/data-tip="man 19\. okt kl\. 21 · /.test(five) && !/data-tip="ons 14\. okt kl\. 14 · /.test(five), '5 døgn rækker til 120 timer efter kl. 21 (man 19. kl. 20) og starter 6 timer før nu');
  const xd = [...five.matchAll(/<span class="xd" style="left:([\d.]+)%">([^<]+)<\/span>/g)];
  ok(xd.map(m => m[2]).join('|') === 'ons 14|tor 15|fre 16|lør 17|søn 18|man 19', 'x-aksen har ét dagsmærke pr. døgn i vinduet', xd.map(m => m[2]).join('|'));
  ok(xd.map(m => m[1]).join('|') === '3.57|16.67|35.71|54.76|73.81|91.67', 'dagsmærkerne står midt under den del af hvert døgn der er med', xd.map(m => m[1]).join('|'));
  ok((five.match(/class="pris-sep"/g) || []).length === 5, 'en skillelinje ved hver midnat');
  // The feed has two settled days (14. and 15.), so the forecast starts at hour 48, bar 33 of 126 = 26,19 %.
  ok(/<span class="pris-fc mid" style="left:26\.19%"><i><\/i>Prognose<\/span>/.test(five), 'Prognose-skillelinjen står hvor prognosen begynder (26,19 %)');
  const feedLate = feed.map((d, i) => i === 1 ? { ...d, type: 'forecast' } : d);
  ok(/<span class="pris-fc mid" style="left:7\.14%">/.test(pris(feedLate, D0, 21, o)), 'er i morgen prognose, flytter skillelinjen til 7,14 %');
  ok(/<span class="pris-fc mid" style="left:45\.24%">/.test(pris(feed.map((d, i) => i === 2 ? { ...d, type: 'actual' } : d), D0, 21, o)), 'er dagen efter i morgen børspris, flytter den til 45,24 %');
  ok(/<div class="pris-xl days">/.test(five), 'x-aksen er dagsaksen');
  // The y-axis of the 5 døgn card follows the highest visible price (3,90 -> 4,5): 0 1 2 3 4.
  ok(/<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d<\/span>){4}<\/div>/.test(five), 'y-aksen i 5 døgn er 0 1 2 3 4');
  // Tiers are terciles of the 120 visible values: roughly a third of the bars in each.
  const tiers = [0, 1, 2].map(t => (five.match(new RegExp(`class="pb t${t}"`, 'g')) || []).length);
  ok(tiers.every(n => n >= 120 * 0.2 && n <= 120 * 0.5), 'tertilerne fordeler de 120 søjler nogenlunde lige', tiers.join('/'));
  // The tiles of each period: 2 døgn ends tomorrow; 5 døgn reaches later days and names them.
  ok(/<div class="pris-tiles pp2">/.test(h) && /<div class="pris-tiles pp5">/.test(h), 'to sæt felter, ét pr. periode');
  const tiles5 = h.slice(h.indexOf('pris-tiles pp5'));
  ok(/<div class="k">Billigst i morgen<\/div><div class="v">1,38 <small>kr · kl\. 13/.test(tiles5) && /<div class="k">Dyrest søn 18\.<\/div><div class="v">3,36 <small>kr · kl\. 19/.test(tiles5), 'felter i 5 døgn: billigst i morgen, dyrest søn 18. (ugedag og dato for senere dage)');
  // The cheapest of the later days wins in 5 døgn when it undercuts today/tomorrow.
  const cheapLate = feed.map((d, i) => i === 3 ? dayOf(d.date, M.map((v, hh) => hh === 13 ? 0.51 : v), 'forecast') : d);
  const cl = pris(cheapLate, D0, 21, o), cl5 = cl.slice(cl.indexOf('pris-tiles pp5'));
  ok(/<div class="k">Billigst lør 17\.<\/div><div class="v">0,51 <small>kr · kl\. 13<\/small>/.test(cl5), 'Billigst lør 17. 0,51 kr · kl. 13');
  const cl2 = cl.slice(cl.indexOf('pris-tiles pp2'), cl.indexOf('pris-tiles pp5'));
  ok(/<div class="k">Billigst i morgen<\/div>/.test(cl2) && !/lør 17/.test(cl2), 'felterne i 2 døgn ser ikke ud over i morgen');
  const dearLate = feed.map((d, i) => i === 4 ? dayOf(d.date, M.map((v, hh) => hh === 19 ? 5.5 : v), 'forecast') : d);
  const dl = pris(dearLate, D0, 21, o);
  ok(/<div class="k">Dyrest søn 18\.<\/div><div class="v">5,50 <small>kr · kl\. 19<\/small>/.test(dl.slice(dl.indexOf('pris-tiles pp5'))), 'Dyrest søn 18. 5,50 kr · kl. 19');
  // The day list: text, one row per day, settled or forecast. Rows 6-10 stay as hidden text for crawlers.
  const trs = h.match(/<tr class="r\d+"><th scope="row">/g) || [];
  ok(trs.length === 10, 'ti dage i dagslisten', String(trs.length));
  ok((h.match(/<tr class="r2">/g) || []).length === 2 && (h.match(/<tr class="r5">/g) || []).length === 3 && (h.match(/<tr class="r10">/g) || []).length === 5,
     'rækkerne: 2 i begge perioder, 3 kun i 5 døgn, 5 kun som tekst');
  ok(/<tr class="r5"><th scope="row">Fredag<small>16\. okt<\/small>/.test(h), 'tredje række hedder ugedagen og datoen');
  ok(/<tr class="r2"><th scope="row">I dag<small>14\. okt<\/small><\/th><td>1,30–3,90<\/td><td>kl\. 04–05<\/td><td class="real">Børspris/.test(h), 'dagens spænd og billigste time står som tekst');
  ok(/<tr class="r5"><th scope="row">Fredag[^]*?<td class="fc">Prognose/.test(h), 'prognosedage er mærket Prognose');
  // The old value 10 ("3–10 døgn") and every spelling of it resolves to 5 døgn; unknown values to 2.
  ok(pctx.prisPeriod(10) === 5 && pctx.prisPeriod('10') === 5 && pctx.prisPeriod('3–10') === 5 && pctx.prisPeriod('3-10') === 5 && pctx.prisPeriod(5) === 5 && pctx.prisPeriod('5') === 5,
     'prisPeriod: 10, "10", "3–10" og 5 giver 5');
  ok(pctx.prisPeriod(2) === 2 && pctx.prisPeriod('2') === 2 && pctx.prisPeriod(undefined) === 2 && pctx.prisPeriod(null) === 2 && pctx.prisPeriod('') === 2 && pctx.prisPeriod('x') === 2 && pctx.prisPeriod(1) === 2 && pctx.prisPeriod(25) === 2,
     'prisPeriod: 2 og ukendte værdier giver 2');
  ok(/data-period="5"/.test(pris(feed, D0, 21, { ...o, period: 10 })) && /aria-selected="true" data-pris-period="5">5 døgn</.test(pris(feed, D0, 21, { ...o, period: 10 })), 'det gamle periode 10 tegnes som 5 døgn');

  // It is the cheapest hour of the next 24: say so.
  const night = pris(feed, D0, 4, o);
  ok(/Billigste time de næste 24 timer/.test(night) && !/Billigere/.test(night), 'er nu den billigste time, siges det');
  ok(/class="pris-pill t0"/.test(night), 'og pillen er grøn');
  // Dearest today, in the evening: "i aften".
  const eve = pris(feed.slice(0, 1), D0, 15, o);
  ok(/Dyrest i aften<\/div><div class="v">3,90 <small>kr · kl\. 19/.test(eve), 'dyrest i dag efter kl. 17 hedder i aften');
  ok(/Billigere i dag kl\. /.test(eve) === false && /Billigste time de næste 24|Billigere i dag/.test(eve), 'uden i morgen findes sætningen stadig, med i dag');
  // Tomorrow missing: one day, no crash, no "i morgen".
  const one = pris(feed.slice(0, 1), D0, 21, o);
  ok((one.slice(one.indexOf('pris-card pp2'), one.indexOf('pris-card pp5')).match(/data-tip=/g) || []).length === 9 && !/i morgen/.test(one.replace(/Næste 2 døgn/g, '')),
     'uden i morgen tegnes kun i dag: de 6 timer før nu og de tre der er tilbage');
  // Spotpris and no net: the captions.
  ok(/Spotpris inkl\. moms/.test(pris(feed, D0, 21, { ...o, view: 'spot' })), 'billedtekst for spotpris');
  ok(/Inkl\. Energinets tariffer, afgifter og moms/.test(pris(feed, D0, 21, { ...o, net: null })), 'billedtekst uden net');
  ok(/data-period="5"/.test(pris(feed, D0, 21, { ...o, period: 5 })) && /aria-selected="true" data-pris-period="5">5 døgn</.test(pris(feed, D0, 21, { ...o, period: 5 })), 'perioden kan være 5 døgn');
  // No data at all: a screen with a dash, not a crash.
  const none = pris([], D0, 21, {});
  ok(/class="pris-now">—</.test(none) && !/NaN|undefined|Infinity/.test(none) && !/pris-pill/.test(none), 'uden data: tankestreg og ingen pille');
  // Negative prices: bars below zero, a zero-line on the axis, never NaN.
  const neg = pris([dayOf(D0, T.map((v, i) => i === 20 ? -0.8 : v), 'actual'), dayOf(nextDate(1), M, 'actual')], D0, 21, o);
  ok(!/NaN|Infinity/.test(neg) && /<span style="top:[\d.]+%">-1<\/span>/.test(neg), 'negative priser giver en akse under nul');
  ok(!/-0,00/.test(pris([dayOf(D0, T.map(() => -0.004), 'actual')], D0, 5, o)), 'et beløb der runder til nul vises uden minus');
  ok(/aria-label="Elpris lige nu — DK1 Vest · N1"/.test(h) && /role="img" tabindex="0" aria-label="Elpris time for time næste 2 døgn: billigst 1,38 kr\/kWh kl\. 13, dyrest 3,90 kr\/kWh kl\. 19\./.test(h), 'grafen har en tekstlig beskrivelse');
  ok(!/<h[1-6]/.test(h), 'skærmen indeholder ingen overskriftstags — sidens h1 står andetsteds');

  // ── What the price is made of (the folded-out caption) ──────────────────────
  // Hand-calculated: spot 0.85 + system 0.07 + transmission 0.054 + net tariff 0.33 + duty 0.008
  // = 1.312 ex. VAT; × 1.25 = 1.64 kr/kWh, of which VAT 0.328.
  const CH = { sys: 0.07, trans: 0.054, afg: 0.008, vat: 0.25 };
  const GT = Array.from({ length: 24 }, () => 0.33);
  const dayG = (date, price, type, gt) => ({ date, type, ...(gt ? { grid_tariff: gt } : {}),
    prices: Array.from({ length: 24 }, (_, hour) => ({ hour, price })) });
  const first = html => html.slice(html.indexOf('<div class="pris-bdhd">'), html.indexOf('</ul>', html.indexOf('<div class="pris-bdhd">')) + 5);
  const lines = html => [...first(html).matchAll(/<li><i class="bd-dot bd-(\w+)"><\/i><span class="l">([^<]*)<\/span><b>([^<]*)<\/b><\/li>/g)].map(m => [m[2], m[3]]);
  const tot = html => (first(html).match(/<li class="tot"><span class="l">I alt<\/span><b>([^<]*)<\/b>/) || [])[1];
  const sumOf = html => lines(html).reduce((a, [, v]) => a + Math.round(parseFloat(v.replace(',', '.')) * 10), 0);
  const bd = (feedX, hour, oo) => pris(feedX, D0, hour, { ...o, charges: CH, ...oo });

  // Din pris with a net: six rows in order, the last one the total, and they add up exactly.
  const netFeed = [dayG(D0, 1.64, 'actual', GT), dayG(nextDate(1), 1.64, 'forecast', GT)];
  const nb = bd(netFeed, 21);
  const rowsNet = lines(nb);
  ok(JSON.stringify(rowsNet) === JSON.stringify([
    ['Spotpris (Nord Pool)', '85,0 øre'], ['Systemtarif (Energinet)', '7,0 øre'], ['Transmissionstarif (Energinet)', '5,4 øre'],
    ['Nettarif (N1, kl. 21)', '33,0 øre'], ['Elafgift', '0,8 øre'], ['Moms (25 %)', '32,8 øre']]),
    'Din pris med net: spot, system, transmission, nettarif, elafgift og moms i den rækkefølge', JSON.stringify(rowsNet));
  ok(tot(nb) === '1,64 kr/kWh', 'summen er det samme tal som i det store felt og i tooltippen', tot(nb));
  ok(sumOf(nb) === 1640, 'rækkerne summer til 164,0 øre på øret', String(sumOf(nb)));
  ok(/<p class="pris-bdh">Sådan er prisen kl\. 21 sammensat<\/p>/.test(nb) && !/data-pris-back/.test(nb), 'overskriften for nu har ingen dag og ingen tilbage-knap');
  ok(/<div class="pris-bdbar" aria-hidden="true">(<i class="bd-\w+" style="width:[\d.]+%"><\/i>){6}<\/div>/.test(nb), 'den tynde stak har ét segment pr. række');

  // Din pris without a net: no Nettarif row; the same totals logic.
  const area = [dayG(D0, 1.23, 'actual'), dayG(nextDate(1), 1.23, 'forecast')];
  const ab = bd(area, 21, { net: null });
  const rowsArea = lines(ab);
  ok(JSON.stringify(rowsArea.map(r => r[0])) === JSON.stringify(['Spotpris (Nord Pool)', 'Systemtarif (Energinet)', 'Transmissionstarif (Energinet)', 'Elafgift', 'Moms (25 %)']),
     'uden net er der ingen Nettarif-række', JSON.stringify(rowsArea));
  ok(JSON.stringify(rowsArea.map(r => r[1])) === JSON.stringify(['85,2 øre', '7,0 øre', '5,4 øre', '0,8 øre', '24,6 øre']) && tot(ab) === '1,23 kr/kWh' && sumOf(ab) === 1230,
     'uden net: 1,23 = 85,2 + 7,0 + 5,4 + 0,8 + 24,6', JSON.stringify(rowsArea));

  // Spotpris: spot and VAT only.
  const sp = bd([dayG(D0, 1.06, 'actual'), dayG(nextDate(1), 1.06, 'actual')], 21, { view: 'spot', net: null });
  ok(JSON.stringify(lines(sp)) === JSON.stringify([['Spotpris (Nord Pool)', '84,8 øre'], ['Moms (25 %)', '21,2 øre']]) && tot(sp) === '1,06 kr/kWh',
     'Spotpris: spot og moms, og I alt', JSON.stringify(lines(sp)));
  ok(/<summary class="pris-cap">Spotpris inkl\. moms<i class="pris-chev"/.test(sp), 'billedteksten er stadig den samme tekst, nu som summary');

  // A model-forecast day is labelled as such, and a picked bar names its day like the tooltip.
  const allN = pctx.days(netFeed.concat(Array.from({ length: 3 }, (_, i) => dayG(nextDate(i + 2), 1.64, 'forecast', GT))), D0);
  const oN = { ...o, charges: CH };
  const pTom = pctx.panel(allN, 1, 13, true, oN), pNow = pctx.panel(allN, 0, 8, false, oN);
  ok(/Spotpris \(prognose\)/.test(pTom) && !/Nord Pool/.test(pTom), 'en prognosedag hedder Spotpris (prognose)');
  ok(/Sådan er prisen i morgen kl\. 13 sammensat/.test(pTom) && /data-pris-back>Tilbage til nu<\/button>/.test(pTom), 'valgt bar i morgen: overskrift med dagen og Tilbage til nu');
  ok(/Sådan er prisen søn 18\. okt kl\. 13 sammensat/.test(pctx.panel(allN, 4, 13, true, oN)), 'senere dage nævnes som ugedag, dato og måned, som i tooltippen');
  ok(/Sådan er prisen i dag kl\. 09 sammensat/.test(pctx.panel(allN, 0, 9, true, oN)) && /Spotpris \(Nord Pool\)/.test(pNow) && /Nettarif \(N1, kl\. 08\)/.test(pNow),
     'en valgt bar i dag siger i dag; nettarifrækken bærer den valgte time');
  ok(!/Spotpris \(prognose\)/.test(pNow), 'en børsprisdag er ikke en prognose');

  // The sum closes exactly for any price, tariff and charge: the spot row absorbs the rounding.
  let sweep = 0, bad = '';
  for (let i = 0; i < 4000 && !bad; i++) {
    const price = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 5, tariff = Math.abs(Math.sin(i * 78.233) * 0.7);
    const ch = { sys: 0.04 + (i % 7) * 0.013, trans: 0.0537, afg: (i % 3) * 0.0079, vat: 0.25 };
    for (const [view, wn] of [['din', true], ['din', false], ['spot', false]]) {
      const r = pctx.parts(price, view, ch, tariff, wn);
      if (!r) { bad = `no parts for ${price}`; break; }
      const sum = r.rows.reduce((a, x) => a + x.v, 0);
      if (sum !== r.total || r.total !== Math.round(price * 1000) || r.rows.some(x => !Number.isInteger(x.v) || Object.is(x.v, -0))) { bad = `${view} ${wn} ${price}: ${sum} vs ${r.total}`; break; }
      sweep++;
    }
  }
  ok(!bad && sweep === 12000, 'summen af rækkerne lukker præcis til prisen afrundet til 0,1 øre (12000 tilfælde)', bad);
  ok(!/-0,0 øre/.test(bd([dayG(D0, -0.0002, 'actual'), dayG(nextDate(1), 1, 'actual')], 21, { view: 'spot', net: null })), 'minus nul vises aldrig');
  const negSpot = lines(bd([dayG(D0, 0.1, 'actual', GT), dayG(nextDate(1), 1, 'actual', GT)], 21));
  ok(/^-\d/.test(negSpot[0][1]) && !/NaN/.test(JSON.stringify(negSpot)), 'er spotprisen negativ, vises den med minus og stakken tegnes stadig');

  // Closed by default, native <details>, one per place the caption shows (hero + each card); same text in all.
  ok((nb.match(/<details class="pris-bd[ "]/g) || []).length === 3 && !/<details[^>]* open/.test(nb), 'tre details (hero og to kort), alle lukkede i den tegnede HTML');
  ok(/<summary class="pris-cap">Inkl\. nettarif, afgifter og moms<i class="pris-chev" aria-hidden="true"><\/i><\/summary>/.test(nb), 'summary er billedteksten med en chevron');
  ok((nb.match(/Sådan er prisen kl\. 21 sammensat/g) || []).length === 3, 'panelteksten for den aktuelle time står som tekst i HTML\'en (crawlbar)');
  ok((bd(netFeed, 21, { open: true }).match(/<details class="pris-bd[^>]* open>/g) || []).length === 3, 'open:true tegner dem åbne (klienten bevarer åbent ved gentegning)');
  ok(/class="pris-bd pris-bd-card"/.test(nb) && /<details class="pris-bd"><summary/.test(nb), 'kortenes udgave bærer pris-bd-card (skjules på bred skærm)');

  // Missing data never shows a broken panel: the caption stays a plain line.
  const plain = (html, what) => ok(!/<details|pris-bdp/.test(html) && /<p class="pris-cap">Inkl\. nettarif, afgifter og moms<\/p>/.test(html) && /<p class="pris-cap pris-cap-card">/.test(html) && !/NaN|undefined|Infinity/.test(html), what);
  plain(pris(netFeed, D0, 21, o), 'uden charges: ren billedtekst uden chevron og uden NaN');
  plain(bd([dayG(D0, 1.64, 'actual'), dayG(nextDate(1), 1.64, 'actual')], 21), 'net uden grid_tariff på dagen: ren billedtekst');
  plain(bd(netFeed, 21, { charges: { sys: 0.07, trans: 0.054, vat: 0.25 } }), 'charges uden afg: ren billedtekst');
  plain(bd(netFeed, 21, { charges: { sys: 'x', trans: null, afg: NaN, vat: 0.25 } }), 'charges med ikke-tal: ren billedtekst');
  plain(bd([dayG(D0, 1.64, 'actual', GT.map((v, i) => i === 21 ? null : v)), dayG(nextDate(1), 1.64, 'actual', GT)], 21), 'en ødelagt tarifværdi: ren billedtekst');
  const gap = netFeed[0].prices.map(x => ({ ...x })); gap[21].price = null;
  plain(bd([{ ...netFeed[0], prices: gap }, netFeed[1]], 21), 'en time uden pris: ren billedtekst');
  ok(/<p class="pris-cap">Spotpris inkl\. moms<\/p>/.test(pris(netFeed, D0, 21, { ...o, view: 'spot' })), 'spotpris uden charges: ren billedtekst');

// ── One screen for every price area: language table, adapter, zone rendering ─────────────
  const L = pctx.PRIS_I18N, langs = ['da', 'nb', 'sv', 'fi', 'nl', 'de', 'fr', 'pl', 'it'], ACTL = ['de', 'fr', 'pl', 'it'];
  ok(Object.keys(L).join() === langs.join(), 'PRIS_I18N har præcis da, nb, sv, fi, nl, de, fr, pl og it', Object.keys(L).join());
  // The four EU languages carry three keys more (act1, act2: the card title for one and two days; cheapRest) and may carry the
  // optional hs (a suffix after the hour or range: " Uhr", " h").
  const OPT = ['hs'], ACTKEYS = ['act1', 'act2', 'cheapRest'];
  // Every key in every language, with the same shape and no empty text.
  const shape = v => Array.isArray(v) ? `array${v.length}` : typeof v;
  const keys = Object.keys(L.da);
  for (const lang of langs) {
    const have = Object.keys(L[lang]).filter(k => !OPT.includes(k) && !(ACTL.includes(lang) && ACTKEYS.includes(k)));
    ok(have.length === keys.length && keys.every(k => k in L[lang]), `${lang}: samme nøgler som dansk`, keys.filter(k => !(k in L[lang])).concat(have.filter(k => !keys.includes(k))).join(','));
    ok(ACTL.includes(lang) ? ACTKEYS.every(k => typeof L[lang][k] === 'string' && L[lang][k].length > 2) : ACTKEYS.every(k => !(k in L[lang])), `${lang}: act-nøglerne findes på de fire EU-sprog og kun dér`);
    ok(OPT.every(k => !(k in L[lang]) || typeof L[lang][k] === 'string') && (lang !== 'de' || L.de.hs === ' Uhr') && (lang !== 'fr' || L.fr.hs === ' h') && (!['da', 'nb', 'sv', 'fi', 'nl', 'pl', 'it'].includes(lang) || !('hs' in L[lang])) && !('dec' in L[lang]) && !('hm' in L[lang]), `${lang}: hs kun på tysk og fransk (ingen engelsk decimalpunktum eller :00 mere)`);
    ok(keys.every(k => shape(L[lang][k]) === shape(L.da[k])), `${lang}: samme form på hver nøgle`, keys.filter(k => shape(L[lang][k]) !== shape(L.da[k])).join(','));
    const flat = keys.flatMap(k => [].concat(L[lang][k]));
    ok(flat.every(x => typeof x === 'string') && flat.filter(x => x === '').length === (['sv', 'nl', 'fr', 'pl', 'it'].includes(lang) ? 1 : 0), `${lang}: ingen tom tekst (kun '' = ingen punktum efter dagstal, i sv, nl, fr, pl og it)`);
    ok(L[lang].wd.length === 7 && L[lang].ws.length === 7 && L[lang].mon.length === 12 && L[lang].verdict.length === 3 && L[lang].tier.length === 3, `${lang}: 7 ugedage, 12 måneder, 3 niveauer`);
  }
  ok(langs.every(l => !/\b10\b/.test(JSON.stringify(L[l]))), 'ingen sprog nævner 10 døgn');
  // The four EU languages: no Danish words, no forecast word (every day on those pages is settled), and words of their own.
  const DANISH = /\b(lige nu|døgn|børspris|billig|dyr|næste|prognose|spotpris|uden moms|afgifter|nettarif|i dag|i morgen|dag for dag|spænd|kl\.)\b/i;
  const FCWORD = { de: /prognos|vorhersage|vorschau/i, fr: /prévision|prevision|prédi/i, pl: /prognoz|przewid/i, it: /previsi|prognosi|stima/i };
  for (const l of ACTL) {
    const all = Object.values(L[l]).flat().join(' | ');
    ok(!DANISH.test(all), `${l}: ingen danske ord i tabellen`, (all.match(DANISH) || [])[0]);
    ok(!FCWORD[l].test(all) && !/prognos|forecast|ennuste/i.test(all), `${l}: intet ord for prognose i tabellen (siderne viser kun faktiske priser)`, (all.match(FCWORD[l]) || [])[0]);
    ok(L[l].fc === L[l].actual && L[l].p2 !== L.da.p2 && L[l].h1 !== L.da.h1 && L[l].cap !== L.da.cap && L[l].model === 'Bundesnetzagentur | SMARD.de' && !/ENTSO/i.test(all), `${l}: fc er samme ord som actual, egne ord, kilden er Bundesnetzagentur | SMARD.de og ENTSO-E nævnes ikke`);
    ok(/elpriser\.org/.test(L[l].note) && /berechnet|calculées|przeliczone|calcolate/.test(L[l].note) && /verändert|modifiées|zmienione|modificati/.test(L[l].note), `${l}: noten siger at elpriser.org har ændret dataene (timegennemsnit)`, L[l].note);
    ok(/ohne|hors|bez|al netto/i.test(L[l].cap) && /VAT|MwSt|TVA|IVA/.test(L[l].cap), `${l}: billedteksten siger "ekskl. moms" (spotpris, ikke hvad kunden betaler)`, L[l].cap);
  }
  ok(new Set(ACTL.map(l => L[l].now)).size === 4 && new Set(ACTL.map(l => L[l].cap)).size === 4 && new Set(ACTL.map(l => L[l].act2)).size === 4, 'de fire EU-sprog har hver deres tekster');
  ok(langs.slice(1).every(l => L[l].p2 !== L.da.p2 || l === 'nb'), 'sv og fi har egne ord for 2 døgn');

  // The adapter: five days from today, at the response's ECB rate.
  const raw = { zone: 'no2', zoneInfo: { rate: 10.6 }, days: Array.from({ length: 10 }, (_, i) => ({
    date: nextDate(i - 1), type: i < 2 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 100 + i, min_eur_mwh: 1, max_eur_mwh: 999 })) })) };
  const out = pctx.zoneToPrisDays(raw, raw.zoneInfo, D0);
  ok(out.length === 5 && out[0].date === D0 && out[4].date === nextDate(4), 'adapteren giver præcis fem døgn fra i dag (gårsdagen springes over)', out.map(d => d.date).join());
  ok(pctx.zoneToPrisDays(raw, raw.zoneInfo).length === 5 && pctx.zoneToPrisDays(raw, raw.zoneInfo)[0].date === nextDate(-1), 'uden dato er det de første fem døgn i feedet');
  ok(pctx.zoneToPrisDays({ days: raw.days }, null).length === 5 && pctx.zoneToPrisDays({ zone: 'no2', days: raw.days.slice(0, 3) }, {}, D0).length === 2, 'færre døgn end fem giver færre, ikke fejl');
  ok(Math.abs(out[0].prices[0].price - 101 * 10.6 / 10) < 1e-9 && out[0].prices[0].hour === 0, '101 EUR/MWh ved kurs 10,6 er 106,06 øre/kWh', String(out[0].prices[0].price));
  ok(Math.abs(pctx.zoneToPrisDays({ ...raw, zone: 'fi' }, { rate: 1 }, D0)[0].prices[3].price - 10.1) < 1e-9, 'EUR-zoner: 101 EUR/MWh er 10,1 cent/kWh');
  ok(Math.abs(pctx.zoneToPrisDays({ ...raw, zone: 'se3' }, null, D0)[0].prices[0].price - 101 * 11.29 / 10) < 1e-9, 'uden kurs i svaret bruges ZONES\' reservekurs');
  ok(Object.keys(out[0].prices[0]).join() === 'hour,price', 'min/max-båndet følger ikke med');
  const hole = { zone: 'no2', days: [{ date: D0, type: 'actual', prices: [{ hour: 0, eur_mwh: null }, null, { hour: 2, eur_mwh: 50 }] }] };
  ok(pctx.zoneToPrisDays(hole, { rate: 10 }, D0)[0].prices.filter(Boolean).length === 1 && !/NaN/.test(JSON.stringify(pctx.zoneToPrisDays(hole, { rate: 10 }, D0))), 'et hul i feedet bliver et hul, ikke NaN');
  ok(pctx.zoneToPrisDays(null, null, D0).length === 0 && pctx.zoneToPrisDays({}, {}, D0).length === 0, 'tomt svar giver ingen døgn');

  // The screen, in each language, from a ten-day feed through the adapter.
  const feedFor = zone => pctx.zoneToPrisDays({ zone, zoneInfo: { rate: zone === 'fi' ? 1 : zone.startsWith('se') ? 11 : 10 },
    days: Array.from({ length: 10 }, (_, i) => ({ date: nextDate(i), type: i < 2 ? 'actual' : 'forecast',
      prices: M.map((v, h) => ({ hour: h, eur_mwh: Math.round((v * 50 + i * 3) * 10) / 10 })) })) }, D0);
  for (const [zone, lang, w] of [['no3', 'nb', { now: 'Strømpris akkurat nå', u: 'øre', cheap: 'Billigst ', p: ['2 døgn', '5 døgn'], next: 'Neste 2 døgn', fc: 'Prognose', verdict: /Billig|Middels|Dyr/ }],
                                  ['se2', 'sv', { now: 'Elpris just nu', u: 'öre', cheap: 'Billigast ', p: ['2 dygn', '5 dygn'], next: 'Kommande 2 dygn', fc: 'Prognos', verdict: /Billigt|Medel|Dyrt/ }],
                                  ['fi', 'fi', { now: 'Sähkön hinta juuri nyt', u: 'snt', cheap: 'Halvin ', p: ['2 vrk', '5 vrk'], next: 'Seuraavat 2 vrk', fc: 'Ennuste', verdict: /Halpa|Keskihintainen|Kallis/ }]]) {
    const z = pris(feedFor(zone), D0, 21, { zone, key: zone, period: 2, where: zone.toUpperCase() });
    const e = z;
    ok(e.includes(`<p class="pris-label">${w.now} · `) && e.includes(`>${w.u}/kWh</span>`) && !/kr\/kWh|>kr</.test(e), `${zone}: etiket og enhed på ${lang}`);
    ok(!/data-pris-view|pris-seg|Din pris|Spotpris inkl/.test(e), `${zone}: ingen Din pris/Spotpris-kontakt`);
    // Words that are Danish and nothing else in this language (Norwegian shares "I dag", Swedish "Elpris").
    const dane = lang === 'nb' ? /Billig lige nu|Næste|Elpris |Spænd/ : lang === 'sv' ? /Billig lige nu|Børspris|Næste|I morgen|I dag|Dag for dag|Spænd/ : /Billig|Børspris|Næste|I morgen|I dag|Dag for dag|Elpris|Spænd/;
    ok(!dane.test(e), `${zone}: ingen danske ord`, (e.match(dane) || [])[0]);
    ok(w.verdict.test((e.match(/class="pris-pill t\d"><i><\/i>([^<]+)</) || [])[1] || '') && e.includes(`<div class="k">${w.cheap}`), `${zone}: dom og feltetiket på ${lang}`, w.cheap);
    ok([...e.matchAll(/<button type="button" role="tab"[^>]*>([^<]*)</g)].map(m => m[1]).join('|') === w.p.join('|') && e.includes(`<section class="pris-card pp2" aria-label="${w.next}">`), `${zone}: periodepille og korttitel på ${lang}`);
    ok(e.includes(`</i>${w.fc}</span>`) || !/pris-fc/.test(e), `${zone}: prognose-skillelinjen hedder ${w.fc}`);
    ok((e.match(/<tr class="r\d+">/g) || []).length === 5 && !/class="r10"/.test(e) && !/\b10 /.test(e.replace(/data-tip="[^"]*"/g, '').replace(/style="[^"]*"/g, '').replace(/\d+ ?(snt|öre|øre)/g, '')), `${zone}: fem dagsrækker og ingen dag seks til ti`);
    ok((e.match(/<span class="pc[ "]/g) || []).length === 54 + 105 && !/NaN|undefined|Infinity/.test(e), `${zone}: 54 + 105 søjler (6 før nu og resten af de fem døgn feedet har), ingen NaN`);
    ok(/data-tip="[^"]*\d (öre|øre|snt)\/kWh"/.test(e) && !/data-tip="[^"]*,\d\d\d /.test(e), `${zone}: tooltip i zonens enhed`);
  }
  // Decimals and axis follow the unit: øre at 300 are whole numbers, snt at 5 keep two decimals; the axis grain scales.
  const big = pris(pctx.zoneToPrisDays({ zone: 'no1', days: [dayOf(D0, T, 'actual'), dayOf(nextDate(1), M, 'actual')].map(d => ({ ...d, prices: d.prices.map(p => ({ hour: p.hour, eur_mwh: p.price * 100 })) })) }, { rate: 10 }, D0), D0, 21, { zone: 'no1', key: 'no1' });
  ok(/class="pris-now">267</.test(big) && /<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d+<\/span>)+<\/div>/.test(big) && [...big.matchAll(/class="pris-yl">([\s\S]*?)<\/div>/g)][0][1].includes('>400<'), 'NO: 267 øre uden decimal, aksen i trin af 100 op til 400', text(/class="pris-yl">([\s\S]*?)<\/div>/));
  const cheap = pris(pctx.zoneToPrisDays({ zone: 'fi', days: [dayOf(D0, T, 'actual'), dayOf(nextDate(1), M, 'actual')].map(d => ({ ...d, prices: d.prices.map(p => ({ hour: p.hour, eur_mwh: p.price * 3 })) })) }, { rate: 1 }, D0), D0, 21, { zone: 'fi', key: 'fi' });
  ok(/class="pris-now">0,80</.test(cheap) && /class="pris-u">snt\/kWh</.test(cheap), 'FI: 8 EUR/MWh er 0,80 snt med to decimaler');
  // The Danish screen is untouched by all of this: the same call with no zone is the Danish output, byte for byte.
  ok(pris(feed, D0, 21, o) === pris(feed, D0, 21, { ...o, zone: undefined }) && /Din pris/.test(pris(feed, D0, 21, o)), 'uden zone er skærmen den danske');
  // ── The EU pages (PRIS_ACT): actual prices only, one period, today and tomorrow — or today alone ──
  {
    const eu = (zone, nDays, rate, base = 100) => ({ zone, zoneInfo: { rate, currency: rate === 1 ? 'EUR' : 'PLN' }, trainedThrough: null,
      days: Array.from({ length: nDays }, (_, i) => ({ date: nextDate(i), type: 'actual', prices: M.map((v, h) => ({ hour: h, eur_mwh: Math.round((base + v * 10 + i * 3) * 100) / 100 })) })) });
    const draw = (zone, nDays, rate, hour = 21) => { const r = eu(zone, nDays, rate); return pris(pctx.zoneToPrisDays(r, r.zoneInfo, D0), D0, hour, { zone, key: zone, period: 2, cfg: pctx.prisCountryCfg(Object.keys(pctx.PRIS_COUNTRIES).find(k => pctx.PRIS_COUNTRIES[k].zones.includes(zone))), where: zone }); };
    // The adapter for one and for two days, and for PLN at a known rate.
    ok(pctx.zoneToPrisDays(eu('de', 2, 1), { rate: 1 }, D0).length === 2 && pctx.zoneToPrisDays(eu('de', 1, 1), { rate: 1 }, D0).length === 1, 'adapteren: ét og to døgn giver ét og to døgn');
    const plDay = pctx.zoneToPrisDays({ zone: 'pl', days: [{ date: D0, type: 'actual', prices: [{ hour: 0, eur_mwh: 100 }, { hour: 1, eur_mwh: -5.5 }, { hour: 2, eur_mwh: null }] }] }, { rate: 4.25 }, D0)[0].prices;
    ok(Math.abs(plDay[0].price - 42.5) < 1e-9 && Math.abs(plDay[1].price - (-2.3375)) < 1e-9 && plDay[2] === null, 'PL: 100 EUR/MWh ved 4,25 zł/€ er 42,5 gr/kWh; en negativ pris bliver negativ; et hul er null');
    ok(Math.abs(pctx.zoneToPrisDays({ zone: 'pl', days: [{ date: D0, type: 'actual', prices: [{ hour: 0, eur_mwh: 100 }] }] }, null, D0)[0].prices[0].price - 43.9) < 1e-9 && pctx.ZONES.pl.cur === 'PLN' && pctx.ZONES.pl.sub === 'gr', 'PL: uden kurs i svaret bruges reservekursen 4,39');
    for (const z of ['de', 'fr', 'it-n']) ok(Math.abs(pctx.zoneToPrisDays({ zone: z, days: [{ date: D0, type: 'actual', prices: [{ hour: 0, eur_mwh: 101 }] }] }, { rate: 1 }, D0)[0].prices[0].price - 10.1) < 1e-9, `${z}: 101 EUR/MWh er 10,1 cent/kWh`);
    // Two days: one card, no pill, no forecast divider, the type "Day-ahead" only, the title says today and tomorrow.
    for (const [zone, w] of [['de', { card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', u: 'ct' }], ['fr', { card: 'Aujourd’hui et demain', one: 'Aujourd’hui', kind: 'Prix day-ahead', u: 'c€' }],
        ['pl', { card: 'Dziś i jutro', one: 'Dziś', kind: 'Cena RDN', u: 'gr' }], ['it-n', { card: 'Oggi e domani', one: 'Oggi', kind: 'Prezzo day-ahead', u: 'c€' }]]) {
      const two = draw(zone, 2, zone === 'pl' ? 4.4 : 1), one = draw(zone, 1, zone === 'pl' ? 4.4 : 1);
      ok(!/pris-period|data-pris-period/.test(two) && !/pris-period|data-pris-period/.test(one), `${zone}: ingen periodepille (hverken tegnet eller deaktiveret) med ét døgn eller to`);
      ok((two.match(/<section class="pris-card/g) || []).length === 1 && two.includes(`<section class="pris-card pp2" aria-label="${w.card}">`) && two.includes(`<p class="pris-ct">${w.card}</p>`), `${zone}: to døgn: ét kort med titlen "${w.card}"`);
      ok(one.includes(`<section class="pris-card pp2" aria-label="${w.one}">`) && one.includes(`<p class="pris-ct">${w.one}</p>`) && !one.includes(w.card), `${zone}: ét døgn: titlen er "${w.one}", ikke "${w.card}"`);
      const bars = h => (h.slice(h.indexOf('pris-card pp2'), h.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
      ok(bars(two) === 48 && bars(one) === 24, `${zone}: 48 søjler med to døgn, 24 med ét`, `${bars(two)}/${bars(one)}`);
      ok((two.match(/<tr class="r\d+">/g) || []).length === 2 && (one.match(/<tr class="r\d+">/g) || []).length === 1 && (two.match(new RegExp(`<td class="real">${w.kind}</td>`, 'g')) || []).length === 2, `${zone}: to og én dagsrække, typen er kun "${w.kind}"`);
      ok(!/pris-fc|class="fc"|r5|r7|r10|pris-sum/.test(two + one) && !/NaN|undefined|Infinity/.test(two + one), `${zone}: ingen prognose-skillelinje, ingen skjulte dage, ingen NaN`);
      ok(two.includes(`>${w.u}/kWh</span>`) && !/kr\/kWh|øre|døgn/.test(two), `${zone}: enheden er ${w.u}/kWh`);
      const aria = (two.match(/role="img" tabindex="0" aria-label="([^"]*)"/) || [])[1] || '';
      ok(aria.startsWith(zone === 'de' ? 'Strompreis stündlich, heute und morgen: ' : '') && /\d/.test(aria) && !/Prognos|forecast/i.test(aria), `${zone}: diagrammets tekst er sandfærdig og uden prognose`, aria.slice(0, 60));
    }
    // The sentence under the verdict: tomorrow's prices make "the next 24 hours" true; with today alone it says what it means.
    ok(draw('de', 2, 1, 21).includes('Billigere') === false && /Günstiger morgen um 13 Uhr — <b>/.test(draw('de', 2, 1, 21)), 'DE: med to døgn: "Günstiger morgen um 13 Uhr — x ct"');
    ok(/class="pris-sent">Günstigste Stunde des restlichen Tages</.test(draw('de', 1, 1, 13)) && /class="pris-sent"><\/p>/.test(draw('de', 1, 1, 23)), 'DE: med kun i dag: "Günstigste Stunde des restlichen Tages", og i sidste time ingen sætning');
    // Hours and decimals the way each language writes them.
    ok(/<p class="pris-label">Strompreis jetzt · <span class="pris-wd">Mittwoch <\/span>um 21 Uhr<\/p>/.test(draw('de', 2, 1)) && /<td>um 13–14 Uhr<\/td>/.test(draw('de', 2, 1)), 'DE: "um 21 Uhr" og "um 13–14 Uhr"');
    ok(/Prix de l’électricité maintenant · <span class="pris-wd">mercredi <\/span>à 21 h/.test(draw('fr', 2, 1)) && /<td>à 13–14 h<\/td>/.test(draw('fr', 2, 1)), 'FR: "à 21 h" og "à 13–14 h"');
    ok(/class="pris-now">[\d,]+</.test(draw('it-n', 2, 1)) && /alle 21/.test(draw('it-n', 2, 1)) && /godz\. 21/.test(draw('pl', 2, 4.4)), 'IT/PL: "alle 21", "godz. 21"');
    // The Danish screen is not touched: no pill is missing, the forecast divider and the 'Prognose' type are still there.
    ok(/data-pris-period="2"/.test(pris(feed, D0, 21, o)) && /pris-fc/.test(pris(feed, D0, 21, o)) && /<td class="fc">Prognose<\/td>/.test(pris(feed, D0, 21, o)), 'de danske sider har stadig periodepille, prognose-skillelinje og typen Prognose');
    // The text block names the source and the basis for an EU page, the model for a Nordic one.
    const raws = k => { const r = eu(k, 2, k === 'pl' ? 4.4 : 1); return r; };
    const zl = pctx.prisZoneList('it/prezzo-luce', Object.fromEntries(pctx.PRIS_COUNTRIES['it/prezzo-luce'].zones.map(k => [k, raws(k)])), D0);
    ok((zl.match(/<li>/g) || []).length === 1 && zl.includes('<a href="https://www.smard.de" target="_blank" rel="noopener">Bundesnetzagentur | SMARD.de</a> (<a href="https://www.energy-charts.info" target="_blank" rel="noopener">Energy-Charts.info</a>), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>') && !/huggingface|entsoe|ENTSO/i.test(zl) && /Fonte:/.test(zl) && /dati modificati/.test(zl), 'IT: én zone i tekstblokken; kilden er Bundesnetzagentur | SMARD.de med Energy-Charts og CC BY 4.0-linket, og noten siger at dataene er ændret (ikke modellen, ikke ENTSO-E)');
    ok(/huggingface/.test(pctx.prisZoneList('no/strompris', Object.fromEntries(pctx.PRIS_COUNTRIES['no/strompris'].zones.map(k => [k, eu(k, 2, 10)])), D0)), 'NO: tekstblokken peger stadig på modellen');
  }
  // The country pages' pieces.
  const tabs = pctx.prisZoneTabs('no/strompris', 'no2');
  ok((tabs.match(/role="tab"/g) || []).length === 5 && /href="#no2" data-zone="no2" aria-selected="true" tabindex="0">NO2<small>Kristiansand<\/small>/.test(tabs) && (tabs.match(/tabindex="-1"/g) || []).length === 4 && /role="tablist" aria-label="Prisområde"/.test(tabs), 'zone-fanerne: tablist, valgt fane har tabindex 0 og by');
  ok(pctx.prisZoneTabs('fi/sahkon-hinta', 'fi') === '' && /aria-label="Elområde"/.test(pctx.prisZoneTabs('sv/elpris', 'se3')), 'Finland har ingen faner; Sverige siger Elområde');
  ok(pctx.prisHref('no5') === '/no/strompris#no5' && pctx.prisHref('fi') === '/fi/sahkon-hinta' && pctx.prisHref('dk2') === '/dk2' && pctx.prisHref('nl') === '/nl/stroomprijs', 'prisHref: landesidens anker, Finland og Holland uden anker, DK');
  ok(pctx.PRIS_COUNTRIES['no/strompris'].def === 'no1' && pctx.PRIS_COUNTRIES['sv/elpris'].def === 'se3' && pctx.PRIS_COUNTRIES['no/strompris'].zones.every(k => pctx.ZONES[k].lang === 'nb'), 'landenes startzone og sprog');
  ok(Object.values(pctx.ZONES).every(z => z.name && z.city && z.cur && z.rate > 0 && z.sub) && Object.keys(pctx.ZONES).length === 17, 'ZONES: 17 områder med navn, by, valuta, kurs og enhed');
  ok(pctx.NORDEN_ZONES.length === 13 && pctx.NORDEN_ZONES.every(k => k in pctx.ZONES && /^(dk|no|se|fi|nl)/.test(k)), '/norden sammenligner stadig kun de 13 nordiske og hollandske områder');
  ok(pctx.ZONES.nl.lang === 'nl' && pctx.ZONES.nl.sub === 'cent' && pctx.ZONES.nl.rate === 1 && pctx.PRIS_COUNTRIES['nl/stroomprijs'].def === 'nl' && pctx.PRIS_COUNTRIES['nl/stroomprijs'].zones.join() === 'nl', 'NL: hollandsk, cent, kurs 1, og landets eneste zone');
  ok(Object.values(pctx.ZONES).every(z => z.lang in L) && Object.values(pctx.PRIS_COUNTRIES).every(c => c.lang in L), 'hver zone og hvert land peger på et sprog der findes');

  // ── The country pages' chrome: CHROME_I18N has the same keys in all four languages, chromeHTML is the one template ──
  {
    const X = pctx.CHROME_I18N, cl = ['nb', 'sv', 'fi', 'nl', 'de', 'fr', 'pl', 'it'];
    ok(Object.keys(X).join() === cl.join(), 'CHROME_I18N har præcis nb, sv, fi, nl, de, fr, pl og it (den danske chrome er index.html\'s egen markup)', Object.keys(X).join());
    const ks = Object.keys(X.nb), cks = Object.keys(X.nb.cn);
    for (const l of cl) {
      // the four EU languages carry one key more: chg, the note that the site changed the data
      ok(Object.keys(X[l]).filter(k => k !== 'chg').join() === ks.join() && Object.keys(X[l].cn).join() === cks.join() && ('chg' in X[l]) === ['de', 'fr', 'pl', 'it'].includes(l), `${l}: chrome-nøgler som norsk (chg kun på de fire EU-sprog)`, Object.keys(X[l]).join());
      ok(ks.concat(l === 'de' || l === 'fr' || l === 'pl' || l === 'it' ? ['chg'] : []).every(k => k === 'cn' || (typeof X[l][k] === 'string' && X[l][k].length > (k === 'and' ? 0 : 1))) && cks.every(k => typeof X[l].cn[k] === 'string' && X[l].cn[k].length > 2), `${l}: ingen tom chrome-tekst`);
    }
    ok(cks.join() === 'dk,no,sv,fi,nl,de,fr,pl,it' && Object.values(pctx.PRIS_COUNTRIES).every(c => cks.includes(c.cc)), 'landenavnene dækker Danmark og hvert landeside-cc');
    // The words differ between the languages — a copy-pasted Norwegian table would pass every check above.
    ok(new Set(cl.map(l => X[l].pick)).size === 8 && new Set(cl.map(l => X[l].privacy)).size === 8 && new Set(cl.map(l => X[l].land)).size >= 7 && cl.every(l => new Set(Object.values(X[l].cn)).size === 9), 'vælger-, privatlivs- og landeord er forskellige på de otte sprog');
    const html = pg => pctx.chromeHTML(pg);
    for (const pg of Object.keys(pctx.PRIS_COUNTRIES)) {
      const c = html(pg), C = pctx.PRIS_COUNTRIES[pg], x = X[C.lang];
      ok(!('nav' in c) && c.home === x.home, `${pg}: ingen landerække i headeren (globussen er vælgeren), og logoets navn er på ${C.lang}`);
      ok(c.foot.startsWith('<footer ') && (c.foot.match(/<footer/g) || []).length === 1 && c.foot.includes(`<p class="sf-h" id="sfLand">${x.land}</p>`) && (c.foot.match(/aria-current="page"/g) || []).length === 1, `${pg}: sidefoden har en landeliste med den aktuelle markeret`);
      ok(c.foot.includes(`<a href="/privatliv" hreflang="da">${x.privacy}</a>`) && (c.foot.match(/hreflang/g) || []).length === 1, `${pg}: privatlivslinket peger på /privatliv med hreflang="da" og er mærket på ${C.lang}`);
      // The Nordic pages credit ENTSO-E and Energi Data Service; the EU pages credit Bundesnetzagentur | SMARD.de (CC BY 4.0, with the
      // licence link) and say the data were changed — and name neither ENTSO-E nor Energi Data Service.
      ok(/&copy; Elpriser\.org &mdash; /.test(c.foot) && c.foot.includes('>Hugging Face</a>') && (C.act
        ? c.foot.includes('>Bundesnetzagentur | SMARD.de</a> (<a href="https://www.energy-charts.info" target="_blank" rel="noopener">Energy-Charts.info</a>), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> &mdash; ' + x.chg) && !c.foot.includes('Energi Data Service') && !/ENTSO/.test(c.foot)
        : c.foot.includes('>ENTSO-E</a>') && c.foot.includes('>Energi Data Service</a>')), `${pg}: ophavsretslinjen med kilderne`);
      const all = c.foot;
      ok(!/Smart hjem|Hent appen|Hent til|Netselskab|netselskab|Hovedmenu|Mobilnavigation|Privatliv|Åbne datasæt|Alle guides|Forstå din elpris|id="netChip|class="app-btn|class="tabbar|<dialog/.test(all), `${pg}: ingen dansk chrome, ingen netchip, ingen app-knap`, (all.match(/Smart hjem|Hent appen|Hent til|Netselskab|netselskab|Hovedmenu|Privatliv|Åbne datasæt/) || [])[0]);
      ok(/^<footer class="sf sf-x" data-pg="[^"]+">/.test(c.foot) && !/\$\{|undefined|NaN/.test(all), `${pg}: ingen skabelonrester`);
    }
  }

  // ── The country picker (the globe in the header): one template for the Danish pages and the eight languages ──
  {
    const X = pctx.CHROME_I18N, HREFS = '/dk1,/no/strompris,/sv/elpris,/fi/sahkon-hinta,/nl/stroomprijs,/de/strompreis,/fr/prix-electricite,/pl/ceny-pradu,/it/prezzo-luce';
    const NAMES = 'Danmark Dansk,Norge Norsk,Sverige Svenska,Suomi Suomi,Nederland Nederlands,Deutschland Deutsch,France Français,Polska Polski,Italia Italiano';
    const links = d => [...d.matchAll(/<a href="([^"]+)"( aria-current="page")?><b>([^<]+)<\/b><span>([^<]+)<\/span><\/a>/g)];
    const da = pctx.pickerHTML('da', 'dk');
    ok(INDEX.includes(da.dialog) && INDEX.slice(INDEX.indexOf('<header class="site-nav">'), INDEX.indexOf('</header>')).includes(da.btn), 'den danske vælger i index.html er pickerHTML(da, dk), tegn for tegn');
    ok(links(da.dialog).map(m => m[1]).join() === HREFS && links(da.dialog).map(m => m[3] + ' ' + m[4]).join() === NAMES && links(da.dialog).filter(m => m[2]).map(m => m[1]).join() === '/dk1', 'dansk vælger: ni lande med eget navn og sprog, Danmark markeret');
    ok(da.dialog.includes('>Vælg land</h2>') && da.dialog.includes('>Norden</p>') && da.dialog.includes('>Resten af Europa</p>') && da.btn.includes('aria-label="Vælg land"'), 'dansk vælger: overskrift, grupper og knapnavn på dansk');
    const picks = new Set(['Vælg land']);
    for (const pg of Object.keys(pctx.PRIS_COUNTRIES)) {
      const C = pctx.PRIS_COUNTRIES[pg], x = X[C.lang], P = pctx.pickerHTML(C.lang, C.cc), l = links(P.dialog);
      picks.add(x.pick);
      ok(l.map(m => m[1]).join() === HREFS && l.map(m => m[3] + ' ' + m[4]).join() === NAMES, `${pg}: vælgeren viser de ni lande med deres egne navne, ens på alle sprog`);
      ok(l.filter(m => m[2]).map(m => m[1]).join() === '/' + pg, `${pg}: præcis sidens eget land er aria-current i vælgeren`);
      ok(P.dialog.includes(`id="countryDialogTitle">${x.pick}</h2>`) && P.dialog.includes(`<p class="pd-gt">${x.g0}</p>`) && P.dialog.includes(`<p class="pd-gt">${x.g1}</p>`) && P.dialog.includes(`aria-label="${x.close}"`) && P.btn.includes(`aria-label="${x.pick}"`), `${pg}: vælgerens ord er på ${C.lang}`);
      ok(!/hreflang|\$\{|undefined|NaN/.test(P.dialog + P.btn) && pctx.chromeHTML(pg).btn === P.btn && pctx.chromeHTML(pg).picker === P.dialog, `${pg}: ingen hreflang-klynge eller skabelonrester, og chromeHTML bruger den samme vælger`);
    }
    ok(picks.size === 9, 'vælgerens overskrift er forskellig på dansk og de otte sprog', [...picks].join());
  }

  // ── /prognose: the SAME screen with a configuration (PRIS_FC) ──────────────────────────────────────────────
  const STD = pctx.PRIS_STD, FC = pctx.PRIS_FC;
  ok(JSON.stringify(STD) === '{"periods":[2,5],"def":2,"days":10,"unc":false}' && JSON.stringify(FC) === '{"periods":[2,5,7],"def":7,"days":7,"unc":true,"summary":true}',
     'PRIS_STD er 2|5 (åbner på 2, ti dage som tekst, intet resumé) og PRIS_FC er 2|5|7 (åbner på 7, syv dage, Usikkerhed, resumé)', JSON.stringify([STD, FC]));
  // The period value: 10 is the longest period the page offers (5 elsewhere, 7 on /prognose); unreadable is the page's default.
  const pp = (cfg, ...vs) => vs.map(v => pctx.prisPeriod(v, cfg)).join();
  ok(pp(STD, 2, '2', 5, '5', 10, '10', '3–10', '3-10', 7, undefined, null, '', 'x', 1, 25) === '2,2,5,5,5,5,5,5,5,2,2,2,2,2,2', 'prisPeriod på de almindelige sider: 2 og 5; 10 og 7 læses som 5; resten som 2', pp(STD, 2, '2', 5, '5', 10, '10', '3–10', '3-10', 7, undefined, null, '', 'x', 1, 25));
  ok(pctx.prisPeriod(10) === 5 && pctx.prisPeriod('x') === 2, 'uden cfg er prisPeriod de almindelige siders');
  ok(pp(FC, 2, '2', 5, '5', 7, '7', 10, '10', '3–10', '3-10', undefined, null, '', 'x', 1, 25) === '2,2,5,5,7,7,7,7,7,7,7,7,7,7,7,7', 'prisPeriod på /prognose: 2, 5 og 7; det gamle 10 bliver 7; ukendt og tomt bliver 7', pp(FC, 2, '2', 5, '5', 7, '7', 10, '10', '3–10', '3-10', undefined, null, '', 'x', 1, 25));
  // Usikkerhed is a function of the horizon and nothing else.
  ok(Array.from({ length: 10 }, (_, i) => pctx.prisUncertainty(i)).join() === '—,Lav,Lav,Middel,Middel,Middel,Høj,Høj,Høj,Høj', 'prisUncertainty: — i dag, Lav i morgen og D+2, Middel D+3 til D+5, Høj fra D+6');
  // prisDays: ten by default, as many as asked, and it still stops at a gap and skips yesterday.
  ok(pctx.days(feed, D0).length === 10 && pctx.days(feed, D0, 7).length === 7 && pctx.days(feed, D0, 7)[6].date === nextDate(6), 'prisDays: ti som standard, syv når der bedes om det');
  ok(pctx.days(feed.filter((_, i) => i !== 3), D0).length === 3, 'et hul i feedet afkorter listen i stedet for at lime døgn sammen');
  ok(pctx.days([dayOf(nextDate(-1), T, 'actual'), ...feed], D0)[0].date === D0, 'gårsdagen er ikke med: i dag er datomatchet, ikke første række');

  const FO = { ...o, cfg: FC, period: 7, net: null, where: 'DK1 Vest', key: 'DK1|din|' };
  const f7 = pris(feed, D0, 21, FO);
  ok(/data-period="7"/.test(f7) && [...f7.matchAll(/<button type="button" role="tab" aria-selected="(\w+)" data-pris-period="(\d)">([^<]*)</g)].map(m => `${m[2]}:${m[1]}:${m[3]}`).join('|') === '2:false:2 døgn|5:false:5 døgn|7:true:7 døgn',
     'pillen har 2 døgn, 5 døgn og 7 døgn, og 7 døgn er valgt');
  ok(/<section class="pris-card pp2" aria-label="Næste 2 døgn">/.test(f7) && /<section class="pris-card pp5" aria-label="Næste 5 døgn">/.test(f7) && /<section class="pris-card pp7" aria-label="Næste 7 døgn">/.test(f7) && /<p class="pris-ct">Næste 7 døgn<\/p>/.test(f7), 'tre kort, det sidste hedder Næste 7 døgn');
  const c2 = f7.slice(f7.indexOf('pris-card pp2'), f7.indexOf('pris-card pp5')), c5 = f7.slice(f7.indexOf('pris-card pp5'), f7.indexOf('pris-card pp7')), c7 = f7.slice(f7.indexOf('pris-card pp7'), f7.indexOf('pris-tiles pp2'));
  ok((c2.match(/<span class="pc[ "]/g) || []).length === 54 && (c5.match(/<span class="pc[ "]/g) || []).length === 126 && /pris-xl">/.test(c2) && />I morgen 00</.test(c2), '2 døgn er 54 søjler (6 før nu og 48 frem) med timemærker og 5 døgn 126');
  ok((c7.match(/<span class="pc[ "]/g) || []).length === 153, '7 døgn er 6 timer før nu og resten af de syv døgn feedet har: 153 søjler');
  ok((c7.match(/class="pc past"/g) || []).length === 6 && (c7.match(/<b class="pd"/g) || []).length === 1, 'de 6 timer før nu er dæmpet, og der er én prik');
  ok(/data-tip="tir 20\. okt kl\. 13 · \d,\d\d kr\/kWh"/.test(c7) && !/ 21\. okt/.test(f7), 'dag syv (tir 20.) er med og dag otte (21.) er ikke');
  const xd7 = [...c7.matchAll(/<span class="xd" style="left:([\d.]+)%">([^<]+)<\/span>/g)];
  ok(xd7.map(m => m[2]).join('|') === 'ons 14|tor 15|fre 16|lør 17|søn 18|man 19|tir 20' && xd7.map(m => m[1]).join('|') === [19.5, 36, 60, 84, 108, 132, 156].map(k => ((k - 15) / 153 * 100).toFixed(2)).join('|'),
     'x-aksen har ét mærke pr. døgn (ugedag og dato), midt under den del af døgnet der er med', xd7.map(m => m[2]).join('|'));
  ok(/<div class="pris-xl days">/.test(c7) && (c7.match(/class="pris-sep"/g) || []).length === 6, 'dagsaksen og en skillelinje ved hver midnat');
  ok(/<span class="pris-fc mid" style="left:21\.57%"><i><\/i>Prognose<\/span>/.test(c7), 'Prognose-skillelinjen står hvor prognosen begynder (bar 33 af 153)');
  ok(/<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d<\/span>){4}<\/div>/.test(c7), 'aksen er nulbaseret og samme regel som de andre kort: 0 1 2 3 4');
  const t7 = f7.slice(f7.indexOf('pris-tiles pp7'));
  ok(/<div class="pris-tiles pp2">/.test(f7) && /<div class="pris-tiles pp5">/.test(f7) && /<div class="k">Billigst i morgen<\/div>/.test(t7), 'et sæt felter pr. periode, også for 7 døgn');
  const dear6 = pris(feed.map((d, i) => i === 6 ? dayOf(d.date, M.map((v, hh) => hh === 19 ? 5.5 : v), 'forecast') : d), D0, 21, FO);
  ok(/<div class="k">Dyrest tir 20\.<\/div><div class="v">5,50 <small>kr · kl\. 19/.test(dear6.slice(dear6.indexOf('pris-tiles pp7'))) && !/Dyrest tir 20\./.test(dear6.slice(dear6.indexOf('pris-tiles pp5'), dear6.indexOf('pris-tiles pp7'))),
     'dag syv tæller kun i 7 døgn-feltet');
  // The day list: seven rows, no more; the Usikkerhed column is a pure function of the row's place.
  ok((f7.match(/<tr class="r\d+"><th scope="row">/g) || []).length === 7 && (f7.match(/<tr class="r2">/g) || []).length === 2 && (f7.match(/<tr class="r5">/g) || []).length === 3 && (f7.match(/<tr class="r7">/g) || []).length === 2 && !/class="r10"/.test(f7),
     'dagslisten har syv rækker: 2 i alle perioder, 3 fra 5 døgn, 2 kun i 7 døgn, ingen ekstra');
  ok(/<th scope="col">Type<\/th><th scope="col">Usikkerhed<\/th><\/tr>/.test(f7), 'Usikkerhed er kolonnen efter Type');
  const rows = f7.slice(f7.indexOf('<tbody>')).split('<tr class=').slice(1);
  ok(rows.map(r => r.match(/<td[^>]*>([^<]*)<\/td><\/tr>/)[1]).join() === '—,Lav,Lav,Middel,Middel,Middel,Høj' && rows.map(r => r.match(/<td class="(?:real|fc)">([^<]*)<\/td>/)[1]).join() === 'Børspris,Børspris,Prognose,Prognose,Prognose,Prognose,Prognose',
     'Usikkerhed: — Lav Lav Middel Middel Middel Høj; Type er stadig Børspris/Prognose', rows.map(r => r.match(/<td[^>]*>([^<]*)<\/td><\/tr>/)[1]).join());
  ok(!/10 (døgn|dage)|\b10 d/.test(f7) && !/Usikkerhed/.test(pris(feed, D0, 21, o)) && !/pp7|data-pris-period="7"|class="r7"/.test(pris(feed, D0, 21, o)),
     'ingen 10 døgn på /prognose, og de almindelige sider har hverken Usikkerhed, 7 døgn eller r7');
  ok(/data-period="7"/.test(pris(feed, D0, 21, { ...FO, period: 10 })) && /data-period="7"/.test(pris(feed, D0, 21, { ...FO, period: undefined })) && /data-period="5"/.test(pris(feed, D0, 21, { ...FO, period: 5 })) && /data-period="5"/.test(pris(feed, D0, 21, { ...o, period: 7 })),
     'det gamle 10 og et manglende valg tegnes som 7 døgn på /prognose; 7 på en almindelig side som 5');
  // No fork: take away what the configuration adds and the markup is the common screen, byte for byte.
  const seven = feed.slice(0, 7);
  const common = pris(seven, D0, 21, { ...FO, cfg: undefined, period: 5 });
  const stripped = pris(seven, D0, 21, { ...FO, period: 5 })
    .replace(/<button type="button" role="tab" aria-selected="\w+" data-pris-period="7">[^<]*<\/button>/, '')
    .replace(/<section class="pris-card pp7"[\s\S]*?<\/section>/, '')
    .replace(/<section class="pris-days pris-sum pp\d"[\s\S]*?<\/section>/g, '')
    .replace(/<div class="pris-tiles pp7">(?:<div class="pris-tile">.*?<\/div><\/div>)+<\/div>/, '')
    .replace('<th scope="col">Usikkerhed</th>', '').replace(/<td>(?:—|Lav|Middel|Høj)<\/td><\/tr>/g, '</tr>').replace(/<tr class="r7">/g, '<tr class="r10">');
  ok(stripped === common, 'tager man det /prognose tilføjer væk, er skærmen tegn for tegn den fælles', stripped === common ? '' : `${stripped.length} vs ${common.length}`);
  // Fewer days than seven: the card draws the days it has; nothing crashes.
  const f4 = pris(feed.slice(0, 4), D0, 21, FO);
  ok((f4.slice(f4.indexOf('pris-card pp7'), f4.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length === 81 && !/NaN|undefined|Infinity/.test(f4) && (f4.match(/<tr class="r\d+"><th/g) || []).length === 4, 'med fire døgn tegnes fire døgn og ingen NaN');
  ok(Object.values(pctx.PRIS_I18N).every(l => /^7 /.test(l.p7)) && pctx.PRIS_I18N.da.p7 === '7 døgn', 'p7 findes på alle fire sprog');

  // ── prisSummary: "Ugen i korte træk" — bullets from the days already drawn ──
  {
    const mk = (date, fn, type = 'forecast') => ({ date, type, prices: Array.from({ length: 24 }, (_, hour) => ({ hour, price: fn(hour) })) });
    const sum = (fd, p, cfg = FC) => { const a = pctx.days(fd, D0, cfg.days); return pctx.summary(a, p, cfg, pctx.ctx({}, a)); };
    const bul = h => [...h.matchAll(/<li><strong>([^<]*):<\/strong> ([^<]*)<\/li>/g)].map(m => `${m[1]}: ${m[2]}`);
    const head = h => (h.match(/<p class="pris-dt">([^<]*)<\/p>/) || [])[1];
    // 14 Oct 2026 is a Wednesday. Every day dips at 13 except Sat/Sun (dip at 03); level per day = k[i].
    const k = [1.0, 1.2, 0.8, 1.1, 1.5, 0.9, 1.3];
    const wk = Array.from({ length: 7 }, (_, i) => mk(nextDate(i), hh => {
      const we = i === 3 || i === 4;   // lør 17 and søn 18 ... (D+3, D+4)
      return +(k[i] * ((we ? hh === 3 : hh === 13) ? 0.5 : 1.5) + hh * 0.001).toFixed(4);
    }, i < 2 ? 'actual' : 'forecast'));
    const s7 = sum(wk, 7), b7 = bul(s7);
    ok(head(s7) === 'Ugen i korte træk' && b7.length === 4 && /^pris-days pris-sum pp7$/.test((s7.match(/class="([^"]*)"/) || [])[1]), 'resumé 7 døgn: overskrift og fire punkter', s7);
    ok(b7[0] === 'Billigste dag: fredag (0,41–1,22 kr/kWh)', 'billigste dag er fredag (laveste dagsgennemsnit)', b7[0]);
    ok(b7[1] === 'Dyreste dag: søndag (0,75–2,27 kr/kWh)', 'dyreste dag er søndag, interval med decimalkomma og kr/kWh', b7[1]);
    ok(b7[2] === 'Bedste tid at bruge strøm: hverdage kl. 13–14, hvor prisen oftest er lavest.', 'bedste tid: kl. 13–14 på de fem hverdage af syv (≥ 60 %, ingen weekenddag) hedder "hverdage"', b7[2]);
    ok(b7[3] === 'Sikkerhed: de næste to dage er sikre. Fra og med lørdag er prognosen mere usikker, og mest usikker fra og med tirsdag.', 'sikkerhed: to dage sikre, usikker fra D+3 (lørdag), mest usikker fra D+6 (tirsdag)', b7[3]);
    const s2 = sum(wk, 2), s5 = sum(wk, 5);
    ok(head(s2) === 'I dag og i morgen i korte træk' && head(s5) === 'De næste 5 døgn i korte træk', 'overskrifter pr. periode');
    ok(bul(s2)[0].startsWith('Billigste dag: i dag (') && bul(s2)[1].startsWith('Dyreste dag: i morgen (') && bul(s2).at(-1) === 'Sikkerhed: begge dage er sikre.', '2 døgn: i dag / i morgen og "begge dage er sikre"', bul(s2).join(' | '));
    ok(bul(s5).at(-1) === 'Sikkerhed: de næste to dage er sikre. Fra og med lørdag er prognosen mere usikker.', '5 døgn nævner ikke "mest usikker"', bul(s5).at(-1));
    // hver dag / hverdage
    const flat13 = Array.from({ length: 7 }, (_, i) => mk(nextDate(i), hh => +((hh === 13 ? 0.5 : 1.5) + i * 0.1).toFixed(4)));
    ok(bul(sum(flat13, 7))[2] === 'Bedste tid at bruge strøm: hver dag kl. 13–14, hvor prisen oftest er lavest.', '"hver dag" når alle dage har samme billigste time');
    ok(bul(sum(flat13.slice(0, 5), 5))[2].includes('hver dag kl. 13–14'), 'fem dage, samme time hver dag');
    const wkdays = Array.from({ length: 7 }, (_, i) => mk(nextDate(i), hh => +(((i === 3 || i === 4) ? hh === 3 : hh === 13) ? 0.5 : 1.5).toFixed(4) + i * 0.01));
    ok(/de fleste dage kl\. 13–14/.test(bul(sum(Array.from({ length: 7 }, (_, i) => mk(nextDate(i), hh => (hh === (i === 4 ? 3 : 13) ? 0.5 : 1.5) + i * 0.01)), 7))[2]), '"de fleste dage" når ≥ 60 % har tiden men også en weekenddag er med');
    // the 60 % line: 2 of 5 days (40 %) is not enough, 3 of 5 (60 %) is
    const dip = n => Array.from({ length: 5 }, (_, i) => mk(nextDate(i), hh => (hh === (i < n ? 13 : 3 + i) ? 0.5 : 1.5) + i * 0.001));
    ok(/^Bedste tid at bruge strøm: lavest /.test(bul(sum(dip(2), 5)).find(x => /^Bedste/.test(x))) && /^Bedste tid at bruge strøm: (hverdage|de fleste dage) kl\. 13–14/.test(bul(sum(dip(3), 5)).find(x => /^Bedste/.test(x))), '60 %-grænsen: 2 af 5 dage er for lidt, 3 af 5 er nok');
    // under 60 %: the cheapest window of the whole period, with its day
    const spread = Array.from({ length: 5 }, (_, i) => mk(nextDate(i), hh => +((hh === 2 + i * 4 ? 0.4 + i * 0.01 : 1.5)).toFixed(4)));
    ok(bul(sum(spread, 5)).find(x => /^Bedste/.test(x)) === 'Bedste tid at bruge strøm: lavest i dag kl. 02–03 (0,40 kr/kWh).', 'spredt billigste time: perioden samlet billigste vindue med dag', bul(sum(spread, 5)).join(' | '));
    // tie on average goes to the earlier day
    const tie = [mk(nextDate(0), () => 1), mk(nextDate(1), () => 2), mk(nextDate(2), () => 1), mk(nextDate(3), () => 2)];
    const bt = bul(sum(tie, 5));
    ok(bt[0].startsWith('Billigste dag: i dag (') && bt[1].startsWith('Dyreste dag: i morgen ('), 'lige dagsgennemsnit: den tidligste dag vinder', bt.join(' | '));
    // flat: identical days and one day only
    const flat = sum(Array.from({ length: 4 }, (_, i) => mk(nextDate(i), () => 1.5)), 5);
    ok(bul(flat)[0] === 'Prisniveau: næsten ens alle dage (1,50–1,50 kr/kWh)' && !/Billigste/.test(flat), 'helt ens dage: ét punkt "Prisniveau" i stedet for billigste/dyreste', bul(flat)[0]);
    const one = sum([mk(D0, () => 1, 'actual')], 7);
    ok(bul(one)[0] === 'Prisniveau: i dag (1,00–1,00 kr/kWh)' && !/Sikkerhed/.test(one) && !/NaN|undefined/.test(one), 'ét døgn: kun det der findes, ingen sikkerhedslinje');
    // negative prices are said plainly
    const neg = sum([mk(nextDate(0), hh => hh < 6 ? -0.2 : 1), mk(nextDate(1), () => -0.3), mk(nextDate(2), () => 1.2)], 5);
    ok(bul(neg)[0] === 'Billigste dag: i morgen (negative priser hele dagen)' && bul(neg).join().includes('negative priser') && !/-0,|–-/.test(neg), 'negative priser siges rent ud, ikke som et forkert interval', bul(neg).join(' | '));
    const part = sum([mk(nextDate(0), hh => hh < 6 ? -0.2 : 1), mk(nextDate(1), () => 5)], 2);
    ok(/^Billigste dag: i dag \(negative priser i nogle timer, op til 1,00 kr\/kWh\)/.test(bul(part)[0]), 'delvis negative priser', bul(part).join(' | '));
    // already-published tomorrow: the uncertain stretch starts later (same rule as the column plus types)
    const real4 = wk.map((d, i) => ({ ...d, type: i < 4 ? 'actual' : 'forecast' }));
    ok(bul(sum(real4, 7)).at(-1).startsWith('Sikkerhed: de næste tre dage er sikre. Fra og med søndag er prognosen mere usikker'), 'faktiske priser flytter usikkerheden senere', bul(sum(real4, 7)).at(-1));
    // short feed (hole), holes in a day, empty
    const short = sum(wk.slice(0, 3), 7);
    ok(!/NaN|undefined|Infinity/.test(short) && bul(short).at(-1) === 'Sikkerhed: alle viste dage er sikre.' && head(short) === 'Ugen i korte træk', 'kort feed: kun det der findes, alle viste dage er sikre', bul(short).join(' | '));
    const holes = sum([mk(nextDate(0), hh => hh < 12 ? null : 1), mk(nextDate(1), hh => hh % 2 ? null : 2)], 2);
    ok(!/NaN|undefined|null/.test(holes) && bul(holes).length >= 3, 'timer uden pris springes over');
    ok(sum([], 7) === '' && sum([mk(nextDate(0), () => null)], 7) === '' && sum([mk(nextDate(2), () => 1)], 7) === '', 'tomt eller uden priser: intet kort');
    // only the configuration that asks for it draws it; the zone screen never does
    ok(sum(wk, 7, STD) === '' && !/pris-sum/.test(pris(feed, D0, 21, o)) && /pris-sum/.test(f7), 'PRIS_STD tegner intet resumé; PRIS_FC gør');
    ok((f7.match(/<section class="pris-days pris-sum pp\d"/g) || []).length === 3 && f7.indexOf('pris-sum') < f7.indexOf('class="pris-days"') && f7.indexOf('pris-sum pp7') > f7.indexOf('pris-tiles pp7'), 'tre resuméer (2/5/7) mellem kortene og "Dag for dag"');
    ok(!/10 (døgn|dage)|NaN|undefined/.test(f7) && [2, 5, 7].every(p => bul(sum(wk, p)).length >= 3 && bul(sum(wk, p)).length <= 5), '2/5/7 døgn: 3–5 punkter, ingen 10 dage/NaN');
  }

  // ── What the old curve's tests guarded, now for the screen ────────────────────────────────────────────────
  const flatAx = pctx.prisAxis([1, 1, 1], 1);
  ok(!/NaN|Infinity/.test(JSON.stringify(flatAx)) && flatAx.lo === 0 && flatAx.ticks.includes(0) && flatAx.hi >= 1, 'en flad kurve giver en nulbaseret akse uden NaN');
  ok(!/NaN|Infinity|undefined/.test(pris([dayOf(D0, T.map(() => 1), 'actual'), dayOf(nextDate(1), T.map(() => 1), 'actual')], D0, 5, o)), 'flad dag giver hverken NaN eller Infinity');
  let badAx = [];
  for (let k = 0; k < 400; k++) {
    const mx = +(Math.random() * 6 + 0.05).toFixed(3), mn = Math.random() < 0.3 ? -(Math.random() * 1.5) : 0;
    const a = pctx.prisAxis([mx, mn, mx / 2], 1);
    if (a.ticks.length < 2 || a.ticks.length > 12 || a.ticks.some(v => v < a.lo - 1e-9 || v > a.hi + 1e-9) || a.hi < mx || a.lo > mn || (mn >= 0 && a.lo !== 0)) badAx.push([mx, mn, a]);
  }
  ok(badAx.length === 0, 'aksen: 2 til 12 mærker, alle inden for aksen, nul med, og den højeste søjle ligger inden for den', JSON.stringify(badAx.slice(0, 2)));
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
