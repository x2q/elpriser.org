// Reference implementation of the small pieces of logic that the web app, the
// Android app (Kotlin) and the iOS app (Swift) each carry their own copy of.
// app-contract.json is generated from these functions; the native unit tests
// then check their implementations against the same file.

export function cheapestWindow(vals, n, highest = false) {
  let best = null;
  for (let s = 0; s <= vals.length - n; s++) {
    const avg = vals.slice(s, s + n).reduce((a, b) => a + b, 0) / n;
    if (best === null || (highest ? avg > best.avg : avg < best.avg)) best = { s, e: s + n, avg };
  }
  const pad = x => String(x).padStart(2, '0');
  return { ...best, label: `${pad(best.s)}–${pad(best.e % 24)}` };
}

/** 0 cheap, 1 middle, 2 dear — by how many of the day's hours are cheaper. */
export function verdict(price, vals) {
  const pct = Math.round(vals.filter(v => v < price).length / vals.length * 100);
  if (pct <= 33) return { kind: 0, label: 'Billig lige nu' };
  if (pct <= 66) return { kind: 1, label: 'Middel lige nu' };
  return { kind: 2, label: 'Dyr lige nu' };
}

const WD = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const WS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export function dayNames(date) {
  const d = new Date(date + 'T12:00:00Z');
  const wd = d.getUTCDay(), day = d.getUTCDate(), mon = MON[d.getUTCMonth()];
  const cap = s => s[0].toUpperCase() + s.slice(1);
  return { date, short: WS[wd], month: `${day}. ${mon}`, long: `${cap(WD[wd])} ${day}. ${mon}` };
}

/** Longest matching name wins ("Trefor Øst" beats "Trefor"). */
export function matchNet(nets, name) {
  if (!name || !name.trim()) return null;
  const lower = name.toLowerCase();
  let best = null;
  for (const n of nets) for (const m of n.match) {
    if (lower.includes(m.toLowerCase()) && (best === null || m.length > best.len)) best = { net: n, len: m.length };
  }
  return best ? best.net.name : null;
}

/** What a client must make of /api/forecast: complete days only, band optional. */
export function parseForecast(resp) {
  const days = [];
  for (const d of resp.days) {
    const price = Array(24).fill(null), lo = Array(24).fill(null), hi = Array(24).fill(null);
    let band = false;
    for (const p of d.prices) {
      if (!(p.hour >= 0 && p.hour <= 23) || p.price == null) continue;
      price[p.hour] = p.price;
      if (p.min != null && p.max != null) { lo[p.hour] = p.min; hi[p.hour] = p.max; band = true; }
    }
    if (price.some(v => v === null)) continue;
    days.push({ date: d.date, actual: d.type === 'actual', price, lo: band ? lo : null, hi: band ? hi : null });
  }
  return { days, model: resp.model && resp.model.name ? resp.model.name : null };
}

/** CO2 per date, only for dates that have all 24 hours. */
export function parseCo2(resp) {
  const by = {};
  for (const r of resp.records) {
    if (!(r.hour >= 0 && r.hour <= 23)) continue;
    (by[r.date] ??= Array(24).fill(-1))[r.hour] = r.co2;
  }
  return Object.fromEntries(Object.entries(by).filter(([, v]) => v.every(x => x >= 0)));
}
