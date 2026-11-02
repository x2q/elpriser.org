# nb — review notes

Terms and texts a native speaker (Norway) should confirm. Bokmål, informal "du/ditt". Apple metadata locale is `no`, Google Play code `no-NO`; the app also serves nn and no through the alias list in `i18n/languages.json`, but the listing text is Bokmål only. Covers the store listing (`docs/store/nb.md`) and the key UI terms in `i18n/strings/nb.json`.

| Where | Choice | Alternative | Why unsure |
|---|---|---|---|
| store, UI (place_zone_title) | "prisområde" (NO1-NO5) | "strømområde", "elspotområde" | "Prisområde" is the term Statnett and the media use for NO1-NO5 |
| store | "strømpris", "spotpris" | "elpris", "kraftpris" | Norwegians say "strømpris" (consumer) and "kraftpris" (industry/news); the app name Elpriser contains "el" |
| store, UI (part_grid) | "nettleie" | "nettariff" | "Nettleie" is the bill term in Norway; Danish nettarif maps to it. Note that Norwegian "nettleie" often includes the energy-based part and the fixed part |
| store | "nettselskap" for Danish netselskab | "nettleverandør" | Standard term |
| store, UI (part_duty) | "elavgift" | "forbruksavgift på elektrisk kraft" | Norwegian elavgift differs legally from the Danish one; closest equivalent |
| store | "mva." | "MVA" | Lower case with a period follows the UI string |
| store | "strømleverandørens påslag" | "påslag", "kraftleverandørens marginal" | In Norway the supplier mark-up is "påslag" on the spot price |
| store | "engrospriser på spotmarkedet (day-ahead)" | "børspris", "markedspris" | Wholesale exchange price wording |
| store | "Energinets tariffer" | "Energinets avgifter" | Danish TSO fees |
| store | "cent per kWh (øre, öre eller grosz ...)" | "øre per kWh" | Norway's own sub-unit is øre; cent as the headline is the same sentence as in all languages. A native should confirm it reads naturally for a Norwegian user who normally sees "øre/kWh" or "kr/kWh" |
| store | "Smarthjem" (heading), "vannvarmer" | "Smart hjem", "varmtvannsbereder" | Matches UI device_water "Vannvarmer"; "varmtvannsbereder" is the Norwegian trade word |
| store | "Dansk, engelsk, ... norsk, ..." | ordering | List order follows the English source |
| store | "i dag", "i morgen" | "idag", "imorgen" | Two words is the Språkrådet norm; one word is common in everyday writing |
| store | "oppgjøret ditt" | "faktiske regning" | Mirrors "settlement"; a native may prefer "regningen din" |
| store | "Gratis, uten reklame" | "Reklamefri" | Either works |
| store (ios.subtitle) | "Spotpriser på strøm i Europa" | "Strømpriser i hele Europa" | Fits 30 characters |
| store (ios.keywords) | "strømpris,spotpris,prisområde,timepris,kWh,strøm,Nord Pool,nettleie,elbil,varmepumpe" | add "billig strøm", "kraftpris" | Cut to fit the 100 character limit |
