#!/usr/bin/env python3
"""Top up the published Elpriser/*-power-market datasets from their sources.

    python3 refresh_hf_datasets.py              dry run: fetch, merge, validate, report
    python3 refresh_hf_datasets.py --publish    ...and upload what passed

Run on the machine that holds ENTSOE_TOKEN and HF_TOKEN (source
~/.config/elpriser.env). The six country datasets had no script of their own —
they were uploaded by hand from a local backup — so this is that script.

THE ALLOWLIST IS THE REPOSITORY. Every file to refresh is taken from what the
Hugging Face repo already holds; nothing else is ever fetched or uploaded, so a
file that does not belong in a public dataset (the JAO Nordic flow-based data,
whose terms forbid redistribution, sits in the same local backup folder) cannot
reach it by construction. This module imports only the EDS and ENTSO-E
fetchers and never reads a JAO credential.

A file is replaced only if every request for it succeeded, its schema and
dtypes are unchanged, and it gained data. A failed or partial fetch leaves the
published file exactly as it was; nothing is published half-updated.
"""
import argparse
import os
import re
import subprocess
import sys
import time
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_all_history as F

WORK = os.path.expanduser("~/hf_refresh")        # the published files, as downloaded
OUT = os.path.expanduser("~/hf_refresh_out")     # refreshed copies, ready to upload
REPOS = ["denmark-power-market", "norway-power-market", "sweden-power-market",
         "finland-power-market", "netherlands-power-market", "germany-power-market"]
OVERLAP = timedelta(days=3)      # re-fetch this much of what is already there; the new rows win
TODAY = date.today()


# ── HTTP: the collection script's curl_get has no retry and no status check, so a
#    429 or 503 from ENTSO-E reads as "no data" and silently leaves a gap. ──────────
def checked_curl_get(url, timeout=120):
    last = None
    for attempt in range(5):
        r = subprocess.run(["curl", "-s", "--max-time", str(timeout), "-w", "\n%{http_code}", url],
                           capture_output=True, text=True)
        body, _, code = r.stdout.rpartition("\n")
        last = f"HTTP {code or '?'} rc={r.returncode}"
        if r.returncode == 0 and code == "200":
            return body
        # ENTSO-E answers 200 with an Acknowledgement when there is nothing to return
        # for the window, but some deployments use 400; both mean "no data", not "error".
        if code in ("400", "404") and re.search(r"No matching data|999", body):
            return body
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"giving up on {url.split('securityToken')[0]}… ({last})")


F.curl_get = checked_curl_get


def chunked(fn, args, start, end, days):
    rows, cur = [], start
    while cur < end:
        ce = min(cur + timedelta(days=days), end)
        rows.extend(fn(*args, cur, ce))
        cur = ce
    return rows


# ── refreshers: name -> (new rows as a DataFrame, whether the source must be current) ──
def zone_of(name):                      # entsoe_no1_dayahead_prices -> no1
    return name.split("_")[1]


def refresh_entsoe(name, old, kind, eic_by_zone):
    z = zone_of(name)
    eic = eic_by_zone[z]
    last = pd.to_datetime(old["datetime_utc"], utc=True).max().date()
    start, end = last - OVERLAP, TODAY + timedelta(days=2)
    if kind == "dayahead_prices":
        return pd.DataFrame(chunked(F.fetch_entsoe_prices_chunk, (eic,), start, end, 90)), True
    if kind == "generation_per_type":
        return pd.DataFrame(chunked(F.fetch_entsoe_generation_chunk, (eic,), start, end, 30)), True
    if kind == "load_actual":
        return pd.DataFrame(chunked(F.fetch_entsoe_load_chunk, (eic, "A16"), start, end, 90)), True
    if kind == "load_forecast":
        return pd.DataFrame(chunked(F.fetch_entsoe_load_chunk, (eic, "A01"), start, end, 90)), False
    if kind == "windsolar_forecast":
        return pd.DataFrame(chunked(F.fetch_entsoe_windsolar_forecast_chunk, (eic,), start, end, 90)), False
    raise KeyError(kind)


def refresh_capacity(name, old, eic_by_zone):
    eic = eic_by_zone[zone_of(name)]
    rows = []
    for y in range(int(old["year"].max()), TODAY.year + 1):
        rows.extend(F.fetch_entsoe_capacity_year(eic, y))
    return pd.DataFrame(rows), False


