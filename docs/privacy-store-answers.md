# Store privacy answers for iOS 1.3.0 (with Apple Watch) and Android 1.3.0

Written 2026-11-03 to go with the rewritten policy at https://elpriser.org/privacy (`privacy.html`, English; the Danish original is https://elpriser.org/privatliv, `privatliv.html`). Every answer below follows from the code, not from what the consoles currently say (they cannot be read from here). Compare each row with what is set in App Store Connect and Play Console; rows marked **CHECK** are where the existing declaration may have to change.

Code read for this: the iOS 1.3.0 tree (`ElpriserIOS/`: Sources, Mac, Watch, Widgets, WatchWidgets, Shared, Bridge, `project.yml`, the four `PrivacyInfo.xcprivacy`) from branch `worktree-agent-a721264424af3a7e8` (0aa7111), the Android 1.3.0 tree from `worktree-agent-a65b893571f8ff755` (b593b92), and the server (`functions/`) on main. Neither 1.3.0 tree is merged to main yet; if they change before release, re-check.

## What the code does, in the terms the stores use

| Fact | Where it is in the code |
|---|---|
| Position: one fix, only after a tap ("Brug min position"); on the Watch after the first-start explanation screen and a tap, or later from the zone screen. Never in the background, never from a widget. | `Sources/PositionFinder.swift`, `Mac/PositionFinderMac.swift`, `Watch/WatchModel.swift` (`locate`), Android `data/Position.kt` |
| Accuracy asked for: 100 m (iOS, Mac, Watch); Android uses network, GPS or the last known fix. Sent to elpriser.org rounded to **5 decimals (about 1 m)**. | `Api.lookup`, Android `Api.lookup` |
| Where it goes: `GET /api/supplierlookup?lat&lng` on elpriser.org. The server asks OpenStreetMap Nominatim (coordinates, from the server, not the user's IP) and, for Danish addresses, Green Power Denmark (the address only). The server caches the answer (address and grid company) in memory for up to 24 h, keyed on the 5-decimal coordinates, with no device or user attached. Our code logs nothing about it. | `handleSupplierLookup` in `functions/api/[[catchall]].js` |
| What is kept on the device: price zone, grid company (name and number), price view, theme, automation settings, reminders, last fetched prices. Never the coordinates or the address. | `Settings`, `SharedStore`, Android `Settings.kt`, `NotifyStore.kt` |
| Positions abroad: the server answers `outside_denmark` plus the address text; iOS, Mac and Watch read the country from the end of that address on the device (`PositionZone`); Android shows a note and asks the user to pick a country. Nothing more is sent. | `Shared/Core/PositionZone.swift` |
| Cheap-hour reminders (iOS and Android 1.3.0): local notifications scheduled on the device. No push: no `aps-environment` entitlement, no APNs or FCM code, no Firebase or Play services dependency, no token, no account. Permission is asked when the first reminder is saved. Background refresh (iOS `BGAppRefreshTask`; Android WorkManager about every 6 h and shortly after 13:05) makes the same price request as the app. Not on Mac, not on Watch. | `Sources/NotifyScheduler.swift`, `project.yml` (`UIBackgroundModes: fetch`), Android `notify/NotifyWork.kt`, `AndroidManifest.xml` |
| App Group `group.org.elpriser.app`: the app writes zone, grid company number and price view for the widget; the iPhone and Watch exchange the same choice over WatchConnectivity. Stays on the devices. The Mac app has no group. | `Shared/Core/SharedStore.swift`, `Bridge/PhoneBridge.swift`, `*.entitlements` |
| Widget, complications and Watch app fetch prices themselves with the same `Api` client. | `Shared/Core/PriceLoader.swift` |
| Network traffic of the apps: only `https://elpriser.org/api/*`. No third-party SDK on iOS (only system frameworks) or Android (Compose, AndroidX, WorkManager, coroutines). No ads, no analytics SDK, no advertising id. | `import` list; `app/build.gradle.kts` |
| Anonymous counts: the User-Agent carries app name and version (`ElpriserIOS/1.3.0 (11)`, `ElpriserAndroid/1.3.0 (7)`). The server writes one Analytics Engine point per GET from a recognised client: client, version, endpoint class, area (DK1/DK2 only), strategy or view, status class. Never IP, device id, grid company, query string. Apple versions (iPhone, iPad, Mac, Watch, widget) all count as `ios`. | `functions/_usage.js` |
| Tracking: none. `NSPrivacyTracking` is false and there are no tracking domains. | all `PrivacyInfo.xcprivacy` |

## App Store Connect: App Privacy ("nutrition label")

One label covers the iPhone/iPad app, the Mac app (same bundle id `org.elpriser.app`), the Watch app and the widgets.

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | Yes (location, below). |
| **Location: Precise Location** | Collected: yes. Linked to the user: **No**. Used for tracking: **No**. Purpose: **App Functionality** only. **CHECK:** the repo's manifests (`Resources/PrivacyInfo.xcprivacy`, `Watch/PrivacyInfo.xcprivacy`) and the existing checklist (`docs/store/europe-release-checklist.md`) say Coarse Location. Apple counts coarse as 3 km or worse; the app asks for 100 m and sends 5 decimals, so the accurate answer is **Precise** (the user may still grant approximate position in the system dialog, but the app cannot rely on that). Either declare Precise, or declare both Coarse and Precise. Keep the label and the manifests identical. |
| Location: Coarse Location | Declare only if you keep both; see above. |
| Contact info, health and fitness, financial info, sensitive info, contacts, user content, browsing history, search history | Not collected. |
| Identifiers (User ID, Device ID) | **Not collected.** No account, no installation id, no IDFA, no vendor id sent. The IP address reaches Cloudflare as in every network request; it is not stored by our code or linked to anything. |
| Purchases | Not collected (the apps are free, no in-app purchases). |
| Usage data (product interaction, advertising data, other) | Not collected inside the app: there is no event tracking in any app. |
| **Diagnostics (Performance data, Other diagnostic data)** | **Judgement call, owner decides.** The anonymous per-call counts (app version, kind of call, DK1/DK2, status class) are server-side, carry no identifier and cannot be linked to a person. Apple's definition of "collect" is about data that leaves the device in a way that lets you read it for longer than the request, so they arguably count. Conservative answer: Diagnostics, Other Diagnostic Data, **not linked, not tracking, purpose Analytics (and App Functionality)**. Keep it consistent with how 1.0.x and 1.1.0 were declared (`docs/store/europe-release-checklist.md` row "Usage telemetry"). |
| Notifications | Nothing to declare: local notifications only, no push token. |
| Do you use data for tracking? | **No.** |
| Privacy policy URL | https://elpriser.org/privacy (English; Danish listing: https://elpriser.org/privatliv). The policy names iPhone, iPad, Mac, Apple Watch, widgets and the reminders. |

Things that are *not* new data collection for the 1.3.0 label: the Watch app (same lookup, same one-time fix, only zone and grid company kept), the reminders (local), the App Group (on the device), the background refresh (same price request).

Per-target manifests (Required Reason APIs): `Widgets`, `WatchWidgets` and `Watch` declare `UserDefaults` with reasons `1C8F.1` (app group) and `CA92.1` (own defaults); `Watch` also declares coarse location, the same as the app. If you change the app to Precise, change `Watch/PrivacyInfo.xcprivacy` in the same commit.

Permission texts (`NSLocationWhenInUseUsageDescription`) in the app, Watch and Mac all say the position is used once, on a tap on "Use my position", and never stored. That matches what the Watch does (its first-start button is that same "Use my position"). No change needed.

## Google Play: Data safety

| Question | Answer |
|---|---|
| Does the app collect or share required user data types? | Yes (location). |
| Is all data encrypted in transit? | Yes (HTTPS only). |
| Can users request that data be deleted? | There is no account and nothing is stored per user, so there is nothing to request deletion of; choose the "no deletion mechanism" option and say in the policy (it does) that nothing is stored per person. Do **not** tick "processed ephemerally" for location: the lookup result is cached in memory for up to 24 h (see above). Keep the plain answer: collected, optional, App functionality. |
| **Location: Approximate location** and **Precise location** | Both: the manifest requests `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`. Collected: yes. Shared: as on the existing declaration (OpenStreetMap receives the coordinates from our server; Green Power Denmark the address). Optional: **yes** (a grid company or country can be picked from a list). Purpose: **App functionality**. **CHECK:** if the console only lists Approximate, add Precise. |
| Personal info (name, email, address, ids), financial info, health, messages, photos, files, calendar, contacts, web browsing, app activity | Not collected. |
| Device or other IDs | **Not collected.** The manifest has no `AD_ID` permission; confirm it is absent in the merged manifest of the release bundle (Play Console shows it under App content > Advertising ID). |
| **App info and performance: Diagnostics** | **Judgement call, owner decides.** Same anonymous counts as on iOS (User-Agent version, kind of call, status class). No crash reporter, no SDK. Conservative answer: collected, not linked to identity, purpose Analytics. Keep consistent with the existing 1.0.x / 1.1.0 declaration. |
| Notifications | `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` are in the manifest of 1.3.0 (no exact-alarm permission, no foreground service, no FCM). They are permissions, not collected data. Nothing to add under Data safety; the permission declaration form is not needed for these. |
| Third-party SDKs that collect data | None. |
| Ads | None. |

## Where the existing declarations may need to change

1. **Location precision** (App Store: Coarse listed in the repo's manifests and checklist; Play: confirm Precise is listed). Precise is what the code does.
2. **Diagnostics** from the anonymous counts: decide once, and make the App Store and Play answers say the same thing. The counts now also cover the Watch, the widget and the Mac (all as `ios`), and the background refresh of the reminders.
3. **Privacy policy URL**: English listings now use https://elpriser.org/privacy (the Danish https://elpriser.org/privatliv keeps working). The page was rewritten; if a store form shows the policy text or the update date, it is now 3 November 2026.
4. **Nothing new for the Watch, notifications, App Group or widget**: these add no data that leaves the device beyond what the app already sent.
5. The **website** (Google Analytics, `store_click`) is outside both store forms; it is described in the policy only.
6. The English listings link to a Danish-only policy (already an open owner decision in `docs/store/europe-release-checklist.md`).
