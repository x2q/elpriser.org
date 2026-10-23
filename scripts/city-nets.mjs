#!/usr/bin/env node
// Which net company answers where? Samples real street addresses in each pilot city and asks
// Green Power Denmark's supplier lookup (the same one /api/supplierlookup uses) who owns them.
// Prints the `nets` table that goes into functions/_cities.js. Run: node scripts/city-nets.mjs [slug ...]
//
// Addresses come from OpenStreetMap (Nominatim: postcode centroids by forward search, then the nearest
// numbered address by reverse search, one request per second, with the site's User-Agent). They are held
// in memory for the one lookup and are never printed or stored — only the net company's name is counted.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const UA = { 'User-Agent': 'elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)' };
const WANT = +process.env.WANT || 20;   // sample points per city; some give no address or repeat one
const CITIES = {     // postcodes that belong to the city proper; the first is the centre
  silkeborg: [8600], svendborg: [5700], viborg: [8800], kolding: [6000], roskilde: [4000],
  aarhus: [8000, 8200, 8210, 8220, 8230, 8240, 8250, 8260, 8270, 8310],
  odense: [5000, 5200, 5210, 5220, 5230, 5240, 5250, 5260, 5270],
  aalborg: [9000, 9200, 9210, 9220, 9400],
  esbjerg: [6700, 6705, 6710, 6715],
  koebenhavn: [1050, 1300, 1400, 1700, 2100, 2200, 2300, 2400, 2450, 2500],
};
const ROOT = path.resolve(import.meta.dirname, '..');
const NETS = vm.runInNewContext('(' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const NETS=(\{[\s\S]*?\]\});/)[1] + ')');

// Same rule as matchNet() in index.html: the longest matching string wins.
function matchNet(name) {
  const l = name.toLowerCase(); let best = null;
  for (const area of ['DK1', 'DK2']) for (const net of NETS[area]) for (const m of net.match)
    if (l.includes(m.toLowerCase()) && (!best || m.length > best.len)) best = { area, net, len: m.length };
  return best;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function nominatim(url) {          // never faster than 1 request per second
  await sleep(Math.max(0, last + 1100 - Date.now()));
  last = Date.now();
  const r = await fetch(url, { headers: UA }).catch(() => null);
  return r && r.ok ? r.json() : null;
}
function gpdAddress(a) {                 // buildGpdAddress() in functions/api/[[catchall]].js
  const street = (a?.road || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const town = a?.city || a?.town || a?.village || a?.suburb || a?.municipality || '';
  return street && a.house_number && a.postcode && town ? `${street} ${a.house_number}, ${a.postcode} ${town}` : null;
}
async function addressNear(lat, lng, postcodes) {
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  for (const [r, n] of [[0, 1], [40, 4], [90, 8]]) for (let k = 0; k < n; k++) {
    const ang = 2 * Math.PI * k / n;
    const o = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat + r * Math.cos(ang) / mLat}&lon=${lng + r * Math.sin(ang) / mLng}&zoom=18&addressdetails=1&layer=address&accept-language=da`);
    const a = o?.address, g = a && gpdAddress(a);
    if (g && postcodes.includes(+a.postcode)) return g;
  }
  return null;
}

const want = process.argv.slice(2);
for (const [slug, postcodes] of Object.entries(CITIES)) {
  if (want.length && !want.includes(slug)) continue;
  const centres = [];
  for (const pc of postcodes) {
    const j = await nominatim(`https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${pc}&country=Denmark&limit=1`);
    if (j && j[0]) centres.push([+j[0].lat, +j[0].lon]);
  }
  // More points than postcodes: rings of 700 / 1400 / 2100 m around the centroids, turned by the golden angle.
  const pts = centres.slice(0, WANT);
  for (let k = 0; centres.length && pts.length < WANT; k++) {
    const [la, lo] = centres[k % centres.length], ang = k * 2.39996, r = 700 * (1 + Math.floor(k / centres.length) % 3);
    pts.push([la + r * Math.cos(ang) / 111320, lo + r * Math.sin(ang) / (111320 * Math.cos(la * Math.PI / 180))]);
  }
  const seen = new Set(), tally = {}; let n = 0, unknown = 0;
  for (const [la, lo] of pts) {
    const addr = await addressNear(la, lo, postcodes);
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    const r = await fetch(`https://api.elnet.greenpowerdenmark.dk/api/supplierlookup/${encodeURIComponent(addr)}`).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (!j || !j.name) { unknown++; continue; }
    n++;
    const m = matchNet(j.name), key = m ? m.net.slug : '?' + j.name;
    tally[key] = (tally[key] || 0) + 1;
  }
  const nets = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, c]) => {
    const net = k[0] === '?' ? null : [...NETS.DK1, ...NETS.DK2].find(x => x.slug === k);
    return net ? { name: net.name, gln: net.gln, slug: net.slug, share: +(c / n).toFixed(2) } : { unmatched: k.slice(1), share: +(c / n).toFixed(2) };
  });
  console.log(JSON.stringify({ slug, samples: n, noAnswer: unknown, nets }));
}
