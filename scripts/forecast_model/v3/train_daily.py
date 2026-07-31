#!/usr/bin/env python3
"""Forecast model v3 — daily training + scoring. Runs on the DGX Spark via cron.

v3 exists to remove the three limitations v2's model card admitted to:

  1. "Interconnector congestion is not modelled." Two features now cover it.
     Neighbouring-zone weather (NO2/SE3/SE4/NL) at the same forecast leads
     captures the price spreads that MAKE congestion bind — and unlike JAO or
     ENTSO-E congestion figures, weather forecasts genuinely exist 10 days out.
     Month-ahead transfer capacity (ENTSO-E A61/A03) covers the capacity side:
     scheduled derating and maintenance, published a month ahead, so it is
     leakage-free at every horizon here.

  2. "Single representative coordinate per area." Fourteen points now: the
     offshore wind clusters (Horns Rev, Anholt, Rødsand) that dominate Danish
     wind, German wind in the north and German solar in the south, plus the
     four neighbouring zones. Points go in as separate features rather than
     hand-weighted — the Phase 0 lesson on this project was that fitted beats
     hand-picked. `wind_spread` across an area's points is its own signal: a
     wide spread means a front is crossing, which is when production forecasts
     are least trustworthy.

  3. "The hybrid shape blend assumes the last 4 weeks are still informative."
     A regime guard now watches how well the seasonal profile's SHAPE has
     tracked reality lately, and pulls the blend toward the model's own shape
     only when that profile is measurably breaking down.

WHAT THE BACKTEST ACTUALLY SAID (rolling origin, 16 months, both areas), and
why the configuration is not symmetric:
  - spatial:      DK1 -1.5%, DK2 -2.0% MAE
  - neighbours:   DK1 -3.0%, DK2 -4.8% cumulative
  - capacity:     DK1 -4.2% cumulative, but DK2 got WORSE (-4.8% -> -3.5%).
    DK2 has two borders to DK1's four, so the same feature block carries much
    less signal there and mostly adds variance. It is therefore enabled for
    DK1 only — see CONFIG below.
  - A freely-fitted adaptive blend weight was tried and REJECTED: it improved
    MAE but cost min-hour hit-rate in both areas (DK1 69.3 -> 67.9), i.e. it
    got worse at the one thing the page is used for. The conservative regime
    guard kept the MAE gain without that cost.

Final: DK1 MAE 178.4 (-4.8% vs the v2-equivalent baseline), hit-rate 69.0%;
DK2 MAE 189.9 (-5.9%), hit-rate 70.0%. Bands calibrated to ~80% coverage.

KV: forecast-v3-{area}, forecast-v3-monitoring-{area}. Worker fallback chain
is v3 -> v2 -> v1 -> seasonal heuristic, so deleting the v3 keys is an instant
rollback.

Needs ~/.config/elpriser.env with CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
(+ optional HF_TOKEN to publish, ENTSOE_TOKEN for the capacity refresh).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import lightgbm as lgb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataset as ds
import publish_hf

V3DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.expanduser("~/elpriser-data-backup")
AREAS = ["DK1", "DK2"]
KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"

CAL = json.load(open(f"{V3DIR}/calibration_v3.json"))
CFG = json.load(open(f"{V3DIR}/config_v3.json"))
GUARD_TRIGGER = CFG["guard_trigger"]
GUARD_SLOPE = CFG["guard_slope"]

BASE = ["h", "hour", "weekday", "month", "is_weekend", "doy_sin", "doy_cos",
        "lag1", "lag2", "lag3", "lag7", "lag14", "lag21", "lag28",
        "seasonal4w", "last_day_mean"]
V2_WEATHER = ["wind", "rad", "wind_de", "rad_de", "temp", "est_prod", "est_prod_de"]
SPATIAL = ([f"wind_p{i}" for i in range(4)] + [f"rad_p{i}" for i in range(4)] +
           [f"temp_p{i}" for i in range(4)] + ["wind_spread"] +
           [f"wind_de{i}" for i in range(3)] + [f"rad_de{i}" for i in range(3)])
NEIGH = [f"{v}_{n}" for n in ("no2", "se3", "se4", "nl") for v in ("wind", "rad")]


def features_for(area, df):
    feats = BASE + V2_WEATHER + SPATIAL + NEIGH
    if CFG["variant_by_area"][area] == "D_congest":
        feats = feats + [c for c in df.columns if c.startswith("ntc_")]
    return feats


def env_creds():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    return (os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"],
            os.environ.get("HF_TOKEN"))


def fetch_json(url, tries=5, timeout=180):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == tries - 1:
                raise
            wait = 30 * (i + 1) if "429" in str(e) else 15
            print(f"    retry in {wait}s: {e}", flush=True)
            time.sleep(wait)


def kv_put(key, value, ttl, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}"
           f"?expiration_ttl={ttl}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


def kv_get(key, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


# ─── incremental data refresh ───────────────────────────────────────────────

def refresh_prices():
    start = (date.today() - timedelta(days=40)).isoformat()
    end = (date.today() + timedelta(days=2)).isoformat()
    for area in AREAS:
        f = urllib.parse.quote(json.dumps({"PriceArea": area}))
        j = fetch_json(f"https://api.energidataservice.dk/dataset/DayAheadPrices"
                       f"?start={start}&end={end}&filter={f}&limit=0")
        new = pd.DataFrame(j.get("records", []))
        if not len(new):
            raise RuntimeError(f"no fresh prices for {area}")
        path = f"{BACKUP}/eds_dayaheadprices_{area.lower()}.parquet"
        old = pd.read_parquet(path)
        merged = (pd.concat([old, new[old.columns.intersection(new.columns)]])
                    .drop_duplicates(subset=["TimeDK"], keep="last"))
        merged.to_parquet(path, index=False)
        print(f"  prices {area}: +{len(new)} -> {len(merged):,}", flush=True)
        time.sleep(5)


def refresh_production():
    start = (date.today() - timedelta(days=60)).isoformat()
    for area in AREAS:
        f = urllib.parse.quote(json.dumps({"PriceArea": area}))
        try:
            j = fetch_json(f"https://api.energidataservice.dk/dataset/ProductionConsumptionSettlement"
                           f"?start={start}&end={date.today().isoformat()}&filter={f}&limit=0")
        except Exception as e:
            print(f"  production {area} skipped: {e}", flush=True)
            continue
        new = pd.DataFrame(j.get("records", []))
        if not len(new):
            continue
        path = f"{BACKUP}/eds_productionconsumptionsettlement_{area.lower()}.parquet"
        old = pd.read_parquet(path)
        merged = (pd.concat([old, new[old.columns.intersection(new.columns)]])
                    .drop_duplicates(subset=["HourDK"], keep="last"))
        merged.to_parquet(path, index=False)
        time.sleep(5)


def _append(path, getter, col="time"):
    old = pd.read_parquet(path)
    last = pd.to_datetime(old[col]).max().date()
    lo, hi = last - timedelta(days=2), date.today() - timedelta(days=1)
    if lo >= hi:
        return
    new = getter(lo.isoformat(), hi.isoformat())
    if new is None or not len(new):
        return
    pd.concat([old, new]).drop_duplicates(col, keep="last").to_parquet(path, index=False)


def refresh_weather():
    prev_vars = ",".join(f"{v}_previous_day{d}"
                         for v in ("wind_speed_100m", "direct_radiation", "temperature_2m")
                         for d in range(1, 8))
    for name, (lat, lon) in ds.POINTS.items():
        _append(f"{V3DIR}/w_prev_{name}.parquet", lambda s, e: pd.DataFrame(
            fetch_json(f"https://previous-runs-api.open-meteo.com/v1/forecast?latitude={lat}"
                       f"&longitude={lon}&hourly={prev_vars}&start_date={s}&end_date={e}"
                       f"&timezone=Europe/Copenhagen").get("hourly", {})))
        _append(f"{V3DIR}/w_actual_{name}.parquet", lambda s, e: pd.DataFrame(
            fetch_json(f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}"
                       f"&longitude={lon}&hourly=wind_speed_100m,direct_radiation,temperature_2m"
                       f"&start_date={s}&end_date={e}&timezone=Europe/Copenhagen").get("hourly", {})))
        time.sleep(3)


def refresh_ntc():
    """Top up month-ahead transfer capacity. Best-effort: capacity moves slowly,
    so a stale file for a day is far better than failing the whole run."""
    token = os.environ.get("ENTSOE_TOKEN")
    if not token:
        print("  ENTSOE_TOKEN not set — keeping existing NTC file", flush=True)
        return
    try:
        sys.path.insert(0, V3DIR)
        import fetch_ntc
        path = f"{V3DIR}/ntc_daily.parquet"
        old = pd.read_parquet(path)
        rows = []
        s = date.today() - timedelta(days=10)
        e = date.today() + timedelta(days=45)
        for name, a, b in fetch_ntc.BORDERS:
            for direction, (x, y) in (("export", (a, b)), ("import", (b, a))):
                xml = fetch_ntc.fetch(x, y, s, e)
                for d, mw in (fetch_ntc.parse(xml) if xml else []):
                    rows.append({"date": d, "mw": mw, "border": name, "direction": direction})
                time.sleep(2)
        if rows:
            new = pd.DataFrame(rows)
            new["date"] = pd.to_datetime(new["date"])
            old["date"] = pd.to_datetime(old["date"])
            merged = (pd.concat([old, new])
                        .drop_duplicates(["border", "direction", "date"], keep="last")
                        .sort_values(["border", "direction", "date"]))
            merged.to_parquet(path, index=False)
            print(f"  NTC: +{len(new)} rows -> {len(merged):,}", flush=True)
    except Exception as e:
        print(f"  NTC refresh failed, keeping existing file: {e}", flush=True)


def live_weather():
    """10-day forecast for every point, one call per point."""
    out = {}
    for name, (lat, lon) in ds.POINTS.items():
        j = fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
                       f"&hourly=wind_speed_100m,direct_radiation,temperature_2m"
                       f"&forecast_days=10&timezone=Europe/Copenhagen")
        df = pd.DataFrame(j.get("hourly", {}))
        df["t"] = pd.to_datetime(df["time"])
        out[name] = df.set_index("t").drop(columns=["time"])
        time.sleep(1)
    return out


# ─── scoring ────────────────────────────────────────────────────────────────

def seasonal_curve(prices, today):
    hist = prices[(prices.index >= pd.Timestamp(today) - pd.Timedelta(days=28))
                  & (prices.index < pd.Timestamp(today) + pd.Timedelta(days=2))]
    d = pd.DataFrame({"p": hist, "wd": hist.index.weekday, "h": hist.index.hour})
    return d.groupby(["wd", "h"]).p.mean()


def regime_alpha(prices, today):
    """How badly has the seasonal profile's SHAPE been tracking reality lately?
    Stay at 0.5 unless it is clearly degrading — the guard is one-directional
    on purpose, because leaning away from the seasonal shape costs hit-rate."""
    hist = prices[prices.index >= pd.Timestamp(today) - pd.Timedelta(days=140)]
    if len(hist) < 24 * 40:
        return 0.5
    d = pd.DataFrame({"p": hist, "date": hist.index.normalize(),
                      "wd": hist.index.weekday, "h": hist.index.hour})
    prof = d.groupby(["wd", "h"]).p.mean()
    d["seas"] = list(map(lambda r: prof.get((r[0], r[1]), np.nan), zip(d.wd, d.h)))
    g = d.groupby("date")
    dev_s = d.seas - g.seas.transform("mean")
    dev_a = d.p - g.p.transform("mean")
    daily = (dev_s - dev_a).abs().groupby(d.date).mean().sort_index()
    # shift by 10 days so nothing inside any horizon's unknown window leaks in
    recent = daily.rolling(14, min_periods=7).mean().shift(10).iloc[-1]
    norm = daily.rolling(90, min_periods=30).median().shift(10).iloc[-1]
    if not np.isfinite(recent) or not np.isfinite(norm) or norm <= 0:
        return 0.5
    ratio = recent / norm
    if ratio <= GUARD_TRIGGER:
        return 0.5
    return float(np.clip(0.5 * (1 - (ratio - GUARD_TRIGGER) * GUARD_SLOPE), 0.0, 0.5))


def score_area(area, models, feats, prices, est, est_de, live, ntc, today, alpha):
    sc = seasonal_curve(prices, today)
    day_mean = prices.groupby(prices.index.normalize()).mean()
    pts = ds.AREA_POINTS[area]
    days_out = []

    for offset in range(10):
        d = today + timedelta(days=offset)
        ds_ = d.isoformat()
        day_prices = prices[prices.index.normalize() == pd.Timestamp(d)]
        is_actual = len(day_prices) > 12
        h = offset
        if is_actual or h < 2:
            hours = [{"hour": hh,
                      "spot_dkk_mwh": (round(float(day_prices[day_prices.index.hour == hh].mean()), 2)
                                       if len(day_prices[day_prices.index.hour == hh]) else None)}
                     for hh in range(24)]
            days_out.append({"date": ds_, "type": "actual" if is_actual else "forecast",
                             "weekday": d.weekday(), "prices": hours})
            continue

        idx = pd.date_range(pd.Timestamp(d), periods=24, freq="h")
        row = pd.DataFrame(index=range(24))
        row["h"] = h
        row["hour"] = range(24)
        row["weekday"] = d.weekday()
        row["month"] = d.month
        row["is_weekend"] = 1 if d.weekday() >= 5 else 0
        doy = d.timetuple().tm_yday
        row["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
        row["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
        for k in (1, 2, 3, 7, 14, 21, 28):
            row[f"lag{k}"] = ([prices.get(t - pd.Timedelta(days=k), np.nan) for t in idx]
                              if k >= h - 1 else np.nan)
        row["last_day_mean"] = day_mean.get(pd.Timestamp(d) - pd.Timedelta(days=h - 1), np.nan)
        row["seasonal4w"] = row[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)

        W, R = [], []
        for i in range(4):
            if i < len(pts):
                lw = live[pts[i]].reindex(idx)
                row[f"wind_p{i}"] = lw.wind_speed_100m.values
                row[f"rad_p{i}"] = lw.direct_radiation.values
                row[f"temp_p{i}"] = lw.temperature_2m.values
                W.append(lw.wind_speed_100m.values); R.append(lw.direct_radiation.values)
            else:
                row[f"wind_p{i}"] = np.nan; row[f"rad_p{i}"] = np.nan; row[f"temp_p{i}"] = np.nan
        Wm, Rm = np.vstack(W), np.vstack(R)
        row["wind"] = Wm.mean(axis=0); row["rad"] = Rm.mean(axis=0)
        row["wind_spread"] = Wm.max(axis=0) - Wm.min(axis=0)
        row["temp"] = row[[f"temp_p{i}" for i in range(len(pts))]].mean(axis=1)

        for i, n in enumerate(ds.DE_POINTS):
            lw = live[n].reindex(idx)
            row[f"wind_de{i}"] = lw.wind_speed_100m.values
            row[f"rad_de{i}"] = lw.direct_radiation.values
        row["wind_de"] = row[[f"wind_de{i}" for i in range(3)]].mean(axis=1)
        row["rad_de"] = row[[f"rad_de{i}" for i in range(3)]].mean(axis=1)
        for n in ds.NEIGHBOURS:
            lw = live[n].reindex(idx)
            row[f"wind_{n}"] = lw.wind_speed_100m.values
            row[f"rad_{n}"] = lw.direct_radiation.values

        row["est_prod"] = est.predict(pd.DataFrame({
            "wind_speed_100m": row.wind, "direct_radiation": row.rad, "month": row.month}))
        row["est_prod_de"] = est_de.predict(pd.DataFrame({
            "wind_speed_100m": row.wind_de, "direct_radiation": row.rad_de, "month": row.month}))
        for c, v in ntc.get(d, {}).items():
            row[c] = v

        for c in feats:
            if c not in row.columns:
                row[c] = np.nan
        X = row[feats]
        md = models["md"].predict(X); lo = models["lo"].predict(X); hi = models["hi"].predict(X)

        se = np.array([sc.get((d.weekday(), hh), np.nan) for hh in range(24)])
        hyb = md if np.isnan(se).any() else (
            md.mean() + (1 - alpha) * (md - md.mean()) + alpha * (se - se.mean()))
        f = CAL[area.lower()][str(h)]
        lo_c, hi_c = hyb - f * (md - lo), hyb + f * (hi - md)
        days_out.append({"date": ds_, "type": "forecast", "weekday": d.weekday(),
                         "prices": [{"hour": hh, "spot_dkk_mwh": round(float(hyb[hh]), 2),
                                     "spot_min_dkk_mwh": round(float(min(lo_c[hh], hyb[hh])), 2),
                                     "spot_max_dkk_mwh": round(float(max(hi_c[hh], hyb[hh])), 2)}
                                    for hh in range(24)]})
    return days_out


def ntc_by_day(area, today):
    """{date: {ntc_feature: scaled value}} for the days being scored."""
    path = f"{V3DIR}/ntc_daily.parquet"
    if not os.path.exists(path) or CFG["variant_by_area"][area] != "D_congest":
        return {}
    n = pd.read_parquet(path)
    n["date"] = pd.to_datetime(n["date"]).dt.date
    out = {}
    for offset in range(10):
        d = today + timedelta(days=offset)
        vals = {}
        for b in ds.AREA_BORDERS[area]:
            for direction in ("export", "import"):
                sub = n[(n.border == b) & (n.direction == direction)]
                key = f"ntc_{b.split('_')[1]}_{direction[:3]}"
                if not len(sub):
                    vals[key] = np.nan
                    continue
                mx = sub.mw.max()
                row = sub[sub.date == d]
                # No published value for a future day means capacity is
                # unchanged from the latest known one, not that it is zero.
                mw = row.mw.iloc[0] if len(row) else sub.sort_values("date").mw.iloc[-1]
                vals[key] = (mw / mx) if mx > 0 else np.nan
        exp = [v for k, v in vals.items() if k.endswith("_exp")]
        imp = [v for k, v in vals.items() if k.endswith("_imp")]
        vals["ntc_exp_mean"] = np.nanmean(exp) if exp else np.nan
        vals["ntc_imp_mean"] = np.nanmean(imp) if imp else np.nan
        vals["ntc_min"] = np.nanmin(exp + imp) if (exp + imp) else np.nan
        out[d] = vals
    return out


def update_monitoring(area, days, today, account, token):
    key = f"forecast-v3-monitoring-{area}"
    log = kv_get(key, account, token) or []
    prev = kv_get(f"forecast-v3-{area}", account, token)
    if prev:
        p = next((x for x in prev.get("days", []) if x["date"] == today.isoformat()), None)
        a = next((x for x in days if x["date"] == today.isoformat()), None)
        if p and p["type"] == "forecast" and a and a["type"] == "actual":
            errs = [abs(x["spot_dkk_mwh"] - y["spot_dkk_mwh"])
                    for x, y in zip(p["prices"], a["prices"])
                    if x.get("spot_dkk_mwh") is not None and y.get("spot_dkk_mwh") is not None]
            if errs:
                log.append({"date": today.isoformat(),
                            "mae_dkk_mwh": round(sum(errs) / len(errs), 2), "n_hours": len(errs)})
    log = [e for e in log if e["date"] >= (today - timedelta(days=90)).isoformat()]
    kv_put(key, log, 120 * 86400, account, token)


def main():
    account, token, hf_token = env_creds()
    today = datetime.now(timezone.utc).date()
    print(f"=== v3 daily run {today} ===", flush=True)

    print("Refreshing data...", flush=True)
    refresh_prices()
    refresh_production()
    refresh_weather()
    refresh_ntc()

    print("Rebuilding datasets...", flush=True)
    for area in AREAS:
        ds.build(area)

    live = live_weather()
    failed, models_all, est_all = [], {}, {}
    for area in AREAS:
        try:
            print(f"=== {area} ===", flush=True)
            df = pd.read_parquet(f"{V3DIR}/dataset_v3_{area.lower()}.parquet")
            feats = features_for(area, df)
            train = df.dropna(subset=["y"])
            models = {}
            for a, name in [(0.1, "lo"), (0.5, "md"), (0.9, "hi")]:
                m = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=400,
                                      num_leaves=63, min_child_samples=30, learning_rate=0.05,
                                      verbosity=-1, n_jobs=10)
                m.fit(train[feats], train["y"])
                models[name] = m
            print(f"  trained on {len(train):,} rows, {len(feats)} features", flush=True)

            prices = ds.load_prices(area)
            est = ds.fit_estimator(ds.AREA_POINTS[area], ds.load_production(area))
            est_de = ds.fit_estimator(ds.DE_POINTS, ds.de_actual_production())
            alpha = regime_alpha(prices, today)
            print(f"  shape blend weight: {alpha:.2f}"
                  f"{' (regime guard active)' if alpha < 0.5 else ''}", flush=True)

            days = score_area(area, models, feats, prices, est, est_de, live,
                              ntc_by_day(area, today), today, alpha)
            update_monitoring(area, days, today, account, token)
            kv_put(f"forecast-v3-{area}",
                   {"area": area, "generated": today.isoformat(),
                    "generatedAt": datetime.now(timezone.utc).isoformat(),
                    "model": "v3", "shapeBlend": round(alpha, 2), "days": days},
                   3 * 86400, account, token)
            print(f"  KV written: forecast-v3-{area}", flush=True)
            models_all[area] = models
            est_all[area] = {"dk": est, "de": est_de}
        except Exception:
            import traceback
            traceback.print_exc()
            failed.append(area)

    # Publishing is best effort and must never fail the run: KV (what the site
    # reads) is already written above, and a non-zero exit would stop tomorrow's
    # cron from even trying.
    if not failed and hf_token:
        try:
            publish_hf.publish(models_all, est_all, CAL, CFG,
                               {a: features_for(a, pd.read_parquet(
                                   f"{V3DIR}/dataset_v3_{a.lower()}.parquet")) for a in AREAS},
                               today, hf_token)
        except Exception:
            import traceback
            print("  HF publish failed (non-fatal):", flush=True)
            traceback.print_exc()

    if failed:
        raise SystemExit(f"failed: {failed}")
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
