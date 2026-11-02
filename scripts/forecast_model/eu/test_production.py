#!/usr/bin/env python3
"""Unit tests for the PRODUCTION recipe of the EU forecast (no network, no LightGBM, no Spark): the fuel failure policy, the 365-day ridge and its
leakage rule, the ensemble per zone, the publish gate and the accuracy block, the band offsets, and the checked-in gate / accuracy files.

    python3 scripts/forecast_model/eu/test_production.py
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_gate as BG          # noqa: E402
import calibrate_bands as CB     # noqa: E402
import features as F             # noqa: E402
import forecast as FC            # noqa: E402
import fuel_features as FUEL     # noqa: E402
import fuel_live as FL           # noqa: E402
import gate as G                 # noqa: E402
import monitor as MON            # noqa: E402
import recipe as RC              # noqa: E402
from zones import ZONES          # noqa: E402


def fuel_frame(last_gas, last_eua, n=120, gas=95.0, eua=80.0):
    """A cache frame (date, gas_da, gas_m1, eua) ending on the given dates."""
    end = max(pd.Timestamp(last_gas), pd.Timestamp(last_eua))
    idx = pd.date_range(end - pd.Timedelta(days=n), end, freq="D")
    df = pd.DataFrame({"gas_da": gas + np.sin(np.arange(len(idx)) / 5), "gas_m1": gas + 1.0, "eua": eua + np.cos(np.arange(len(idx)) / 7)}, index=idx)
    df.index.name = "date"
    df.loc[df.index > pd.Timestamp(last_gas), ["gas_da", "gas_m1"]] = np.nan
    df.loc[df.index > pd.Timestamp(last_eua), "eua"] = np.nan
    return df


class FuelPolicy(unittest.TestCase):
    today = date(2026, 11, 2)

    def test_fresh_cache_is_usable(self):
        ok, st = FL.assess(fuel_frame("2026-11-02", "2026-10-30"), self.today)
        self.assertTrue(ok, st)
        self.assertEqual((st["gas_age"], st["eua_age"]), (0, 3))           # a weekend's gap in the carbon auctions is normal
        self.assertIsNone(st["reason"])

    def test_gas_up_to_three_days_old_is_used_older_is_not(self):
        self.assertTrue(FL.assess(fuel_frame("2026-10-30", "2026-10-30"), self.today)[0])        # 3 days
        ok, st = FL.assess(fuel_frame("2026-10-29", "2026-10-30"), self.today)                    # 4 days
        self.assertFalse(ok)
        self.assertIn("gas print is 4 days old", st["reason"])

    def test_carbon_is_allowed_a_weekend_and_a_holiday(self):
        self.assertTrue(FL.assess(fuel_frame("2026-11-02", "2026-10-28"), self.today)[0])        # 5 days
        ok, st = FL.assess(fuel_frame("2026-11-02", "2026-10-26"), self.today)                    # 7 days
        self.assertFalse(ok)
        self.assertIn("EUA", st["reason"])

    def test_missing_columns_and_absurd_values_switch_the_fuel_off(self):
        self.assertFalse(FL.assess(None, self.today)[0])
        self.assertFalse(FL.assess(fuel_frame("2026-11-02", "2026-11-02")[["gas_da", "gas_m1"]], self.today)[0])
        self.assertFalse(FL.assess(fuel_frame("2026-11-02", "2026-11-02", gas=9000.0), self.today)[0])
        self.assertFalse(FL.assess(fuel_frame("2026-11-02", "2026-11-02", eua=-5.0), self.today)[0])

    def test_a_failing_refresh_falls_back_to_the_cache_and_never_raises(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "fuel_daily.csv")
            fuel_frame("2026-11-01", "2026-10-30").to_csv(path)

            def boom(*a, **k):
                raise RuntimeError("network down")
            logs = []
            table, st = FL.load(path, self.today, updater=boom, log=logs.append)
            self.assertIsNotNone(table, st)                                 # a 1-day-old cache is good enough
            self.assertTrue(any("refresh failed" in m for m in logs))
            self.assertIn("gas", table.columns)
            fuel_frame("2026-10-20", "2026-10-20").to_csv(path)             # a dead feed: the cache is 13 days old
            table, st = FL.load(path, self.today, updater=boom, log=logs.append)
            self.assertIsNone(table)
            self.assertIn("days old", st["reason"])

    def test_no_cache_at_all_is_fuel_off_not_an_error(self):
        with tempfile.TemporaryDirectory() as td:
            table, st = FL.load(os.path.join(td, "none.csv"), self.today, refresh=False, log=lambda m: None)
        self.assertIsNone(table)
        self.assertEqual(st["reason"], "no fuel cache")

    def test_the_updater_result_is_used_when_it_works(self):
        fresh = fuel_frame("2026-11-02", "2026-11-02")
        table, st = FL.load("/nonexistent/fuel.csv", self.today, updater=lambda p, s: fresh, log=lambda m: None)
        self.assertIsNotNone(table)
        self.assertEqual(st["gas_date"], "2026-11-02")


# ------------------------------------------------------------------ the ridge and the ensemble on synthetic rows
def history(zone_names=("de", "ee"), days=130, seed=2):
    """Training-style rows (zone, h = 2..7, target hours) built with features.make_features from synthetic prices + weather + fuel, plus the
    prices dict. y is the actual price, as in dataset.build."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-01-01", periods=24 * days, freq="h")
    prices, wx = {}, {}
    for i, z in enumerate(zone_names):
        lvl = 60 + 20 * i + 15 * np.sin(np.arange(len(idx)) / 24 / 9)
        wind = rng.uniform(0, 12, len(idx))
        prices[z] = pd.Series(lvl + 25 * np.sin((idx.hour - 6) / 24 * 2 * np.pi) - 1.2 * wind + np.where(idx.weekday >= 5, -12, 0) + rng.normal(0, 3, len(idx)), index=idx)
        wx[z] = pd.DataFrame({"wind": wind, "rad": rng.uniform(0, 400, len(idx)), "temp": rng.uniform(-3, 15, len(idx)), "precip": rng.uniform(0, 1, len(idx))}, index=idx)
    reg = pd.DataFrame({"reg_wind": 5.0, "reg_rad": 100.0, "reg_temp": 5.0}, index=idx)
    dtab, eu = F.day_table(prices)
    fidx = pd.date_range("2025-12-01", periods=days + 40, freq="D")
    fuel = pd.DataFrame({"gas_da": 90 + 6 * np.sin(np.arange(len(fidx)) / 15), "gas_m1": 91.0, "eua": 80 + np.cos(np.arange(len(fidx)) / 20)}, index=fidx)
    fuel.index.name = "date"
    table = FUEL.daily_table(fuel)
    parts = []
    for z in zone_names:
        for h in range(2, 8):
            t = idx[(idx >= idx[0] + pd.Timedelta(days=45)) & (idx < idx[-1] - pd.Timedelta(days=1))]
            X = F.make_features(z, t, h, prices[z], wx[z], reg, dtab[z], eu)
            X["t"] = t
            X["date"] = t.normalize()
            X["y"] = prices[z].reindex(t).to_numpy()
            parts.append(X)
    df = pd.concat(parts, ignore_index=True)
    df["zone"] = df["zone"].astype(str)
    return df, prices, table


class LinearModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df, cls.prices, cls.table = history()
        cls.df = RC.add_fuel_columns(cls.df, cls.table)
        cls.aug = RC.augment(cls.df, cls.prices)

    def live_like(self, zone, h, target):
        """The rows of one (zone, h, target day) taken from the augmented frame, as the live job would build them."""
        a = self.aug
        return a[(a["zone"] == zone) & (a["h"] == h) & (a["date"] == pd.Timestamp(target))].copy()

    def test_the_design_without_fuel_has_fewer_columns(self):
        with_f, without = RC.lear_design(self.aug.head(500), True), RC.lear_design(self.aug.head(500), False)
        self.assertGreater(with_f.shape[1], without.shape[1])
        self.assertTrue(set(without.columns) <= set(with_f.columns))
        self.assertTrue(set(RC.EXTRA_LAGS) <= set(without.columns))
        self.assertFalse(any(c.startswith(("gap_", "mc_d7_", "mc_d28_")) or c in ("eua_d28", "gas_m1_spread") for c in without.columns))

    def test_baseline_is_level_plus_shape(self):
        r = self.live_like("de", 3, "2026-04-02")
        self.assertEqual(len(r), 24)
        self.assertAlmostEqual((r["b_lvlshape"] - r["level_7d"]).mean(), 0.0, places=6)         # shape only: zero daily mean
        np.testing.assert_allclose((r["b_lvlshape"] - r["level_7d"]).to_numpy(), (r["seasonal4w"] - r["seasonal4w"].mean()).to_numpy(), atol=1e-6)

    def test_it_learns_and_beats_the_baseline_on_the_synthetic_wind_effect(self):
        errs_ridge, errs_base = [], []
        for target in pd.date_range("2026-04-10", "2026-04-17"):
            r = self.live_like("de", 3, target)
            p = RC.lear_predict(self.aug, r, True, window=60)
            self.assertTrue(p.notna().all())
            errs_ridge.append(np.abs(p - r["y"]).mean())
            errs_base.append(np.abs(r["b_lvlshape"] - r["y"]).mean())
        self.assertLess(np.mean(errs_ridge), np.mean(errs_base) * 0.9)

    def test_nothing_after_the_last_known_day_enters_the_fit(self):
        """Corrupt every label of a target day after T - h (the newest settled target when T is forecast) and the prediction of T is unchanged."""
        target, h = pd.Timestamp("2026-04-12"), 4
        r = self.live_like("de", h, target)
        base = RC.lear_predict(self.aug, r, True, window=60)
        bad = self.aug.copy()
        late = (bad["zone"] == "de") & (bad["h"] == h) & (bad["date"] > target - pd.Timedelta(days=h))
        bad.loc[late, "y"] += 500.0
        pd.testing.assert_series_equal(base, RC.lear_predict(bad, r, True, window=60))
        early = (bad["zone"] == "de") & (bad["h"] == h) & (bad["date"] <= target - pd.Timedelta(days=h)) & (bad["date"] > target - pd.Timedelta(days=h + 20))
        bad2 = self.aug.copy()
        bad2.loc[early, "y"] += 80.0
        self.assertGreater((RC.lear_predict(bad2, r, True, window=60) - base).abs().max(), 0.1, "labels INSIDE the window must matter")

    def test_the_window_is_a_year_of_targets_not_more(self):
        target, h = pd.Timestamp("2026-04-12"), 2
        r = self.live_like("de", h, target)
        base = RC.lear_predict(self.aug, r, False, window=30)
        old = self.aug.copy()
        old.loc[(old["zone"] == "de") & (old["h"] == h) & (old["date"] <= target - pd.Timedelta(days=h + 30)), "y"] += 300.0
        pd.testing.assert_series_equal(base, RC.lear_predict(old, r, False, window=30))

    def test_too_little_history_gives_nan_never_a_guess(self):
        r = self.live_like("de", 2, "2026-02-20")                                # only ~6 days of targets precede it
        self.assertTrue(RC.lear_predict(self.aug, r, True, window=60).isna().all())
        self.assertTrue(RC.lear_predict(self.aug, self.aug.iloc[0:0], True).empty)

    def test_a_missing_feature_makes_that_row_nan_only(self):
        r = self.live_like("de", 3, "2026-04-12")
        r.iloc[5, r.columns.get_loc("wind")] = np.nan
        p = RC.lear_predict(self.aug, r, True, window=60)
        self.assertTrue(np.isnan(p.iloc[5]) and p.drop(p.index[5]).notna().all())

    def test_a_missing_hourly_lag_is_replaced_by_the_training_mean_but_nothing_else_is(self):
        """Portugal and Ireland have no hour 23 on the last known day (it belongs to the unpublished market day), a price feed has a hole now and
        then: the ridge must still give a number for the hour, near the one it gives with the lag at its mean; weather, level and fuel gaps stay NaN."""
        r = self.live_like("de", 3, "2026-04-12")
        base = RC.lear_predict(self.aug, r, True, window=60)
        gap = r.copy()
        for c in ("lag_last", "d_lag_last"):
            gap.iloc[23, gap.columns.get_loc(c)] = np.nan                     # what the last known day's missing hour 23 does to hour 23
        p = RC.lear_predict(self.aug, gap, True, window=60)
        self.assertTrue(p.notna().all(), "the hour is still forecast")
        self.assertEqual(p.attrs["imputed"], 2)                               # d_lag_last and shape_persist (= lag_last - last_day_mean)
        self.assertLess(abs(p.iloc[23] - base.iloc[23]), 15.0)
        pd.testing.assert_series_equal(p.iloc[:23], base.iloc[:23])           # the other hours are untouched
        # more than MAX_IMPUTED gaps in one row is not repaired
        many = r.copy()
        for c in ("lag_last", "d_lag_last", "lag7", "d_lag7", "d_prev", "d_lag14"):             # six imputable design columns
            many.iloc[3, many.columns.get_loc(c)] = np.nan
        self.assertTrue(np.isnan(RC.lear_predict(self.aug, many, True, window=60).iloc[3]))
        # a missing level, weather or fuel feature is a real problem: NaN
        for c in ("level_7d", "wind", "ccgt_mc"):
            bad = r.copy()
            bad.iloc[7, bad.columns.get_loc(c)] = np.nan
            self.assertTrue(np.isnan(RC.lear_predict(self.aug, bad, True, window=60).iloc[7]), c)
        self.assertEqual(RC.lear_predict(self.aug, gap, True, window=60, impute=False).isna().sum(), 1)

    def test_live_rows_equal_training_rows_for_every_added_column(self):
        """A row built the live way (prices cut at the last known day) augments to the same numbers as the training row built from the full history."""
        zone, h, target = "de", 4, pd.Timestamp("2026-04-12")
        train_row = self.live_like(zone, h, target)
        cut = target - pd.Timedelta(days=h - 2)
        live_prices = {z: p[p.index < cut] for z, p in self.prices.items()}
        days, eu = F.day_table(live_prices)
        idx = pd.date_range(target, periods=24, freq="h")
        rng = np.random.default_rng(2)
        # the weather of the training frame, so the weather columns are equal too
        wxl = train_row.set_index("t")[["wind", "rad", "temp", "precip"]]
        regl = train_row.set_index("t")[["reg_wind", "reg_rad", "reg_temp"]]
        wx_full = wxl.reindex(pd.date_range(idx[0] - pd.Timedelta(days=2), idx[-1], freq="h"))
        live = F.make_features(zone, idx, h, live_prices[zone], wx_full, regl.reindex(wx_full.index), days[zone], eu)
        live["t"], live["date"] = idx, target
        live = RC.add_fuel_columns(live, self.table)
        live = RC.augment(live, live_prices)
        for c in ["ewm5", "shape_s", "b_lvlshape", "p_prev", "d_lag_last", "d_prev", "d_lag7", "d_lag14", "level_7d", "ccgt_mc", "gas", "mc_gap", "lag_last"]:
            np.testing.assert_allclose(live[c].to_numpy(dtype=float), train_row[c].to_numpy(dtype=float), rtol=1e-9, atol=1e-9, err_msg=c)


