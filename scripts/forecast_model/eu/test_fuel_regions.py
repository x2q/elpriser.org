#!/usr/bin/env python3
"""Unit tests for the fuel inputs and the per-region candidate models (no network, no Spark, no LightGBM):

  * the three fuel parsers against saved fixtures (MIBGAS and EEX are verbatim excerpts of the real files; the AGSI+ one is the
    documented shape with made-up numbers, because the live endpoint needs a key we do not hold)
  * the leakage rule of the fuel features: a value after the cut-off day can never reach a feature
  * the candidate models' arithmetic, their clocks (zone offsets), the reference-zone spread, the scoring and the publish rule

    python3 scripts/forecast_model/eu/test_fuel_regions.py
"""
import io
import os
import sys
import unittest
import warnings
from zoneinfo import ZoneInfo
from datetime import datetime

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import family_models as FM       # noqa: E402
import fetch_fuel as FF          # noqa: E402
import fuel_features as FUEL     # noqa: E402
import metrics as M              # noqa: E402
import region_all as RA          # noqa: E402
import region_models as RM       # noqa: E402
import region_scores as RS       # noqa: E402
from zones import ZONES          # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def read_text(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def read_bytes(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


class TestFuelParsers(unittest.TestCase):
    def test_mibgas_keeps_only_the_pvb_day_and_month_ahead_on_the_trading_day(self):
        g = FF.parse_mibgas(read_bytes("mibgas_sample.csv").decode("utf-8"))
        self.assertEqual(list(g.columns), ["gas_da", "gas_m1"])
        self.assertEqual(g.loc["2026-10-30", "gas_da"], 103.49)          # trading day 30/10, delivery 31/10
        self.assertEqual(g.loc["2026-10-30", "gas_m1"], 103.06)
        self.assertEqual(g.loc["2026-11-02", "gas_da"], 93.79)
        self.assertTrue(np.isnan(g.loc["2026-10-31", "gas_m1"]))          # no month-ahead trade at the weekend
        self.assertEqual(g.index.is_unique, True)
        # the quarter / year products (GQES, GYES) are not in the frame
        self.assertNotIn(75.51, g.to_numpy().ravel().tolist())

    def test_mibgas_accepts_the_decimal_comma_of_the_web_export(self):
        txt = 'Trading day;Product;Place of delivery;Area;First Day Delivery;Last Day Delivery;"MIBGAS Daily Price [EUR/MWh]";\n' \
              '02/11/2026;GDAES_D+1;PVB;ES;03/11/2026;03/11/2026;93,79;\n'
        self.assertEqual(FF.parse_mibgas(txt).loc["2026-11-02", "gas_da"], 93.79)

    def test_mibgas_rejects_other_files(self):
        with self.assertRaises(ValueError):
            FF.parse_mibgas("<html>blocked</html>")

    def test_eex_auctions_by_date_status_and_banner(self):
        s = FF.parse_eex_auctions(read_bytes("eex_eua_sample.xlsx"))
        self.assertEqual(s.name, "eua")
        self.assertAlmostEqual(s.loc["2026-10-30"], 89.55)
        self.assertAlmostEqual(s.loc["2026-11-02"], 89.43)
        self.assertTrue(s.index.is_monotonic_increasing and s.index.is_unique)
        self.assertNotIn(pd.Timestamp("2026-10-31"), s.index)            # no auction on a Saturday: stays a gap

    def test_eex_two_auctions_on_one_day_are_volume_weighted_and_failed_ones_ignored(self):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append([None, "x"])
        ws.append([None, "Date", "Time", "Auction Name", "Contract", "Status", "Auction Price €/tCO2", "Minimum Bid", "Maximum Bid",
                   "Mean", "Median", "Auction Volume tCO2"])
        d = datetime(2026, 5, 4)
        ws.append([None, d, None, "a", "T3PA", "successful", 80.0, 0, 0, 0, 0, 1000])
        ws.append([None, d, None, "b", "T3PA", "successful", 90.0, 0, 0, 0, 0, 3000])
        ws.append([None, datetime(2026, 5, 5), None, "c", "T3PA", "cancelled", 70.0, 0, 0, 0, 0, 1000])
        buf = io.BytesIO()
        wb.save(buf)
        s = FF.parse_eex_auctions(buf.getvalue())
        self.assertAlmostEqual(s.loc["2026-05-04"], 87.5)               # (80*1000 + 90*3000) / 4000
        self.assertNotIn(pd.Timestamp("2026-05-05"), s.index)

    def test_agsi_fixture_shape(self):
        import json
        s = FF.parse_agsi(json.loads(read_bytes("agsi_sample.json")))
        self.assertEqual(s.name, "full")
        self.assertAlmostEqual(s.loc["2026-11-01"], 91.45)
        self.assertTrue(np.isnan(s.loc["2026-10-30"]))                   # '-' in the feed is a missing value, not a zero

    def test_agsi_is_skipped_without_a_key(self):
        self.assertIsNone(FF.fetch_agsi("2026-01-01", None))
        self.assertIsNone(FF.fetch_agsi("2026-01-01", ""))

    def test_combine_keeps_each_sources_own_days(self):
        gas = FF.parse_mibgas(read_bytes("mibgas_sample.csv").decode("utf-8"))
        eua = FF.parse_eex_auctions(read_bytes("eex_eua_sample.xlsx"))
        c = FF.combine(gas, eua)
        self.assertEqual(list(c.columns), ["gas_da", "gas_m1", "eua"])
        self.assertTrue(np.isnan(c.loc["2026-10-31", "eua"]))            # nothing invented for the weekend
        self.assertEqual(c.loc["2026-10-30", "eua"], eua.loc["2026-10-30"])


