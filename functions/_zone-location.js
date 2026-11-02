/**
 * Where the foreign price pages (/no/strompris … /it/prezzo-luce, /norden) apply: spatialCoverage on the WebPage.
 *
 * A Place, never a Country (schema.org accepts Text or Place there, and Google flagged Country on /api). The Place is the
 * country with its Wikidata entity; a country with several price areas lists them in containsPlace by the labels the
 * page itself uses (ZONES in [[path]].js: "NO1 Oslo"). Two zones are not their country and say so: DE-LU covers Germany
 * and Luxembourg, IT-Nord only the north of Italy. No coordinates and no boundary — the page makes no claim about
 * where a zone ends, and none is invented here.
 *
 * `ctx` is { ZONES, PRIS_COUNTRIES, CHROME_I18N, NORDEN_ZONES } from [[path]].js. A leading underscore keeps this
 * file out of Pages' route table.
 */

/** Wikidata items of the countries, checked against their English labels on 2026-11-02. */
export const COUNTRY_QID = { dk: 'Q35', no: 'Q20', sv: 'Q34', fi: 'Q33', nl: 'Q55', de: 'Q183', fr: 'Q142', pl: 'Q36', it: 'Q38', lu: 'Q32' };
/** The country a zone belongs to, by the first letters of its key (dk1, no3, se2, fi, nl, de, fr, pl, it-n). */
const ZONE_COUNTRY = z => ({ dk: 'dk', no: 'no', se: 'sv', fi: 'fi', nl: 'nl', de: 'de', fr: 'fr', pl: 'pl', it: 'it' }[z.slice(0, 2)]);

const DA = { land: 'Prisområde', cn: { dk: 'Danmark', no: 'Norge', sv: 'Sverige', fi: 'Finland', nl: 'Holland' } };
const LUXEMBOURG = 'Luxemburg';   // DE-LU is only ever shown on the German page
const NORTH_ITALY = 'Zona di prezzo Nord Italia (IT-Nord)';
const NORDEN_NAME = 'Norden og Holland';

const entity = (name, cc) => ({ '@type': 'Place', name, sameAs: `https://www.wikidata.org/wiki/${COUNTRY_QID[cc]}` });

/** The place of one price area, by the label the page uses for it. */
function zonePlace(k, z, areaWord) {
  return { '@type': 'Place', name: `${areaWord} ${z.name} ${z.city}` };
}

/** The Place for one country page (`pg` a key of PRIS_COUNTRIES). */
function countryPage(pg, ctx) {
  const C = ctx.PRIS_COUNTRIES[pg], L = ctx.CHROME_I18N[C.lang], name = L.cn[C.cc];
  if (C.zones.length > 1) {
    return { ...entity(name, C.cc), containsPlace: C.zones.map(k => zonePlace(k, ctx.ZONES[k], L.area)) };
  }
  const k = C.zones[0];
  if (k === 'de') {
    // The market zone is Germany and Luxembourg together.
    return { '@type': 'Place', name: `${L.area} ${ctx.ZONES.de.name}`, containsPlace: [entity(name, 'de'), entity(LUXEMBOURG, 'lu')] };
  }
  if (k === 'it-n') return { '@type': 'Place', name: NORTH_ITALY, containedInPlace: entity(name, 'it') };
  return entity(name, C.cc);
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
    const e = entity(DA.cn[cc], cc);
    return zs.length > 1 ? { ...e, containsPlace: zs.map(k => zonePlace(k, ctx.ZONES[k], DA.land)) } : e;
  });
  return { '@type': 'Place', name: NORDEN_NAME, containsPlace: countries };
}

/** `pg` is the country page's key, or null for /norden. Returns the fields to add to the page's WebPage. */
export function zoneLocation(pg, ctx) {
  return { spatialCoverage: pg ? countryPage(pg, ctx) : nordenPage(ctx) };
}
