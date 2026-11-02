#!/usr/bin/env python3
"""Unit tests for the EU forecast model's pure logic (no network, no LightGBM, no Spark): holidays, the leakage rule of the
feature rows, training/scoring parity, the metrics, the target days and the KV payload.

    python3 scripts/forecast_model/eu/test_eu_forecast.py
"""
import os
import re
import sys
import unittest
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import calendar_features as C    # noqa: E402
import features as F             # noqa: E402
import forecast as FC            # noqa: E402
import level_correction as LC    # noqa: E402
import calibrate as K             # noqa: E402
import metrics as M              # noqa: E402
import kv as KV                  # noqa: E402
import monitor as MON            # noqa: E402
from zones import ZONES          # noqa: E402


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def synthetic(zone_names=("de", "fr"), days=70, seed=1):
    """Hourly prices on a naive local clock with a daily shape, a weekly pattern and a drifting level; plus weather."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-01-01", periods=24 * days, freq="h")
    prices, wx = {}, {}
    for i, z in enumerate(zone_names):
        base = 60 + 20 * i + 15 * np.sin(np.arange(len(idx)) / 24 / 9)
        shape = 25 * np.sin((idx.hour - 6) / 24 * 2 * np.pi)
        wk = np.where(idx.weekday >= 5, -12, 0)
        prices[z] = pd.Series(base + shape + wk + rng.normal(0, 3, len(idx)), index=idx)
        wx[z] = pd.DataFrame({"wind": rng.uniform(0, 12, len(idx)), "rad": rng.uniform(0, 400, len(idx)),
                              "temp": rng.uniform(-3, 15, len(idx)), "precip": rng.uniform(0, 1, len(idx))}, index=idx)
    reg = pd.DataFrame({"reg_wind": 5.0, "reg_rad": 100.0, "reg_temp": 5.0}, index=idx)
    return idx, prices, wx, reg


class Holidays(unittest.TestCase):
    def test_easter_dates(self):
        self.assertEqual(C.easter(2026), date(2026, 4, 5))
        self.assertEqual(C.easter(2025), date(2025, 4, 20))
        self.assertEqual(C.easter(2027), date(2027, 3, 28))

    def test_orthodox_easter(self):
        self.assertEqual(C.orthodox_easter(2026), date(2026, 4, 12))
        self.assertEqual(C.orthodox_easter(2025), date(2025, 4, 20))

    def test_flags(self):
        self.assertTrue(C.is_holiday(date(2026, 12, 25), "DE"))
        self.assertTrue(C.is_holiday(date(2026, 4, 6), "DE"))          # Easter Monday
        self.assertTrue(C.is_holiday(date(2026, 4, 3), "DE"))          # Good Friday
        self.assertFalse(C.is_holiday(date(2026, 4, 3), "FR"))
        self.assertTrue(C.is_holiday(date(2026, 4, 13), "RO"))         # Orthodox Easter Monday
        self.assertFalse(C.is_holiday(date(2026, 11, 3), "DE"))
        self.assertTrue(C.xmas_week(date(2026, 12, 29)))
        self.assertFalse(C.xmas_week(date(2026, 12, 23)) or C.xmas_week(date(2027, 1, 2)))
        self.assertTrue(C.xmas_week(date(2026, 12, 24)) and C.xmas_week(date(2027, 1, 1)))

    def test_every_zone_has_a_calendar(self):
        for z in ZONES:
            self.assertIn(F.COUNTRY[z], C.FIXED, z)
            self.assertIn(F.COUNTRY[z], C.EASTER, z)


class Zones(unittest.TestCase):
    def test_zone_table_agrees_with_the_price_jobs(self):
        """The model's zones, EIC codes and clocks are exactly those of scripts/eu_prices (the jobs that write eu-prices-*)."""
        root = os.path.join(HERE, "..", "..", "eu_prices")
        en = read(os.path.join(root, "build_entsoe_prices.py"))
        ec = read(os.path.join(root, "build_eu_prices.py"))
        en_z = dict((m[0], (m[1], m[2])) for m in re.findall(r'^\s+"([a-z-]+)":\s+\("(10Y[0-9A-Z-]{13})",\s+"([A-Za-z/_]+)"\)', en, re.M))
        ec_z = dict((m[0], m[1]) for m in re.findall(r'^\s+"([a-z-]+)":\s+\("[A-Za-z-]+",\s+"([A-Za-z/_]+)"\)', ec, re.M))
        # the model covers the Energy-Charts and ENTSO-E zones plus Ireland (whose prices the site now takes from SEMOpx; the model keeps
        # reading the same SEM prices from ENTSO-E) - not Kosovo (no model) and not Great Britain (a within-day index, not a day-ahead price)
        self.assertEqual(set(ZONES), (set(en_z) | set(ec_z) | {"ie"}) - {"xk"})
        for z, (eic, tz) in en_z.items():
            if z != "xk":
                self.assertEqual((ZONES[z][0], ZONES[z][1]), (eic, tz), z)
        for z, tz in ec_z.items():
            self.assertEqual(ZONES[z][1], tz, z)

    def test_points_are_plausible(self):
        for z, (_, _, pts) in ZONES.items():
            self.assertTrue(1 <= len(pts) <= 3, z)
            for lat, lon in pts:
                self.assertTrue(34 < lat < 60 and -12 < lon < 30, (z, lat, lon))