class Ensemble(unittest.TestCase):
    parts = {"lear_fuel": [10.0, 20.0], "lgb_fuel": [30.0, 40.0], "lear_nofuel": [0.0, 2.0], "lgb_base": [6.0, 8.0]}

    def test_the_recipe_per_zone_and_fuel_state(self):
        self.assertEqual(RC.recipe_for("de", True), "ens")
        self.assertEqual(RC.recipe_for("de", False), "ens-nofuel")
        for z in ("ee", "lv", "lt"):
            self.assertEqual(RC.recipe_for(z, True), "lgb")
            self.assertEqual(RC.recipe_for(z, False), "lgb")
        self.assertEqual(RC.BALTICS, ("ee", "lv", "lt"))

    def test_the_point_forecast(self):
        np.testing.assert_allclose(RC.point_forecast("de", self.parts, True), [20.0, 30.0])        # mean(ridge+fuel, LightGBM+fuel)
        np.testing.assert_allclose(RC.point_forecast("de", self.parts, False), [3.0, 5.0])         # mean(ridge, LightGBM) without fuel
        np.testing.assert_allclose(RC.point_forecast("lv", self.parts, True), [6.0, 8.0])          # the Baltics: the plain LightGBM
        np.testing.assert_allclose(RC.point_forecast("lv", self.parts, False), [6.0, 8.0])

    def test_a_ridge_gap_of_a_few_hours_is_bridged_by_the_lightgbm_alone_but_a_missing_ridge_is_not(self):
        days = np.array(["a"] * 24 + ["b"] * 24)
        lin = np.full(48, 10.0)
        tree = np.full(48, 30.0)
        lin[[3, 5]] = np.nan                                         # two hours of day a: the ridge had a gap
        lin[24:34] = np.nan                                          # ten hours of day b (more than a quarter): not bridged
        out = RC.point_forecast("ie", {"lear_fuel": lin, "lgb_fuel": tree}, True, day_ids=days)
        self.assertEqual((out[3], out[5], out[0]), (30.0, 30.0, 20.0))
        self.assertTrue(np.isnan(out[24:34]).all(), "ten missing hours: the day is left to be dropped")
        self.assertEqual(out[40], 20.0)
        # without day ids nothing is bridged (the old behaviour), a missing LightGBM is never bridged by the ridge, the Baltics are untouched
        self.assertTrue(np.isnan(RC.point_forecast("ie", {"lear_fuel": lin, "lgb_fuel": tree}, True)[3]))
        t2 = tree.copy()
        t2[0] = np.nan
        self.assertTrue(np.isnan(RC.point_forecast("ie", {"lear_fuel": np.full(48, 10.0), "lgb_fuel": t2}, True, day_ids=days)[0]))
        self.assertTrue(np.allclose(RC.point_forecast("lv", {"lgb_base": tree}, True, day_ids=days), 30.0))

    def test_a_missing_component_is_a_missing_forecast(self):
        p = {**self.parts, "lear_fuel": [np.nan, 20.0]}
        out = RC.point_forecast("de", p, True)
        self.assertTrue(np.isnan(out[0]) and out[1] == 30.0)


