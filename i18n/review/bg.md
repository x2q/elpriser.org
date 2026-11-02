# bg (Bulgarian) – terms to have a native speaker check

Address: formal plural ("Изберете", "вашата"), as in Android/Google Bulgarian. Button-like actions (copy, close, use my location, forget) use verbal nouns ("Копиране", "Използване на местоположението ми") to avoid mixing registers. Alternative: informal "Избери / твоята".
The App Store has no Bulgarian metadata language, so docs/store/bg.md holds only the Google Play fields (ios.* = n/a).

| Key(s) | Choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh, unit_ct | "евроцента/kWh", "евроцента" | "ст./kWh", "ц/kWh" | After the euro changeover "ст." (stotinki) could still read as the old lev; "евроцента" is unambiguous but long. Check chart fit. |
| hero_label | "Цена на тока сега" | "Цена на електроенергията сега" | "ток" is colloquial and short; the breakdown rows use the formal "електроенергия". |
| mode_spot_price etc. | "Спот цена" | "Борсова цена", "Цена на борсата" | "Спот" is the market term; view_spot_incl_sub uses "Борсовата цена". caption_zone says "пазара „ден напред“" (IBEX term). |
| part_grid, caption_net, part_system, part_transmission | "Мрежова / Системна / Преносна тарифа" | "Цена за достъп и пренос", "Мрежови услуги" | Bulgarian bills say "цена за достъп/пренос през електропреносната/разпределителната мрежа"; my wording is generic but understandable. |
| part_duty | "Акциз върху електроенергията" | "Данък върху електроенергията" | The Bulgarian electricity excise applies mostly to business users; household readers may not know the term. |
| grid company everywhere | "мрежов оператор" | "електроразпределително дружество", "ЕРД" | The official term is long and regional; I chose the short generic one. |
| place_use_position, location_usage | "местоположение" | "позиция", "локация" | "местоположение" is Google's term; check it fits the button. |
| weekdays_short | нд пн вт ср чт пт сб | нед пон вто сря ... | CLDR two-letter forms, chosen for tight chart axes. |
| months_short | яну фев март апр май юни юли авг сеп окт ное дек | with dots, "ян. фев. мар." | CLDR forms; "март/юни/юли" are full words, so lengths are mixed. |
| tile_cheapest, tile_priciest | "Най-евтино днес" | "Най-евтин час днес" | Neuter adverbial form without a noun; may read oddly. |
| devices_active | "%1$d активно устройство" | "%1$d устройство е активно" | Adjective-first word order. |
| device_water | "Бойлер" | "Водонагревател" | Boiler is the everyday term. |
| kwh_moved | "%1$s kWh преместени" | "изместени", "Преместени: %1$s kWh" | Verb choice and agreement. |
| theme_system/light/dark | "Системна / Светла / Тъмна" | "Системен", "Светъл" | Feminine, agreeing with an implied "тема"; unsure what the label above implies. |
| action_privacy | "Поверителност" | "Поверителност и лични данни" | - |
| Store text | whole play.* text | - | Marketing copy written from the English; not read by a native speaker. |