class Leakage(unittest.TestCase):
    """The rule that makes the backtest honest: a feature row for horizon h must not change if every price after the last
    known day is changed."""

    def rows(self, p, h, target, zone="de"):
        idx, prices, wx, reg = synthetic()
        prices[zone] = p
        days, eu = F.day_table(prices)
        t = pd.date_range(pd.Timestamp(target), periods=24, freq="h")
        return F.make_features(zone, t, h, p, wx[zone], reg, days[zone], eu)

    def test_prices_after_the_last_known_day_never_enter_a_row(self):
        idx, prices, _, _ = synthetic()
        p = prices["de"]
        for h in (2, 3, 5, 8):
            target = date(2026, 2, 20)
            last_known = pd.Timestamp(target) - pd.Timedelta(days=h - 1)
            a = self.rows(p, h, target)
            q = p.copy()
            q[q.index >= last_known + pd.Timedelta(days=1)] += 1000.0        # corrupt everything after the last known day
            b = self.rows(q, h, target)
            cols = [c for c in F.FEATS if c not in ("zone",)]
            # eu_* mixes in the other zone, which is corrupted too only through `p`, so compare the zone's own features
            own = [c for c in cols if not c.startswith("eu_") and c != "level_30d_vs_eu"]
            pd.testing.assert_frame_equal(a[own].reset_index(drop=True), b[own].reset_index(drop=True), obj=f"h={h}")

    def test_lags_younger_than_h_minus_1_are_empty(self):
        idx, prices, _, _ = synthetic()
        r = self.rows(prices["de"], 4, date(2026, 2, 20))
        self.assertTrue(r["lag1"].isna().all() and r["lag2"].isna().all())      # k < h-1 = 3
        self.assertTrue(r["lag3"].notna().all() and r["lag7"].notna().all())
        self.assertTrue(r["lag_last"].notna().all())                            # the last known day is always there
        t = pd.Timestamp(date(2026, 2, 20))
        expected = prices["de"].reindex(pd.date_range(t - pd.Timedelta(days=3), periods=24, freq="h")).values
        np.testing.assert_allclose(r["lag_last"].values, expected)

    def test_day_statistics_end_at_the_last_known_day(self):
        idx, prices, _, _ = synthetic()
        r = self.rows(prices["de"], 3, date(2026, 2, 20))
        last = pd.Timestamp(date(2026, 2, 18))                                  # target - (h-1) = 2 days
        day = prices["de"][prices["de"].index.normalize() == last]
        self.assertAlmostEqual(r["last_day_mean"].iloc[0], day.mean())
        days, _ = F.day_table(prices)
        self.assertAlmostEqual(r["level_30d"].iloc[0], days["de"].loc[last, "level_30d"])


