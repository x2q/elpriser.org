# App Store Connect via the API (no Xcode account needed)

Python 3 + `pip install pyjwt cryptography requests`. Key file, key id and issuer id are in `asc.py` (the key itself is `~/Downloads/AuthKey_7Q7CCA98A2.p8`, never committed).
`VER`/`INFO` in `ios_meta.py` are the ids of the version/appInfo being edited: look them up first (`GET /v1/apps/<id>/appStoreVersions`, `/appInfos`).

* `ios_meta.py [--apply]`: description/keywords/promo/whatsNew (version localizations) and name/subtitle (appInfo localizations) from `docs/store/<lang>.md`.
* `ios_shots.py [locale ...]`: screenshot sets from `ElpriserIOS/store/screenshots/<lang>/{iphone-6.3 -> APP_IPHONE_61, ipad-13 -> APP_IPAD_PRO_3GEN_129}`; skips a set that already has files, so delete the set (DELETE /v1/appScreenshotSets/<id>) to replace it.
* Submit: POST /v1/reviewSubmissions, POST /v1/reviewSubmissionItems (appStoreVersion), PATCH reviewSubmissions {submitted:true}. Every localization needs `supportUrl` first.
* Territory availability (`/v2/appAvailabilities/<app>/territoryAvailabilities`, PATCH /v1/territoryAvailabilities/<id> {available}) takes effect IMMEDIATELY and without review: switch countries on only after the version that supports them is live.

## Follow-up agent and next versions

* `enable_after_live.py` runs every 30 min via launchd (`~/Library/LaunchAgents/org.elpriser.asc-enable.plist`, venv `~/.cache/elpriser-asc/venv`, log `~/.cache/elpriser-asc/run.log`). When iOS 1.1.0 is READY_FOR_SALE it enables the 30 countries, tries primary language en-GB (retried up to 72 h), notifies and unloads itself. Remove manually: `launchctl bootout gui/$(id -u)/org.elpriser.asc-enable`.
* Every new App Store version must keep an en-GB localization with screenshots (a new version copies the previous version's localizations; do not delete en-GB). Apple only lets the primary language change when English screenshots exist in every version, so Danish stayed primary after 1.1.0 was submitted.
