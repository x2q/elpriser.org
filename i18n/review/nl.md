# nl — review notes

Terms and texts a native speaker (Netherlands/Flanders) should confirm. Informal "je/jouw" throughout (app UI and store listing). Covers the store listing (`docs/store/nl.md`) and the key UI terms in `i18n/strings/nl.json`.

| Where | Choice | Alternative | Why unsure |
|---|---|---|---|
| store, UI (place_zone_title, welcome_zone_body, note_zone_*) | "biedzone" | "prijszone", "prijsgebied" | "Biedzone" is the official ENTSO-E/TenneT term but consumers rarely use it; the Nordic wording "prijsgebied" has no Dutch counterpart. Kept for consistency with the UI strings |
| store | "stroomprijs" (also in name "Elpriser – stroomprijzen") | "energieprijs", "elektriciteitsprijs" | "Stroomprijs" is the everyday word; "energieprijs" also covers gas |
| store (keywords, description) | "dynamisch contract" in keywords only; "dag-vooruit" / "day-ahead-spotprijs (dag-vooruitprijs)" | "dynamisch energiecontract", "EPEX-prijs" | The app is not a supplier; "dynamisch contract" is the search term Dutch users type, but it is not claimed in the prose. "Dag-vooruit" vs "day-ahead": both are used |
| store | "spotprijs", "groothandels-spotprijzen" | "beursprijs", "marktprijs" | Wording for wholesale exchange price; "beursprijs" is also common in consumer media |
| store, UI (part_grid) | "netkosten" (prose), "nettarief" (Danish tariff) | "transportkosten", "netbeheerkosten" | Dutch bills say "netbeheerkosten"/"transportkosten"; "nettarief" follows the Danish tariff concept |
| store, UI | "netbeheerder" for the Danish netselskab | "netwerkbedrijf" | Correct Dutch term, but in NL it is the regional network operator (Liander, Stedin); Danish netselskaber are the same role |
| store, UI (part_duty) | "energiebelasting" | "belasting op elektriciteit" | Dutch term differs legally from the Danish elafgift; closest equivalent |
| store | "btw" | "BTW" | Lower case follows current spelling guidance; both common |
| store | "cent per kWh (øre, öre of grosz ...)" | "eurocent per kWh" | In NL the unit is euro cents; the sentence is the same in every language |
| store | "boiler" for water heater | "warmwaterboiler", "warmwatervoorraadvat" | "Boiler" matches UI device_water and is the common word |
| store | "Slim huis" (heading) | "Slim wonen", "Smart home" | Matches UI nav_smart; "smart home" is also widely used in NL |
| store | "Lets" for Latvian | "Letlands" | "Lets" is the standard language name |
| store | "Gratis, zonder reclame" | "Geen advertenties" | "Reclame" is more natural than "advertenties" in a consumer context |
| store (ios.subtitle) | "Stroomprijs per uur in Europa" | "Stroomprijzen in heel Europa" | Subtitle limited to 30 characters; hourly and Europe both fit |
| store (ios.keywords) | "stroomprijs,energieprijs,spotprijs,dynamisch contract,dag-vooruit,kWh,stroom,Nord Pool,warmtepomp" | add "laden", "elektrische auto" | Cut to fit the 100 character limit; native speaker may prefer different search terms |
| UI, store | "uur voor uur" | "per uur" | Mirrors the Danish "time for time". NL day-ahead prices have moved to 15-minute resolution (kwartierprijs); the app shows hourly averages, a reviewer may want a note |