class Parity(unittest.TestCase):
    """Training rows and live rows come from one function; a row built the 'live' way for a past day (prices cut at the last
    known day) must equal the training row built from the full history."""

    def test_live_row_equals_training_row(self):
        idx, prices, wx, reg = synthetic()
        zone, h, target = "fr", 5, date(2026, 2, 25)
        full_days, full_eu = F.day_table(prices)
        t = pd.date_range(pd.Timestamp(target), periods=24, freq="h")
        train_row = F.make_features(zone, t, h, prices[zone], wx[zone], reg, full_days[zone], full_eu)

        cut = pd.Timestamp(target) - pd.Timedelta(days=h - 2)                   # data up to the end of the last known day
        live = {z: p[p.index < cut] for z, p in prices.items()}
        live_days, live_eu = F.day_table(live)
        live_row = F.make_features(zone, t, h, live[zone], wx[zone], reg, live_days[zone], live_eu)
        own = [c for c in F.FEATS if c != "zone"]
        pd.testing.assert_frame_equal(train_row[own].reset_index(drop=True), live_row[own].reset_index(drop=True))


class Metrics(unittest.TestCase):
    def test_regret_zero_for_a_perfect_ranking(self):
        a = np.array([[5.0 + h for h in range(24)], [30.0 - h for h in range(24)]])
        np.testing.assert_allclose(M.regret(a, a), [0, 0])
        # against the single cheapest hour even a perfect ranking costs the spread of the 3 cheapest: (0+1+2)/3 = 1
        np.testing.assert_allclose(M.regret_vs_min(a, a), [1.0, 1.0])

    def test_regret_of_the_worst_ranking(self):
        a = np.array([np.arange(24.0)])
        wrong = -a                                  # ranks the dearest hours cheapest
        self.assertAlmostEqual(M.regret(a, wrong)[0], np.mean([23, 22, 21]) - np.mean([0, 1, 2]))

    def test_nan_rows_are_nan(self):
        a = np.arange(24.0)[None, :].copy()
        f = a.copy()
        f[0, 3] = np.nan
        self.assertTrue(np.isnan(M.regret(a, f)[0]))

    def test_blend_keeps_the_daily_mean_of_the_model(self):
        rows = []
        for hr in range(24):
            rows.append({"zone": "de", "date": "2026-01-02", "h": 2, "hour": hr, "p": 50 + hr, "seasonal4w": 100 - 2 * hr})
        d = pd.DataFrame(rows)
        d["zone"] = pd.Categorical(d["zone"])
        out = M.blend(d, "p")
        self.assertAlmostEqual(out.mean(), d["p"].mean())

    def test_scorecard_shapes(self):
        rng = np.random.default_rng(0)
        rows = []
        for day in pd.date_range("2026-01-01", periods=6):
            for hr in range(24):
                y = 50 + 10 * np.sin(hr / 24 * 6.28) + rng.normal(0, 1)
                rows.append({"zone": "de", "date": day, "h": 2, "hour": hr, "y": y, "m": y + rng.normal(0, 2), "n": 50.0})
        d = pd.DataFrame(rows)
        d["zone"] = pd.Categorical(d["zone"])
        sc = M.scorecard(d, {"model": "m", "naive": "n"})
        self.assertEqual(len(sc), 1)
        self.assertLess(sc["model_mae"].iloc[0], sc["naive_mae"].iloc[0])
        self.assertLess(sc["model_regret"].iloc[0], sc["naive_regret"].iloc[0])
        self.assertEqual(sc["n_days"].iloc[0], 6)