def toy_fuel():
    idx = pd.date_range("2026-01-01", periods=120, freq="D")
    f = pd.DataFrame({"gas_da": np.linspace(30, 90, 120), "gas_m1": np.linspace(31, 91, 120),
                      "eua": np.linspace(70, 85, 120)}, index=idx)
    f.loc[f.index.dayofweek >= 5, "eua"] = np.nan                         # weekends: no auction
    f.index.name = "date"
    return f


class TestFuelFeatures(unittest.TestCase):
    def test_value_is_that_of_the_day_before_issue(self):
        table = FUEL.daily_table(toy_fuel())
        target = pd.Timestamp("2026-04-10")
        for h in (2, 5, 7):
            row = FUEL.for_rows(table, [target], h).iloc[0]
            f = target - pd.Timedelta(days=h + 1)
            self.assertAlmostEqual(row["gas"], table.loc[f, "gas"])
            self.assertAlmostEqual(row["gas_d7"], table.loc[f, "gas"] - table.loc[f - pd.Timedelta(days=7), "gas"])

    def test_nothing_after_the_cutoff_day_reaches_a_feature(self):
        fuel = toy_fuel()
        target, h = pd.Timestamp("2026-04-10"), 3
        cutoff = target - pd.Timedelta(days=h + 1)
        a = FUEL.for_rows(FUEL.daily_table(fuel), [target], h).iloc[0]
        poisoned = fuel.copy()
        poisoned.loc[poisoned.index > cutoff, ["gas_da", "gas_m1", "eua"]] = 1e6
        b = FUEL.for_rows(FUEL.daily_table(poisoned), [target], h).iloc[0]
        pd.testing.assert_series_equal(a, b)

    def test_weekend_eua_carries_the_last_auction_and_age_counts_days_since_a_gas_print(self):
        fuel = toy_fuel()
        t = FUEL.daily_table(fuel)
        sat = pd.Timestamp("2026-02-07")                                  # a Saturday
        self.assertEqual(t.loc[sat, "eua"], fuel.loc[sat - pd.Timedelta(days=1), "eua"])
        stale = fuel.copy()
        stale.loc[stale.index >= "2026-03-01", "gas_da"] = np.nan         # the gas feed stopped on 28 Feb
        stale = stale.iloc[:100]
        row = FUEL.for_rows(FUEL.daily_table(stale), [pd.Timestamp("2026-04-05")], 2).iloc[0]
        self.assertGreater(row["fuel_age"], 30)                            # the staleness is visible to the model
        self.assertAlmostEqual(row["gas"], fuel.loc["2026-02-28", "gas_da"])

    def test_ccgt_marginal_cost(self):
        t = FUEL.daily_table(toy_fuel())
        d = pd.Timestamp("2026-03-10")
        g, e = toy_fuel().loc[d, ["gas_da", "eua"]]
        self.assertAlmostEqual(t.loc[d, "ccgt_mc"], g / 0.55 + 0.202 / 0.55 * (e if not np.isnan(e) else t.loc[d, "eua"]))

    def test_storage_columns_only_when_the_cache_has_them(self):
        fuel = toy_fuel()
        self.assertNotIn("full", FUEL.daily_table(fuel).columns)
        fuel["full"] = np.linspace(40, 90, len(fuel))
        t = FUEL.daily_table(fuel)
        self.assertIn("full_d28", t.columns)

    def test_add_to_frame_uses_each_rows_own_horizon(self):
        table = FUEL.daily_table(toy_fuel())
        df = pd.DataFrame({"date": pd.to_datetime(["2026-04-10"] * 2), "h": [2, 6]})
        out = FUEL.add_to_frame(df, table)
        self.assertAlmostEqual(out.loc[0, "gas"], table.loc[pd.Timestamp("2026-04-07"), "gas"])
        self.assertAlmostEqual(out.loc[1, "gas"], table.loc[pd.Timestamp("2026-04-03"), "gas"])


