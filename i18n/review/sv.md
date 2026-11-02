# sv — review notes

Terms and texts a native speaker (Sweden) should confirm. Informal "du/ditt" throughout. Covers the store listing (`docs/store/sv.md`) and the key UI terms in `i18n/strings/sv.json`.

| Where | Choice | Alternative | Why unsure |
|---|---|---|---|
| store, UI (place_zone_title) | "elområde" (SE1-SE4) | "prisområde" | "Elområde" is the official Swedish term (Svenska kraftnät); the rest of the Nordics and the app's other zones also use it |
| store | "elpris", "spotpris", "rörligt elpris" (keyword) | "timpris", "börspris" | Consumer terms for hourly prices. "Rörligt elpris" is the search term for variable-rate contracts; used in keywords only |
| store | "elhandlarens påslag" | "elhandelsföretagets marginal" | Swedish name for the supplier margin; "elhandlare" is the standard word |
| store, UI (part_grid) | "nätavgift", "nätbolag" | "elnätsavgift", "nätägare" | "Elnätsavgift" is the usual bill term; "nätavgift" follows the Danish nettarif and the UI string |
| store, UI (part_duty) | "elskatt" (store), "energiskatt" (UI part_duty) | one term in both | Swedish law calls it "energiskatt på el"; the store text says "elskatt" (colloquial). Align with the UI if a reviewer prefers |
| store | "Energinets tariffer" | "Energinets avgifter" | Danish TSO fees; "tariffer" matches the UI |
| store | "grossistpriser på spotmarknaden (day-ahead)" | "börspris" | Wording for wholesale exchange price |
| store | "dagen före" not used; "day-ahead" kept in parentheses | "dagen-före-priset" | Swedish consumers rarely say "dagen före-pris"; English term is common among Nord Pool users |
| store | "i dag", "i morgon" (two words) | "idag", "imorgon" | Two words is the Språkrådet recommendation; one word is common in apps and may read as more modern |
| store | "cent per kWh (öre, øre eller grosz ...)" | "euro-cent per kWh" | Sweden uses öre, the text lists the other local sub-units as in every language. In Sweden "öre per kWh" or "kr/kWh" is the norm, check that cent as the headline unit does not mislead |
| store | "Smarta hemmet" (heading), "varmvattenberedare" | "Smart hem", "varmvattenberedare" vs "varmvatten" | UI device_water says "Varmvatten" (short); store uses the full word |
| store | "Gratis, utan reklam" | "Reklamfri" | Either works |
| store | "nätbolag" for Danish netselskab | "nätägare" | "Nätbolag" is the common word |
| store | "avräkning" | "faktura" | "Din faktiska avräkning" mirrors English "settlement"; a native may prefer "din faktiska faktura" |
| store (ios.subtitle) | "Spotpriser för el i Europa" | "Elpriset i hela Europa" | Fits 30 characters |
| store (ios.keywords) | "elpris,spotpris,elområde,timpris,kWh,rörligt elpris,Nord Pool,el,elbil,värmepump,elavtal" | add "billig el", "elnät" | Cut to fit the 100 character limit |