class Scoring(unittest.TestCase):
    def setUp(self):
        self.idx, self.prices, self.wx, self.reg = synthetic(days=60)
        self.days, self.eu = F.day_table(self.prices)
        self.last = FC.last_known_day(self.prices["de"])
        wx = self.wx["de"]
        self.wxl = wx.reindex(pd.date_range(wx.index.min(), wx.index.max() + pd.Timedelta(days=10), freq="h"))
        self.regl = self.reg.reindex(self.wxl.index)

    def rows(self, today=None, zone="de"):
        return FC.build_rows(zone, self.prices[zone], self.wxl, self.regl, self.days[zone], self.eu, today or self.last)

    def test_last_known_day_needs_12_hours(self):
        p = self.prices["de"].copy()
        p = p[p.index < p.index.max().normalize() + pd.Timedelta(hours=5)]       # the last day has only 6 hours
        self.assertEqual(FC.last_known_day(p), (p.index.max().normalize() - pd.Timedelta(days=1)).date())

    def test_target_days_and_horizons(self):
        lk = date(2026, 11, 3)                       # tomorrow is published on 2 November
        t = FC.target_days(lk, date(2026, 11, 2))
        self.assertEqual(t[0], (date(2026, 11, 4), 2))
        self.assertEqual(t[-1], (date(2026, 11, 9), 7))
        self.assertEqual(len(t), 6)                  # D+2 .. D+7
        # tomorrow not published yet: it is itself h = 2, and the horizon never exceeds MAX_H
        t2 = FC.target_days(date(2026, 11, 2), date(2026, 11, 2))
        self.assertEqual(t2[0], (date(2026, 11, 3), 2))
        self.assertTrue(all(2 <= h <= FC.MAX_H for _, h in t2))
        self.assertEqual(FC.MAX_H, 7)

    def test_rows_cover_every_horizon_with_the_last_known_day_populated(self):
        r = self.rows()
        self.assertEqual(sorted(r["h"].unique()), [2, 3, 4, 5, 6, 7])
        self.assertEqual(len(r), 6 * 24)
        self.assertTrue(r["lag_last"].notna().all(), "lag_last (the last known day) must always be populated")
        self.assertEqual(r["date"].min(), pd.Timestamp(self.last + timedelta(days=1)))
        self.assertTrue((r["zone"] == "de").all())

    def test_stale_prices_give_no_rows(self):
        self.assertTrue(self.rows(today=self.last + timedelta(days=5)).empty)

    def edges_for(self, r, point, off=(-10.0, 12.0)):
        lo, hi = np.full(len(r), off[0]), np.full(len(r), off[1])
        return FC.band_edges(point, None, None, lo, hi)

    def test_days_shape_bands_and_the_gate(self):
        r = self.rows()
        point = np.full(len(r), 55.5)
        out = FC.build_days(r, point, self.edges_for(r, point), {2, 3, 5})
        self.assertEqual([d["horizon"] for d in out], [2, 3, 5])           # D+4, D+6, D+7 are not allowed by the gate
        d0 = out[0]
        self.assertEqual(d0["date"], (self.last + timedelta(days=1)).isoformat())
        self.assertEqual(d0["type"], "forecast")
        self.assertEqual(len(d0["prices"]), 24)
        self.assertEqual(d0["prices"][5], {"hour": 5, "eur_mwh": 55.5, "min_eur_mwh": 45.5, "max_eur_mwh": 67.5})
        self.assertEqual(FC.build_days(r, point, None, set()), [])

    def test_the_band_always_contains_the_central_estimate(self):
        r = self.rows()
        point = np.linspace(40, 90, len(r))
        q_lo, q_hi = point + 5.0, point + 20.0          # the quantile models' edges sit ABOVE the ensemble's estimate
        e = FC.band_edges(point, q_lo, q_hi, np.full(len(r), -1.0), np.full(len(r), 3.0))
        for d in FC.build_days(r, point, e, {2, 3, 4, 5, 6, 7}):
            for p in d["prices"]:
                self.assertLessEqual(p["min_eur_mwh"], p["eur_mwh"])
                self.assertGreaterEqual(p["max_eur_mwh"], p["eur_mwh"])

    def test_quantile_edges_get_their_own_offsets(self):
        point = np.array([50.0, 60.0])
        e = FC.band_edges(point, np.array([40.0, 50.0]), np.array([70.0, 80.0]), np.array([-4.0, -4.0]), np.array([9.0, 9.0]))
        np.testing.assert_allclose(e[0], [36.0, 46.0])
        np.testing.assert_allclose(e[1], [79.0, 89.0])

    def test_no_calibration_no_band_and_a_partial_band_is_no_band(self):
        r = self.rows()
        point = np.full(len(r), 40.0)
        self.assertIsNone(FC.band_edges(point, None, None, np.full(len(r), np.nan), np.full(len(r), np.nan)))
        out = FC.build_days(r, point, None, {2, 3})
        self.assertTrue(out and "min_eur_mwh" not in out[0]["prices"][0])
        lo = np.full(len(r), -5.0)
        lo[3] = np.nan                                                      # one hour of the first day has no edge
        hi = np.full(len(r), 5.0)
        e = FC.band_edges(point, None, None, lo, hi)
        days = FC.build_days(r, point, e, {2, 3})
        self.assertNotIn("min_eur_mwh", days[0]["prices"][0], "a band on some hours only must not be published")
        self.assertIn("min_eur_mwh", days[1]["prices"][0])

    def test_offset_arrays_per_horizon_and_the_nearest_fallback(self):
        cal = {"quantile": {"de": {"2": {"lo": -1.0, "hi": 2.0}, "4": {"lo": -3.0, "hi": 6.0}}}, "residual": {}}
        lo, hi = FC.offset_arrays(cal, "quantile", "de", [2, 3, 4, 7])
        np.testing.assert_allclose(lo, [-1, -1, -3, -3])             # 3 is equidistant: the first (lower) key wins; 7 borrows 4
        lo, hi = FC.offset_arrays(cal, "quantile", "fr", [2])
        self.assertTrue(np.isnan(lo).all())
        lo, hi = FC.offset_arrays(cal, "residual", "de", [2])
        self.assertTrue(np.isnan(hi).all())

    def test_non_finite_day_is_dropped_not_patched(self):
        r = self.rows()
        point = np.where(r["h"] == 3, np.nan, 40.0)
        out = FC.build_days(r, point, None, {2, 3, 4})
        self.assertNotIn(3, [d["horizon"] for d in out])
        self.assertIn(2, [d["horizon"] for d in out])
        point = np.full(len(r), 40.0)
        point[list(r.index[r["h"] == 4])[5]] = np.inf                       # one infinite hour costs the whole day
        self.assertNotIn(4, [d["horizon"] for d in FC.build_days(r, point, None, {2, 3, 4})])

    def test_hours_are_in_order_whatever_the_row_order(self):
        r = self.rows()
        shuffled = r.sample(frac=1.0, random_state=3).reset_index(drop=True)
        point = shuffled["hour"].to_numpy(dtype=float)
        out = FC.build_days(shuffled, point, None, {2})
        self.assertEqual([p["eur_mwh"] for p in out[0]["prices"]], [float(h) for h in range(24)])

    def test_payload_shape(self):
        pl = FC.payload("de", [], date(2026, 11, 2), date(2026, 11, 1), "2026-11-02T12:50:00+00:00",
                        {"byHorizon": {"2": {"mae": 20}}}, "ens", True)
        self.assertEqual(set(pl), {"zone", "generated", "generatedAt", "trainedThrough", "unit", "model", "days", "accuracy", "recipe", "fuel"})
        self.assertEqual(pl["trainedThrough"], "2026-11-01")
        self.assertEqual(pl["model"], "eu-ens-v2")
        self.assertNotIn("accuracy", FC.archive_payload(pl))
        self.assertEqual(FC.payload("de", [], date(2026, 11, 2), None, "x")["trainedThrough"], None)


