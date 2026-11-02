# App Store Connect via the API (no Xcode account needed)

Python 3 + `pip install pyjwt cryptography requests`. Key file, key id and issuer id are in `asc.py` (the key itself is `~/Downloads/AuthKey_7Q7CCA98A2.p8`, never committed).
`VER`/`INFO` in `ios_meta.py` are the ids of the version/appInfo being edited: look them up first (`GET /v1/apps/<id>/appStoreVersions`, `/appInfos`).

* `ios_meta.py [--apply]`: description/keywords/promo/whatsNew (version localizations) and name/subtitle (appInfo localizations) from `docs/store/<lang>.md`.
* `ios_shots.py [locale ...]`: screenshot sets from `ElpriserIOS/store/screenshots/<lang>/{iphone-6.3 -> APP_IPHONE_61, ipad-13 -> APP_IPAD_PRO_3GEN_129}`; skips a set that already has files, so delete the set (DELETE /v1/appScreenshotSets/<id>) to replace it.
* Submit: POST /v1/reviewSubmissions, POST /v1/reviewSubmissionItems (appStoreVersion), PATCH reviewSubmissions {submitted:true}. Every localization needs `supportUrl` first.
* Territory availability (`/v2/appAvailabilities/<app>/territoryAvailabilities`, PATCH /v1/territoryAvailabilities/<id> {available}) takes effect IMMEDIATELY and without review: switch countries on only after the version that supports them is live.