def synthetic_rows(n_days=60, zones=("aa", "bb"), seed=3):
    """Rows (zone, t, date, h=2) on a hourly clock with the columns the candidates read; y = shape + level + noise."""
    rng = np.random.default_rng(seed)
    rows = []
    for z_i, z in enumerate(zones):
        for d in pd.date_range("2026-01-01", periods=n_days, freq="D"):
            lvl = 50 + 10 * z_i + 0.3 * (d - pd.Timestamp("2026-01-01")).days
            for hr in range(24):
                shp = 15 * np.sin((hr - 6) / 24 * 2 * np.pi)
                rows.append({"zone": z, "t": d + pd.Timedelta(hours=hr), "date": d, "h": 2, "hour": hr, "weekday": d.weekday(),
                             "y": lvl + shp + rng.normal(0, 1), "seasonal4w": 50 + 10 * z_i + shp, "level_7d": lvl - 2.0,
                             "level_30d": lvl - 8.0, "last_day_mean": lvl - 0.3, "lag_last": lvl - 0.3 + shp, "lag7": lvl - 2 + shp,
                             "ewm5": lvl - 1.0, "ewm7": lvl - 1.5, "is_weekend": int(d.weekday() >= 5), "is_holiday": 0,
                             "xmas_week": 0, "wind": rng.uniform(0, 20), "rad": max(0.0, 400 * np.sin((hr - 6) / 12 * np.pi)),
                             "temp": 5.0, "reg_wind": 8.0, "ccgt_mc": 100.0, "ccgt_mc_d7": 0.0, "ccgt_mc_d28": 0.0, "eua_d28": 0.0,
                             "gas_m1_spread": 0.0})
    return pd.DataFrame(rows)