class LevelCorrection(unittest.TestCase):
    def backtest_frame(self, bias_by_day, h=3, zone="de"):
        """One row per hour: forecast = actual - bias of that target day (so the day error equals the bias)."""
        rows = []
        for day, bias in bias_by_day.items():
            for hr in range(24):
                rows.append({"zone": zone, "date": pd.Timestamp(day), "h": h, "hour": hr, "y": 100.0, "p_raw": 100.0 - bias})
        d = pd.DataFrame(rows)
        d["zone"] = pd.Categorical(d["zone"])
        return d

    def test_only_days_settled_at_issue_time_are_used(self):
        # target 2026-03-20 at h=3: the last known day is 03-18; the window is the 14 days ending there
        days = {d.strftime("%Y-%m-%d"): 10.0 for d in pd.date_range("2026-03-01", "2026-03-18")}
        days.update({d.strftime("%Y-%m-%d"): 500.0 for d in pd.date_range("2026-03-19", "2026-03-25")})   # not settled yet: must not count
        errs = LC.day_errors_from_backtest(self.backtest_frame(days))
        self.assertAlmostEqual(LC.correction(errs, "de", 3, pd.Timestamp("2026-03-20").date(), lam=0.5), 5.0)
        self.assertAlmostEqual(LC.correction(errs, "de", 3, pd.Timestamp("2026-03-20").date(), lam=1.0), 10.0)

    def test_no_evidence_no_correction(self):
        errs = LC.day_errors_from_backtest(self.backtest_frame({"2026-03-01": 10.0, "2026-03-02": 10.0}))
        self.assertEqual(LC.correction(errs, "de", 3, pd.Timestamp("2026-03-05").date()), 0.0)     # 2 days < MIN_DAYS
        self.assertEqual(LC.correction(errs, "fr", 3, pd.Timestamp("2026-03-05").date()), 0.0)     # another zone
        self.assertEqual(LC.correction(errs, "de", 4, pd.Timestamp("2026-03-05").date()), 0.0)     # another horizon
        self.assertEqual(LC.correction(None, "de", 3, pd.Timestamp("2026-03-05").date()), 0.0)
        self.assertEqual(LC.correction(errs, "de", 3, pd.Timestamp("2026-03-05").date(), lam=0), 0.0)

    def test_the_vectorised_backtest_version_equals_the_per_forecast_one(self):
        """What the backtest measures must be exactly what production applies."""
        rng = np.random.default_rng(5)
        days = {d.strftime("%Y-%m-%d"): float(rng.normal(8, 12)) for d in pd.date_range("2026-01-01", periods=70)}
        bt = self.backtest_frame(days, h=4)
        vec = LC.apply_to_backtest(bt, lam=0.5)
        errs = LC.day_errors_from_backtest(bt)
        per_row = np.array([LC.correction(errs, "de", 4, r.date.date(), lam=0.5) for r in bt.itertuples()])
        np.testing.assert_allclose(vec, per_row, atol=1e-9)
        self.assertTrue((vec != 0).any())

    def test_the_archive_wins_over_the_backtest_and_measures_the_uncorrected_model(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            day = {"date": "2026-03-02", "type": "forecast", "horizon": 3, "prices": [{"hour": h, "eur_mwh": 999.0} for h in range(24)],
                   "uncorrected": [90.0] * 24}
            with open(os.path.join(td, "de-2026-02-28.json"), "w", encoding="utf-8") as f:
                json.dump({"zone": "de", "days": [day, {**day, "date": "2026-03-03", "uncorrected": [80.0] * 24}]}, f)
            idx = pd.date_range("2026-03-02", periods=48, freq="h")
            prices = {"de": pd.Series(100.0, index=idx)}
            arch = LC.day_errors_from_archive(td, prices)
            self.assertEqual(sorted(arch["res"].round(1).tolist()), [10.0, 20.0])      # actual - UNcorrected, not the 999 published
            bt = LC.day_errors_from_backtest(self.backtest_frame({"2026-03-02": 1.0}, h=3))
            merged = LC.merge_errors(arch, bt)
            self.assertEqual(len(merged), 2)
            self.assertAlmostEqual(float(merged[merged["date"] == pd.Timestamp("2026-03-02")]["res"].iloc[0]), 10.0)

    def test_build_days_applies_the_shift_and_the_published_payload_hides_the_raw_numbers(self):
        idx, prices, wx, reg = synthetic(days=60)
        days, eu = F.day_table(prices)
        lk = FC.last_known_day(prices["de"])
        w = wx["de"].reindex(pd.date_range(wx["de"].index.min(), wx["de"].index.max() + pd.Timedelta(days=10), freq="h"))
        rows = FC.build_rows("de", prices["de"], w, reg.reindex(w.index), days["de"], eu, lk)
        point = np.full(len(rows), 50.0)
        edges = (np.full(len(rows), 40.0), np.full(len(rows), 65.0))
        out = FC.build_days(rows, point, edges, {2, 3}, level_corr=lambda z, h, d: 7.0)
        self.assertEqual(out[0]["prices"][0], {"hour": 0, "eur_mwh": 57.0, "min_eur_mwh": 47.0, "max_eur_mwh": 72.0})     # the band moves with the shift
        self.assertEqual(out[0]["uncorrected"][0], 50.0)
        sh = FC.build_days(rows, point, None, {2, 3}, shadow_corr=lambda z, h, d: -4.0)
        self.assertEqual(sh[0]["prices"][0]["eur_mwh"], 50.0)                  # the shadow is never published
        self.assertEqual(sh[0]["shadow"][0], 46.0)
        pl = FC.payload("de", out, lk, lk, "x")
        self.assertTrue(all("uncorrected" not in d and "shadow" not in d for d in FC.payload("de", sh, lk, lk, "x")["days"]))
        self.assertTrue(all("uncorrected" not in d for d in pl["days"]))
        self.assertTrue(all("uncorrected" in d for d in FC.archive_payload(pl, out)["days"]))


class KvWrites(unittest.TestCase):
    """kv.put against a fake urlopen: the request is what Cloudflare expects and a failure never carries the token."""

    def test_put_request_shape_and_ttl(self):
        import io
        import json
        import urllib.error
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout=0):
            seen.update(url=req.full_url, method=req.get_method(), body=req.data, auth=req.get_header("Authorization"))
            return Resp(b'{"success": true}')
        real = KV.urllib.request.urlopen
        KV.urllib.request.urlopen = fake
        try:
            KV.put("eu-forecast-de", {"a": 1}, KV.FORECAST_TTL, "ACCT", "SECRET-TOKEN")
        finally:
            KV.urllib.request.urlopen = real
        self.assertEqual(seen["method"], "PUT")
        self.assertIn("/accounts/ACCT/storage/kv/namespaces/" + KV.KV_NAMESPACE + "/values/eu-forecast-de?expiration_ttl=259200", seen["url"])
        self.assertEqual(json.loads(seen["body"]), {"a": 1})
        self.assertEqual(seen["auth"], "Bearer SECRET-TOKEN")

        def boom(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 403, "no", {}, None)
        KV.urllib.request.urlopen = boom
        try:
            with self.assertRaises(RuntimeError) as cm:
                KV.put("k", {}, 60, "ACCT", "SECRET-TOKEN")
        finally:
            KV.urllib.request.urlopen = real
        self.assertNotIn("SECRET-TOKEN", str(cm.exception))
        self.assertIn("403", str(cm.exception))

    def test_the_key_is_escaped_not_interpreted(self):
        self.assertNotIn("/../", KV._url("../x", "A"))


