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
  const c = src.indexOf('\n}', src.indexOf('return \'<svg id="fcCurve"', b));
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
vm.runInContext(serverCopy + '\nglobalThis.chart = fcChartHTML;', ctx);
const chart = ctx.chart;

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
  ok(/<div class="fc-days">/.test(h), 'dagnavnene ligger i HTML, ikke i den strakte svg');
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

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
