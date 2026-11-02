# el (Greek) – terms to have a native speaker check

Address: formal plural ("Επιλέξτε", "σας"), the convention of Greek consumer apps. Button actions use verbal nouns ("Αντιγραφή", "Κλείσιμο", "Χρήση της τοποθεσίας μου").

| Key(s) | Choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh, unit_ct | "λεπτά/kWh", "λεπτά" | "c/kWh", "λεπτά του ευρώ/kWh" | Greek retail sites mostly use €/kWh; "λεπτά" could read as minutes when shown without "/kWh" (unit_ct is used without it in tiles). Check on screen. |
| mode_spot_price, part_spot_*, captions | "Τιμή spot" | "Τιμή χονδρικής", "Τιμή αγοράς επόμενης ημέρας" | Greek consumers know "τιμή χονδρικής"; "spot" is used by the media. caption_zone says "Τιμή χονδρικής στην αγορά επόμενης ημέρας". |
| part_grid, caption_net, caption_system, view_* | "Χρέωση δικτύου", "Χρεώσεις Energinet" | "Τέλη δικτύου", "Χρεώσεις χρήσης δικτύου" | Greek bills say "Χρεώσεις Χρήσης Δικτύου"; "τιμολόγιο" avoided because it means retail plan or invoice. |
| part_system, part_transmission | "Χρέωση συστήματος", "Χρέωση μεταφοράς" | "Χρέωση χρήσης συστήματος μεταφοράς" | Short forms; Danish tariff types do not map one to one. |
| part_duty | "Φόρος ηλεκτρικής ενέργειας" | "Ειδικός Φόρος Κατανάλωσης (ΕΦΚ) ηλεκτρικής ενέργειας" | ΕΦΚ is the formal term; kept short for the breakdown row. |
| grid company | "διαχειριστής δικτύου" | "διαχειριστής δικτύου διανομής" | Generic term; in Greece the DSO is a single company. |
| tile_cheapest, tile_priciest | "Φθηνότερη ώρα σήμερα" | "Φθηνότερη σήμερα" | Added "ώρα" for clarity; longer label. |
| cheaper_later | "Φθηνότερα %1$s στις %2$s:00" | "Πιο φθηνά ..." | Adverb form; with day words like "Κυρ 17" it reads telegraphic. |
| hero_label | "Τιμή ρεύματος τώρα" | "Τιμή ηλεκτρικής ενέργειας τώρα" | "ρεύμα" is colloquial; the formal alternative is long for the label. |
| weekdays_long | capitalised (Κυριακή ...) | lower case | Greek usage varies; capitalised is common in UI, lower case is the grammatical norm. |
| months_short | Ιαν Φεβ Μαρ Απρ Μαΐ Ιουν Ιουλ Αυγ Σεπ Οκτ Νοε Δεκ | with dots | CLDR forms; "Μαΐ" may look odd. |
| hours "στις %1$s:00" | "στις 01:00" | "στη 01:00" | Grammatically "στη μία"; numerals are conventionally written "στις 01:00". |
| kwh_moved | "Μετατόπιση %1$s kWh" | "%1$s kWh μετατοπίστηκαν" | Noun phrase to avoid agreement issues. |
| device_water | "Θερμοσίφωνας" | "Μπόιλερ" | Everyday term. |
| a11y_period_hint | "Εμφανίζει τις τιμές για τις %1$s" | - | Depends on the title being "επόμενες 2 ημέρες" (accusative plural, no article). |
| about_sources_eu | "που μετατρέπονται ... από το elpriser.org" | - | Wording keeps the CC BY "data were changed" statement. |
| action_privacy | "Απόρρητο" | "Προστασία προσωπικών δεδομένων" | - |
| Store: Macedonian language name | "μακεδονικά" | "σλαβομακεδονικά" | Politically sensitive in Greece; "μακεδονικά" follows the Prespa agreement, please confirm. |
| ios.keywords | "χονδρική,ωριαία,δυναμικό τιμολόγιο ..." | - | Chosen from my knowledge of Greek dynamic-tariff vocabulary, not validated against App Store search volumes. |
