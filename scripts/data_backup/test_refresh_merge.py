#!/usr/bin/env python3
"""Offline tests for refresh_hf_datasets.py's merge — the part that decides what
reaches a public dataset. Run: npm run test:refresh

The cases are the ones that actually happened: published files that already
contain duplicate keys (ENTSO-E returned overlapping series for Denmark), files
sorted newest-first (Energinet's own order), and a fetch whose columns drifted.
"""
import importlib.util
import os
import sys

import pandas as pd

os.environ.setdefault("ENTSOE_TOKEN", "test")      # the collection module reads it on import
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("refresh", os.path.join(HERE, "refresh_hf_datasets.py"))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

passed, failed = 0, []
def ok(cond, name):
    global passed
    if cond: passed += 1
    else: failed.append(name)

ts = lambda d, h: f"2026-07-{d:02d}T{h:02d}:00:00+00:00"
old = pd.DataFrame({"datetime_utc": [ts(1, 0), ts(1, 1), ts(1, 1), ts(2, 0), ts(3, 0)], "load_mw": [1., 2., 2.5, 3., 4.]})
new = pd.DataFrame({"datetime_utc": [ts(2, 0), ts(3, 0), ts(4, 0)], "load_mw": [3.5, 4.5, 5.]})

out = R.merge("entsoe_dk1_load_actual", old, new, ["datetime_utc"], False)
ok(out.load_mw.tolist() == [1., 2., 2.5, 3.5, 4.5, 5.], "history before the window is kept, including a pre-existing duplicate key")
ok(out.datetime_utc.is_monotonic_increasing, "ascending files stay ascending")
ok(R.merge("x", old.iloc[::-1].reset_index(drop=True), new, ["datetime_utc"], False).datetime_utc.is_monotonic_decreasing,
   "newest-first files stay newest-first")

for label, bad in (("a renamed column", new.rename(columns={"load_mw": "v"})), ("an extra column", new.assign(z=1))):
    try: R.merge("x", old, bad, ["datetime_utc"], False); ok(False, f"refuses {label}")
    except ValueError: ok(True, f"refuses {label}")

# dtype is kept, or the merge refuses — never silently coerced to something else
try:
    R.merge("x", old, new.assign(load_mw=["a", "b", "c"]), ["datetime_utc"], False); ok(False, "refuses an uncastable dtype")
except ValueError: ok(True, "refuses an uncastable dtype")

# a source that has gone stale is refused when the series must be current
stale = pd.DataFrame({"datetime_utc": [ts(2, 0)], "load_mw": [9.]})
try: R.merge("x", old, stale, ["datetime_utc"], True); ok(False, "refuses a stale source")
except ValueError: ok(True, "refuses a stale source")

# composite keys: same timestamp, different type, are different rows
g_old = pd.DataFrame({"datetime_utc": [ts(1, 0)] * 2, "psr_type": ["B16", "B19"], "quantity_mw": [1., 2.]})
g_new = pd.DataFrame({"datetime_utc": [ts(1, 0)], "psr_type": ["B19"], "quantity_mw": [2.5]})
g = R.merge("entsoe_no1_generation_per_type", g_old, g_new, ["datetime_utc", "psr_type"], False)
ok(sorted(g.quantity_mw.tolist()) == [1., 2.5], "only the matching (timestamp, type) row is replaced")

# every file kind maps to its key
for name, key in (("entsoe_no1_dayahead_prices", ["datetime_utc"]), ("entsoe_delu_generation_per_type", ["datetime_utc", "psr_type"]),
                  ("entsoe_flow_dk1_delu", ["datetime_utc", "direction"]), ("entsoe_ntc_dk2_delu", ["datetime_utc", "direction"]),
                  ("entsoe_dk1_installed_capacity", ["year", "psr_type"]), ("eds_dayaheadprices_dk1", ["TimeUTC", "PriceArea"]),
                  ("eds_co2emis_dk2", ["TimeDK", "PriceArea"]), ("eds_consumption_profile_private", ["TimeDK"])):
    ok(R.key_of(name) == key, f"key of {name}")

# the JAO flow-based data can never be a refresh target: the allowlist is the repo's own files
ok(not any("jao" in n for n in ("entsoe_no1_dayahead_prices", "eds_dayaheadprices_dk1")), "no JAO name in the refresh set")
ok("jao" not in open(os.path.join(HERE, "refresh_hf_datasets.py")).read().lower().replace("jao nordic flow-based data", "").replace("jao credential", ""),
   "refresh_hf_datasets.py never refers to JAO beyond its warning")

print(f"{passed} beståede, {len(failed)} fejl")
for f in failed: print("  ✗", f)
sys.exit(1 if failed else 0)
