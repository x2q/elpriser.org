#!/usr/bin/env python3
"""Unit tests of the Great Britain / Portugal / Ireland estimate (no network, no LightGBM, no Spark): the leakage rule of the feature rows, the baselines, the models'
building blocks, the hour-23 estimator, the payload builders and the checked-in gate files. Run: python3 test_gb.py  (also by test-eu-forecast.mjs)."""
import json
import os
import sys
import unittest
from datetime import date

import numpy as np
import pandas as pd

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import gbcal                                    # noqa: E402
import gbfeat as GF                             # noqa: E402
import gbjob as GJ                              # noqa: E402
import gbmodels as GM                           # noqa: E402
import hour23 as H23                            # noqa: E402


def make_prices(days=80, start="2026-06-01", seed=1):
    """Hourly prices on a naive London clock with a daily shape, a weekly pattern and a drifting level; every hour distinct."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=days * 24, freq="h")
    base = 100 + 25 * np.sin((idx.hour - 6) / 24 * 2 * np.pi) + 15 * (idx.weekday >= 5) * -1 + np.linspace(0, 40, len(idx))
    return pd.Series(base + rng.normal(0, 5, len(idx)), index=idx)


def make_weather(idx):
    rng = np.random.default_rng(2)
    return pd.DataFrame({"wind": 8 + rng.normal(0, 2, len(idx)), "rad": np.maximum(0, 300 * np.sin((idx.hour - 6) / 12 * np.pi)), "temp": 10 + rng.normal(0, 1, len(idx)),
                         "precip": np.zeros(len(idx))}, index=idx)


class Calendar(unittest.TestCase):
    def test_bank_holidays_2026_2027(self):
        h26 = gbcal.holidays(2026)
        for d in ("2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28"):
            self.assertIn(date.fromisoformat(d), h26, d)
        self.assertNotIn(date(2026, 12, 26), h26, "Boxing Day on a Saturday moves to Monday 28")
        h27 = gbcal.holidays(2027)
        self.assertIn(date(2027, 12, 27), h27)
        self.assertIn(date(2027, 12, 28), h27)
        self.assertIn(date(2027, 1, 1), h27 | {date(2027, 1, 1)})
        self.assertTrue(gbcal.xmas_week(date(2026, 12, 30)) and not gbcal.xmas_week(date(2026, 12, 20)))


class Rows(unittest.TestCase):
    def setUp(self):
        self.p = make_prices()
        self.wx = {lead: make_weather(self.p.index) for lead in range(1, 8)}
        self.h = GF.Hist(self.p, wx_by_lead=self.wx)
        self.D = date(2026, 7, 25)
        self.di = self.h.di(self.D)

    def rows(self, h, a=8, D=None):
        return pd.DataFrame({c: np.concatenate([r[c] for r in GF.rows_for_day(h, D or self.D, [a])]) for c in GF.rows_for_day(h, D or self.D, [a])[0]})

    def test_shape_and_horizons(self):
        r = self.rows(self.h, 8)
        self.assertEqual(sorted(r["k"].unique()), list(range(8)))
        self.assertEqual(sorted(r[r.k == 0]["hr"]), list(range(8, 24)), "the rest of today is the hours at and after the as-of hour")
        self.assertTrue((r[r.k == 3]["hr"].tolist() == list(range(24))))
        self.assertEqual(r[(r.k == 0)]["ahead"].min(), 1)
        self.assertEqual(r[(r.k == 1) & (r.hr == 0)]["ahead"].iloc[0], 24 - 8 + 1)

    def test_no_future_information_in_the_features(self):
        """Whatever happens to today's hours from the as-of hour on, and to every later day, the features of the rows are unchanged (only y moves)."""
        a = 8
        base = self.rows(self.h, a)
        p2 = self.p.copy()
        idx = (p2.index >= pd.Timestamp(self.D) + pd.Timedelta(hours=a))
        p2[idx] = p2[idx] * 3 + 1000                       # the future, wildly different
        h2 = GF.Hist(p2, wx_by_lead=self.wx)
        other = self.rows(h2, a)
        feats = [c for c in base.columns if c != "y"]
        pd.testing.assert_frame_equal(base[feats].reset_index(drop=True), other[feats].reset_index(drop=True))
        self.assertFalse(np.allclose(base["y"], other["y"]), "y is the only thing that moves")

    def test_intraday_features_use_only_finished_hours(self):
        """rho is the mean residual of hours < a: changing the price of hour a (still running) changes nothing, changing hour a-1 does."""
        a = 8
        base = self.rows(self.h, a)
        p2 = self.p.copy()
        p2[pd.Timestamp(self.D) + pd.Timedelta(hours=a)] += 500
        same = self.rows(GF.Hist(p2, wx_by_lead=self.wx), a)
        self.assertTrue(np.allclose(base["rho1"], same["rho1"]) and np.allclose(base["rho_all"], same["rho_all"]))
        p3 = self.p.copy()
        p3[pd.Timestamp(self.D) + pd.Timedelta(hours=a - 1)] += 500
        moved = self.rows(GF.Hist(p3, wx_by_lead=self.wx), a)
        self.assertFalse(np.allclose(base["rho1"], moved["rho1"]))

    def test_level_shape_baseline(self):
        r = self.rows(self.h, 8)
        k1 = r[r.k == 1].sort_values("hr")
        di = self.di
        lvl = np.nanmean([self.h.dm[di - j] for j in range(1, 8)])
        T = di + 1
        sea = np.nanmean(np.vstack([self.h.P[T - lag] for lag in (7, 14, 21, 28)]), axis=0)
        want = sea - sea.mean() + lvl
        self.assertTrue(np.allclose(k1["b_A"].to_numpy(), want), "level (7 complete days) + the seasonal profile minus its own mean")
        k7 = r[r.k == 7].sort_values("hr")
        sea7 = np.nanmean(np.vstack([self.h.P[di + 7 - lag] for lag in (14, 21, 28)]), axis=0)      # lag 7 of D+7 is today: not complete, not used
        self.assertTrue(np.allclose(k7["b_A"].to_numpy(), sea7 - sea7.mean() + lvl))
        self.assertTrue(np.allclose(k1["b_persist"].to_numpy(), self.h.P[di - 1]), "persistence is the last COMPLETE day")

    def test_live_hist_masks_the_running_hour(self):
        h = GJ.live_hist(self.p, make_weather(self.p.index).rename(columns=lambda c: c), self.D, 8)
        self.assertTrue(np.isnan(h.P[self.di, 8:]).all() and np.isfinite(h.P[self.di, :8]).all())

    def test_design_has_no_nan_and_is_relative(self):
        r = self.rows(self.h, 8)
        X = GF.design(r)
        self.assertFalse(X.isna().any().any())
        self.assertFalse(any(c in GF.LGB_FEATS for c in ("b_A", "level_7d", "level_30d")), "no absolute price level among the tree features")


