// The ten pilot city pages (/elpris/<slug>). DATA ONLY: the generator is cityHTML() in [[path]].js.
//
// Which net company serves a city depends on the ADDRESS, not the city. Each row records which net
// company Green Power Denmark's supplier lookup (https://api.elnet.greenpowerdenmark.dk/api/supplierlookup/,
// the one /api/supplierlookup uses) named for real street addresses spread over the city's postcodes —
// found with OpenStreetMap/Nominatim, one request per second — on 2026-10-24. Reproduce with
// `node scripts/city-nets.mjs` (prints these rows; the addresses themselves are never printed or stored).
//
//   slug, name   the URL part (ASCII) and the display name
//   area         DK1 or DK2, the price area of the city
//   samples      how many distinct addresses answered. THIS IS A SMALL SAMPLE, not a coverage map: a share of
//                0.90 on 20 addresses is "about nine in ten of those", and a boundary street can be wrong.
//   nets         net companies we price (slug and gln as in NETS), most common first, with share = fraction of
//                the samples; the first is the "main" net company the page is drawn for
//   other        net companies named by the lookup that are not among the 16 we price, with their share
export const CITIES = [
  { slug: 'silkeborg', name: 'Silkeborg', area: 'DK1', samples: 18, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 1 }] },
  { slug: 'svendborg', name: 'Svendborg', area: 'DK1', samples: 17, nets: [{ name: 'Flow Elnet', gln: '5790000392551', slug: 'flow-elnet', share: 1 }] },
  { slug: 'viborg', name: 'Viborg', area: 'DK1', samples: 19, nets: [{ name: 'Elnet Midt', gln: '5790001100520', slug: 'elnet-midt', share: 1 }] },
  { slug: 'aarhus', name: 'Aarhus', area: 'DK1', samples: 20, nets: [{ name: 'Konstant', gln: '5790000704842', slug: 'konstant', share: 0.6 }, { name: 'Dinel', gln: '5790000610099', slug: 'dinel', share: 0.4 }] },
  { slug: 'odense', name: 'Odense', area: 'DK1', samples: 20, nets: [{ name: 'Vores Elnet', gln: '5790000610976', slug: 'vores-elnet', share: 0.9 }, { name: 'Ravdex', gln: '5790000836727', slug: 'ravdex', share: 0.1 }] },
  { slug: 'aalborg', name: 'Aalborg', area: 'DK1', samples: 18, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 0.94 }, { name: 'Nord Energi', gln: '5790000610877', slug: 'nord-energi', share: 0.06 }] },
  { slug: 'esbjerg', name: 'Esbjerg', area: 'DK1', samples: 19, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 0.89 }], other: [{ name: 'Hjerting Transformatorforening', share: 0.11 }] },
  { slug: 'kolding', name: 'Kolding', area: 'DK1', samples: 20, nets: [{ name: 'Trefor', gln: '5790000392261', slug: 'trefor', share: 1 }] },
  { slug: 'koebenhavn', name: 'København', area: 'DK2', samples: 15, nets: [{ name: 'Radius', gln: '5790000705689', slug: 'radius', share: 1 }] },
  { slug: 'roskilde', name: 'Roskilde', area: 'DK2', samples: 17, nets: [{ name: 'Cerius', gln: '5790000705184', slug: 'cerius', share: 0.53 }, { name: 'Radius', gln: '5790000705689', slug: 'radius', share: 0.47 }] },
];

// Location data for the city pages, and the experiment that tests which of it Google and Bing make use of.
// DATA ONLY: the builder is cityLocation() in _city-location.js.
//
//   lat, lng, wikidata, wikipedia   the city's point and entity, read from Wikidata on 2026-11-01 (P625 and the
//                                   Danish Wikipedia sitelink) — a city centre, not a boundary
//   region                          ISO 3166-2 code of the region (DK-81 Nordjylland, DK-82 Midtjylland, DK-83
//                                   Syddanmark, DK-84 Hovedstaden, DK-85 Sjælland)
//   arm                             one variant per page, because a URL cannot be A/B-tested against itself:
//                                     base      WebPage about a City in Danmark (the control)
//                                     place     + the city as a Place: coordinates and sameAs (Wikidata, Wikipedia)
//                                     coverage  + spatialCoverage (a Place) on the WebPage
//                                     dataset   + a Dataset about the city's prices, with spatialCoverage and a link to the API
//                                     geo       + geo.region / geo.placename / geo.position / ICBM meta tags
//                                   Two cities per arm, one large and one small. Started 2026-11-01; read the
//                                   result per page in Search Console (impressions, clicks, position) and in the
//                                   structured-data reports around 2026-11-22 and 2026-12-06.
export const CITY_LOCATION = {
  silkeborg: { lat: 56.1667, lng: 9.55, wikidata: 'Q21180', wikipedia: 'Silkeborg', region: 'DK-82', arm: 'base' },
  svendborg: { lat: 55.0597, lng: 10.61, wikidata: 'Q28031', wikipedia: 'Svendborg', region: 'DK-83', arm: 'dataset' },
  viborg: { lat: 56.45, lng: 9.4, wikidata: 'Q21176', wikipedia: 'Viborg', region: 'DK-82', arm: 'coverage' },
  aarhus: { lat: 56.1564, lng: 10.2097, wikidata: 'Q25319', wikipedia: 'Aarhus', region: 'DK-82', arm: 'place' },
  odense: { lat: 55.4, lng: 10.3833, wikidata: 'Q25331', wikipedia: 'Odense', region: 'DK-83', arm: 'base' },
  aalborg: { lat: 57.05, lng: 9.9167, wikidata: 'Q25410', wikipedia: 'Aalborg', region: 'DK-81', arm: 'coverage' },
  esbjerg: { lat: 55.4708, lng: 8.4514, wikidata: 'Q26234', wikipedia: 'Esbjerg', region: 'DK-83', arm: 'geo' },
  kolding: { lat: 55.4908, lng: 9.4722, wikidata: 'Q27119', wikipedia: 'Kolding', region: 'DK-83', arm: 'place' },
  koebenhavn: { lat: 55.6761, lng: 12.5689, wikidata: 'Q1748', wikipedia: 'København', region: 'DK-84', arm: 'dataset' },
  roskilde: { lat: 55.6417, lng: 12.0808, wikidata: 'Q26563', wikipedia: 'Roskilde', region: 'DK-85', arm: 'geo' },
};
