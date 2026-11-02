# hu — terms to have checked by a native speaker

Register: formal address (Ön / magázás) in sentences and buttons ("Próbálja újra", "Válassza ki"). Many Hungarian consumer apps use informal "te"; this is a tone decision for the owner.

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| mode_spot_price, part_spot_*, caption_spot_*, view_spot_* | "Tőzsdei ár" | "Spotár", "Azonnali ár" | Everyday Hungarian says "tőzsdei ár" (HUPX), energy blogs say "spotár". Chosen as most understandable. |
| caption_zone | "Másnapi (day-ahead) tőzsdei ár ..." | "Másnapi piaci ár" | Keeps "day-ahead" in brackets for people who know the English term. |
| hero_label | "Áramár most" | "Villamos energia ára most", "Áram ára" | "Áramár" is colloquial and short; "villany" is also very common. |
| unit_ct_kwh / unit_ct | "ct/kWh", "ct" | "cent/kWh", "eurócent/kWh", "c/kWh" | No fixed Hungarian convention for euro cents; "ct" is compact for the chart. |
| part_system | "Rendszerirányítási díj (Energinet)" | "Rendszerdíj", "Rendszerszintű díj" | Danish "systemtarif" has no exact Hungarian counterpart; "rendszerirányítási díj" is a real MAVIR term but not an exact match. |
| part_transmission | "Átviteli díj (Energinet)" | "Átviteli hálózati díj" | Fine in meaning, wording unverified. |
| part_grid / part_grid_named | "Hálózati díj" | "Rendszerhasználati díj" | The official Hungarian term on bills is "rendszerhasználati díj"; "hálózati díj" is more understandable for the Danish context. |
| part_duty | "Villamosenergia-adó" | "Energiaadó", "Áramadó" | The Danish elafgift ~ Hungarian "villamosenergia-adó"; Hungary's actual tax is differently structured. |
| part_vat | "Áfa (%1$d%%)" | "ÁFA (... %)" | Lower-case "áfa" is the dictionary form; no space before % is customary in Hungarian. |
| all "netselskab" strings | "hálózatüzemeltető" | "elosztó", "elosztóhálózati engedélyes", "áramszolgáltató" | "Áramszolgáltató" in Hungarian means the retailer, so avoided. "Hálózatüzemeltető" is correct but a little formal. |
| place_zone_title, welcome_zone_body | "Ajánlati zóna" | "Árzóna", "Piaci zóna" | "Ajánlati zóna" is the official bidding-zone term; the consumer word is unclear. |
| weekdays_short | vas, hét, kedd, sze, csüt, pén, szo | V, H, K, Sze, Cs, P, Szo (CLDR) | Mixed lengths for readability on chart axes; CLDR uses single letters for some days. |
| months_short | "jan.", "febr.", "márc." ... "szept." | without dots | Dots are customary in Hungarian dates; the date templates put the month first ("okt. 17."). |
| date_long | "%1$s, %3$s %2$d." ("Vasárnap, okt. 17.") | "okt. 17., vasárnap" | The app passes a capitalised weekday, so it must come first; Hungarian would normally lower-case it mid-sentence. |
| cheaper_later, tooltip, breakdown_heading_* | "%2$s:00-kor" in sentences, plain "%2$s:00" in bubbles | "órakor" | "-kor" suffix works for any number, but reads slightly technical; verify with "ma este", "holnap". |
| tile_cheapest / tile_priciest | "Legolcsóbb %1$s" / "Legdrágább %1$s" | "A legolcsóbb ... " | Works with "ma", "holnap", "vas 17." but "Legolcsóbb ma este" is terse. |
| a11y_period_hint | "Árak megjelenítése: %1$s" | - | The inserted text is a lower-case chart title ("következő 2 nap"). |
| device_water | "Villanybojler" | "Vízmelegítő" | Colloquial and most common word. |
| export_title / export_subtitle | "Terv letöltése a Home Assistant számára" | "Home Assistantba" | Avoids suffixing a brand name. |
| place_no_match | "Nincs találat a(z) „%1$s” kifejezésre ..." | - | The "a(z)" hedge is the standard workaround for unknown words. |
| error strings | "Ellenőrizze a kapcsolatot" | informal | Formal register as above. |