class Models(unittest.TestCase):
    def test_ridge_recovers_a_linear_rule(self):
        rng = np.random.default_rng(0)
        X = rng.normal(size=(2000, 4))
        y = 3 * X[:, 0] - 2 * X[:, 2] + 5 + rng.normal(0, 0.1, 2000)
        m = GM.ridge_fit(X, y)
        self.assertLess(np.abs(GM.ridge_predict(m, X) - y).mean(), 0.2)

    def test_fixed_rules(self):
        df = pd.DataFrame({"b_A": [100.0, 100.0], "rho3": [20.0, 20.0], "ahead": [1, 60], "known_mean": [120.0, 120.0], "a_known_mean": [100.0, 100.0]})
        s = GM.b_simple(df)
        self.assertGreater(s[0], 110)
        self.assertAlmostEqual(s[1], 100.0, delta=0.01)
        self.assertGreater(GM.b_mult(df)[0], 110)
        self.assertAlmostEqual(GM.b_mult(df)[1], 100.0, delta=0.5)

    def test_band_contains_the_point_and_uses_the_class_offsets(self):
        df = pd.DataFrame({"k": [0, 0, 1], "ahead": [2, 12, 30]})
        self.assertEqual(list(GM.lead_class(df)), ["r1", "r3", "d1"])
        off = {"r1": {"lo": -5, "hi": 6}, "r3": {"lo": -9, "hi": 12}, "d1": {"lo": -10, "hi": 15}}
        lo, hi = GM.apply_band(df, [100, 100, 100], [98, 90, 120], [110, 120, 130], off)
        self.assertTrue(np.all(lo <= 100) and np.all(hi >= 100))
        self.assertEqual(list(lo), [93.0, 81.0, 100.0])
        self.assertEqual(list(hi), [116.0, 132.0, 145.0])

    def test_offsets_are_scaled_percentiles_of_the_own_miss(self):
        rng = np.random.default_rng(3)
        n = 600
        res = pd.DataFrame({"cls": "d1", "date": pd.Timestamp("2026-10-01"), "y": 100 + rng.normal(0, 10, n)})
        res["q10"], res["q90"] = 90.0, 110.0
        o = GM.band_offsets(res)["d1"]
        self.assertAlmostEqual(o["lo"], np.percentile(res["y"] - 90, 10) * 1.2, places=1)
        self.assertAlmostEqual(o["hi"], np.percentile(res["y"] - 110, 90) * 1.2, places=1)


