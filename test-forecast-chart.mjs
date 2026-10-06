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

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
