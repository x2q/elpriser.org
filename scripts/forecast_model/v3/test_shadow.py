"""Unit tests for the shadow correction (pure logic only; no network).

  python3 -m unittest scripts/forecast_model/v3/test_shadow.py
"""
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shadow as S


def day(d, kind, base, hours=24, band=None):
    prices = []
    for h in range(hours):
        p = {"hour": h, "spot_dkk_mwh": base + h}
        if band:
            p["spot_min_dkk_mwh"], p["spot_max_dkk_mwh"] = base + h - band, base + h + band
        prices.append(p)
    return {"date": d.isoformat(), "type": kind, "prices": prices}


def run(issued, bias=-100.0, true=1000.0, horizons=range(2, 10), band=None):
    """A run issued on `issued`: two settled days, then forecasts that are `bias` off the truth."""
    days = [day(issued, "actual", true), day(issued + timedelta(days=1), "actual", true)]
    for h in horizons:
        days.append(day(issued + timedelta(days=h), "forecast", true + bias, band=band))
    return {"generated": issued.isoformat(), "model": "v3", "days": days}


D0 = date(2026, 10, 1)


class Corrections(unittest.TestCase):
    def runs(self, n=16, **kw):
        return [run(D0 + timedelta(days=i), **kw) for i in range(n)]

    def test_constant_bias_is_recovered_per_horizon(self):
        runs = self.runs()
        issued = D0 + timedelta(days=15)
        c = S.corrections(runs, issued)
        for h in S.HORIZONS:
            self.assertEqual(c[h]["n"] > 0, True)
            self.assertAlmostEqual(c[h]["c"], 100.0, places=6)   # actual - forecast

    def test_shift_is_lambda_times_c_and_only_inside_horizons(self):
        runs = self.runs(band=50)
        issued = D0 + timedelta(days=15)
        base = runs[-1]
        out = S.apply_shadow(base, S.corrections(runs, issued))
        by_h = {(S._d(d["date"]) - issued).days: d for d in out["days"] if d["type"] == "forecast"}
        orig = {(S._d(d["date"]) - issued).days: d for d in base["days"] if d["type"] == "forecast"}
        for h in range(2, 8):
            self.assertAlmostEqual(by_h[h]["prices"][3]["spot_dkk_mwh"], orig[h]["prices"][3]["spot_dkk_mwh"] + 50.0)
            # the band moves with the median, so its width is unchanged
            p, q = by_h[h]["prices"][3], orig[h]["prices"][3]
            self.assertAlmostEqual(p["spot_max_dkk_mwh"] - p["spot_min_dkk_mwh"], q["spot_max_dkk_mwh"] - q["spot_min_dkk_mwh"])
        for h in (8, 9):
            self.assertEqual(by_h[h]["prices"], orig[h]["prices"])
        self.assertEqual(out["model"], "v3-shadow")
        self.assertEqual(out["shadow"]["base"], "v3")

    def test_settled_days_and_the_input_are_never_modified(self):
        runs = self.runs()
        base = runs[-1]
        before = repr(base)
        out = S.apply_shadow(base, S.corrections(runs, D0 + timedelta(days=15)))
        self.assertEqual(repr(base), before)
        for a, b in zip(out["days"], base["days"]):
            if b["type"] == "actual":
                self.assertEqual(a, b)

    def test_too_little_history_means_no_correction(self):
        runs = self.runs(n=5)                       # D+2 errors exist for at most 2 target days
        issued = D0 + timedelta(days=4)
        c = S.corrections(runs, issued)
        self.assertTrue(all(v["c"] == 0.0 for v in c.values()))
        out = S.apply_shadow(runs[-1], c)
        self.assertEqual([d["prices"] for d in out["days"]], [d["prices"] for d in runs[-1]["days"]])

    def test_no_look_ahead(self):
        """Runs issued on/after the shadow day must not count. (The window already excludes their
        targets, since h >= 2 puts them past D-1; the explicit guard in corrections() is defence in depth.)"""
        runs = self.runs()
        issued = D0 + timedelta(days=10)
        poisoned = [dict(r) for r in runs]
        for r in poisoned:
            if S._d(r["generated"]) >= issued:
                r["days"] = [dict(d, prices=[dict(p, spot_dkk_mwh=p["spot_dkk_mwh"] + 9999) for p in d["prices"]])
                             if d["type"] == "forecast" else d for d in r["days"]]
        self.assertEqual(S.corrections(runs, issued), S.corrections(poisoned, issued))

    def test_window_only_counts_the_last_days(self):
        runs = self.runs(n=40)
        issued = D0 + timedelta(days=39)
        # old runs were wildly off; they are outside the window and must not leak in
        for r in runs[:15]:
            for d in r["days"]:
                if d["type"] == "forecast":
                    for p in d["prices"]:
                        p["spot_dkk_mwh"] -= 5000
        c = S.corrections(runs, issued)
        for h in S.HORIZONS:
            self.assertAlmostEqual(c[h]["c"], 100.0, places=6)

    def test_incomplete_settled_days_are_skipped(self):
        runs = [run(D0 + timedelta(days=i)) for i in range(16)]
        for r in runs:                               # every settled day has only 10 hours
            for d in r["days"]:
                if d["type"] == "actual":
                    d["prices"] = d["prices"][:10]
        c = S.corrections(runs, D0 + timedelta(days=15))
        self.assertTrue(all(v["n"] == 0 and v["c"] == 0.0 for v in c.values()))

    def test_dst_day_with_23_hours_counts(self):
        runs = [run(D0 + timedelta(days=i)) for i in range(16)]
        for r in runs:
            for d in r["days"]:
                if d["type"] == "actual":
                    d["prices"] = [p for p in d["prices"] if p["hour"] != 2]
        c = S.corrections(runs, D0 + timedelta(days=15))
        self.assertGreater(c[2]["n"], 0)

    def test_corrections_follow_a_changing_bias(self):
        runs = [run(D0 + timedelta(days=i), bias=-300.0 if i < 8 else -50.0) for i in range(24)]
        early = S.corrections(runs, D0 + timedelta(days=9))[2]["c"]
        late = S.corrections(runs, D0 + timedelta(days=23))[2]["c"]
        self.assertGreater(early, late)

    def test_negative_prices_are_shifted_not_clamped(self):
        runs = self.runs(true=-20.0, bias=-50.0)
        out = S.apply_shadow(runs[-1], S.corrections(runs, D0 + timedelta(days=15)))
        f = next(d for d in out["days"] if d["type"] == "forecast")
        self.assertLess(f["prices"][0]["spot_dkk_mwh"], 0)


if __name__ == "__main__":
    unittest.main()