def refresh_border(name, old):          # entsoe_flow_dk1_delu / entsoe_ntc_dk1_delu
    kind, pair = name.split("_")[1], "_".join(name.split("_")[2:])
    _, in_eic, out_eic = next(p for p in F.BORDER_PAIRS if p[0] == pair)
    last = pd.to_datetime(old["datetime_utc"], utc=True).max().date()
    start, end = last - OVERLAP, TODAY + timedelta(days=2)
    fn = F.fetch_entsoe_flow_chunk if kind == "flow" else F.fetch_entsoe_ntc_chunk
    fwd = chunked(fn, (in_eic, out_eic), start, end, 90)
    rev = chunked(fn, (out_eic, in_eic), start, end, 90)
    a, b = pair.split("_")
    for r in fwd: r["direction"] = f"{b}_to_{a}"
    for r in rev: r["direction"] = f"{a}_to_{b}"
    return pd.DataFrame(fwd + rev), kind == "flow"


def eds_rows(dataset, area, start, end, columns=None, flt=None):
    import json, urllib.parse
    f = urllib.parse.quote(json.dumps(flt or {"PriceArea": area}))
    cols = f"&columns={columns}" if columns else ""
    url = (f"https://api.energidataservice.dk/dataset/{dataset}"
           f"?start={start}&end={end}&filter={f}&limit=0{cols}")
    for attempt in range(6):
        try:
            return pd.DataFrame(F.fetch_json(url, timeout=300).get("records", []))
        except Exception as e:
            if "429" not in str(e) or attempt == 5:
                raise
            time.sleep(30 * (attempt + 1))


def refresh_eds(name, old):
    area = name.rsplit("_", 1)[1].split(".")[0].upper()
    tc = {"eds_dayaheadprices": "TimeUTC", "eds_productionconsumptionsettlement": "HourUTC",
          "eds_co2emis": "TimeDK", "eds_consumption_profile_private": "TimeDK"}
    base = next(k for k in tc if name.startswith(k))
    last = pd.to_datetime(old[tc[base]]).max()
    start = (last - OVERLAP).date().isoformat()
    end = (TODAY + timedelta(days=1)).isoformat()
    if base == "eds_dayaheadprices":
        return eds_rows("DayAheadPrices", area, start, end), True
    if base == "eds_productionconsumptionsettlement":
        return eds_rows("ProductionConsumptionSettlement", area, start, end), False  # published with a lag
    if base == "eds_co2emis":
        df = eds_rows("CO2Emis", area, start, end)
        df["hour"] = pd.to_datetime(df["Minutes5DK"]).dt.floor("h")
        g = df.groupby("hour")["CO2Emission"].agg(["mean", "count"]).reset_index()
        g = g[g["count"] >= 12]          # a part-filled last hour is a wrong average, not a late one
        out = pd.DataFrame({"TimeDK": g["hour"], "CO2Emission_g_per_kWh": g["mean"], "PriceArea": area})
        return out, True
    df = eds_rows("ConsumptionDK3619IndustryHour", None, start, end,
                  "TimeDK,Consumption_MWh", {"DK36Code": "PR"})
    return df, False


# Files that stay as published, with the reason. The refresh would otherwise change their character.
SKIP = {
    "entsoe_no5_windsolar_forecast":
        "NO5 has no wind or solar; the source now returns an all-zero series that would turn an 89-row file into ~27,000 rows of zeros",
}


def same_content(a, b):
    """Same rows regardless of order (a refresh can reorder ties)."""
    if len(a) != len(b):
        return False
    cols = list(a.columns)
    return a.sort_values(cols, kind="stable").reset_index(drop=True).equals(
        b.sort_values(cols, kind="stable").reset_index(drop=True))


# ── merge + validation ────────────────────────────────────────────────────────
KEYS = {  # timestamp column + any further key columns, per file kind
    "entsoe_dayahead_prices": ["datetime_utc"], "entsoe_load_actual": ["datetime_utc"],
    "entsoe_load_forecast": ["datetime_utc"], "entsoe_generation_per_type": ["datetime_utc", "psr_type"],
    "entsoe_windsolar_forecast": ["datetime_utc", "psr_type"], "entsoe_installed_capacity": ["year", "psr_type"],
    "entsoe_flow": ["datetime_utc", "direction"], "entsoe_ntc": ["datetime_utc", "direction"],
    "eds_dayaheadprices": ["TimeUTC", "PriceArea"], "eds_productionconsumptionsettlement": ["HourUTC", "PriceArea"],
    "eds_co2emis": ["TimeDK", "PriceArea"], "eds_consumption_profile_private": ["TimeDK"],
}
TSCOL = {"datetime_utc": "datetime_utc", "TimeUTC": "TimeUTC", "HourUTC": "HourUTC", "TimeDK": "TimeDK", "year": "year"}


