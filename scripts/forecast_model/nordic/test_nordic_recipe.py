#!/usr/bin/env python3
"""Unit tests for the Nordic ensemble recipe and the gate that publishes it (no network, no LightGBM, no Spark).

    python3 scripts/forecast_model/nordic/test_nordic_recipe.py
"""
import json
import os
import sys
import unittest

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish_nordic as PUB      # noqa: E402
import recipe_nordic as RN        # noqa: E402


def prices(zones=("no1", "dk1"), days=120, seed=3, start="2026-01-01"):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=24 * days, freq="h")
    out = {}
    for i, z in enumerate(zones):
        lvl = 60 + 10 * i + np.cumsum(rng.normal(0, 0.4, len(idx) // 24)).repeat(24)
        shape = 15 * np.sin((idx.hour.to_numpy() - 6) / 24 * 2 * np.pi)
        out[z] = pd.Series(lvl + shape + rng.normal(0, 3, len(idx)), index=idx)
    return out


def weather(idx):
    rng = np.random.default_rng(5)
    return pd.DataFrame({"wind_speed_100m": rng.uniform(2, 14, len(idx)), "direct_radiation": rng.uniform(0, 300, len(idx)),
                         "temperature_2m": rng.uniform(-5, 10, len(idx)), "precipitation": rng.uniform(0, 1, len(idx))}, index=idx)


class GateFiles(unittest.TestCase):
    """The checked-in gate and accuracy files obey the rule they claim."""

    def setUp(self):
        self.gate = PUB.load_gate(os.path.join(HERE, "publish_gate_nordic.json"))
        self.acc = PUB.load_accuracy(os.path.join(HERE, "accuracy_nordic.json"))
        self.cal = PUB.load_calibration(os.path.join(HERE, "calibration_nordic_v2.json"))

    def test_files_load_and_cover_the_13_zones(self):
        self.assertIsNotNone(self.gate)
        self.assertIsNotNone(self.acc)
        self.assertIsNotNone(self.cal)
        self.assertEqual(sorted(self.gate), sorted(RN.ZONES))
        self.assertEqual(sorted(self.acc["zones"]), sorted(RN.ZONES))

    def test_every_published_cell_passes_the_five_percent_rule(self):
        for z, e in self.gate.items():
            cells = self.acc["zones"][z]["cells"]
            self.assertIn(e["recipe"], ("ens", "pooled"))
            self.assertEqual(sorted(map(int, cells)), sorted(e["horizons"]), z)
            for h in e["horizons"]:
                c = cells[str(h)]
                self.assertGreaterEqual(c["gain"], 0.05, f"{z} D+{h} whole backtest")
                self.assertGreaterEqual(c["gainHold"], 0.05, f"{z} D+{h} hold-out")

    def test_horizons_are_a_prefix_from_d2(self):
        for z, e in self.gate.items():
            hs = sorted(e["horizons"])
            self.assertEqual(hs, list(range(2, 2 + len(hs))), z)

    def test_norway_four_is_not_published_and_the_other_norway_zones_use_the_ensemble(self):
        self.assertEqual(self.gate["no4"]["horizons"], [])
        for z in ("no1", "no2", "no3", "no5"):
            self.assertEqual(self.gate[z]["recipe"], "ens")
            self.assertEqual(self.gate[z]["horizons"], list(range(2, 9)))

    def test_calibration_has_every_published_horizon(self):
        for z, e in self.gate.items():
            for h in e["horizons"]:
                self.assertIsNotNone(PUB.band(self.cal, z, h), f"{z} D+{h}")


class Publish(unittest.TestCase):
    def rows(self, last, hs, nan_day=None):
        out = []
        for h in hs:
            d = pd.Timestamp(last) + pd.Timedelta(days=h - 1)
            for hr in range(24):
                out.append({"date": d, "hour": hr, "h": h, "point": (np.nan if (nan_day == h and hr == 5) else 50.0 + hr)})
        return pd.DataFrame(out)

    cal = {"no1": {"2": {"lo": -10.0, "hi": 12.0}, "3": {"lo": -11.0, "hi": 13.0}}}

    def test_only_allowed_consecutive_days_with_a_band_that_contains_the_price(self):
        last = pd.Timestamp("2026-11-09").date()
        days = PUB.forecast_days("no1", self.rows(last, [2, 3, 4]), last, {2, 3}, self.cal)
        self.assertEqual([d["horizon"] for d in days], [2, 3])
        self.assertEqual(days[0]["date"], "2026-11-10")
        for d in days:
            self.assertEqual(len(d["prices"]), 24)
            for p in d["prices"]:
                self.assertLessEqual(p["min_eur_mwh"], p["eur_mwh"])
                self.assertGreaterEqual(p["max_eur_mwh"], p["eur_mwh"])
        self.assertEqual(days[0]["prices"][0]["min_eur_mwh"], 40.0)

    def test_a_gap_or_a_forbidden_horizon_cuts_everything_behind_it(self):
        last = pd.Timestamp("2026-11-09").date()
        self.assertEqual(PUB.forecast_days("no1", self.rows(last, [3, 4]), last, {2, 3, 4}, self.cal), [])      # h = 2 missing: the first day is not the day after
        days = PUB.forecast_days("no1", self.rows(last, [2, 3, 4]), last, {2, 4}, self.cal)
        self.assertEqual([d["horizon"] for d in days], [2])                                                       # h = 3 not allowed: h = 4 is behind a gap

    def test_a_day_with_a_missing_hour_is_dropped_with_everything_after_it(self):
        last = pd.Timestamp("2026-11-09").date()
        days = PUB.forecast_days("no1", self.rows(last, [2, 3, 4], nan_day=3), last, {2, 3, 4}, self.cal)
        self.assertEqual([d["horizon"] for d in days], [2])

    def test_no_calibration_means_no_band_at_all(self):
        last = pd.Timestamp("2026-11-09").date()
        days = PUB.forecast_days("se3", self.rows(last, [2]), last, {2}, self.cal)
        self.assertEqual(len(days), 1)
        self.assertNotIn("min_eur_mwh", days[0]["prices"][0])

    def test_published_horizons_need_gate_and_accuracy(self):
        gate = {"no1": {"recipe": "ens", "horizons": [2, 3, 4]}}
        acc = {"zones": {"no1": {"cells": {"2": {}, "3": {}}}}}
        self.assertEqual(PUB.published_horizons(gate, acc, "no1"), {2, 3})
        self.assertEqual(PUB.published_horizons(gate, acc, "no2"), set())
        self.assertEqual(PUB.published_horizons(None, acc, "no1"), set())
        self.assertIsNone(PUB.accuracy_block(acc, "no1", set()))

    def test_payload_keeps_the_old_keys_and_adds_the_new_ones(self):
        pl = PUB.payload("no1", [{"date": "2026-11-09", "type": "actual", "prices": []}], [{"date": "2026-11-10", "type": "forecast", "horizon": 2, "prices": []}],
                         pd.Timestamp("2026-11-08").date(), pd.Timestamp("2026-11-07").date(), "x", "nordic-ens-v1", "ens", {"byHorizon": {}})
        for k in ("zone", "generated", "trainedThrough", "unit", "days"):
            self.assertIn(k, pl)
        self.assertEqual(pl["days"][1]["horizon"], 2)
        self.assertEqual(pl["recipe"], "ens")

    def test_missing_or_old_format_files_are_absent(self):
        self.assertIsNone(PUB.load_gate("/nonexistent.json"))
        p = os.path.join(HERE, "calibration_nordic.json")           # the first build's calibration: no `version`
        self.assertIsNone(PUB.load_calibration(p))


class Recipe(unittest.TestCase):
    def test_hybrid_keeps_the_daily_mean_and_mixes_the_shape(self):
        d = pd.Timestamp("2026-11-10")
        rows = pd.DataFrame({"zone": "no1", "date": d, "h": 2, "hour": range(24), "seasonal4w": 40 + 10 * np.sin(np.arange(24) / 24 * 6.28)})
        model = 70 + 20 * np.cos(np.arange(24) / 24 * 6.28)
        out = RN.hybrid(rows, model)
        self.assertAlmostEqual(out.mean(), model.mean(), places=9)
        expect = model.mean() + 0.5 * (model - model.mean()) + 0.5 * (rows["seasonal4w"] - rows["seasonal4w"].mean())
        np.testing.assert_allclose(out, expect)

    def test_point_forecast_is_nan_where_a_model_is(self):
        p = RN.point_forecast([1.0, np.nan, 3.0], [3.0, 2.0, np.nan])
        self.assertEqual(p[0], 2.0)
        self.assertTrue(np.isnan(p[1]) and np.isnan(p[2]))

    def test_last_known_day_is_capped_at_tomorrow(self):
        p = prices(("no1",), days=10, start="2026-11-01")["no1"]          # to 2026-11-10 23:00
        self.assertEqual(RN.last_known_day(p, pd.Timestamp("2026-11-08")).isoformat(), "2026-11-09")
        self.assertEqual(RN.last_known_day(p, pd.Timestamp("2026-11-12")).isoformat(), "2026-11-10")

    def test_reservoir_features_never_see_the_future(self):
        wk = pd.date_range("2022-01-02", periods=230, freq="W-SUN")
        r = pd.DataFrame({"t_utc": wk.tz_localize("UTC"), "mwh": 1e6 + 3e5 * np.sin(np.arange(230) / 8.0), "zone": "no1"})
        a = RN.reservoir_lf(r)["no1"]
        r2 = r.copy()
        r2.loc[r2.index[-30:], "mwh"] *= 3                               # change the last 30 weeks
        b = RN.reservoir_lf(r2)["no1"]
        cut = wk[-30] + pd.Timedelta(days=RN.RES_LAG_DAYS)               # nothing before the first changed reading is used may move
        before = a.index < cut
        pd.testing.assert_frame_equal(a[before].dropna(how="all"), b[before].dropna(how="all"))
        self.assertFalse(np.allclose(a.loc[a.index >= cut + pd.Timedelta(days=60), "res_pct_lf"].dropna(), b.loc[b.index >= cut + pd.Timedelta(days=60), "res_pct_lf"].dropna()))

    def test_live_rows_obey_the_leakage_rule(self):
        pr = prices(("no1",), days=60, start="2026-09-10")["no1"]
        today = pd.Timestamp("2026-11-08")
        lk = RN.last_known_day(pr.loc[:"2026-11-08 23:00"], today)       # prices end today: the last known day is today
        self.assertEqual(lk.isoformat(), "2026-11-08")
        idx = pd.date_range("2026-10-31", periods=24 * 20, freq="h")
        live = weather(idx)
        reg = pd.DataFrame({"reg_wind": 5.0, "reg_temp": 2.0, "hydro_precip": 0.3, "hydro_precip_7d": 50.0}, index=idx)
        rows = RN.live_rows("no1", pr.loc[:"2026-11-08 23:00"], live, reg, today, lk)
        self.assertEqual(sorted(rows["h"].unique()), list(range(2, 9)))
        self.assertEqual(rows[rows["h"] == 2]["date"].iloc[0], pd.Timestamp("2026-11-09"))
        g = rows[rows["h"] == 5]
        self.assertTrue(g["lag1"].isna().all() and g["lag3"].isna().all())          # k < h - 1 = 4: not known at issue
        self.assertTrue(g["lag7"].notna().all())
        self.assertAlmostEqual(g["last_day_mean"].iloc[0], pr["2026-11-08"].mean())   # h = 5, target 11-12 -> last known day 11-08
        self.assertEqual(len(rows[rows["h"] == 2]), 24)

    def test_augment_does_not_move_when_prices_after_the_last_known_day_change(self):
        pr = prices(("no1",), days=80, start="2026-08-20")
        today = pd.Timestamp("2026-11-06")
        lk = RN.last_known_day(pr["no1"].loc[:"2026-11-06 23:00"], today)
        idx = pd.date_range("2026-10-25", periods=24 * 20, freq="h")
        reg = pd.DataFrame({"reg_wind": 5.0, "reg_temp": 2.0, "hydro_precip": 0.3, "hydro_precip_7d": 50.0}, index=idx)
        base = RN.live_rows("no1", pr["no1"].loc[:"2026-11-06 23:00"], weather(idx), reg, today, lk)
        a = RN.augment(base, {"no1": pr["no1"].loc[:"2026-11-06 23:00"]})
        bumped = pr["no1"].copy()
        bumped.loc["2026-11-07":] += 100                                 # prices that were not known: must not enter any feature
        b = RN.augment(base, {"no1": bumped})
        for c in ("level_7d", "ewm5", "lag_last", "b_lvlshape", "d_lag_last"):
            pd.testing.assert_series_equal(a[c], b[c], check_names=False)

    def test_ridge_trains_only_on_settled_targets(self):
        # history rows whose target day is after T - h must not be used: poison them and the prediction must not change
        pr = prices(("no1",), days=140, start="2026-06-20")
        rows = []
        for h in (2,):
            for d in pd.date_range("2026-08-01", "2026-11-04"):
                idx = pd.date_range(d, periods=24, freq="h")
                r = pd.DataFrame({"t": idx, "date": d, "zone": "no1", "h": h, "hour": range(24)})
                r["weekday"], r["month"], r["is_weekend"] = d.weekday(), d.month, int(d.weekday() >= 5)
                for k in RN.LAGS:
                    r[f"lag{k}"] = pr["no1"].reindex(idx - pd.Timedelta(days=k)).to_numpy() if k >= h - 1 else np.nan
                r["seasonal4w"] = r[[f"lag{k}" for k in (7, 14, 21, 28)]].mean(axis=1)
                lk = d - pd.Timedelta(days=h - 1)
                dm = pr["no1"].groupby(pr["no1"].index.normalize()).mean()
                r["last_day_mean"], r["level_30d"] = dm.get(lk, np.nan), dm.rolling(30, min_periods=10).mean().get(lk, np.nan)
                rng = np.random.default_rng(int(d.strftime("%j")))
                for c in ("wind", "rad", "temp", "precip", "reg_wind", "reg_temp", "hydro_precip_7d"):
                    r[c] = rng.uniform(0, 5)
                r["y"] = pr["no1"].reindex(idx).to_numpy()
                for c, v in (("gas", 30.0), ("eua", 70.0), ("gas_d7", 0.0), ("gas_d28", 0.0), ("gas_m1_spread", 0.0), ("eua_d7", 0.0), ("eua_d28", 0.0), ("ccgt_mc", 90.0),
                             ("ccgt_mc_d7", 0.0), ("ccgt_mc_d28", 0.0), ("res_anom_lf", 0.0), ("nres_anom_lf", 0.0)):
                    r[c] = v
                rows.append(r)
        df = pd.concat(rows, ignore_index=True)
        df = RN.augment(df, pr)
        live = df[df["date"] == "2026-11-04"].copy().drop(columns="y")
        hist = df[df["date"] <= "2026-11-02"].copy()                    # T - h = 11-02 for T = 11-04
        a = RN.lear_predict(hist, live, True, min_rows=200)
        poisoned = df.copy()
        poisoned.loc[poisoned["date"] > "2026-11-02", "y"] += 1000
        b = RN.lear_predict(poisoned, live, True, min_rows=200)          # lear_predict itself must cut the window at T - h
        self.assertTrue(a.notna().all())
        np.testing.assert_allclose(a.to_numpy(), b.to_numpy())


if __name__ == "__main__":
    unittest.main(verbosity=1)