class TestCandidates(unittest.TestCase):
    def test_level_shape_matches_the_metrics_module(self):
        df = synthetic_rows()
        df["zone"] = pd.Categorical(df["zone"])
        ours = RM.level_shape(df)
        theirs = M.level_shape(df)
        np.testing.assert_allclose(ours.to_numpy(), theirs.to_numpy())

    def test_shape_has_zero_daily_mean(self):
        df = synthetic_rows()
        m = RM.shape(df).groupby([df["zone"], df["date"]]).mean()
        np.testing.assert_allclose(m.to_numpy(), 0.0, atol=1e-9)

    def test_ewm_level_ends_at_the_last_known_day_and_weights_recent_days(self):
        p = pd.Series(np.r_[np.full(24 * 20, 40.0), np.full(24 * 10, 100.0)],
                      index=pd.date_range("2026-01-01", periods=24 * 30, freq="h"))
        t = RM.day_tables({"z": p})["z"]
        last = pd.Timestamp("2026-01-30")
        # ten days at 100 after twenty at 40: half-life 5 puts 75 % of the weight on the last ten days -> far above the plain 30-day mean
        self.assertGreater(t.loc[last, "ewm5"], 85)
        self.assertLess(t.loc[last, "ewm7"], t.loc[last, "ewm5"])         # a longer half-life lags more
        self.assertAlmostEqual(t.loc[last, "level_7d"], 100.0)
        df = pd.DataFrame({"zone": ["z"], "date": [pd.Timestamp("2026-01-30")], "h": [4]})
        out = RM.attach_last_known(df, {"z": t}, ["ewm5"])
        self.assertAlmostEqual(out.loc[0, "ewm5"], t.loc[pd.Timestamp("2026-01-27"), "ewm5"])   # last known day = date - (h - 1)

    def test_ridge_beats_its_base_when_a_fuel_signal_exists_and_is_neutral_without(self):
        df = synthetic_rows(n_days=120, zones=("aa",))
        df["b_lvlshape"] = RM.level_shape(df)
        # the true price follows the fuel gap: y = base + 0.5 * (mc - level), but only the fuel variant can see it
        df["ccgt_mc"] = 80.0 + 30.0 * np.sin(np.arange(len(df)) / 24 / 17)
        df["y"] = df["b_lvlshape"] + 0.5 * (df["ccgt_mc"] - df["level_7d"]) + np.random.default_rng(1).normal(0, 0.5, len(df))
        train, test = df[df["date"] < "2026-03-15"], df[df["date"] >= "2026-03-15"]
        with_fuel = RM.ridge_residual(train, test, True)
        no_fuel = RM.ridge_residual(train, test, False)
        base_err = (test["b_lvlshape"] - test["y"]).abs().mean()
        self.assertLess((with_fuel - test["y"]).abs().mean(), 0.3 * base_err)
        self.assertGreater((no_fuel - test["y"]).abs().mean(), 0.7 * base_err)       # without the fuel columns there is no skill to find
        self.assertEqual(int(with_fuel.isna().sum()), 0)

    def test_ridge_returns_nan_instead_of_guessing_when_the_features_are_missing(self):
        df = synthetic_rows(n_days=80, zones=("aa",))
        df["b_lvlshape"] = RM.level_shape(df)
        train, test = df[df["date"] < "2026-02-20"], df[df["date"] >= "2026-02-20"].copy()
        test.loc[test.index[:5], "wind"] = np.nan
        out = RM.ridge_residual(train, test, False)
        self.assertEqual(int(out.isna().sum()), 5)

    def test_daily_linear_learns_the_fuel_gap(self):
        df = synthetic_rows(n_days=150, zones=("aa",))
        df["ccgt_mc"] = 70.0 + 40.0 * np.sin(np.arange(len(df)) / 24 / 13)
        df["level_30d"] = df["level_7d"]
        g = df.groupby("date")["ewm7"].transform("first")
        df["y"] = df["y"] + 0.6 * (df["ccgt_mc"] - g)
        days = RM.daily_frame(df)
        tr, te = days[days["date"] < "2026-04-10"], days[days["date"] >= "2026-04-10"]
        pred = RM.daily_linear(tr, te)
        err = (pred - te["dm"]).abs().mean()
        naive = (te["ewm7"] - te["dm"]).abs().mean()
        self.assertLess(err, 0.4 * naive)

    def test_zone_offsets_match_the_real_clocks(self):
        winter = datetime(2026, 1, 15, 12)
        for z, (_, tz, _) in ZONES.items():
            off = ZoneInfo(tz).utcoffset(winter).total_seconds() / 3600
            self.assertEqual(RM.STD_OFFSET[z], off, z)
        self.assertEqual({z for z in RM.ZONE_GROUP}, {z for z in ZONES} | {"no1", "no2", "no3", "no4", "no5", "se1", "se2", "se3", "se4", "fi", "dk1", "dk2", "nl"})

    def test_groups_partition_the_39_zones(self):
        seen = [z for zs in RM.GROUPS.values() for z in zs]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(len(seen), 39)

    def test_spread_uses_only_lags_of_a_week_or_more_and_the_last_known_days(self):
        idx = pd.date_range("2026-01-01", periods=24 * 40, freq="h")
        rng = np.random.default_rng(0)
        ref = pd.Series(60 + rng.normal(0, 5, len(idx)), index=idx)
        zone = ref + 10.0
        sp = RM.spread_series(zone, ref, 0)
        rows = pd.DataFrame({"zone": "z", "t": [pd.Timestamp("2026-02-05 10:00")], "date": [pd.Timestamp("2026-02-05")], "h": [2]})
        f = RM.spread_features(rows, sp)
        self.assertAlmostEqual(f.loc[0, "sp_wdh"], 10.0)
        self.assertAlmostEqual(f.loc[0, "sp_lvl"], 10.0)
        # poison every spread value newer than the last known day (T - 1 for h = 2) and the last six days of lags: unchanged
        bad = sp.copy()
        bad[bad.index >= "2026-01-30"] = 999.0                          # 6 days before the target and everything after
        g = RM.spread_features(rows, bad)
        self.assertAlmostEqual(g.loc[0, "sp_wdh"], 10.0)                 # lags are 7, 14, 21, 28 days: all before 30 Jan
        self.assertNotAlmostEqual(g.loc[0, "sp_lvl"], 10.0)              # the level spread DOES read the last 7 known days

    def test_spread_clock_offset(self):
        # a EET zone (+1 vs CET): its 13:00 is the reference's 12:00
        idx = pd.date_range("2026-01-01", periods=48, freq="h")
        ref = pd.Series(np.arange(48, dtype=float), index=idx)
        zone = pd.Series(np.arange(48, dtype=float) + 100.0, index=idx)
        sp = RM.spread_series(zone, ref, 1)
        t = pd.Timestamp("2026-01-01 13:00")
        self.assertEqual(sp.loc[t], 113.0 - 12.0)

    def test_reference_candidates_algebra(self):
        rows = pd.DataFrame({"zone": ["z"] * 4, "date": [pd.Timestamp("2026-02-01")] * 4, "h": [2] * 4}, index=[0, 1, 2, 3])
        sp = pd.DataFrame({"sp_wdh": [1.0, 3.0, 5.0, 7.0], "sp_lvl": [10.0] * 4}, index=rows.index)
        ref = pd.Series([50.0, 60.0, 70.0, 80.0], index=rows.index)
        c = RM.reference_candidates(rows, ref, sp)
        np.testing.assert_allclose(c["e1"], [51, 63, 75, 87])
        np.testing.assert_allclose(c["e3"], [60, 70, 80, 90])
        np.testing.assert_allclose(c["e2"], [50 + 10 + (1 - 4), 60 + 10 + (3 - 4), 70 + 10 + 1, 80 + 10 + 3])