class Calibration(unittest.TestCase):
    def frame(self, n_days=40, sigma=5.0, seed=3):
        rng = np.random.default_rng(seed)
        rows = []
        for day in pd.date_range("2026-01-01", periods=n_days):
            for hr in range(24):
                y = 60 + 15 * np.sin(hr / 24 * 6.28) + rng.normal(0, sigma)
                base = 60 + 15 * np.sin(hr / 24 * 6.28)
                rows.append({"zone": "de", "date": day, "h": 2, "hour": hr, "y": y, "p_md": base,
                             "b_lag7": base + 8, "b_seasonal": base + 6, "b_persist": base + 5, "b_lvlshape": base + 4,
                             "seasonal4w": base + 6, "level_7d": 60.0})
        d = pd.DataFrame(rows)
        d["zone"] = pd.Categorical(d["zone"])
        return d

    def test_bands_are_the_residual_quantiles(self):
        d = self.frame(n_days=60)
        b = K.residual_bands(d, window_days=None, scale=1.0)["de"]["2"]
        self.assertLess(b["lo"], 0)
        self.assertGreater(b["hi"], 0)
        self.assertAlmostEqual(b["hi"], 1.2816 * 5.0, delta=1.0)
        self.assertAlmostEqual(b["lo"], -1.2816 * 5.0, delta=1.0)
        wide = K.residual_bands(d, window_days=None, scale=1.2)["de"]["2"]
        self.assertAlmostEqual(wide["hi"], b["hi"] * 1.2, delta=0.02)

    def test_the_band_comes_from_the_recent_window_only(self):
        d = self.frame(n_days=120)
        d.loc[d["date"] < pd.Timestamp("2026-02-15"), "y"] += np.random.default_rng(1).normal(0, 40, (d["date"] < pd.Timestamp("2026-02-15")).sum())
        recent = K.residual_bands(d, window_days=40, scale=1.0)["de"]["2"]
        everything = K.residual_bands(d, window_days=None, scale=1.0)["de"]["2"]
        self.assertLess(recent["hi"], everything["hi"] / 3)             # old noisy period excluded: much narrower

    def test_thin_cells_get_no_band(self):
        self.assertEqual(K.residual_bands(self.frame(n_days=3)), {})

    def test_rolling_coverage_is_close_to_80_when_errors_are_stationary(self):
        cov = K.rolling_coverage(self.frame(n_days=240), window_days=90, scale=1.0, warmup_days=90)
        self.assertAlmostEqual(cov[("de", 2)], 0.8, delta=0.05)

    def test_a_volatility_jump_is_visible_in_the_measured_coverage(self):
        d = self.frame(n_days=240)
        late = d["date"] >= d["date"].min() + pd.Timedelta(days=150)
        d.loc[late, "y"] += np.random.default_rng(2).normal(0, 12, late.sum())     # errors 3x larger late on
        cov = K.rolling_coverage(d, window_days=90, scale=1.0, warmup_days=90)
        self.assertLess(cov[("de", 2)], 0.75)                                      # an honest number, not 80 %


