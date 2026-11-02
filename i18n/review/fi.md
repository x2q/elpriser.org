# fi — review notes

Terms and texts a native speaker (Finland) should confirm. Informal "sinä" forms (-si, -sta) throughout. Covers the store listing (`docs/store/fi.md`) and the key UI terms in `i18n/strings/fi.json`.

| Where | Choice | Alternative | Why unsure |
|---|---|---|---|
| store, UI (place_zone_title) | "hinta-alue" | "tarjousalue" (official bidding zone) | Finland is a single zone (FI); consumers say "hinta-alue", the TSO Fingrid says "tarjousalue". "Hinta-alue" matches the other Nordic wording |
| store | "sähkön hinta", "pörssisähkö", "pörssihinta" | "spot-hinta", "markkinahinta" | The consumer search terms in Finland are "pörssisähkö" and "sähkön hinta"; "spot-hinta" is kept in keywords. The app is not a supplier, "pörssisähkö" is used for the wholesale price |
| store | "tukkumarkkinoiden pörssihintoja (day-ahead-markkina)" | "vuorokausimarkkina" | The Finnish term for day-ahead is "vuorokausimarkkina"; English "day-ahead" is kept in parentheses because Finnish users of exchange-price apps know it |
| store, UI (part_grid) | "siirtomaksu" | "verkkomaksu", "sähkönsiirto" | "Siirtomaksu" is the Finnish bill term; Danish nettarif maps to it |
| store, UI (part_duty) | "sähkövero" | "sähkön valmistevero" | Finnish sähkövero is not identical to the Danish elafgift (different base and rate); closest equivalent |
| store | "alv" | "arvonlisävero" | Abbreviation follows the UI string; in the promo text "alv:ineen" inflects the abbreviation (veroineen ja alv:ineen), a native should check the form |
| store | "verkkoyhtiö", "sähköntoimittaja", "sähkönmyyjän kate" | "jakeluyhtiö", "sähkönmyyjän marginaali" | "Verkkoyhtiö" for the Danish netselskab; "kate" for supplier margin |
| store | "senttiä kilowattitunnilta (øre, öre tai grosz ...)" | "senttiä/kWh" | Finland uses c/kWh; the sentence is the same in every language. Written out for readability, a native may prefer "snt/kWh" |
| store | "Älykoti" (heading), "vedenlämmittimelle" | "Älykoti", "lämminvesivaraaja" | "Lämminvesivaraaja" is the Finnish trade word; "vedenlämmitin" follows the UI device_water |
| store | "Pohjoismaiden hinta-alueille ja Alankomaille" | "Pohjoismaiden hinta-alueille sekä Alankomaille" | Case choice after the compound |
| store | "Hugging Facessa", "Shellyyn", "Home Assistantiin" | "Hugging Face'ssa" | Foreign names whose written form ends in a consonant are inflected without an apostrophe; names whose pronunciation differs from the spelling (Shelly, Face) may need one. Check all three |
| store | "Ilmainen, ei mainoksia" | "Maksuton, mainokseton" | Either works |
| store | "Sovellus on nyt saatavilla 26 kielellä" | "tukee nyt 26 kieltä" | Idiomatic phrasing |
| store | "Tanska, englanti, ..." (language list in nominative) | "tanskaksi, englanniksi, ..." | Nominative list after the heading "OMALLA KIELELLÄSI" |
| store (ios.subtitle) | "Pörssisähkön hinta Euroopassa" | "Sähkön hinta Euroopassa" | Fits 30 characters |
| store (ios.keywords) | "sähkön hinta,pörssisähkö,spot-hinta,hinta-alue,tuntihinta,kWh,Nord Pool,siirtomaksu,sähköauto" | add "lämpöpumppu", "sähkö" | Cut to fit the 100 character limit (Finnish words are long) |
| store | Finnish 15-minute pricing | "varttihinta" | Nord Pool day-ahead moved to 15-minute resolution; the app shows hourly averages, "tunti tunnilta" mirrors the Danish "time for time" |
