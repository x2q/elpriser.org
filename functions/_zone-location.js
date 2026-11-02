/**
 * Where the foreign price pages (/no/strompris … /ie/electricity-price, /norden) apply: spatialCoverage on the WebPage.
 *
 * A Place, never a Country (schema.org accepts Text or Place there, and Google flagged Country on /api). The Place is the
 * country with its Wikidata entity; a country with several price areas lists them in containsPlace by the labels the
 * page itself uses (ZONES in [[path]].js: "NO1 Oslo"). Three zones are not their country and say so: DE-LU covers Germany
 * and Luxembourg, IE-SEM the Republic of Ireland and Northern Ireland, IT-Nord only the north of Italy. No coordinates and
 * no boundary — the page makes no claim about where a zone ends, and none is invented here.
 *
 * The Wikidata item of a country is the `qid` of its PRIS_COUNTRIES entry (checked against the item's English label when it
 * was added: docs/add-a-country.md), so a new country page needs nothing in this file unless its zone is not its country.
 *
 * `ctx` is { ZONES, PRIS_COUNTRIES, CHROME_I18N, NORDEN_ZONES, prisCn } from [[path]].js. A leading underscore keeps this
 * file out of Pages' route table.
 */

/** Countries that have no page of their own, or are only part of a zone: Denmark (the Danish pages), Luxembourg (in DE-LU), Northern Ireland (in IE-SEM). */
const EXTRA_QID = { dk: 'Q35', lu: 'Q32', 'gb-nir': 'Q26' };
/** The country a zone belongs to, by the first letters of its key (dk1, no3, se2, fi, nl) — /norden's zones. */
const ZONE_COUNTRY = z => ({ dk: 'dk', no: 'no', se: 'sv', fi: 'fi', nl: 'nl' }[z.slice(0, 2)]);

const DA = { land: 'Prisområde', cn: { dk: 'Danmark', no: 'Norge', sv: 'Sverige', fi: 'Finland', nl: 'Holland' } };
const LUXEMBOURG = 'Luxemburg';   // DE-LU is only ever shown on the German page
const NORTHERN_IRELAND = 'Northern Ireland';   // IE-SEM is only ever shown on the English page
const NORTH_ITALY = 'Zona di prezzo Nord Italia (IT-Nord)';
const NORDEN_NAME = 'Norden og Holland';

const qidOf = (ctx, cc) => EXTRA_QID[cc] || (Object.values(ctx.PRIS_COUNTRIES).find(C => C.cc === cc) || {}).qid;
const entity = (ctx, name, cc) => ({ '@type': 'Place', name, sameAs: `https://www.wikidata.org/wiki/${qidOf(ctx, cc)}` });

/** The place of one price area, by the label the page uses for it. */
function zonePlace(k, z, areaWord) {
  return { '@type': 'Place', name: `${areaWord} ${z.name} ${z.city}` };
}

/** The Place for one country page (`pg` a key of PRIS_COUNTRIES). */
function countryPage(pg, ctx) {
  const C = ctx.PRIS_COUNTRIES[pg], L = ctx.CHROME_I18N[C.lang], name = ctx.prisCn(L, C.cc);
  if (C.zones.length > 1) {
    return { ...entity(ctx, name, C.cc), containsPlace: C.zones.map(k => zonePlace(k, ctx.ZONES[k], L.area)) };
  }
  const k = C.zones[0];
  if (k === 'de') {
    // The market zone is Germany and Luxembourg together.
    return { '@type': 'Place', name: `${L.area} ${ctx.ZONES.de.name}`, containsPlace: [entity(ctx, name, 'de'), entity(ctx, LUXEMBOURG, 'lu')] };
  }
  if (k === 'ie') {
    // The Single Electricity Market covers the Republic of Ireland and Northern Ireland.
    return { '@type': 'Place', name: `${L.area} ${ctx.ZONES.ie.name}`, containsPlace: [entity(ctx, name, 'ie'), entity(ctx, NORTHERN_IRELAND, 'gb-nir')] };
  }
  if (k === 'it-n') return { '@type': 'Place', name: NORTH_ITALY, containedInPlace: entity(ctx, name, 'it') };
  return entity(ctx, name, C.cc);
}

/** /norden: the thirteen areas the page compares, grouped by country. */
function nordenPage(ctx) {
  const by = new Map();
  for (const k of ctx.NORDEN_ZONES) {
    const cc = ZONE_COUNTRY(k);
    if (!by.has(cc)) by.set(cc, []);
    by.get(cc).push(k);
  }
  const countries = [...by].map(([cc, zs]) => {
    const e = entity(ctx, DA.cn[cc], cc);
    return zs.length > 1 ? { ...e, containsPlace: zs.map(k => zonePlace(k, ctx.ZONES[k], DA.land)) } : e;
  });
  return { '@type': 'Place', name: NORDEN_NAME, containsPlace: countries };
}

/** `pg` is the country page's key, or null for /norden. Returns the fields to add to the page's WebPage. */
export function zoneLocation(pg, ctx) {
  return { spatialCoverage: pg ? countryPage(pg, ctx) : nordenPage(ctx) };
}
