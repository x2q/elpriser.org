#!/usr/bin/env python3
"""One-shot follow-up for the Europe release, run every 30 minutes by launchd (org.elpriser.asc-enable) until it is done.

When iOS 1.1.0 is READY_FOR_SALE: (1) make the app available in the 30 European countries, (2) set the primary language to
en-GB (Apple refuses this while an older version without English screenshots exists, so it is retried on every run for up to
72 h), (3) notify and unload the agent. A rejected version only notifies. Idempotent; state in ~/.cache/elpriser-asc/state.json.
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc import call, APP

VERSION_ID = "e87849cb-8d82-4018-9deb-007f25881267"          # iOS 1.1.0
TERRITORIES = "ALB AUT BEL BGR CHE CZE DEU EST ESP FIN FRA GRC HRV HUN IRL ITA LTU LUX LVA MNE MKD NLD NOR POL PRT ROU SRB SWE SVN SVK".split()
LABEL = "org.elpriser.asc-enable"
STATE = os.path.expanduser("~/.cache/elpriser-asc/state.json")
GIVE_UP_PRIMARY_AFTER = 72 * 3600

def log(m): print(time.strftime("%Y-%m-%d %H:%M:%S"), m, flush=True)
def notify(m): subprocess.run(["osascript", "-e", f'display notification "{m}" with title "Elpriser App Store"'], check=False)
def unload(): subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"], check=False)

def main():
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    st = json.load(open(STATE)) if os.path.exists(STATE) else {}
    s, j = call("GET", f"/v1/appStoreVersions/{VERSION_ID}")
    if s != 200:
        log(f"version lookup failed {s}"); return
    state = j["data"]["attributes"]["appStoreState"]; log(f"1.1.0 state {state}")
    if state in ("REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "DEVELOPER_REJECTED"):
        if st.get("rejected") != state:
            notify(f"iOS 1.1.0: {state}. Se App Store Connect."); st["rejected"] = state
            json.dump(st, open(STATE, "w"))
        return
    if state != "READY_FOR_SALE":
        return
    st.setdefault("live_at", time.time())
    if not st.get("territories"):
        s, j = call("GET", f"/v2/appAvailabilities/{APP}/territoryAvailabilities", params={"limit": 200})
        ids = {x["relationships"]["territory"]["data"]["id"]: x["id"] for x in j["data"]}
        bad = []
        for t in TERRITORIES:
            r = call("PATCH", f"/v1/territoryAvailabilities/{ids[t]}", {"data": {"type": "territoryAvailabilities", "id": ids[t], "attributes": {"available": True}}})
            if r[0] >= 300: bad.append(t)
        log(f"territories enabled, failed: {bad}")
        st["territories"] = not bad
    if not st.get("primary"):
        r = call("PATCH", f"/v1/apps/{APP}", {"data": {"type": "apps", "id": APP, "attributes": {"primaryLocale": "en-GB"}}})
        ok = r[0] < 300; log(f"primary en-GB: {r[0] if not ok else 'ok'}"); st["primary"] = ok
    json.dump(st, open(STATE, "w"))
    if st.get("territories") and st.get("primary"):
        notify("iOS 1.1.0 er live: 30 lande tændt og engelsk er primaersprog."); unload()
    elif time.time() - st["live_at"] > GIVE_UP_PRIMARY_AFTER:
        notify("iOS 1.1.0 live og landene tændt. Primaersprog kunne ikke skiftes til engelsk."); unload()
    elif st.get("territories") and not st.get("notified_live"):
        notify("iOS 1.1.0 er live og de 30 lande er tændt. Proever stadig engelsk primaersprog."); st["notified_live"] = True
        json.dump(st, open(STATE, "w"))

if __name__ == "__main__":
    main()
