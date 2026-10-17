#!/usr/bin/env node
/**
 * The homepage curve: "nu og 2 døgn frem".
 * Run: npm run test:forecast   (offline, no server)
 *
 * fcChartHTML is drawn by the server so a crawler gets the numbers, and
 * redrawn by the client when the visitor switches DK1/DK2. Neither runtime can
 * import from the other, so the function exists verbatim in both files — and
 * the first thing this file checks is that the two copies are still byte for
 * byte the same. That is the whole reason the duplication is tolerable.
 *
 * Worth testing rather than eyeballing: the geometry divides by the price span,
 * which is zero on a flat stretch; the curve has to split exactly where settled
 * prices stop and forecast begins; the feed opens on YESTERDAY, so "I dag" is a
 * date match and not row 0; and the per-day figures must stay text, because
 * they are what the front page answers "elpriser prognose" with.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const ROUTES = fs.readFileSync(new URL('./functions/[[path]].js', import.meta.url), 'utf8');
const INDEX  = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const MARK = '// ═══ Forsidens kurve: nu og 2 døgn frem ═══';
const END  = '\n}\n';
const lift = (src, what) => {
  const a = src.indexOf(MARK);
  if (a < 0) throw new Error(`fcChartHTML not found in ${what}`);
  const b = src.indexOf('\nfunction fcChartHTML', a);
  // The body is indented, so the first brace at column 0 closes the function.
  // Keying this off the text of the return line broke silently when that line
  // changed: both copies came back EMPTY, and "the two copies are identical"
  // passed because two empty strings are.
  const c = b < 0 ? -1 : src.indexOf('\n}', b + 1);
  if (c < 0) throw new Error(`end of fcChartHTML not found in ${what}`);
  return src.slice(a, c + 2);
};
const serverCopy = lift(ROUTES, 'functions/[[path]].js');
const clientCopy = lift(INDEX, 'index.html');

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── The two copies must not drift ──────────────────────────────────────────
ok(serverCopy === clientCopy,
   'server- og klientudgaven af fcChartHTML er tegn for tegn ens',
   serverCopy === clientCopy ? '' : `${serverCopy.length} vs ${clientCopy.length} tegn`);
ok(serverCopy.length > 2000, 'fcChartHTML blev faktisk hentet ud', `${serverCopy.length} tegn`);

const ctx = { console, Intl, Date, Math };
vm.createContext(ctx);
vm.runInContext(serverCopy + '\nglobalThis.chart = fcChartHTML; globalThis.ticks = fcTicks; globalThis.week = fcWeekHTML;', ctx);
const chart = ctx.chart, week = ctx.week, ticks = (a, b) => [...ctx.ticks(a, b)];

const day = (date, lo, hi, type = 'forecast') => ({
  date, type,
  prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: h === 0 ? lo : h === 1 ? hi : (lo + hi) / 2 })),
});
const TODAY = '2026-09-27';
const span = (n, los, his, types = []) => ({
  days: Array.from({ length: n }, (_, i) => day(
    new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10),
    los[i], his[i], types[i] || 'forecast')),
});

// ── A normal window: today settled, three days of forecast ────────────────
{
  const f = span(6, [0.15, 0.96, 0.59, 0.71, 0.13, 0.42],
                    [1.86, 2.49, 2.03, 1.74, 0.86, 1.71], ['actual']);
  const h = chart(f.days, TODAY, 11);
  ok(/<svg id="fcCurve"/.test(h), 'der tegnes en svg');
  ok((h.match(/<div class="mini[ "]/g) || []).length === 3, 'tre døgn: i dag og to frem', h.slice(-300));
  ok(/>I dag · Børspris</.test(h), 'i dag mærkes som afregnet børspris');
  ok(/>I morgen · Prognose</.test(h), 'i morgen mærkes som prognose');
  ok(/<div class="fc-days[ "]/.test(h), 'dagnavnene ligger i HTML, ikke i den strakte svg');
  ok(/<span>I dag<small>27\. sep<\/small><\/span>/.test(h), 'første etiket er "I dag" med dato');
  ok(!/<text[^>]*>I dag</.test(h), 'dagnavnene står ikke længere inde i svg\'en');
  ok(/>0,15–1,86</.test(h), 'dagens spænd står som tekst med komma');
  ok(/aria-label="Elpris time for time i dag og 2 døgn frem"/.test(h), 'svg har en læsbar beskrivelse');

  // The split: solid up to the last settled hour, dashed after it.
  const solid = h.match(/<polyline points="([^"]+)" fill="none" stroke="url\(#fcg\)" stroke-width="3\.2"/);
  const dash  = h.match(/<polyline points="([^"]+)"[^>]*stroke-dasharray="5 4"/);
  ok(solid && dash, 'kurven er delt i en afregnet og en prognosticeret del');
  ok(solid[1].split(' ').length === 24, 'den fuldt optrukne del dækker netop det afregnede døgn',
     `${solid && solid[1].split(' ').length}`);
  // They must share the boundary point, or the line breaks visibly.
  ok(solid[1].split(' ').pop() === dash[1].split(' ')[0],
     'de to dele mødes i samme punkt');
  ok(!/<rect[^>]*fill-opacity/.test(h), 'der tegnes intet bånd bag prognosen');
  // Six-hour marks: 00 06 12 18 for each of the three days.
  const hrs = [...h.matchAll(/<span(?: class="first")? style="left:([\d.]+)%">(\d\d)<\/span>/g)];
  ok(hrs.length === 12, 'tolv 6-timers etiketter på tre døgn', `${hrs.length}`);
  ok(hrs.map(m => m[2]).join(' ') === '00 06 12 18 00 06 12 18 00 06 12 18',
     'etiketterne går 00 06 12 18 hvert døgn', hrs.map(m => m[2]).join(' '));
  const lefts = hrs.map(m => +m[1]);
  ok(lefts[0] === 0 && lefts.every((x, i) => i === 0 || x > lefts[i - 1]) && lefts.at(-1) < 100,
     'etiketterne står i stigende rækkefølge inden for grafen', lefts.join(','));
  // Hour 6 of 72 sits at 6/71 of the width, exactly where the svg draws it.
  ok(Math.abs(lefts[1] - 6 / 71 * 100) < 0.01, 'etiket 06 står ud for sin gitterlinje', `${lefts[1]}`);
  ok((h.match(/stroke-opacity="\.06" stroke-dasharray="2 4"/g) || []).length === 9,
     'ni svage 6-timers linjer (midnat har sin egen)');
  ok(!/<text[^>]*>\d\d</.test(h), 'timetallene står ikke inde i den strakte svg');
  // The curve is two polylines sharing one gradient. Left to default to
  // objectBoundingBox, each stretches the whole window's ramp across its own
  // width and today gets painted in tomorrow's colours — cheap hours came out
  // red. The offsets must be pinned to the viewBox.
  ok(/id="fcg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="720"/.test(h),
     'prisgradienten er bundet til viewBox, ikke til hver enkelt polylines bbox',
     (h.match(/<linearGradient id="fcg"[^>]*>/) || [''])[0]);
  // And the cheapest hour in the window must actually be the green end.
  ok(/<stop offset="[^"]*" stop-color="#34c759"\/>/.test(h), 'billigste timer er grønne');
  ok(/<stop offset="[^"]*" stop-color="#ff3b30"\/>/.test(h), 'dyreste timer er røde');
  ok(/<circle[^>]*fill="#1b57f5"/.test(h), '"nu" markeres på kurven');

  const geo = [...h.matchAll(/(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g)].map(m => [+m[1], +m[2]]);
  ok(geo.every(([x, y]) => x >= 0 && x <= 720 && y >= -1 && y <= 232),
     'ingen punkter uden for tegnefladen');
}

// ── Two settled days: the split moves ─────────────────────────────────────
{
  const f = span(5, [0.2, 0.3, 0.4, 0.5, 0.6], [1.2, 1.3, 1.4, 1.5, 1.6], ['actual', 'actual']);
  const h = chart(f.days, TODAY, 11);
  const solid = h.match(/<polyline points="([^"]+)" fill="none" stroke="url\(#fcg\)" stroke-width="3\.2"/);
  ok(solid[1].split(' ').length === 48, 'to afregnede døgn giver 48 optrukne timer',
     `${solid[1].split(' ').length}`);
  ok((h.match(/· Børspris/g) || []).length === 2, 'to døgn mærkes som børspris');
}

// ── Nothing settled yet ───────────────────────────────────────────────────
{
  const f = span(4, [0.2, 0.3, 0.4, 0.5], [1.2, 1.3, 1.4, 1.5]);
  const h = chart(f.days, TODAY, 11);
  ok(!/stroke-width="3\.2"/.test(h), 'uden afregnede timer tegnes intet fuldt optrukket');
  ok(/stroke-dasharray="5 4"/.test(h), 'hele kurven er stiplet');
  ok(!/<circle[^>]*fill="#1b57f5"/.test(h), '"nu" markeres ikke på en ren prognose');
}

// ── A flat stretch: the span is zero ──────────────────────────────────────
{
  const f = span(4, [1, 1, 1, 1], [1, 1, 1, 1], ['actual']);
  const h = chart(f.days, TODAY, 11);
  ok(!/NaN|Infinity/.test(h), 'flad kurve giver hverken NaN eller Infinity', h.slice(0, 200));
  ok(/>1,00–1,00</.test(h), 'flad dag vises stadig med tal');
}

// ── The feed opens on yesterday ───────────────────────────────────────────
{
  const f = { days: [day('2026-09-26', 0.1, 1.1, 'actual'), ...span(4, [0.2, 0.3, 0.4, 0.5], [1.2, 1.3, 1.4, 1.5], ['actual']).days] };
  const h = chart(f.days, TODAY, 11);
  ok(/>I dag[^<]*<\/div><div class="v">0,20–1,20</.test(h),
     '"I dag" er datomatchet, ikke blot den første række i feedet', h.slice(-400));
  ok(!/25\. sep|26\. sep/.test(h), 'gårsdagen er ikke med', h.slice(-400));
}

// ── Not enough to draw ────────────────────────────────────────────────────
{
  ok(chart([], TODAY, 11) === '', 'tomt feed giver tom streng');
  ok(chart(span(1, [0.5], [1.5]).days, TODAY, 11) === '', 'ét døgn alene er ikke en kurve');
  const holed = span(3, [0.5, 0.7, 0.9], [1.5, 1.7, 1.9], ['actual']);
  holed.days[1].prices = holed.days[1].prices.map(p => ({ ...p, price: null }));
  // Splicing day 1 and day 3 together would draw a jump that never happened
  // and label day 3 "I morgen", so a hole ends the window rather than closing.
  ok(chart(holed.days, TODAY, 11) === '',
     'et hul i feedet afkorter vinduet i stedet for at lime døgn sammen',
     chart(holed.days, TODAY, 11).slice(-200));
  const late = span(5, [0.5, 0.7, 0.9, 1.1, 1.3], [1.5, 1.7, 1.9, 2.1, 2.3], ['actual']);
  late.days[2].prices = late.days[3].prices.map(p => ({ ...p, price: null }));
  ok((chart(late.days, TODAY, 11).match(/<div class="mini[ "]/g) || []).length === 2,
     'et hul på tredjedagen afkorter vinduet til to døgn');
}

// ── The cheapest day is marked, exactly once ──────────────────────────────
{
  const f = span(4, [0.9, 0.8, 0.12, 0.7], [1.9, 1.8, 1.2, 1.7], ['actual']);
  const h = chart(f.days, TODAY, 11);
  ok((h.match(/class="mini best"/g) || []).length === 1, 'præcis ét døgn markeres som billigst');
  ok(/class="mini best"[\s\S]{0,140}0,12/.test(h), 'markeringen sidder på det billigste døgn', h.slice(-400));
}

// ── The price scale ───────────────────────────────────────────────────────
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(ticks(0.15, 3.35), [1, 2, 3]), 'skala 0,15–3,35 giver 1 2 3', JSON.stringify(ticks(0.15, 3.35)));
  ok(eq(ticks(0.15, 1.86), [0.5, 1, 1.5]), 'skala 0,15–1,86 giver 0,5 1 1,5', JSON.stringify(ticks(0.15, 1.86)));
  ok(ticks(-0.3, 0.8).includes(0), 'negative priser: skalaen går gennem 0', JSON.stringify(ticks(-0.3, 0.8)));
  ok(eq(ticks(1, 1), [1]), 'flad kurve: ét mærke, ingen division med nul');
  let bad = [];
  for (let k = 0; k < 400; k++) {
    const lo = +(Math.random() * 4 - 1).toFixed(3), hi = +(lo + 0.05 + Math.random() * 5).toFixed(3);
    const t = ticks(lo, hi);
    if (t.length < 2 || t.length > 6 || t.some(v => v < lo - 1e-9 || v > hi + 1e-9)) bad.push([lo, hi, t]);
  }
  ok(bad.length === 0, 'mellem to og seks mærker, alle inden for kurvens spænd', JSON.stringify(bad.slice(0, 3)));

  const f = span(3, [0.15, 1.40, 1.02], [1.86, 3.35, 2.48], ['actual', 'actual']);
  const h = chart(f.days, TODAY, 11);
  const grid = [...h.matchAll(/<line x1="0" y1="([\d.]+)" x2="720" y2="[\d.]+" stroke="currentColor" stroke-opacity="\.07"\/>/g)].map(m => +m[1]);
  const labs = [...h.match(/<div class="yax">([\s\S]*?)<\/div>/)[1].matchAll(/top:([\d.]+)%">([^<]+)</g)];
  ok(grid.length >= 2 && grid.length === labs.length, 'én etiket pr. gitterlinje', `${grid.length} linjer, ${labs.length} etiketter`);
  ok(labs.every((m, i) => Math.abs(+m[1] - grid[i] / 190 * 100) < 0.01),
     'hver etiket står i samme højde som sin linje', JSON.stringify(labs.map(m => m[1])));
  ok(labs.every(m => /^-?\d+,\d\d$/.test(m[2])), 'etiketterne har komma og to decimaler', labs.map(m => m[2]).join(' '));
  ok(/<div class="yplot"><svg id="fcCurve"/.test(h), 'kurven ligger i en ramme med skalaen ved siden af');
  ok(/<div class="fc-hours ygut">/.test(h) && /<div class="fc-days ygut">/.test(h),
     'time- og dagrækken rykker ind sammen med kurven, så de stadig flugter');
}

// ── The week as text (fcWeekHTML, /prognose) ──────────────────────────────
{
  const f = span(9, [0.15, 1.40, 1.02, 0.71, 0.13, 0.42, 0.38, 0.5, 0.6], [1.86, 3.35, 2.48, 1.74, 0.86, 1.71, 1.66, 1.9, 2.0], ['actual', 'actual']);
  // put the cheapest hour of day 0 somewhere other than hour 0 so the column is tested
  f.days[0].prices = f.days[0].prices.map(p => ({ ...p, price: p.hour === 14 ? 0.15 : 1 + p.hour / 100 }));
  const h = week(f.days, TODAY, 7);
  const rows = h.split('<tr><th scope="row">').slice(1);
  ok(rows.length === 7, 'syv rækker, ikke ti', `${rows.length}`);
  ok(/^I dag<small>27\. sep<\/small>/.test(rows[0]) && /^I morgen<small>28\. sep<\/small>/.test(rows[1]), 'i dag og i morgen, med dato');
  ok(/^Tirsdag<small>29\. sep/.test(rows[2]), 'tredje dag får ugedag');
  ok(/<td>0,15–1,23<\/td><td>kl\. 14–15<\/td>/.test(rows[0]), 'spænd og billigste time står som tekst', rows[0]);
  ok(/class="real">Børspris/.test(rows[1]) && /class="fc">Prognose/.test(rows[2]), 'børspris og prognose er mærket');
  ok(/<th scope="col">Billigst<\/th>/.test(h) && /<th scope="col">Spænd<\/th>/.test(h), 'kolonnerne har overskrifter');
  ok(!/<th scope="row">[^<]*<small>[^<]*<\/small><\/th><td>[^<]*NaN/.test(h) && !/NaN|Infinity/.test(h), 'ingen NaN');

  // The feed opens on yesterday: "I dag" is a date, not row 0.
  const y = { days: [day('2026-09-26', 0.1, 1.1, 'actual'), ...span(3, [0.2, 0.3, 0.4], [1.2, 1.3, 1.4], ['actual']).days] };
  const hy = week(y.days, TODAY, 7);
  ok(/^I dag<small>27\. sep/.test(hy.split('<tr><th scope="row">')[1]) && !/26\. sep/.test(hy), 'gårsdagen er ikke med');

  // A hole ends the list rather than closing up.
  const holed = span(5, [0.5, 0.7, 0.9, 1.1, 1.3], [1.5, 1.7, 1.9, 2.1, 2.3], ['actual']);
  holed.days[2].prices = holed.days[2].prices.map(p => ({ ...p, price: null }));
  ok((week(holed.days, TODAY, 7).match(/<tr><th scope="row">/g) || []).length === 2, 'et hul afkorter listen i stedet for at lime døgn sammen');
  ok(week([], TODAY, 7) === '' && week(span(1, [0.5], [1.5]).days, TODAY, 7) === '', 'tomt eller ét døgn giver ingenting');
  ok((week(f.days, TODAY, 3).match(/<tr><th scope="row">/g) || []).length === 3, 'antallet af dage kan begrænses');
  const neg = span(3, [-0.004, 0.3, 0.4], [1, 1, 1], ['actual']);
  ok(/<td>0,00–1,00<\/td>/.test(week(neg.days, TODAY, 7)) && !/-0,00/.test(week(neg.days, TODAY, 7)), 'et beløb der runder til nul vises uden minus');
}

// ── The Pris screen (prisHTML): Design A ───────────────────────────────────
// Like fcChartHTML it exists verbatim in index.html and functions/[[path]].js.
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
  vm.runInContext(ps + '\nglobalThis.pris = prisHTML; globalThis.parts = prisParts; globalThis.panel = prisPanel; globalThis.days = prisDays;', pctx);
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
  ok((two.match(/<span class="pc[ "]/g) || []).length === 48, 'to døgn er 48 søjler');
  ok((two.match(/class="pc past"/g) || []).length === 21, 'de 21 timer der er gået er dæmpet');
  ok((two.match(/<b class="pd"/g) || []).length === 1, 'én prik over den nuværende time');
  ok(/data-tip="I dag kl\. 19 · 3,90 kr\/kWh"/.test(two) && /data-tip="I morgen kl\. 13 · 1,38 kr\/kWh"/.test(two), 'den præcise pris står i tip-teksten');
  ok(/<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d<\/span>){4}<\/div>/.test(two), 'y-aksen er 0 1 2 3 4', text(/class="pris-yl">([\s\S]*?)<\/div>/));
  ok(/class="pris-unit">kr\/kWh</.test(two), 'enhedsmærket kr/kWh står over aksen');
  ok(/>I dag 00<\/span>/.test(two) && />I morgen 00<\/span>/.test(two) && />12<\/span>/.test(two), 'x-aksen: I dag 00, 06 12 18, I morgen 00');
  // The tallest bar (3,90 on an axis to 4,5) is 86,7 % high — never touching the top.
  ok(/height:86\.7%/.test(two), 'aksen når 4,5, så den højeste søjle er 86,7 %');
  // Tiers by the same verdict the apps use: the current bar is the pill's colour.
  const nowCol = two.match(/<span class="pc"[^>]*><i class="pb t(\d)"[^>]*><\/i><b class="pd"/);
  ok(nowCol && nowCol[1] === '2', 'den nuværende søjle har pillens farve', nowCol && nowCol[1]);
  // 5 døgn: today from 00:00 plus four more calendar days, 120 bars (14.-18. okt in this feed).
  const five = h.slice(h.indexOf('pris-card pp5'), h.indexOf('pris-tiles pp2'));
  ok((five.match(/<span class="pc[ "]/g) || []).length === 120, '5 døgn er fem døgn, 120 søjler');
  ok((five.match(/class="pc past"/g) || []).length === 21 && (five.match(/<b class="pd"/g) || []).length === 1, 'de 21 timer der er gået er dæmpet, og der er én prik');
  ok(/data-tip="I dag kl\. 19 · 3,90 kr\/kWh"/.test(five) && /data-tip="I morgen kl\. 13 · 1,38 kr\/kWh"/.test(five), 'tip for i dag og i morgen i 5 døgn');
  ok(/data-tip="fre 16\. okt kl\. 13 · \d,\d\d kr\/kWh"/.test(five) && /data-tip="søn 18\. okt kl\. 04 · /.test(five), 'tip for senere dage har ugedag og dato');
  ok(!/data-tip="fre 23\. okt/.test(five) && !/data-tip="[^"]*(man|tir) 19\. okt/.test(five), 'dag seks og frem er ikke med i 5 døgn');
  const xd = [...five.matchAll(/<span class="xd" style="left:([\d.]+)%">([^<]+)<\/span>/g)];
  ok(xd.map(m => m[2]).join('|') === 'ons 14|tor 15|fre 16|lør 17|søn 18', 'x-aksen har ét dagsmærke pr. døgn', xd.map(m => m[2]).join('|'));
  ok(xd.map(m => m[1]).join('|') === '10.00|30.00|50.00|70.00|90.00', 'dagsmærkerne står midt under hvert døgns 24 søjler', xd.map(m => m[1]).join('|'));
  ok((five.match(/class="pris-sep"/g) || []).length === 4, 'en skillelinje ved hver midnat');
  // The feed has two settled days (14. and 15.), so the forecast starts at bar 48 = 40 %.
  ok(/<span class="pris-fc mid" style="left:40\.00%"><i><\/i>Prognose<\/span>/.test(five), 'Prognose-skillelinjen står hvor prognosen begynder (40 %)');
  const feedLate = feed.map((d, i) => i === 1 ? { ...d, type: 'forecast' } : d);
  ok(/<span class="pris-fc mid" style="left:20\.00%">/.test(pris(feedLate, D0, 21, o)), 'er i morgen prognose, flytter skillelinjen til 20 %');
  ok(/<span class="pris-fc mid" style="left:60\.00%">/.test(pris(feed.map((d, i) => i === 2 ? { ...d, type: 'actual' } : d), D0, 21, o)), 'er dagen efter i morgen børspris, flytter den til 60 %');
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
  ok((one.slice(one.indexOf('pris-card pp2'), one.indexOf('pris-card pp5')).match(/data-tip=/g) || []).length === 24 && !/i morgen/.test(one.replace(/Næste 2 døgn/g, '')),
     'uden i morgen tegnes kun i dag');
  // Spotpris and no net: the captions.
  ok(/Spotpris inkl\. moms/.test(pris(feed, D0, 21, { ...o, view: 'spot' })), 'billedtekst for spotpris');
  ok(/Inkl\. Energinets tariffer, afgifter og moms/.test(pris(feed, D0, 21, { ...o, net: null })), 'billedtekst uden net');
  ok(/data-period="5"/.test(pris(feed, D0, 21, { ...o, period: 5 })) && /aria-selected="true" data-pris-period="5">5 døgn</.test(pris(feed, D0, 21, { ...o, period: 5 })), 'perioden kan være 5 døgn');
  // No data at all: a screen with a dash, not a crash.
  const none = pris([], D0, 21, {});
  ok(/class="pris-now">—</.test(none) && !/NaN|undefined|Infinity/.test(none) && !/pris-pill/.test(none), 'uden data: tankestreg og ingen pille');
  // Negative prices: bars below zero, a zero-line on the axis, never NaN.
  const neg = pris([dayOf(D0, T.map((v, i) => i === 3 ? -0.8 : v), 'actual'), dayOf(nextDate(1), M, 'actual')], D0, 21, o);
  ok(!/NaN|Infinity/.test(neg) && /<span style="top:[\d.]+%">-1<\/span>/.test(neg), 'negative priser giver en akse under nul');
  ok(!/-0,00/.test(pris([dayOf(D0, T.map(() => -0.004), 'actual')], D0, 5, o)), 'et beløb der runder til nul vises uden minus');
  ok(/aria-label="Elpris lige nu — DK1 Vest · N1"/.test(h) && /role="img" tabindex="0" aria-label="Elpris time for time næste 2 døgn: billigst 1,30 kr\/kWh kl\. 04, dyrest 3,90 kr\/kWh kl\. 19\./.test(h), 'grafen har en tekstlig beskrivelse');
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
  const L = pctx.PRIS_I18N, langs = ['da', 'nb', 'sv', 'fi'];
  ok(Object.keys(L).join() === langs.join(), 'PRIS_I18N har præcis da, nb, sv og fi', Object.keys(L).join());
  // Every key in every language, with the same shape and no empty text.
  const shape = v => Array.isArray(v) ? `array${v.length}` : typeof v;
  const keys = Object.keys(L.da);
  for (const lang of langs) {
    const have = Object.keys(L[lang]);
    ok(have.length === keys.length && keys.every(k => k in L[lang]), `${lang}: samme nøgler som dansk`, keys.filter(k => !(k in L[lang])).concat(have.filter(k => !keys.includes(k))).join(','));
    ok(keys.every(k => shape(L[lang][k]) === shape(L.da[k])), `${lang}: samme form på hver nøgle`, keys.filter(k => shape(L[lang][k]) !== shape(L.da[k])).join(','));
    const flat = keys.flatMap(k => [].concat(L[lang][k]));
    ok(flat.every(x => typeof x === 'string') && flat.filter(x => x === '').length === (lang === 'sv' ? 1 : 0), `${lang}: ingen tom tekst (kun svensk '' = ingen punktum efter dagstal)`);
    ok(L[lang].wd.length === 7 && L[lang].ws.length === 7 && L[lang].mon.length === 12 && L[lang].verdict.length === 3 && L[lang].tier.length === 3, `${lang}: 7 ugedage, 12 måneder, 3 niveauer`);
  }
  ok(langs.every(l => !/\b10\b/.test(JSON.stringify(L[l]))), 'ingen sprog nævner 10 døgn');
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
    ok((e.match(/<span class="pc[ "]/g) || []).length === 48 + 120 && !/NaN|undefined|Infinity/.test(e), `${zone}: 48 + 120 søjler, ingen NaN`);
    ok(/data-tip="[^"]*\d (öre|øre|snt)\/kWh"/.test(e) && !/data-tip="[^"]*,\d\d\d /.test(e), `${zone}: tooltip i zonens enhed`);
  }
  // Decimals and axis follow the unit: øre at 300 are whole numbers, snt at 5 keep two decimals; the axis grain scales.
  const big = pris(pctx.zoneToPrisDays({ zone: 'no1', days: [dayOf(D0, T, 'actual'), dayOf(nextDate(1), M, 'actual')].map(d => ({ ...d, prices: d.prices.map(p => ({ hour: p.hour, eur_mwh: p.price * 100 })) })) }, { rate: 10 }, D0), D0, 21, { zone: 'no1', key: 'no1' });
  ok(/class="pris-now">267</.test(big) && /<div class="pris-yl"><span style="top:[\d.]+%">0<\/span>(<span[^>]*>\d+<\/span>)+<\/div>/.test(big) && [...big.matchAll(/class="pris-yl">([\s\S]*?)<\/div>/g)][0][1].includes('>400<'), 'NO: 267 øre uden decimal, aksen i trin af 100 op til 400', text(/class="pris-yl">([\s\S]*?)<\/div>/));
  const cheap = pris(pctx.zoneToPrisDays({ zone: 'fi', days: [dayOf(D0, T, 'actual'), dayOf(nextDate(1), M, 'actual')].map(d => ({ ...d, prices: d.prices.map(p => ({ hour: p.hour, eur_mwh: p.price * 3 })) })) }, { rate: 1 }, D0), D0, 21, { zone: 'fi', key: 'fi' });
  ok(/class="pris-now">0,80</.test(cheap) && /class="pris-u">snt\/kWh</.test(cheap), 'FI: 8 EUR/MWh er 0,80 snt med to decimaler');
  // The Danish screen is untouched by all of this: the same call with no zone is the Danish output, byte for byte.
  ok(pris(feed, D0, 21, o) === pris(feed, D0, 21, { ...o, zone: undefined }) && /Din pris/.test(pris(feed, D0, 21, o)), 'uden zone er skærmen den danske');
  // The country pages' pieces.
  const tabs = pctx.prisZoneTabs('no/strompris', 'no2');
  ok((tabs.match(/role="tab"/g) || []).length === 5 && /href="#no2" data-zone="no2" aria-selected="true" tabindex="0">NO2<small>Kristiansand<\/small>/.test(tabs) && (tabs.match(/tabindex="-1"/g) || []).length === 4 && /role="tablist" aria-label="Prisområde"/.test(tabs), 'zone-fanerne: tablist, valgt fane har tabindex 0 og by');
  ok(pctx.prisZoneTabs('fi/sahkon-hinta', 'fi') === '' && /aria-label="Elområde"/.test(pctx.prisZoneTabs('sv/elpris', 'se3')), 'Finland har ingen faner; Sverige siger Elområde');
  ok(pctx.prisHref('no5') === '/no/strompris#no5' && pctx.prisHref('fi') === '/fi/sahkon-hinta' && pctx.prisHref('dk2') === '/dk2' && pctx.prisHref('nl') === '', 'prisHref: landesidens anker, Finland uden, DK, NL ingen');
  ok(pctx.PRIS_COUNTRIES['no/strompris'].def === 'no1' && pctx.PRIS_COUNTRIES['sv/elpris'].def === 'se3' && pctx.PRIS_COUNTRIES['no/strompris'].zones.every(k => pctx.ZONES[k].lang === 'nb'), 'landenes startzone og sprog');
  ok(Object.values(pctx.ZONES).every(z => z.name && z.city && z.cur && z.rate > 0 && z.sub) && Object.keys(pctx.ZONES).length === 13, 'ZONES: 13 områder med navn, by, valuta, kurs og enhed');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