def key_of(name):
    """The columns that identify a row, from the file name alone."""
    parts = name.split("_")
    if name.startswith(("entsoe_flow", "entsoe_ntc")):
        return KEYS[f"entsoe_{parts[1]}"]                  # entsoe_flow_dk1_delu
    if name.startswith("entsoe_"):
        return KEYS["entsoe_" + "_".join(parts[2:])]       # entsoe_no1_dayahead_prices
    return next(KEYS[k] for k in KEYS if k.startswith("eds_") and name.startswith(k))


def merge(name, old, new, keys, must_be_current):
    """Replace only what the re-fetched window covers; leave history as published.

    The first version de-duplicated the whole file on its key and refused four
    Danish files for "losing rows" — which was true: they already hold duplicate
    keys (ENTSO-E returned overlapping series for Denmark), and that is the
    published data, not this tool's to rewrite. So: drop the old rows whose key
    reappears in the fresh window, add the fresh rows, and check that nothing
    before the window changed."""
    if set(new.columns) != set(old.columns):
        raise ValueError(f"columns differ: new {sorted(new.columns)} vs published {sorted(old.columns)}")
    new = new[list(old.columns)].copy()
    for c in old.columns:
        if str(new[c].dtype) != str(old[c].dtype):
            try:
                new[c] = new[c].astype(old[c].dtype)
            except Exception as e:
                raise ValueError(f"cannot keep dtype of {c}: {old[c].dtype} <- {new[c].dtype} ({e})")
    ts = keys[0]
    new = new.drop_duplicates(subset=keys, keep="last")
    hit = old.merge(new[keys].drop_duplicates(), on=keys, how="left", indicator=True)["_merge"].to_numpy() == "both"
    merged = pd.concat([old[~hit], new], ignore_index=True)
    asc = bool(old[ts].iloc[0] <= old[ts].iloc[-1]) if ts != "year" else True
    merged = merged.sort_values(ts, ascending=asc, kind="stable").reset_index(drop=True)
    if ts != "year":
        edge = new[ts].min()
        if int((old[ts] < edge).sum()) != int((merged[ts] < edge).sum()):
            raise ValueError("rows before the refreshed window changed")
        if must_be_current:
            newest = pd.to_datetime(merged[ts], utc=True, errors="coerce").max()
            if newest < pd.Timestamp(TODAY - timedelta(days=4), tz="UTC"):
                raise ValueError(f"source is not current: newest row {newest}")
    return merged


def refresh_pricelist(old):
    """DatahubPricelist is a registry, not a log, and Energinet edits it: a
    snapshot taken three months after the published one had dropped twelve
    retired network companies and most of their rows (441,196 -> 120,951) and
    carried different values on 12,844 shared price cells. Replacing the file
    with it would delete history that is still the right answer for analysing
    past dates, and appending by timestamp would not even apply — so this is a
    union by (owner, charge code, ValidFrom): every published row stays exactly
    as it was, and a record is added only when its key is not already there.
    That picks up what has been announced since (Radius's tariff from April 2027,
    for one) without rewriting anything. Revised values on existing keys are
    deliberately NOT applied; the README says so."""
    j = F.fetch_json("https://api.energidataservice.dk/dataset/DatahubPricelist?limit=0", timeout=900)
    new = pd.DataFrame(j.get("records", []))
    if set(new.columns) != set(old.columns):
        raise ValueError(f"columns differ: {sorted(set(new.columns) ^ set(old.columns))}")
    new = new[list(old.columns)].copy()
    for c in old.columns:
        if str(new[c].dtype) != str(old[c].dtype):
            new[c] = new[c].astype(old[c].dtype)
    if len(new) < 0.1 * len(old):
        raise ValueError(f"snapshot looks broken: {len(new):,} rows vs {len(old):,} published")
    key = ["GLN_Number", "ChargeTypeCode", "ValidFrom"]
    fresh = new.merge(old[key].drop_duplicates(), on=key, how="left", indicator=True)
    add = new[(fresh["_merge"] == "left_only").to_numpy()]
    return pd.concat([old, add], ignore_index=True), len(add)


