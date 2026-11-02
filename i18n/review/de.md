# de — review notes

Terms and strings a native speaker (Germany/Austria/Switzerland) should confirm. Written du/Sie-free (infinitives, impersonal), consistent across the UI.

| Key | Choice | Alternative | Why unsure |
|---|---|---|---|
| mode_net_price | "Endpreis" | "Dein Preis", "Verbraucherpreis" | Avoids du/Sie, but "Endpreis" may read as retail price incl. supplier margin, which the app does not show (Danish price = spot + tariffs + taxes + VAT) |
| place_title | "Standort" | "Wo befindest du dich?" | Danish is a question; a noun title avoids addressing the reader |
| place_zone_title, welcome_zone_body, place_zone_note, note_zone_de_lu | "Preiszone" | "Gebotszone" (official, SMARD/ENTSO-E) | Consumer-friendly vs. official; "Gebotszone" is kept only in note_zone_it_n. Check for consistency |
| part_system | "Systementgelt (Energinet)" | "Systemdienstleistungsentgelt", "Systemtarif" | No exact German equivalent of the Danish systemtarif; invented but descriptive |
| part_transmission | "Übertragungsentgelt (Energinet)" | "Übertragungsnetzentgelt" | Shortened for width; the longer form is the textbook term |
| part_grid / part_grid_named, caption_net | "Netzentgelt" | "Netztarif" | "Netzentgelt" is the German regulatory term; Danish "nettarif" is closer to "Netztarif" |
| caption_net, view_*_sub | "Abgaben" for Danish "afgifter" (and "Steuern" nowhere) | "Steuern und Abgaben" | "Abgaben" covers taxes and levies but may sound vague |
| part_duty, view_nonet_sub | "Stromsteuer" | "Elafgift" kept | Closest German equivalent of the Danish elafgift, but legally not identical (different base and rate) |
| caption_spot_excl, view_spot_excl_title | "exkl. MwSt." | "zzgl. MwSt.", "ohne MwSt." | "exkl." is the CH/AT habit, "zzgl." the DE one |
| part_vat | "MwSt. (25 %)" | "USt." | MwSt. is understood in DE/AT/CH; AT/DE invoices often say USt. |
| device_water | "Warmwasserspeicher" | "Boiler", "Warmwasserbereiter" | "Boiler" is shorter and common in CH/AT/DE; "Speicher" is more precise but long |
| device_avg_save | "Ø %1$s / Ersparnis %2$s" | "durchschn." | "Ø" for average is compact, check that the glyph renders in the font |
| months_short | "Jan.", "Feb.", "März", …, "Sept." | no dots | Duden/Android style with trailing dots and uneven lengths (März, Mai, Juni, Juli); chart axis may look uneven |
| weekdays_short | "So", "Mo", … without dot | "So.", "Mo." | iOS style is without a dot; Duden has a dot |
| day_short_date | "So, 17." | "So. 17." | Comma after the weekday is my choice |
| hero_label* / tooltip | "14:00 Uhr" | "14 Uhr", "14:00" | "Uhr" costs width in the chart bubble; consider dropping it in the tooltip |
| cheaper_later | "Günstiger morgen um 03:00 Uhr – 1,12 …" | "Morgen um 03:00 Uhr günstiger" | Sentence order kept from the Danish to keep placeholders stable; the day word is lower case |
| tile_cheapest / tile_priciest | "Am günstigsten heute", "Am teuersten heute Abend" | "Günstigste Stunde heute" | Adverbial superlative mirrors the Danish |
| verdict_mid | "Jetzt durchschnittlich" | "Jetzt mittel" | Long for a pill on small phones |
| smart_subtitle | "Betrieb in den günstigsten Stunden von heute" | "Läuft in den günstigsten Stunden" | Danish is an imperative ("Kør efter ..."); this is a noun phrase |
| welcome_body, note_* | impersonal ("wird ermittelt", "in der Liste wählen") | "du"/"Sie" | Some sentences become slightly stiff; a native may prefer a consistent "du" |
| place_your_country | "Mein Land" | "Dein Land" | Section header; first-person to stay du/Sie-free |
| value_ore | "øre" lower case | "Øre" | German capitalises nouns, but it is a unit like "ct" |