def toy_predictions():
    """Two zones in one group, two horizons: candidate `good` is 20 % better than the baseline on the whole period, `lucky` only in the
    select period and worse on the hold-out."""
    rng = np.random.default_rng(5)
    rows = []
    for z in ("pt", "es"):
        for h in (2, 3):
            for d in pd.date_range("2025-04-01", "2026-10-31", freq="D"):
                hold = d >= pd.Timestamp("2026-07-01")
                y = 50 + 20 * np.sin(np.arange(24) / 24 * 2 * np.pi) + rng.normal(0, 3, 24)
                base_err = rng.normal(0, 10, 24)
                for hr in range(24):
                    rows.append({"zone": z, "t": d + pd.Timedelta(hours=hr), "date": d, "h": h, "hour": hr, "y": y[hr],
                                 "b_lvlshape": y[hr] + base_err[hr],
                                 "b_lag7": y[hr] + base_err[hr] * 1.2, "b_seasonal": y[hr] + base_err[hr] * 1.1,
                                 "b_persist": y[hr] + base_err[hr] * 1.3,
                                 "good": y[hr] + base_err[hr] * 0.8,
                                 "lucky": y[hr] + base_err[hr] * (0.5 if not hold else 1.5)})
    return pd.DataFrame(rows)


class TestScoring(unittest.TestCase):
    def test_mae_bias_and_regret_by_hand(self):
        y = np.r_[np.arange(24, dtype=float)]
        d = pd.DataFrame({"zone": "z", "h": 2, "t": pd.date_range("2026-05-01", periods=24, freq="h"), "date": pd.Timestamp("2026-05-01"),
                          "y": y, "good": y + 2.0, "rev": y[::-1].copy()})
        r = RS.score_zone_h(d, ["good", "rev"], "full")
        by = {x["col"]: x for x in r}
        self.assertAlmostEqual(by["good"]["mae"], 2.0)
        self.assertAlmostEqual(by["good"]["bias"], 2.0)
        self.assertAlmostEqual(by["good"]["regret"], 0.0)              # same ordering: perfect timing
        self.assertAlmostEqual(by["rev"]["regret"], np.mean([21, 22, 23]) - np.mean([0, 1, 2]))

    def test_all_columns_of_a_zone_are_scored_on_the_same_rows(self):
        d = toy_predictions()
        d.loc[d.index[:100], "good"] = np.nan
        sc = RS.score(d, ["b_lvlshape", "good", "b_lag7", "b_seasonal", "b_persist"])
        n = sc[(sc.zone == "pt") & (sc.h == 2) & (sc.period == "full")]["n_hours"].unique()
        self.assertEqual(len(n), 1)

    def test_winner_is_chosen_on_select_and_published_only_if_it_also_holds_out(self):
        d = toy_predictions()
        sc = RS.score(d, ["b_lvlshape", "good", "lucky", "b_lag7", "b_seasonal", "b_persist"])
        # put both zones in a real group for the selection
        old = dict(RM.GROUPS)
        RM.GROUPS.clear()
        RM.GROUPS.update({"iberia": ["es", "pt"]})
        old_zg = dict(RM.ZONE_GROUP)
        RM.ZONE_GROUP.clear()
        RM.ZONE_GROUP.update({"es": "iberia", "pt": "iberia"})
        try:
            win = RS.pick_winners(sc)
            self.assertEqual(win[("iberia", 2)], "lucky")                 # best on SELECT ...
            wt = RS.winners_table(sc)
            row = wt[(wt.zone == "es") & (wt.h == 2)].iloc[0]
            self.assertEqual(row["model"], "lucky")
            self.assertGreater(row["gain_lvl_select"], 0.3)
            self.assertLess(row["gain_lvl_hold"], 0.0)                    # ... but worse than the baseline on the hold-out
            self.assertFalse(row["publish"])                              # so it is not published
        finally:
            RM.GROUPS.clear()
            RM.GROUPS.update(old)
            RM.ZONE_GROUP.clear()
            RM.ZONE_GROUP.update(old_zg)

    def test_a_steady_gain_of_at_least_five_percent_is_published(self):
        d = toy_predictions().drop(columns=["lucky"])
        sc = RS.score(d, ["b_lvlshape", "good", "b_lag7", "b_seasonal", "b_persist"])
        old, old_zg = dict(RM.GROUPS), dict(RM.ZONE_GROUP)
        RM.GROUPS.clear()
        RM.GROUPS.update({"iberia": ["es", "pt"]})
        RM.ZONE_GROUP.clear()
        RM.ZONE_GROUP.update({"es": "iberia", "pt": "iberia"})
        try:
            wt = RS.winners_table(sc)
            self.assertTrue(wt["publish"].all())
            self.assertTrue((wt["model"] == "good").all())
            self.assertTrue((wt["gain_lvl_full"] > 0.15).all())
        finally:
            RM.GROUPS.clear()
            RM.GROUPS.update(old)
            RM.ZONE_GROUP.clear()
            RM.ZONE_GROUP.update(old_zg)

    def test_candidate_columns_exclude_the_naive_baselines_and_the_ablation(self):
        cols = RS.candidate_columns(pd.DataFrame(columns=["zone", "t", "y", "b_lvlshape", "lgb_gasonly", "lgb_fuel", "a_ewm7", "hour"]))
        self.assertEqual(sorted(cols), ["a_ewm7", "lgb_fuel"])


