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

// ── Zone options: labels, dates, unit and decimals from the zone's locale ──
{
  const f = span(3, [40, 60, 30], [120, 180, 90], ['actual', 'actual']);
  const h = chart(f.days, TODAY, 11, {
    today: 'I dag', tomorrow: null, wd: dt => ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'][dt.getUTCDay()].replace('Mandag', 'Mandag'),
    dm: dt => `${dt.getUTCDate()}. sep.`, actual: 'Faktisk', forecast: 'Prognose', unit: 'øre/kWh', dec: 0, aria: 'Neste 3 døgn · øre/kWh' });
  ok(/>40–120</.test(h) && />60–180</.test(h), 'øre vises uden decimaler', h.slice(-500));
  ok(/· øre\/kWh</.test(h) && !/kr\/kWh/.test(h), 'enheden følger zonen');
  ok(/>I dag · Faktisk</.test(h), 'zonens ord for afregnet pris bruges');
  ok(/>Mandag · Faktisk</.test(h) && !/I morgen/.test(h), 'dagen efter i dag navngives med ugedag, ikke et nyt ord');
  ok(/<small>28\. sep\.<\/small>/.test(h), 'datoformatet kommer fra zonen');
  ok(/aria-label="Neste 3 døgn · øre\/kWh"/.test(h), 'beskrivelsen er på zonens sprog');
  const labs = [...h.match(/<div class="yax">([\s\S]*?)<\/div>/)[1].matchAll(/>([^<]+)</g)].map(m => m[1]);
  ok(labs.every(x => /^-?\d+$/.test(x)), 'skalaen følger zonens decimaler', labs.join(' '));
}

// ── A price a fraction below zero is not printed as "-0" ──────────────────
{
  const f = span(3, [-0.3, 60, 30], [179, 180, 90], ['actual', 'actual']);
  const h = chart(f.days, TODAY, 11, { dec: 0, unit: 'øre/kWh', tomorrow: null });
  ok(/>0–179</.test(h) && !/-0[–<]/.test(h), 'et beløb der runder til nul vises uden minus', h.slice(-600));
  const g = span(3, [-2.4, 60, 30], [179, 180, 90], ['actual', 'actual']);
  ok(/>-2–179</.test(chart(g.days, TODAY, 11, { dec: 0 })), 'rigtige negative priser beholder fortegnet');
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
  vm.runInContext(ps + '\nglobalThis.pris = prisHTML;', pctx);
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
  ok(/<section class="pris-card pp2" aria-label="Næste 2 døgn">/.test(h) && /<p class="pris-ct">Næste 2 døgn<\/p>/.test(h) && /<p class="pris-ct">Døgn 3–10<\/p>/.test(h), 'korttitlerne er Næste 2 døgn og Døgn 3–10');
  ok(/role="tablist" aria-label="Periode"/.test(h) && (h.match(/role="tab"/g) || []).length === 2 && />2 døgn</.test(h) && />3–10 døgn</.test(h), 'periodepillen er en tablist med 2 døgn og 3–10 døgn');
  const two = h.slice(h.indexOf('pris-card pp2'), h.indexOf('pris-card pp10'));
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
  const ten = h.slice(h.indexOf('pris-card pp10'));
  ok((ten.match(/<span class="pc[ "]/g) || []).length === 192, 'døgn 3–10 er otte døgn, 192 søjler');
  ok(/data-tip="fre 16\. okt kl\. 13 · \d,\d\d kr\/kWh"/.test(ten), 'tip for døgn 3–10 har ugedag og dato');
  ok(/<span class="xd"[^>]*>fre 16<\/span>/.test(ten) && /<span class="xd"[^>]*>fre 23<\/span>/.test(ten), 'x-aksen har dagetiketter');
  ok(/<span class="pris-fc"[^>]*><i><\/i>Prognose<\/span>/.test(ten), 'prognosedage er mærket');
  // The day list: text, one row per day, settled or forecast.
  ok((h.match(/<tr class="r\d+"><th scope="row">/g) || []).length === 10, 'ti dage i dagslisten');
  ok(/<tr class="r2"><th scope="row">I dag<small>14\. okt<\/small><\/th><td>1,30–3,90<\/td><td>kl\. 04–05<\/td><td class="real">Børspris/.test(h), 'dagens spænd og billigste time står som tekst');

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
  ok((one.slice(one.indexOf('pris-card pp2'), one.indexOf('pris-card pp10')).match(/data-tip=/g) || []).length === 24 && !/i morgen/.test(one.replace(/Næste 2 døgn/g, '')),
     'uden i morgen tegnes kun i dag');
  // Spotpris and no net: the captions.
  ok(/Spotpris inkl\. moms/.test(pris(feed, D0, 21, { ...o, view: 'spot' })), 'billedtekst for spotpris');
  ok(/Inkl\. Energinets tariffer, afgifter og moms/.test(pris(feed, D0, 21, { ...o, net: null })), 'billedtekst uden net');
  ok(/data-period="10"/.test(pris(feed, D0, 21, { ...o, period: 10 })) && /aria-selected="true" data-pris-period="10"/.test(pris(feed, D0, 21, { ...o, period: 10 })), 'perioden kan være 3–10 døgn');
  // No data at all: a screen with a dash, not a crash.
  const none = pris([], D0, 21, {});
  ok(/class="pris-now">—</.test(none) && !/NaN|undefined|Infinity/.test(none) && !/pris-pill/.test(none), 'uden data: tankestreg og ingen pille');
  // Negative prices: bars below zero, a zero-line on the axis, never NaN.
  const neg = pris([dayOf(D0, T.map((v, i) => i === 3 ? -0.8 : v), 'actual'), dayOf(nextDate(1), M, 'actual')], D0, 21, o);
  ok(!/NaN|Infinity/.test(neg) && /<span style="top:[\d.]+%">-1<\/span>/.test(neg), 'negative priser giver en akse under nul');
  ok(!/-0,00/.test(pris([dayOf(D0, T.map(() => -0.004), 'actual')], D0, 5, o)), 'et beløb der runder til nul vises uden minus');
  ok(/aria-label="Elpris lige nu — DK1 Vest · N1"/.test(h) && /role="img" tabindex="0" aria-label="Elpris time for time næste 2 døgn: billigst 1,30 kr\/kWh kl\. 04, dyrest 3,90 kr\/kWh kl\. 19\./.test(h), 'grafen har en tekstlig beskrivelse');
  ok(!/<h[1-6]/.test(h), 'skærmen indeholder ingen overskriftstags — sidens h1 står andetsteds');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