# ------------------------------------------------------------------ gate, accuracy block, band offsets
class GateFiles(unittest.TestCase):
    def write(self, td, name, obj):
        path = os.path.join(td, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f)
        return path

    def test_missing_unreadable_or_old_format_is_absent(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertIsNone(G.load_gate(os.path.join(td, "nope.json")))
            bad = os.path.join(td, "bad.json")
            with open(bad, "w", encoding="utf-8") as f:
                f.write("{not json")
            self.assertIsNone(G.load_gate(bad))
            self.assertIsNone(G.load_gate(self.write(td, "old.json", {"de": {"2": {"lo": -1, "hi": 1}}})))          # the first build's calibration format
            self.assertIsNone(G.load_gate(self.write(td, "v1.json", {"version": 1, "zones": {"de": {}}})))
            self.assertIsNone(G.load_calibration(self.write(td, "c.json", {"de": {"2": {"lo": -1, "hi": 1}}})))
            self.assertIsNone(G.load_accuracy(self.write(td, "a.json", {"de": {"backtest": {}}})))

    def test_the_review_friendly_json_is_the_same_data(self):
        obj = {"version": 2, "zones": {"de": {"recipe": "ens", "fuel": [2, 3], "nofuel": []}, "ee": {"recipe": "lgb", "fuel": {"2": {"mae": 1.5, "low": False}}}},
               "empty": {}, "list": [{"a": 1}, {"b": [1, 2]}], "s": "x"}
        self.assertEqual(json.loads(G.dumps_compact(obj)), obj)
        with open(os.path.join(HERE, "accuracy_eu.json"), encoding="utf-8") as f:
            text = f.read()
        self.assertLess(text.count("\n"), 700, "the accuracy file is one line per cell, not one per number")

    def gate(self):
        return {"de": {"recipe": "ens", "fuel": [2, 3, 4], "nofuel": [2]}, "lv": {"recipe": "lgb", "fuel": [2, 3], "nofuel": [2, 3]}}

    def acc(self):
        cell = lambda h: {"mae": 20.0 + h, "low": False}
        return {"version": 2, "period": "2025-04-01..2026-11-02", "baseline": "level+shape", "recent": "2026-09-01",
                "zones": {"de": {"recipe": "ens", "showEur": False, "fuel": {str(h): cell(h) for h in (2, 3)}, "nofuel": {"2": cell(2)}},
                          "lv": {"recipe": "lgb", "showEur": True, "fuel": {"2": cell(2), "3": cell(3)}, "nofuel": {"2": cell(2), "3": cell(3)}}}}

    def test_horizons_depend_on_the_fuel_mode_and_unknown_zones_publish_nothing(self):
        g = self.gate()
        self.assertEqual(G.horizons(g, "de", True), {2, 3, 4})
        self.assertEqual(G.horizons(g, "de", False), {2})
        self.assertEqual(G.horizons(g, "fr", True), set())
        self.assertEqual(G.horizons(None, "de", True), set())

    def test_a_horizon_without_accuracy_numbers_is_not_published(self):
        self.assertEqual(G.published_horizons(self.gate(), self.acc(), "de", True), {2, 3})        # the gate allows 4, the accuracy file has no cell
        self.assertEqual(G.published_horizons(self.gate(), None, "de", True), set())

    def test_the_accuracy_block_covers_exactly_the_published_horizons(self):
        b = G.accuracy_block(self.acc(), "de", True, {2, 3})
        self.assertEqual(sorted(b["byHorizon"]), ["2", "3"])
        self.assertEqual((b["version"], b["fuel"], b["showEur"], b["recent"]), (2, True, False, "2026-09-01"))
        self.assertEqual(G.accuracy_block(self.acc(), "de", False, {2})["fuel"], False)
        lv = G.accuracy_block(self.acc(), "lv", True, {2})
        self.assertTrue(lv["showEur"])
        self.assertFalse(lv["fuel"], "the Baltics never use fuel")
        self.assertIsNone(G.accuracy_block(self.acc(), "fr", True, {2}))
        self.assertIsNone(G.accuracy_block(self.acc(), "de", True, {7}))

    def test_offsets_borrow_the_nearest_horizon_and_return_none_for_an_unknown_zone(self):
        cal = {"quantile": {"de": {"2": {"lo": -1, "hi": 2}, "6": {"lo": -5, "hi": 9}}}}
        self.assertEqual(G.offsets(cal, "quantile", "de", 2), {"lo": -1, "hi": 2})
        self.assertEqual(G.offsets(cal, "quantile", "de", 5), {"lo": -5, "hi": 9})
        self.assertIsNone(G.offsets(cal, "quantile", "fr", 2))
        self.assertIsNone(G.offsets(cal, "residual", "de", 2))


class BandOffsets(unittest.TestCase):
    def frame(self, n=300, seed=4):
        rng = np.random.default_rng(seed)
        rows = []
        for day in pd.date_range("2026-01-01", periods=n):
            for hr in range(24):
                mid = 60 + 10 * np.sin(hr / 24 * 6.28)
                rows.append({"zone": "de", "h": 2, "date": day, "y": mid + rng.normal(0, 8), "q10": mid - 5.0, "q90": mid + 5.0})
        return pd.DataFrame(rows)

    def test_offsets_are_the_scaled_quantiles_of_each_edges_own_miss(self):
        o = CB.quantile_offsets(self.frame())["de"]["2"]
        # y ~ N(mid, 8): y - q10 ~ N(5, 8) -> P10 = 5 - 1.2816 * 8 = -5.25 (x 1.2); y - q90 ~ N(-5, 8) -> P90 = -5 + 10.25 = 5.25 (x 1.2)
        self.assertAlmostEqual(o["lo"], -5.25 * 1.2, delta=0.8)
        self.assertAlmostEqual(o["hi"], 5.25 * 1.2, delta=0.8)

    def test_only_the_last_180_days_count(self):
        f = self.frame(n=300)
        f.loc[f["date"] < pd.Timestamp("2026-04-01"), "y"] += 200.0                  # an old shock, outside the window
        o = CB.quantile_offsets(f)["de"]["2"]
        self.assertAlmostEqual(o["lo"], -5.25 * 1.2, delta=1.0)

    def test_thin_cells_get_no_offset(self):
        self.assertEqual(CB.quantile_offsets(self.frame(n=5)), {})

    def test_widened_edges_cover_about_80_percent_when_errors_are_stationary(self):
        f = self.frame(n=300)
        o = CB.quantile_offsets(f)["de"]["2"]
        lo, hi = f["q10"] + o["lo"], f["q90"] + o["hi"]
        cov = float(((f["y"] >= lo) & (f["y"] <= hi)).mean())
        self.assertAlmostEqual(cov, 0.8, delta=0.07)


class BuildGate(unittest.TestCase):
    def research(self, seed=7):
        """A research-style frame for four zones over the evaluation period: 'de' (recipe clearly better than level+shape), 'ee' (Baltic, plain
        LightGBM), 'fr' (recipe worse than the baseline on the hold-out) and 'al' (good - but its D+7 is switched off by the owner)."""
        rng = np.random.default_rng(seed)
        rows = []
        for day in pd.date_range("2026-05-01", "2026-11-02"):
            for h in range(2, 8):
                for z in ("de", "ee", "fr", "al", "it-n"):
                    for hr in range(24):
                        y = 80 + 25 * np.sin(hr / 24 * 6.28) + rng.normal(0, 4)
                        noisy = lambda s: y + rng.normal(0, s)
                        base = noisy(14)
                        good = noisy(5)
                        if z == "fr" and day >= pd.Timestamp("2026-07-01"):
                            good = noisy(16)
                        rows.append({"zone": z, "t": day + pd.Timedelta(hours=hr), "date": day, "h": h, "hour": hr, "y": y, "level_7d": 80.0,
                                     "b_lag7": noisy(20), "b_seasonal": noisy(18), "b_persist": noisy(22), "b_lvlshape": base,
                                     "lear_r365_g": good, "lear_r365": good + 1, "lgb_fuel": good, "lgb_base": good + 2})
        return pd.DataFrame(rows)

    def test_the_gate_and_the_accuracy_block(self):
        gate, acc, notes = BG.build(self.research())
        z = gate["zones"]
        self.assertEqual(z["de"]["fuel"], [2, 3, 4, 5, 6, 7])
        self.assertEqual(z["de"]["recipe"], "ens")
        self.assertEqual(z["ee"]["recipe"], "lgb")
        self.assertEqual(z["fr"]["fuel"], [], "worse than level+shape on the hold-out: nothing published, however good the early months were")
        self.assertEqual(z["al"]["fuel"], [2, 3, 4, 5, 6], "the owner's list switches AL D+7 off")
        self.assertEqual(z["ee"]["fuel"], z["ee"]["nofuel"], "the Baltics have one recipe")
        self.assertTrue(any("al D+7" in n and "forced off" in n for n in notes))
        c = acc["zones"]["de"]["fuel"]["3"]
        self.assertGreater(c["gain"], 0.4)
        self.assertGreater(c["baseMae"], c["mae"])
        self.assertIn("coverage", c)
        self.assertTrue(set(c) >= {"mae", "baseMae", "gain", "gainHold", "gainRecent", "bias", "baseBias", "regret", "baseRegret", "rankGain", "rankOk", "low", "days"})
        self.assertTrue(acc["zones"]["ee"]["showEur"] and not acc["zones"]["de"]["showEur"])
        self.assertEqual(acc["recent"], "2026-09-01")
        self.assertEqual(gate["version"], 2)
        # the gate's horizons and the accuracy cells are the same set
        for zone, e in gate["zones"].items():
            for mode in ("fuel", "nofuel"):
                self.assertEqual([str(h) for h in e[mode]], list(acc["zones"][zone][mode]), (zone, mode))

    def test_low_confidence_flags(self):
        gate, acc, _ = BG.build(self.research())
        self.assertFalse(acc["zones"]["de"]["fuel"]["2"]["low"])
        for h, c in acc["zones"]["it-n"]["fuel"].items():
            self.assertTrue(c["low"], f"it-n D+{h}: the owner lists it as weak")

    def test_rank_ok_needs_five_percent_in_the_whole_backtest_and_the_hold_out(self):
        _, acc, _ = BG.build(self.research())
        self.assertTrue(acc["zones"]["de"]["fuel"]["2"]["rankOk"])


class Artifacts(unittest.TestCase):
    """The checked-in publish_gate.json and accuracy_eu.json: what the lead reviews, kept consistent with the code."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "publish_gate.json"), encoding="utf-8") as f:
            cls.gate = json.load(f)
        with open(os.path.join(HERE, "accuracy_eu.json"), encoding="utf-8") as f:
            cls.acc = json.load(f)

    def test_zones_and_versions(self):
        self.assertEqual((self.gate["version"], self.acc["version"]), (2, 2))
        self.assertEqual(list(self.gate["zones"]), list(ZONES))
        self.assertEqual(list(self.acc["zones"]), list(ZONES))
        self.assertEqual(self.gate["model"], FC.MODEL_NAME)

    def test_the_owner_list_is_respected(self):
        for z, hs in {"al": [7]}.items():
            for h in hs:
                self.assertNotIn(h, self.gate["zones"][z]["fuel"])
                self.assertNotIn(h, self.gate["zones"][z]["nofuel"])
        for z in ("no1", "no4", "no5", "fi"):
            self.assertNotIn(z, self.gate["zones"], "the Nordic zones have their own forecast")

    def test_the_baltics_run_the_plain_lightgbm_and_quote_euro(self):
        for z in RC.BALTICS:
            self.assertEqual(self.gate["zones"][z]["recipe"], "lgb")
            self.assertTrue(self.acc["zones"][z]["showEur"])
            self.assertEqual(self.gate["zones"][z]["fuel"], self.gate["zones"][z]["nofuel"])
        for z in set(ZONES) - set(RC.BALTICS):
            self.assertEqual(self.gate["zones"][z]["recipe"], "ens")
            self.assertFalse(self.acc["zones"][z]["showEur"])

    def test_every_published_cell_is_measured_and_at_least_five_percent_better(self):
        for z, e in self.gate["zones"].items():
            for mode in ("fuel", "nofuel"):
                self.assertEqual([str(h) for h in e[mode]], list(self.acc["zones"][z][mode]), (z, mode))
                for h, c in self.acc["zones"][z][mode].items():
                    self.assertGreaterEqual(c["gain"], 0.05, (z, mode, h))
                    self.assertGreaterEqual(c["gainHold"], 0.05, (z, mode, h))
                    self.assertAlmostEqual(c["gain"], 1 - c["mae"] / c["baseMae"], delta=0.01)      # mae is rounded to 0.1 EUR/MWh
                    self.assertIsInstance(c["low"], bool)
                    self.assertIsInstance(c["rankOk"], bool)
                    if c["coverage"] is not None:
                        self.assertTrue(0.5 < c["coverage"] < 0.95, (z, mode, h, c["coverage"]))

    def test_the_gate_publishes_a_horizon_prefix_so_the_forecast_days_join_without_a_hole(self):
        for z, e in self.gate["zones"].items():
            for mode in ("fuel", "nofuel"):
                hs = e[mode]
                self.assertEqual(hs, list(range(2, 2 + len(hs))), f"{z} {mode}: {hs}")

    def test_no_nominal_80_percent_claim_in_the_files(self):
        text = json.dumps(self.acc) + json.dumps(self.gate)
        self.assertNotRegex(text, r"80 ?%")


class TheJob(unittest.TestCase):
    def test_without_the_gate_nothing_is_published_and_the_job_says_why(self):
        import io
        from contextlib import redirect_stdout
        import train_daily as T
        real = T.DIR
        buf = io.StringIO()
        with tempfile.TemporaryDirectory() as td:
            T.DIR = td
            try:
                with redirect_stdout(buf):
                    code = T.main(["--dry-run", "--skip-refresh"])
            finally:
                T.DIR = real
        self.assertEqual(code, 2)
        self.assertIn("nothing is published", buf.getvalue())

    def test_dry_run_needs_no_cloudflare_credentials_and_a_unknown_zone_is_refused(self):
        import io
        from contextlib import redirect_stdout
        import train_daily as T
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(T.main(["--dry-run", "--skip-refresh", "--zones", "xx"]), 2)
        self.assertIn("unknown zone", buf.getvalue())


class MonitorCoverage(unittest.TestCase):
    def test_live_coverage_of_the_published_band(self):
        days = [{"date": "2026-03-02", "type": "forecast", "horizon": 2,
                 "prices": [{"hour": h, "eur_mwh": 50.0 + h, "min_eur_mwh": 45.0 + h, "max_eur_mwh": 55.0 + h} for h in range(24)]}]
        idx = pd.date_range("2026-03-02", periods=24, freq="h")
        actual = pd.Series([50.0 + h + (20 if h < 6 else 0) for h in range(24)], index=idx)       # six hours above the band
        live = MON.evaluate([{"zone": "de", "days": days}], {"de": actual})
        self.assertAlmostEqual(live.iloc[0]["cover"], 18 / 24)
        nob = [{**days[0], "prices": [{"hour": h, "eur_mwh": 50.0 + h} for h in range(24)]}]
        self.assertTrue(np.isnan(MON.evaluate([{"zone": "de", "days": nob}], {"de": actual}).iloc[0]["cover"]))


if __name__ == "__main__":
    unittest.main(verbosity=1)
