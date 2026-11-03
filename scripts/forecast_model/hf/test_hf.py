#!/usr/bin/env python3
"""Tests of the Hugging Face publishing helpers: the guard that keeps fuel-trained weights, data series and credentials off the Hub, the stripping of the fuel entries
from the gate files, and the card tables built from the checked-in gate files. Hermetic: no network, no Spark, no LightGBM.

    python3 scripts/forecast_model/hf/test_hf.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import card_tables as CT  # noqa: E402
import export_eu as EE    # noqa: E402
import stage as S         # noqa: E402

EU = os.path.join(HERE, "..", "eu")
GB = os.path.join(HERE, "..", "gb")


def write(root, rel, text="x"):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)


def rd(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def good_eu_stage(root):
    write(root, "weights/config.json", json.dumps({"model": "eu-ens-v2-nofuel", "lgb_features": ["lag7", "wind"], "ridge_features": ["trend", "wind_x_h3"]}))
    write(root, "weights/lgb_base.txt", "tree")
    write(root, "code/fuel_features.py", "# feature definitions of the production variant: code only")
    write(root, "README.md", "# card")


class Guard(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        good_eu_stage(self.d)

    def tearDown(self):
        shutil.rmtree(self.d)

    def test_a_clean_fuel_free_stage_passes_and_fuel_features_code_is_allowed(self):
        files = S.guard(self.d, "eu")
        self.assertIn(os.path.join("code", "fuel_features.py"), files)

    def test_fuel_trained_weights_and_fuel_data_are_refused(self):
        for rel in ("held-fuel/config.json", "weights/lgb_fuel.txt", "weights/ridge_fuel.npz", "fuel_daily.csv", "weights/lgb_fuel_q10.txt", "x/held/y.txt"):
            write(self.d, rel)
            with self.assertRaises(SystemExit, msg=rel):
                S.guard(self.d, "eu")
            os.remove(os.path.join(self.d, rel))
            S.guard(self.d, "eu")

    def test_pickles_tables_and_credentials_are_refused(self):
        for rel, text in (("weights/m.pkl", "x"), ("data/price.parquet", "x"), ("p.csv", "a,b"), ("code/a.py", "url = 'https://x?securityToken=ABCDEFGH12345678'"),
                          ("code/b.py", "HF_TOKEN=hf_abcdefghijklmnopqrstuvwxyz0123"), ("code/c.py", "ENTSOE_TOKEN=abcdef123456")):
            write(self.d, rel, text)
            with self.assertRaises(SystemExit, msg=rel):
                S.guard(self.d, "eu")
            os.remove(os.path.join(self.d, rel))

    def test_a_config_that_declares_a_fuel_model_or_fuel_features_is_refused(self):
        write(self.d, "weights/config.json", json.dumps({"model": "eu-ens-v2-nofuel", "fuel": True, "lgb_features": [], "ridge_features": []}))
        with self.assertRaises(SystemExit):
            S.guard(self.d, "eu")
        write(self.d, "weights/config.json", json.dumps({"model": "eu-ens-v2", "lgb_features": [], "ridge_features": []}))
        with self.assertRaises(SystemExit):
            S.guard(self.d, "eu")
        write(self.d, "weights/config.json", json.dumps({"model": "eu-ens-v2-nofuel", "lgb_features": ["gas", "wind"], "ridge_features": []}))
        with self.assertRaises(SystemExit):
            S.guard(self.d, "eu")
        write(self.d, "weights/config.json", json.dumps({"model": "eu-ens-v2-nofuel", "lgb_features": [], "ridge_features": ["gap_night", "ccgt_mc"]}))
        with self.assertRaises(SystemExit):
            S.guard(self.d, "eu")

    def test_the_two_repos_are_the_ones_the_docs_name(self):
        self.assertEqual(S.REPOS, {"eu": "Elpriser/eu-price-forecast", "gb": "Elpriser/gb-price-estimate"})


class Export(unittest.TestCase):
    def test_strip_gate_removes_every_fuel_entry_from_the_three_files(self):
        d = tempfile.mkdtemp()
        try:
            g, a, c = EE.strip_gate(EU, d)
            for z, v in g["zones"].items():
                self.assertEqual(set(v), {"recipe", "nofuel"}, z)
            for z, v in a["zones"].items():
                self.assertEqual(set(v), {"recipe", "showEur", "nofuel"}, z)
            self.assertNotIn("ens", a["recipes"])
            self.assertEqual(c["quantile"], {})
            self.assertTrue(c["residual"])
            text = "".join(rd(os.path.join(d, f)) for f in os.listdir(d))
            self.assertNotIn('"fuel"', text)
        finally:
            shutil.rmtree(d)


class Cards(unittest.TestCase):
    def test_the_eu_zone_table_has_a_row_per_zone_and_no_placeholder(self):
        d = tempfile.mkdtemp()
        try:
            EE.strip_gate(EU, d)
            t = CT.eu_zone_table(d)
            self.assertEqual(len(t.strip().split("\n")), 2 + 25)
            self.assertIn("| IT-N | ridge + LightGBM | D+2..D+4 |", t)
            self.assertIn("| EE | LightGBM |", t)
        finally:
            shutil.rmtree(d)

    def test_the_gb_tables_follow_the_checked_in_gate(self):
        d = tempfile.mkdtemp()
        try:
            for f in ("gb_gate.json", "hour23_gate.json"):
                shutil.copy(os.path.join(GB, f), d)
            rest, days = CT.gb_tables(d)
            self.assertEqual(len(rest.split("\n")), 2 + 8)
            self.assertEqual(len(days.split("\n")), 2 + 7)
            h = CT.hour23_table(d)
            self.assertIn("| PT | persist |", h)
            self.assertIn("| IE | med28 |", h)
        finally:
            shutil.rmtree(d)

    def test_the_cards_have_their_placeholders_and_the_honest_headline_numbers_exist_in_the_gate(self):
        eu = rd(os.path.join(HERE, "eu", "MODEL_CARD.md"))
        gb = rd(os.path.join(HERE, "gb", "MODEL_CARD.md"))
        self.assertIn("ZONE_TABLE", eu)
        for ph in ("GB_REST_TABLE", "GB_DAYS_TABLE", "HOUR23_TABLE"):
            self.assertIn(ph, gb)
        for card in (eu, gb):
            self.assertIn("Dansk resume", card)
            self.assertIn("English summary", card)
            self.assertIn("DATA_LICENCES.md", card)
        # the EU card says the model is NOT the production model and names what is missing
        self.assertIn("not exactly the production model", eu)
        self.assertIn("withheld", eu)
        self.assertNotRegex(eu + gb, r"commercial and non-commercial use")


if __name__ == "__main__":
    unittest.main(verbosity=1)