class Monitoring(unittest.TestCase):
    def archive(self, zone="de", dates=("2026-03-02",), h=2, level=50.0):
        days = [{"date": d, "type": "forecast", "horizon": h,
                 "prices": [{"hour": hr, "eur_mwh": level + hr} for hr in range(24)]} for d in dates]
        return {"zone": zone, "generated": "2026-03-01", "days": days}

    def actual(self, dates, shift=0.0):
        idx = pd.DatetimeIndex([pd.Timestamp(d) + pd.Timedelta(hours=hr) for d in dates for hr in range(24)])
        return pd.Series([50.0 + i % 24 + shift for i in range(len(idx))], index=idx)

    def test_mae_and_bias_of_a_settled_day(self):
        live = MON.evaluate([self.archive(dates=["2026-03-02"])], {"de": self.actual(["2026-03-02"], shift=4.0)})
        r = live.iloc[0]
        self.assertEqual((r.zone, r.h, r.days), ("de", 2, 1))
        self.assertAlmostEqual(r.mae, 4.0)
        self.assertAlmostEqual(r.bias, -4.0)           # forecast below the realised price

    def test_shadow_and_uncorrected_numbers_can_be_scored_instead_of_the_published_ones(self):
        arch = self.archive(dates=["2026-03-02"], level=50.0)               # published: 50 + hour
        arch["days"][0]["uncorrected"] = [40.0 + hr for hr in range(24)]
        arch["days"][0]["shadow"] = [53.0 + hr for hr in range(24)]
        act = {"de": self.actual(["2026-03-02"])}                           # actual: 50 + hour
        self.assertAlmostEqual(MON.evaluate([arch], act).iloc[0].mae, 0.0)
        self.assertAlmostEqual(MON.evaluate([arch], act, "uncorrected").iloc[0].mae, 10.0)
        self.assertAlmostEqual(MON.evaluate([arch], act, "shadow").iloc[0].mae, 3.0)
        self.assertTrue(MON.evaluate([self.archive()], act, "shadow").empty)      # an archive without shadow numbers: nothing scored

    def test_unsettled_or_incomplete_days_are_not_scored(self):
        a = self.actual(["2026-03-02"])
        a = a[a.index.hour < 20]                       # four hours missing
        self.assertTrue(MON.evaluate([self.archive()], {"de": a}).empty)
        self.assertTrue(MON.evaluate([self.archive(zone="fr")], {"de": self.actual(["2026-03-02"])}).empty)

    def test_alert_needs_both_a_bad_ratio_and_enough_days(self):
        dates = [f"2026-03-{d:02d}" for d in range(1, 13)]
        acc = {"version": 2, "zones": {"de": {"fuel": {"2": {"mae": 2.0}}, "nofuel": {}}}}
        live = MON.evaluate([self.archive(dates=dates)], {"de": self.actual(dates, shift=10.0)})    # 10 EUR error vs 2 in the backtest
        res = MON.drift(live, acc, factor=1.5)
        self.assertTrue(bool(res["alert"].iloc[0]))
        few = MON.evaluate([self.archive(dates=dates[:3])], {"de": self.actual(dates[:3], shift=10.0)})
        self.assertFalse(bool(MON.drift(few, acc)["alert"].iloc[0]))        # three days: weather, not a broken model
        calm = MON.evaluate([self.archive(dates=dates)], {"de": self.actual(dates, shift=1.0)})
        self.assertFalse(bool(MON.drift(calm, acc)["alert"].iloc[0]))


class NoSecrets(unittest.TestCase):
    def test_no_token_literal_or_url_with_a_token_in_the_code(self):
        for f in sorted(os.listdir(HERE)):
            if not f.endswith(".py") or f.startswith("test_"):
                continue
            t = read(os.path.join(HERE, f))
            self.assertFalse(re.search(r"[0-9a-f]{32}", re.sub(r"KV_NAMESPACE\s*=\s*\"[0-9a-f]{32}\"", "", t)), f"a 32-hex literal in {f}")
            self.assertFalse(re.search(r"(print|log)\([^)]*(os\.environ|token\(\)|\bcf\b|\btoken\b)", t), f"{f} prints something that could be a token value")


if __name__ == "__main__":
    unittest.main(verbosity=1)