def eic_map():
    return dict(F.ALL_ZONES)


def run(publish, only=None):
    import glob
    report, ok_files = [], {}
    for repo in REPOS:
        os.makedirs(f"{OUT}/{repo}", exist_ok=True)
        for path in sorted(glob.glob(f"{WORK}/{repo}/*.parquet")):
            name = os.path.basename(path)[:-8]
            if only and name not in only:
                continue
            old = pd.read_parquet(path)
            t0 = time.time()
            try:
                if name in SKIP:
                    report.append((repo, name, "skipped", SKIP[name])); continue
                if name.startswith("eds_elspotprices"):
                    report.append((repo, name, "static", "legacy dataset, ended 2025-09-30")); continue
                if name == "eds_datahubpricelist":
                    union, n_add = refresh_pricelist(old)
                    if n_add == 0:
                        report.append((repo, name, "unchanged", "no record newer than the published ones")); continue
                    union.to_parquet(f"{OUT}/{repo}/{name}.parquet", index=False)
                    ok_files.setdefault(repo, []).append(name)
                    report.append((repo, name, "refreshed", f"+{n_add:,} records not previously published; {len(old):,} existing rows untouched  ({time.time()-t0:.0f}s)"))
                    print(f"  {repo[:10]:10} {name:52} {report[-1][2]:10} {report[-1][3]}", flush=True); continue
                if name.startswith("eds_"):
                    new, cur = refresh_eds(name, old)
                    keys = key_of(name)
                elif name.startswith("entsoe_flow") or name.startswith("entsoe_ntc"):
                    new, cur = refresh_border(name, old); keys = key_of(name)
                elif name.endswith("installed_capacity"):
                    new, cur = refresh_capacity(name, old, eic_map()); keys = ["year", "psr_type"]
                else:
                    kind = name.split("_", 2)[2]
                    new, cur = refresh_entsoe(name, old, kind, eic_map()); keys = key_of(name)
                if not len(new):
                    report.append((repo, name, "unchanged", "source returned no new rows")); continue
                merged = merge(name, old, new, keys, cur)
                added = len(merged) - len(old)
                if same_content(merged, old):
                    report.append((repo, name, "unchanged", "nothing newer than what is published")); continue
                ts = keys[0]
                last = str(pd.to_datetime(merged[ts], utc=True, errors="coerce").max())[:16] if ts != "year" else str(int(merged["year"].max()))
                merged.to_parquet(f"{OUT}/{repo}/{name}.parquet", index=False)
                ok_files.setdefault(repo, []).append(name)
                report.append((repo, name, "refreshed", f"+{added:,} rows -> last {last}  ({time.time()-t0:.0f}s)"))
            except Exception as e:
                report.append((repo, name, "FAILED", f"{type(e).__name__}: {str(e)[:150]}"))
            print(f"  {repo[:10]:10} {name:52} {report[-1][2]:10} {report[-1][3]}", flush=True)
    return report, ok_files


UPDATES = """## Updates

Last refreshed {today}. Each refresh re-fetches the most recent three days of every series and replaces those rows, so very recent *actual* values (generation, load, flows) can be revised between refreshes; everything older is left exactly as published. Refreshed with [`scripts/data_backup/refresh_hf_datasets.py`](https://github.com/x2q/elpriser.org/blob/main/scripts/data_backup/refresh_hf_datasets.py) in the elpriser.org repository.
{extra}"""

EXTRA = {
    "denmark-power-market": (
        "\n`eds_datahubpricelist.parquet` is a union, not a snapshot: Energinet edits this registry in place and has since dropped "
        "twelve retired network companies and most of their rows. Every row published in July is kept as it was; records announced "
        "since then (new tariffs with a later `ValidFrom`) have been added. Revised values on keys that already existed are not applied, "
        "so for the current value of a tariff use the latest `ValidFrom` per owner and charge code.\n"
        "\n`eds_elspotprices_*` is the legacy Energinet dataset and ended 2025-09-30; later prices are in `eds_dayaheadprices_*`.\n"),
    "norway-power-market": (
        "\n`entsoe_no5_windsolar_forecast.parquet` is not refreshed: NO5 has no wind or solar generation and ENTSO-E now returns an all-zero series for it.\n"),
}