class TestFamilies(unittest.TestCase):
    def test_ridge_fit_matches_sklearn(self):
        from sklearn.linear_model import Ridge
        rng = np.random.default_rng(2)
        X = rng.normal(size=(400, 6)) * [1, 5, 0.1, 2, 1, 3]
        y = X @ [1, 0.2, 3, -1, 0, 0.5] + rng.normal(0, 1, 400) + 7
        w = np.ones(400)
        model = FM.ridge_fit(X, y, w, alpha_rel=0.01)
        mu, sd = X.mean(0), X.std(0)
        ref = Ridge(alpha=0.01 * 400).fit((X - mu) / sd, y)
        np.testing.assert_allclose(FM.linear_predict(model, X), ref.predict((X - mu) / sd), rtol=1e-6)

    def test_recency_weights_halve_every_half_life(self):
        d = np.array(["2026-01-01", "2026-01-31", "2026-03-02"], dtype="datetime64[D]")
        w = FM.recency_weights(d, np.datetime64("2026-03-02"), 30)
        np.testing.assert_allclose(w, [0.25, 0.5, 1.0], atol=0.02)
        np.testing.assert_allclose(FM.recency_weights(d, np.datetime64("2026-03-02"), None), 1.0)

    def _lear_inputs(self, days=260, h=3):
        rng = np.random.default_rng(4)
        dates = np.repeat(np.arange(np.datetime64("2026-01-01"), np.datetime64("2026-01-01") + days), 24)
        X = rng.normal(size=(len(dates), 4))
        y_res = X @ [2.0, -1.0, 0.0, 0.5] + rng.normal(0, 0.3, len(dates))
        base = np.full(len(dates), 50.0)
        return X, y_res, base, dates, h

    def test_lear_learns_and_never_trains_on_targets_newer_than_issue(self):
        X, y_res, base, dates, h = self._lear_inputs()
        refits = np.arange(np.datetime64("2026-08-01"), np.datetime64("2026-09-12"), np.timedelta64(7, "D"))
        kw = dict(h=h, refit_days=refits, window=120, halflife=None, kind="ridge", test_from=np.datetime64("2026-08-01"),
                  test_to=np.datetime64("2026-09-12"), step=7)
        a = FM.lear_block(X, y_res, base, dates, **kw)
        sel = np.isfinite(a)
        self.assertGreater(sel.sum(), 24 * 30)
        self.assertLess(np.abs(a[sel] - (base + y_res)[sel]).mean(), 0.6)           # it found the signal
        # poison every target newer than (first refit - h): predictions of the FIRST block must not move
        first_block = (dates >= np.datetime64("2026-08-01")) & (dates < np.datetime64("2026-08-08"))
        y2 = y_res.copy()
        y2[dates > np.datetime64("2026-08-01") - np.timedelta64(h, "D")] = 1e4
        b = FM.lear_block(X, y2, base, dates, **kw)
        np.testing.assert_allclose(a[first_block], b[first_block])

    def test_lear_leaves_nan_where_a_feature_is_missing(self):
        X, y_res, base, dates, h = self._lear_inputs()
        X[-5, 1] = np.nan
        refits = np.array([np.datetime64("2026-09-05")])
        out = FM.lear_block(X, y_res, base, dates, h, refits, 120, None, "ridge", np.datetime64("2026-09-05"), np.datetime64("2026-09-12"), 7)
        self.assertTrue(np.isfinite(out).sum() > 0)
        self.assertTrue(np.isnan(out[-5]) or dates[-5] >= np.datetime64("2026-09-12"))

    def test_lasso_zeroes_an_irrelevant_feature(self):
        X, y_res, base, dates, h = self._lear_inputs()
        mu, sd, beta, b0 = FM.lasso_fit(X[:3000], y_res[:3000], np.ones(3000), alpha=0.3)
        self.assertAlmostEqual(beta[2], 0.0, places=6)
        self.assertGreater(abs(beta[0]), 1.0)

    def test_kalman_is_causal_skips_gaps_and_tracks_a_level_shift(self):
        rng = np.random.default_rng(1)
        y = np.r_[np.full(60, 50.0), np.full(60, 120.0)] + rng.normal(0, 3, 120)
        y[30] = np.nan
        mu, beta = FM.kalman_filter(y, 0.5, 0.0)
        self.assertFalse(np.isnan(mu[30]))
        self.assertAlmostEqual(mu[59], 50.0, delta=4)
        self.assertAlmostEqual(mu[119], 120.0, delta=5)
        y2 = y.copy()
        y2[80:] += 1000.0                                              # the future changes ...
        mu2, _ = FM.kalman_filter(y2, 0.5, 0.0)
        np.testing.assert_allclose(mu[:80], mu2[:80])                  # ... the past state does not

    def test_kalman_param_choice_prefers_a_smoother_level_for_noisier_series(self):
        rng = np.random.default_rng(3)
        noisy = 60 + rng.normal(0, 15, 500)
        walk = 60 + np.cumsum(rng.normal(0, 4, 500)) + rng.normal(0, 1, 500)
        ql_noisy, _ = FM.fit_kalman_params(noisy, 500)
        ql_walk, _ = FM.fit_kalman_params(walk, 500)
        self.assertLess(ql_noisy, ql_walk)

    def test_error_correction_learns_to_follow_the_fuel_gap(self):
        rng = np.random.default_rng(6)
        gap = rng.normal(0, 20, 300)
        df = pd.DataFrame({"gap": gap, "mc_d7": rng.normal(0, 5, 300)})
        df["miss"] = 0.4 * gap + rng.normal(0, 1, 300)
        c = FM.error_correction(df.iloc[:200], df.iloc[200:])
        self.assertLess(np.abs(c - df["miss"].iloc[200:]).mean(), 2.0)
        self.assertTrue((FM.error_correction(df.iloc[:10], df.iloc[200:]) == 0).all())    # too little evidence: no correction

    def test_interval_score_and_coverage(self):
        y = np.array([5.0, 12.0, -3.0])
        lo, hi = np.array([0.0, 0.0, 0.0]), np.array([10.0, 10.0, 10.0])
        np.testing.assert_allclose(FM.interval_score(y, lo, hi, 0.2), [10, 10 + 10 * 2, 10 + 10 * 3])
        self.assertAlmostEqual(FM.coverage(y, lo, hi), 1 / 3)

    def test_rolling_band_uses_only_residuals_settled_before_the_block(self):
        days = pd.date_range("2026-01-01", periods=400, freq="D")
        f = pd.DataFrame({"zone": "z", "h": 2, "date": days})
        rng = np.random.default_rng(8)
        f["p"] = 50.0
        f["y"] = 50.0 + rng.normal(0, 5, len(f))
        lo, hi = FM.rolling_residual_band(f, "p", window_days=100, settle_days=8, block_days=30)
        first = lo.first_valid_index()
        start = f.loc[first, "date"]
        poisoned = f.copy()
        poisoned.loc[poisoned["date"] >= start - pd.Timedelta(days=8), "y"] += 500.0   # everything newer than the settled history
        lo2, hi2 = FM.rolling_residual_band(poisoned, "p", window_days=100, settle_days=8, block_days=30)
        blk = (f["date"] >= start) & (f["date"] < start + pd.Timedelta(days=30))
        np.testing.assert_allclose(lo[blk], lo2[blk])
        np.testing.assert_allclose(hi[blk], hi2[blk])
        self.assertTrue((lo[blk] < 50).all() and (hi[blk] > 50).all())

    def test_ensembles_average_the_components_chosen_on_the_select_period(self):
        d = toy_predictions().rename(columns={"good": "b_ridge_gas", "lucky": "lgb_fuel"})
        sc = RS.score(d, ["b_lvlshape", "b_ridge_gas", "lgb_fuel", "b_lag7", "b_seasonal", "b_persist"])
        old, old_zg = dict(RM.GROUPS), dict(RM.ZONE_GROUP)
        RM.GROUPS.clear()
        RM.GROUPS.update({"iberia": ["es", "pt"]})
        RM.ZONE_GROUP.clear()
        RM.ZONE_GROUP.update({"es": "iberia", "pt": "iberia"})
        try:
            out, chosen = RA.add_ensembles(d, sc)
        finally:
            RM.GROUPS.clear()
            RM.GROUPS.update(old)
            RM.ZONE_GROUP.clear()
            RM.ZONE_GROUP.update(old_zg)
        self.assertEqual(chosen[("iberia", 2)]["linear"], "b_ridge_gas")
        self.assertEqual(chosen[("iberia", 2)]["tree"], "lgb_fuel")
        m = out["h"] == 2
        np.testing.assert_allclose(out.loc[m, "ens_lt"], (out.loc[m, "b_ridge_gas"] + out.loc[m, "lgb_fuel"]) / 2)
        np.testing.assert_allclose(out.loc[m, "ens_lb"], (out.loc[m, "b_lvlshape"] + out.loc[m, chosen[("iberia", 2)]["best"]]) / 2)


class TestHygiene(unittest.TestCase):
    def test_no_secret_is_printed_or_embedded(self):
        for name in ("fetch_fuel.py", "fuel_features.py", "region_backtest.py"):
            src = read_text(name)
            self.assertNotRegex(src, r"(?i)print\([^)]*(key|token)", name)
        src = read_text("fetch_fuel.py")
        self.assertIn('os.environ.get("GIE_API_KEY")', src)


if __name__ == "__main__":
    warnings.simplefilter("ignore", FutureWarning)
    unittest.main(verbosity=1)
