# sl — terms to have checked by a native speaker

Register: formal plural address ("vi") in sentences ("Izberite", "Preverite"), short singular imperative on buttons and screen-reader actions ("Poskusi znova", "Zapri", "Kopiraj"), as in Google's own Slovenian UI. Check that the mix feels right.

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| mode_spot_price etc. | "Borzna cena" | "Spot cena", "Cena na borzi" | "Borzna cena" is understandable; some Slovenian energy sites say "spot cena" or "tržna cena". |
| caption_zone | "Borzna cena na dan vnaprej" | "cena na trgu dan vnaprej" | Day-ahead wording. |
| part_grid / caption_net | "Omrežnina" | "Omrežnina za distribucijo" | The standard consumer term on Slovenian bills; correct for the Danish "nettarif". |
| part_system | "Sistemska tarifa (Energinet)" | "Tarifa za sistemske storitve" | Danish systemtarif has no direct Slovenian counterpart. |
| part_transmission | "Prenosna tarifa (Energinet)" | "Tarifa za prenos" | Wording unverified. |
| part_duty | "Trošarina na elektriko" | "Trošarina za električno energijo", "Davek na elektriko" | Slovenian has an excise duty on electricity; fine for the Danish elafgift. |
| place_zone_title, welcome_zone_body | "Cenovno območje" | "Ponudbeno območje", "Tržno območje" | "Ponudbeno območje" is the official bidding-zone term; I chose the more consumer-friendly word. |
| "netselskab" strings | "operater omrežja" | "distribucijski operater", "distributer" | Slovenians know "distribucijsko podjetje" (Elektro Ljubljana etc.). |
| unit_ct_kwh / unit_ct | "ct/kWh", "ct" | "c/kWh", "evrocent/kWh" | No firm convention. |
| day_tonight | "nocoj" | "drevi" | "Drevi" is the strict "this evening"; "nocoj" is more common in speech. |
| tile_cheapest / tile_priciest | "Najceneje %1$s" / "Najdražje %1$s" | "Najcenejša ura %1$s" | Adverbial form fits "danes/jutri/ned. 17." but is terse. |
| weekdays_short / months_short | "ned.", "pon." ... ; "jan.", "feb.", "maj" | without dots | Dots are customary; "maj" has no dot as it is not abbreviated. Combined with day_short_date this gives "ned. 17." |
| date_long | "%1$s, %2$d. %3$s" | - | Comma after weekday. |
| a11y_period_hint | "Prikaz cen: %1$s" | - | Lower-case chart title inserted ("naslednja 2 dneva"). |
| period_title_two / five | "Naslednja 2 dneva" / "Naslednjih 5 dni" | - | Dual ("2 dneva") and genitive plural ("5 dni") agreement; the buttons use "2 dneva" / "5 dni". |
| devices_active, hours_count | one/two/few/other forms ("aktivna naprava", "aktivni napravi", "aktivne naprave", "aktivnih naprav") | - | Adjective agreement inside the plural strings; please check. |
| device_water | "Grelnik vode" | "Bojler" | "Bojler" is colloquial. |
| a11y_device_toggle | "Avtomatika: %1$s" | "Avtomatizacija %1$s" | |
| theme_system | "Sistemska" | "Sistem" | The Danish source is a noun; here an adjective that agrees with "Svetla/Temna" (teme). |
| export_title | "Prenos načrta za Home Assistant" | "Prenesi načrt ..." | Noun form avoids the register question. |
| tapnite (chart_hint, location_usage) | "tapnite" | "se dotaknite" | Calque from English but widely used in Slovenian app UIs. |