class Hour23(unittest.TestCase):
    def matrix(self):
        rng = np.random.default_rng(4)
        P = 100 + 20 * np.sin(np.arange(24) / 24 * 6.28)[None, :] + rng.normal(0, 3, (60, 24))
        P[:, 23] = P[:, 22] + 5 + rng.normal(0, 1, 60)         # hour 23 is hour 22 plus a typical step of about +5
        return P

    def test_estimators(self):
        P = self.matrix()
        i = 50
        self.assertEqual(H23.estimate(P, i, "persist"), P[i, 22])
        want = P[i, 22] + np.median(P[22:50, 23] - P[22:50, 22])
        self.assertAlmostEqual(H23.estimate(P, i, "med28"), want)
        self.assertLess(abs(H23.estimate(P, i, "med28") - P[i, 23]), abs(H23.estimate(P, i, "persist") - P[i, 23]) + 3)

    def test_nothing_from_the_future_or_a_missing_hour_22(self):
        P = self.matrix()
        a = H23.estimate(P, 50, "med28")
        P2 = P.copy()
        P2[50, 23] = 999.0                                      # the hour being estimated
        P2[51:, :] = 999.0                                      # later days
        self.assertEqual(H23.estimate(P2, 50, "med28"), a)
        P3 = P.copy()
        P3[50, 22] = np.nan
        self.assertTrue(np.isnan(H23.estimate(P3, 50, "persist")) and np.isnan(H23.estimate(P3, 50, "med28")))
        self.assertTrue(np.isnan(H23.estimate(P[:5], 4, "med28")), "too little history for the typical step: no estimate")
        self.assertEqual(set(H23.naive(P, 50)), {"persist", "yday", "lag7"})

    def test_band(self):
        self.assertIsNone(H23.band_offsets([1.0] * 10))
        lo, hi = H23.band_offsets(np.linspace(-10, 10, 200))
        self.assertLess(lo, 0)
        self.assertGreater(hi, 0)


