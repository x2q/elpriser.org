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
//   other        net companies named by the lookup that are not among the 15 we price, with their share
export const CITIES = [
  { slug: 'silkeborg', name: 'Silkeborg', area: 'DK1', samples: 18, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 1 }] },
  { slug: 'svendborg', name: 'Svendborg', area: 'DK1', samples: 17, nets: [{ name: 'Flow Elnet', gln: '5790000392551', slug: 'flow-elnet', share: 1 }] },
  { slug: 'viborg', name: 'Viborg', area: 'DK1', samples: 19, nets: [{ name: 'Elnet Midt', gln: '5790001100520', slug: 'elnet-midt', share: 1 }] },
  { slug: 'aarhus', name: 'Aarhus', area: 'DK1', samples: 20, nets: [{ name: 'Konstant', gln: '5790000704842', slug: 'konstant', share: 0.6 }, { name: 'Dinel', gln: '5790000610099', slug: 'dinel', share: 0.4 }] },
  { slug: 'odense', name: 'Odense', area: 'DK1', samples: 20, nets: [{ name: 'Vores Elnet', gln: '5790000610976', slug: 'vores-elnet', share: 0.9 }], other: [{ name: 'Ravdex', share: 0.1 }] },
  { slug: 'aalborg', name: 'Aalborg', area: 'DK1', samples: 18, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 0.94 }, { name: 'Nord Energi', gln: '5790000610877', slug: 'nord-energi', share: 0.06 }] },
  { slug: 'esbjerg', name: 'Esbjerg', area: 'DK1', samples: 19, nets: [{ name: 'N1', gln: '5790001089030', slug: 'n1', share: 0.89 }], other: [{ name: 'Hjerting Transformatorforening', share: 0.11 }] },
  { slug: 'kolding', name: 'Kolding', area: 'DK1', samples: 20, nets: [{ name: 'Trefor', gln: '5790000392261', slug: 'trefor', share: 1 }] },
  { slug: 'koebenhavn', name: 'København', area: 'DK2', samples: 15, nets: [{ name: 'Radius', gln: '5790000705689', slug: 'radius', share: 1 }] },
  { slug: 'roskilde', name: 'Roskilde', area: 'DK2', samples: 17, nets: [{ name: 'Cerius', gln: '5790000705184', slug: 'cerius', share: 0.53 }, { name: 'Radius', gln: '5790000705689', slug: 'radius', share: 0.47 }] },
];
