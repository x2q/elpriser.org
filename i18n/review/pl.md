# pl — review notes

Terms and strings a native speaker should confirm. Address style: informal second-person imperative ("Wybierz", "Spróbuj ponownie"), standard in Polish consumer apps; some labels are neutral.

| Key | Choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh / unit_ct | "ct/kWh", "ct" | "c€/kWh", "eurocent/kWh" | No firm Polish habit for euro cents (Polish prices are in zł and gr) |
| part_grid / caption_net | "opłata dystrybucyjna" | "opłata sieciowa", "opłata za dystrybucję" | Polish bills have separate "opłata dystrybucyjna zmienna/stała/sieciowa"; chose the generic term |
| operator sieci | "operator sieci" | "OSD", "operator systemu dystrybucyjnego" | Consumer wording; OSD is the official term |
| part_system | "Opłata systemowa (Energinet)" | "Opłata za usługi systemowe" | Possible confusion with other Polish levies (e.g. "opłata mocowa") |
| part_transmission | "Opłata przesyłowa (Energinet)" | "Opłata za przesył" | PSE term is "opłata przesyłowa" |
| part_duty, view_nonet_sub | "Akcyza na energię elektryczną" / "akcyza" | "Podatek od energii" | Closest Polish excise; Danish elafgift also covers other levies |
| value_ore | "øre" | "øre duńskie" | Unit kept |
| mode_net_price | "Twoja cena" | "Cena końcowa", "Cena z opłatami" | Mirrors the Danish; "końcowa" is more neutral |
| verdict_cheap/mid/high | "Tanio / Średnio / Drogo teraz" | "Tania / Średnia / Droga godzina" | Adverbial style may read colloquial; short for pills |
| hero_label | "Cena prądu teraz · 14:00" | "Cena energii elektrycznej" | "Prąd" is colloquial; "energia" is formal |
| tile_cheapest / tile_priciest | "Najtaniej dziś", "Najdrożej dziś wieczorem" | "Najtańsza godzina" | Adverbial superlative mirrors the Danish |
| cheaper_later | "Taniej jutro o 03:00 — 1,12 …" | "Jutro o 03:00 taniej" | Word order mirrors the Danish; "o 03:00" with leading zero |
| devices_active | one "urządzenie", few "urządzenia", many "urządzeń", other "urządzenia aktywnego" | | `other` is the fractional genitive singular; unused for integers, check it is acceptable |
| hours_count | "godzina / godziny / godzin / godziny" | | CLDR forms; `other` again for fractions |
| kwh_moved | "Przesunięto %1$s kWh" | "%1$s kWh przesunięte" | Word order reversed vs. Danish |
| a11y_period_hint | "Pokazuje ceny na najbliższe 2 dni" | | Needs the accusative; the title "Najbliższe 2 dni" lower-cased works as is |
| place_zone_title / welcome_zone_body | "Strefa cenowa" | "Strefa rynkowa", "Obszar cenowy" | Official ENTSO-E translation is "obszar rynku/strefa rynkowa"; I used the consumer term |
| note_zone_it_n | "strefy rynkowej Włochy Północne" | "Północ Włoch" | Inflection of a proper name phrase |
| place_group_dk / place_west / place_east | "Dania", "Dania Zachodnia", "Dania Wschodnia" | "Zachodnia Dania" | Established names |
| weekdays_short | "niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob." | "nd", "pn", "wt", "śr", "cz", "pt", "sb" | CLDR vs. calendar convention; "niedz." is longer for the axis |
| months_short | "sty", "lut", …, "paź" | with dots | CLDR; genitive vs nominative is not an issue for abbreviations |
| date_day_month | "17 paź" | "17 paź." | Without dot |
| date_long | "Niedziela, 17 paź" | lower case | The app passes the weekday capitalised |
| part_vat | "VAT (25%)" | "VAT (25 %)" | Polish writes "25%" |
| device_water | "Podgrzewacz wody" | "Bojler", "Zasobnik c.w.u." | Colloquial "bojler" is shorter |
| device_car | "Samochód elektryczny" | "Auto elektryczne" | Length |
| device_avg_save | "śr. %1$s / oszczędność %2$s" | | Two-line text; check wrapping |
| a11y_device_toggle | "Automatyzacja: %1$s" | "Automat %1$s" | Reordered |
| welcome_body | "...zarządza liniami doprowadzającymi prąd do domu... odpowiadały tym, które naprawdę płacisz" | | Slightly long sentence |
| smart_subtitle | "Włączaj w najtańszych godzinach dnia" | "Uruchamiaj ..." | Imperative |
| location_usage | "Twojej lokalizacji ... jednorazowo" | | iOS permission text; check tone and the quoted button name |
| store listing, "grosz" | "tam, gdzie to podjednostka danego kraju" | | Awkward but true to the English source |