class Payloads(unittest.TestCase):
    def setUp(self):
        self.gate = {"version": 1, "period": "2025-04-01..2026-11-02", "recent": "2026-09-01", "baseline": "level+shape",
                     "rest": {"0": {"publish": True, "mae": 19.0, "baseMae": 24.0, "gain": 0.2}, "8": {"publish": True, "mae": 18.0, "baseMae": 25.0, "gain": 0.28, "coverage": 0.77},
                              "20": {"publish": False, "mae": 12.0, "baseMae": 20.0, "gain": 0.4}},
                     "days": {"1": {"publish": True, "mae": 20.0, "baseMae": 25.0, "gain": 0.22, "coverage": 0.78}, "2": {"publish": False, "mae": 21.0, "baseMae": 25.0, "gain": 0.03},
                              "3": {"publish": True, "mae": 22.0, "baseMae": 26.0, "gain": 0.15}}}
        self.p = make_prices()
        self.h = GF.Hist(self.p)
        self.today = date(2026, 7, 25)

    def pred(self, a=8, hole=None, band=True):
        rows = []
        for k in range(0, 4):
            hrs = range(a, 24) if k == 0 else range(24)
            for hr in hrs:
                pt = 150.0 + hr
                rows.append({"k": k, "hr": hr, "point": np.nan if hole == (k, hr) else pt, "lo": pt - 20 if band else np.nan, "hi": pt + 30 if band else np.nan})
        return pd.DataFrame(rows)

    def test_rest_cell_uses_the_nearest_tested_hour_below(self):
        self.assertEqual(GJ.rest_cell(self.gate, 8)[0], 8)
        self.assertEqual(GJ.rest_cell(self.gate, 13)[0], 8)
        self.assertEqual(GJ.rest_cell(self.gate, 23)[0], 20)
        self.assertEqual(GJ.rest_cell(self.gate, 1)[0], 0)

    def test_estimate_is_the_unsettled_hours_with_band_and_accuracy(self):
        h = GJ.live_hist(self.p, None, self.today, 8)
        e = GJ.build_estimate(self.pred(8), self.gate, h, self.today, 8, "2026-07-25T08:12:00+00:00")
        self.assertEqual([x["hour"] for x in e["hours"]], list(range(8, 24)))
        self.assertTrue(all(x["min_eur_mwh"] <= x["eur_mwh"] <= x["max_eur_mwh"] for x in e["hours"]))
        self.assertEqual(e["date"], "2026-07-25")
        self.assertEqual(e["accuracy"]["asOf"], 8)
        self.assertEqual(e["accuracy"]["unit"], "GBP/MWh")
        self.assertEqual(e["unit"], "GBP/MWh")

    def test_estimate_is_cut_at_a_hole_dropped_when_the_class_fails_and_never_covers_a_settled_hour(self):
        h = GJ.live_hist(self.p, None, self.today, 8)
        e = GJ.build_estimate(self.pred(8, hole=(0, 15)), self.gate, h, self.today, 8, "t")
        self.assertEqual([x["hour"] for x in e["hours"]], list(range(8, 15)), "a run of consecutive hours, cut at the first hole")
        self.assertIsNone(GJ.build_estimate(self.pred(20), self.gate, GJ.live_hist(self.p, None, self.today, 20), self.today, 20, "t"), "the class rest@20 is not published")
        e2 = GJ.build_estimate(self.pred(8, band=False), self.gate, h, self.today, 8, "t")
        self.assertTrue(all("min_eur_mwh" not in x for x in e2["hours"]), "no band, no half band")
        h2 = GJ.live_hist(self.p, None, self.today, 24)             # nothing is unsettled
        self.assertIsNone(GJ.build_estimate(self.pred(8), self.gate, h2, self.today, 8, "t"))

    def test_forecast_days_only_for_published_horizons_with_24_finite_hours(self):
        f = GJ.build_forecast(self.pred(8), self.gate, self.today, "t", "2026-07-24")
        self.assertEqual([d["horizon"] for d in f["days"]], [1, 3])
        self.assertEqual([d["date"] for d in f["days"]], ["2026-07-26", "2026-07-28"])
        self.assertTrue(all(len(d["prices"]) == 24 and d["type"] == "forecast" for d in f["days"]))
        self.assertEqual(sorted(f["accuracy"]["byHorizon"]), ["1", "3"])
        self.assertEqual(f["accuracy"]["unit"], "GBP/MWh")
        self.assertEqual(f["generated"], "2026-07-25")
        f2 = GJ.build_forecast(self.pred(8, hole=(1, 5)), self.gate, self.today, "t", "x")
        self.assertEqual([d["horizon"] for d in f2["days"]], [3], "a day with a missing hour is dropped, never patched")
        self.assertIsNone(GJ.build_forecast(self.pred(8, hole=(1, 5)), {**self.gate, "days": {"1": self.gate["days"]["1"]}}, self.today, "t", "x"))


class CheckedInFiles(unittest.TestCase):
    def load(self, name):
        with open(os.path.join(DIR, name), encoding="utf-8") as f:
            return json.load(f)

    def test_gate_publishes_only_what_passed_the_rule(self):
        g = self.load("gb_gate.json")
        self.assertEqual(g["version"], 1)
        self.assertEqual(g["unit"], "GBP/MWh")
        self.assertFalse(__import__("re").search(r"80 ?%", json.dumps(g)))
        for kind in ("rest", "days"):
            self.assertTrue(g[kind])
            for k, c in g[kind].items():
                want = c["gain"] >= 0.05 and c["gainHold"] >= 0.05 and c["mae"] <= c["persistMae"] and c["coverage"] is not None
                self.assertEqual(c["publish"], want, f"{kind} {k}")
                self.assertTrue(c["mae"] > 0 and c["baseMae"] > 0 and 0 < c["coverage"] < 1)
        self.assertEqual(sorted(int(k) for k in g["days"]), list(range(1, 8)))

    def test_calibration_has_an_offset_pair_for_every_class(self):
        c = self.load("gb_calibration.json")
        self.assertEqual(c["version"], 1)
        for cls in ("r1", "r2", "r3", *[f"d{k}" for k in range(1, 8)]):
            self.assertLess(c["offsets"][cls]["lo"], 0)
            self.assertGreater(c["offsets"][cls]["hi"], 0)

    def test_hour23_gate(self):
        g = self.load("hour23_gate.json")
        self.assertEqual(sorted(g["zones"]), ["ie", "pt"])
        for z, c in g["zones"].items():
            self.assertIn(c["method"], H23.METHODS)
            self.assertTrue(c["publish"] and c["mae"] <= c["bestNaiveMae"] * 1.000001, z)
            if c["method"] == "persist":
                self.assertEqual(c["gain"], 0, "persistence claims no gain")


if __name__ == "__main__":
    unittest.main(verbosity=1)