def update_readmes(api, ok, up_fail):
    """Add or replace the Updates section in each repo that actually changed, and fix the index."""
    import io
    from huggingface_hub import hf_hub_download
    failed_repos = {x.split("/")[0] for x in up_fail}
    for repo in ok:
        if repo in failed_repos:
            continue
        text = open(f"{WORK}/{repo}/README.md", encoding="utf-8").read()
        text = text.replace("7-day forecast", "10-day forecast")   # the live API's forecast covers 10 days
        text = re.sub(r"\n## Updates\n.*?(?=\n## |\Z)", "\n", text, flags=re.S).rstrip() + "\n\n" \
               + UPDATES.format(today=TODAY.isoformat(), extra=EXTRA.get(repo, ""))
        api.upload_file(path_or_fileobj=io.BytesIO(text.encode()), path_in_repo="README.md", repo_id=f"Elpriser/{repo}",
                        repo_type="dataset", commit_message=f"README: refreshed {TODAY.isoformat()}")
        print(f"  README updated: {repo}", flush=True)
    # the index repo has no data, only a README — and it still described a "7-day forecast"
    idx = hf_hub_download("Elpriser/nordic-power-market-data", "README.md", repo_type="dataset", token=os.environ["HF_TOKEN"])
    t = open(idx, encoding="utf-8").read()
    t2 = t.replace("7-day forecast", "10-day forecast")
    if t2 != t:
        api.upload_file(path_or_fileobj=io.BytesIO(t2.encode()), path_in_repo="README.md", repo_id="Elpriser/nordic-power-market-data",
                        repo_type="dataset", commit_message="README: the live API's forecast covers 10 days, not 7")
        print("  README updated: nordic-power-market-data (7-day -> 10-day)", flush=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--publish", action="store_true")
    ap.add_argument("--only", nargs="+", metavar="NAME", help="refresh just these files (names without .parquet)")
    ap.add_argument("--publish-existing", action="store_true",
                    help="upload what an earlier dry run left in the output folder, without fetching again — "
                         "so what ships is exactly what was audited")
    a = ap.parse_args()
    if a.publish_existing:
        import glob
        report, ok = [], {}
        for repo in REPOS:
            for path in sorted(glob.glob(f"{OUT}/{repo}/*.parquet")):
                name = os.path.basename(path)[:-8]
                if name in SKIP or same_content(pd.read_parquet(path), pd.read_parquet(f"{WORK}/{repo}/{name}.parquet")):
                    continue
                ok.setdefault(repo, []).append(name)
        a.publish = True
    else:
        report, ok = run(a.publish, set(a.only) if a.only else None)
    from collections import Counter
    c = Counter(r[2] for r in report)
    print("\nSUMMARY:", dict(c))
    failed = [r for r in report if r[2] == "FAILED"]
    for r in failed: print("  FAILED", r[1], "-", r[3])
    if not a.publish:
        print("dry run — nothing uploaded"); return 1 if failed else 0
    from huggingface_hub import HfApi
    api = HfApi(token=os.environ["HF_TOKEN"])
    up_fail = []
    for repo, names in ok.items():
        existing = {x.rfilename for x in api.dataset_info(f"Elpriser/{repo}").siblings}
        for n in names:
            fn = f"{n}.parquet"
            assert fn in existing, f"{fn} is not in Elpriser/{repo} — refusing to add a new file"
            # One commit per file, not one per repo. The forecast-inputs uploader
            # learned that a single commit holding several 20-35 MB files makes the
            # upload layer abort ("failed to fill whole buffer") and take the small
            # files down with it; per file, a failure costs exactly one file.
            try:
                api.upload_file(path_or_fileobj=f"{OUT}/{repo}/{fn}", path_in_repo=fn, repo_id=f"Elpriser/{repo}",
                                repo_type="dataset", commit_message=f"Refresh {fn} to {TODAY.isoformat()}")
                print(f"  published {repo}/{fn}", flush=True)
            except Exception as e:
                up_fail.append(f"{repo}/{fn}")
                print(f"  UPLOAD FAILED {repo}/{fn}: {str(e)[:160]}", flush=True)
    if up_fail:
        print("upload incomplete:", ", ".join(up_fail))
    update_readmes(api, ok, up_fail)
    return 1 if (failed or up_fail) else 0


if __name__ == "__main__":
    sys.exit(main())
