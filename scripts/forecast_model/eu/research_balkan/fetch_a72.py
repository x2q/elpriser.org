"""(d) Hydro: weekly reservoir filling (ENTSO-E A72 / A16) for the EU job's zones that have it (probe_a72.py) -> a72_weekly.parquet (zone, t_utc, mwh), and the LEAK-FREE feature table
a72_features.parquet (zone, day, res_pct, res_d4, res_reg) used by bl_hydro_frame.py.

Leak-free rule (the Norway recipe's, docs/forecast-nordic-no.md): a reading for the week starting W is used from W + 14 days on (published weekly in arrears; 14 days is more conservative than
the real lag), `res_pct` is the fill as a share of the zone's OWN trailing 52-week maximum known at that time (no whole-series maximum, no week-of-year median: those contain the future),
`res_d4` the change of res_pct over the last four published weeks, `res_reg` the mean res_pct of the Balkan hydro zones (al me mk rs gr bg ro hr).
Token from the environment (ENTSOE_TOKEN), never printed.
"""
import os, re, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import date, timedelta
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
from zones import ZONES

ZS = ["al", "me", "mk", "rs", "gr", "bg", "ro", "hr", "at", "ch", "it-n", "si", "fr", "es", "pt"]
BALKAN_HYDRO = ["al", "me", "mk", "rs", "gr", "bg", "ro", "hr"]


def fetch(eic, s, e):
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode({
        "securityToken": os.environ["ENTSOE_TOKEN"], "documentType": "A72", "processType": "A16", "in_Domain": eic,
        "periodStart": s.strftime("%Y%m%d0000"), "periodEnd": e.strftime("%Y%m%d0000")})
    for k in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as ex:
            if ex.code == 400:
                return ""
            time.sleep(10 * (k + 1))
        except Exception:
            time.sleep(10 * (k + 1))
    return ""


def parse(xml):
    rows = []
    for per in re.finditer(r"<Period>(.*?)</Period>", xml, re.S):
        body = per.group(1)
        ti = re.search(r"<start>([^<]+)</start>\s*<end>([^<]+)</end>", body)
        if not ti:
            continue
        t0, t1 = pd.Timestamp(ti.group(1)).tz_convert("UTC"), pd.Timestamp(ti.group(2)).tz_convert("UTC")
        last = int((t1 - t0) / pd.Timedelta(weeks=1)) + 1
        pts = sorted((int(p), float(q)) for p, q in re.findall(r"<position>(\d+)</position>\s*<quantity>([\d.]+)</quantity>", body))
        for i, (pos, qty) in enumerate(pts):
            end = pts[i + 1][0] if i + 1 < len(pts) else last
            for slot in range(pos, end):
                rows.append((t0 + pd.Timedelta(weeks=slot - 1), qty))
    return rows


def features(w):
    """w: weekly frame (zone, t_utc, mwh) -> daily leak-free feature table."""
    out = []
    days = pd.date_range("2024-03-01", date.today() + timedelta(days=1), freq="D")
    for z, g in w.groupby("zone"):
        g = g.drop_duplicates("t_utc").sort_values("t_utc")
        wk = pd.Series(g["mwh"].to_numpy(), index=g["t_utc"].dt.tz_localize(None).dt.normalize().to_numpy())
        wk = wk[~wk.index.duplicated()]
        mx = wk.rolling(52, min_periods=26).max()
        pct = (wk / mx).rename("res_pct")
        d4 = (pct - pct.shift(4)).rename("res_d4")
        f = pd.concat([pct, d4], axis=1)
        f.index = f.index + pd.Timedelta(days=14)             # available from W + 14 days
        f = f.reindex(days.union(f.index)).ffill().reindex(days)
        f["zone"] = z
        out.append(f.rename_axis("day").reset_index())
    F = pd.concat(out, ignore_index=True)
    reg = F[F.zone.isin(BALKAN_HYDRO)].groupby("day")["res_pct"].mean().rename("res_reg")
    return F.merge(reg, on="day", how="left")


if __name__ == "__main__":
    rows = []
    for z in ZS:
        eic = ZONES[z][0]
        cur, got = date(2024, 1, 1), []
        while cur < date.today() + timedelta(days=1):
            nxt = min(cur + timedelta(days=365), date.today() + timedelta(days=1))
            xml = fetch(eic, cur, nxt)
            if xml:
                got += parse(xml)
            cur = nxt
            time.sleep(1)
        df = pd.DataFrame(got, columns=["t_utc", "mwh"]).drop_duplicates("t_utc")
        df["zone"] = z
        print(f"{z}: {len(df)} weeks", flush=True)
        rows.append(df)
    w = pd.concat(rows, ignore_index=True)
    w.to_parquet("a72_weekly.parquet", index=False)
    features(w).to_parquet("a72_features.parquet", index=False)
    print("A72 DONE")
