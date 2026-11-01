/**
 * Location data for the city pages (/elpris/<by>), one variant per page — see CITY_LOCATION in _cities.js for the
 * arms and why. Everything is built from that table and the city's own row: coordinates and entity ids from
 * Wikidata, the net company and price area from the sampled addresses. Nothing is a claim the page does not
 * already make, and no business address or LocalBusiness is invented — elpriser.org is not a local business.
 *
 * Returns { about, pageExtra, extraLd, headMeta }:
 *   about      the WebPage's `about`
 *   pageExtra  more fields for the WebPage (spatialCoverage in the coverage arm)
 *   extraLd    more JSON-LD objects (the Dataset in the dataset arm)
 *   headMeta   <meta> tags for <head> (the geo arm)
 * A leading underscore keeps this file out of Pages' route table.
 */
import { CITY_LOCATION } from './_cities.js';

const DENMARK = { '@type': 'Country', name: 'Danmark' };

/** The city as a Place with a point and its entity pages. */
function cityPlace(c, L) {
  return {
    '@type': 'City', name: c.name,
    geo: { '@type': 'GeoCoordinates', latitude: L.lat, longitude: L.lng },
    sameAs: [`https://www.wikidata.org/wiki/${L.wikidata}`, `https://da.wikipedia.org/wiki/${encodeURIComponent(L.wikipedia)}`],
    containedInPlace: DENMARK,
  };
}

/** schema.org accepts Text or Place in spatialCoverage; Google flagged Country on /api. */
function coveragePlace(c, L) {
  return { '@type': 'Place', name: c.name, geo: { '@type': 'GeoCoordinates', latitude: L.lat, longitude: L.lng } };
}

function cityDataset(c, L, net, pageUrl) {
  return {
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: `Elpriser i ${c.name} time for time`,
    description: `Elpris time for time i ${c.name} (prisområde ${c.area}): spotprisen på Nord Pool plus nettarif hos ${net.name}, Energinets system- og transmissionstarif, elafgift og moms, for i dag og i morgen og som prognose de næste døgn. Hentet fra Energi Data Service.`,
    url: pageUrl, inLanguage: 'da', isAccessibleForFree: true,
    license: 'https://www.energidataservice.dk/legal-information',
    creator: { '@type': 'Organization', name: 'Energinet', url: 'https://energidataservice.dk' },
    publisher: { '@type': 'Organization', name: 'elpriser.org', url: 'https://elpriser.org' },
    keywords: ['elpriser', 'elpris', c.name, c.area, net.name, 'nettarif', 'Nord Pool'],
    spatialCoverage: coveragePlace(c, L),
    variableMeasured: [{ '@type': 'PropertyValue', name: `Elpris inkl. nettarif hos ${net.name}, afgifter og moms`, unitText: 'DKK/kWh' }],
    distribution: [{
      '@type': 'DataDownload', name: `Elpris i ${c.name} (${net.name}) — JSON`, encodingFormat: 'application/json',
      contentUrl: `https://elpriser.org/api/forecast?area=${c.area}&mode=net_inkl_alt&gln=${net.gln}`,
    }],
  };
}

function geoMeta(c, L) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return [
    `<meta name="geo.region" content="${esc(L.region)}">`,
    `<meta name="geo.placename" content="${esc(c.name)}">`,
    `<meta name="geo.position" content="${L.lat};${L.lng}">`,
    `<meta name="ICBM" content="${L.lat}, ${L.lng}">`,
  ].join('\n  ');
}

/** `c` is a CITIES row, `net` its main net company (c.nets[0]). A city without a row gets the control. */
export function cityLocation(c, net, pageUrl) {
  const L = CITY_LOCATION[c.slug];
  const out = { about: { '@type': 'City', name: c.name, containedInPlace: DENMARK }, pageExtra: {}, extraLd: [], headMeta: '' };
  if (!L || L.arm === 'base') return out;
  out.about = cityPlace(c, L);
  if (L.arm === 'coverage') out.pageExtra = { spatialCoverage: coveragePlace(c, L) };
  if (L.arm === 'dataset') out.extraLd = [cityDataset(c, L, net, pageUrl)];
  if (L.arm === 'geo') out.headMeta = geoMeta(c, L);
  return out;
}
