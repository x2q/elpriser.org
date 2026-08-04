#!/usr/bin/env python3
"""Quality assurance across all 13 bidding zones.

Checks the data the forecast actually depends on, not just that files exist.
Grouped by what could go wrong, with the most valuable check first.

CROSS-SOURCE is the strongest test available here: DK1 and DK2 prices are
pulled from ENTSO-E for the multi-zone model, but Denmark also has an entirely
independent feed in Energinet's EDS. If the two agree hour by hour after unit
and timezone conversion, then the timezone handling, the hour alignment and
the currency conversion are all validated at once — by a source that shares no
code path with the one under test. Nothing else in this suite proves that much.

Everything else looks for the failure modes that actually bite time series:
gaps, duplicates, DST days, frozen sensors, and impossible values.

Exit code is non-zero if any FAIL-level finding is present, so this can gate a
deploy. WARN-level findings are reported but do not fail.
"""
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

import numpy as np
import pandas as pd

NORDIC = os.path.expanduser("~/nordic")
BACKUP = os.path.expanduser("~/elpriser-data-backup")
ZONES = ["dk1", "dk2", "no1", "no2", "no3", "no4", "no5",
         "se1", "se2", "se3", "se4", "fi", "nl"]
HYDRO = ["no1", "no2", "no3", "no4", "no5", "se1", "se2"]

findings = []


def report(level, area, msg):
    findings.append((level, area, msg))
    icon = {"FAIL": "✗", "WARN": "!", "OK": "✓"}[level]
    print(f"  {icon} [{area}] {msg}")


# ─── 1. Cross-source validation: ENTSO-E vs Energinet for DK ────────────────

def check_cross_source():
    print("\n1. KRYDSVALIDERING — ENTSO-E mod Energinet (uafhængige kilder)")
    prices = pd.read_parquet(f"{NORDIC}/prices_all.parquet")
    prices["t"] = pd.to_datetime(prices["t"])

    for area in ("dk1", "dk2"):
        ours = prices[prices.zone == area].set_index("t").eur_mwh.sort_index()
        eds_path = f"{BACKUP}/eds_dayaheadprices_{area}.parquet"
        if not os.path.exists(eds_path):
            report("WARN", area, "EDS-fil mangler — kan ikke krydsvalidere")
            continue
        eds = pd.read_parquet(eds_path)
        eds["t"] = pd.to_datetime(eds.TimeDK).dt.floor("h")
        # EDS is DKK/MWh; ENTSO-E is EUR/MWh. The DKK is pegged to EUR, so the
        # ratio should be near-constant — its spread is the real test.
        eds_h = eds.groupby("t").DayAheadPriceDKK.mean()
        j = pd.DataFrame({"eur": ours, "dkk": eds_h}).dropna()
        j = j[j.eur.abs() > 5]          # ratios are meaningless near zero
        if len(j) < 500:
            report("WARN", area, f"kun {len(j)} overlappende timer — svag test")
            continue
        ratio = j.dkk / j.eur
        med, spread = ratio.median(), ratio.quantile(.99) - ratio.quantile(.01)
        # Hour alignment: if we were off by an hour the correlation would drop
        corr = j.eur.corr(j.dkk)
        if not (7.30 < med < 7.60):
            report("FAIL", area, f"DKK/EUR-forhold {med:.3f} — forventet ~7.46, "
                                 "tyder på enheds- eller kildefejl")
        elif spread > 0.35:
            report("WARN", area, f"DKK/EUR-forhold varierer {spread:.3f} (median {med:.3f})")
        else:
            report("OK", area, f"DKK/EUR-forhold {med:.3f} ±{spread:.3f} over {len(j):,} timer")
        if corr < 0.999:
            report("FAIL", area, f"korrelation mod EDS kun {corr:.4f} — tidszone-/timeforskydning?")
        else:
            report("OK", area, f"korrelation mod EDS {corr:.5f} — timerne flugter")

        # Explicit shift test: the best alignment must be at lag 0.
        best = max(range(-2, 3), key=lambda k: j.eur.corr(j.dkk.shift(k)))
        if best != 0:
            report("FAIL", area, f"bedste korrelation ved forskydning {best:+d} time — misalignet")
        else:
            report("OK", area, "bedste korrelation ved forskydning 0")


# ─── 2. Price series integrity ──────────────────────────────────────────────

def check_prices():
    print("\n2. PRISDATA — dækning, huller, dubletter, fastfrosne værdier")
    prices = pd.read_parquet(f"{NORDIC}/prices_all.parquet")
    prices["t"] = pd.to_datetime(prices["t"])
    missing_zones = set(ZONES) - set(prices.zone.unique())
    if missing_zones:
        report("FAIL", "alle", f"zoner mangler helt: {sorted(missing_zones)}")

    for z in ZONES:
        s = prices[prices.zone == z].set_index("t").eur_mwh.sort_index()
        if s.empty:
            report("FAIL", z, "ingen prisdata")
            continue

        dupes = s.index.duplicated().sum()
        if dupes:
            report("FAIL", z, f"{dupes} dublerede timestamps")

        # Expected hours must come from the calendar, not from a naive hourly
        # range: 02:00 does not exist on a spring-forward day, so a naive range
        # invents three hours a year and reports them as missing. Any gap that
        # survives this is a real one — it must not be waved away as daylight
        # saving, which is the excuse that hid the A03 block-expansion bug.
        full = expected_local_hours(s.index.min(), s.index.max())
        missing = full.difference(s.index)
        gap_pct = len(missing) / len(full) * 100
        if gap_pct > 0.5:
            report("FAIL", z, f"{len(missing)} manglende timer ({gap_pct:.2f} %)")
        elif len(missing):
            report("WARN", z, f"{len(missing)} manglende timer ({gap_pct:.2f} %): "
                              f"{', '.join(str(x) for x in missing[:3])}")
        else:
            report("OK", z, f"{len(s):,} timer, ingen huller")

        # Frozen feed: a real market almost never repeats the same price for a
        # full day. Long runs mean a stuck source, not a calm market.
        runs = (s != s.shift()).cumsum()
        longest = s.groupby(runs).size().max()
        if longest >= 24:
            report("FAIL", z, f"{longest} identiske timer i træk — fastfrossen kilde?")
        elif longest >= 10:
            report("WARN", z, f"{longest} identiske timer i træk")

        # Plausibility. Negative prices are real and common; absurd ones are not.
        if s.max() > 5000 or s.min() < -1000:
            report("FAIL", z, f"urimelige værdier: {s.min():.0f} til {s.max():.0f} EUR/MWh")
        neg = (s < 0).mean() * 100
        if neg > 15:
            report("WARN", z, f"{neg:.1f} % negative timer — usædvanligt højt")

        # Freshness
        age_h = (pd.Timestamp.now() - s.index.max()).total_seconds() / 3600
        if age_h > 48:
            report("FAIL", z, f"seneste pris er {age_h:.0f} timer gammel")


TZ = "Europe/Copenhagen"


def expected_hours(d):
    """Hours in a calendar day in Europe/Copenhagen: 23 on spring-forward,
    25 on autumn fall-back, 24 otherwise. Derived from the timezone rather
    than hard-coded, so it stays right in future years."""
    lo = pd.Timestamp(d).tz_localize(TZ)
    hi = (pd.Timestamp(d) + pd.Timedelta(days=1)).tz_localize(TZ)
    return int((hi - lo) / pd.Timedelta(hours=1))


def expected_local_hours(lo, hi):
    """The distinct wall-clock hours that really exist between two naive local
    timestamps. Built by walking UTC and converting, so spring-forward's
    missing 02:00 is never expected in the first place."""
    a = pd.Timestamp(lo).tz_localize(TZ, ambiguous=True).tz_convert("UTC")
    b = pd.Timestamp(hi).tz_localize(TZ, ambiguous=False).tz_convert("UTC")
    local = pd.date_range(a, b, freq="h").tz_convert(TZ).tz_localize(None)
    # Fall-back repeats an hour; the schema stores one row per wall-clock hour,
    # so compare on distinct hours and let check_dst() account for the repeat.
    return pd.DatetimeIndex(local).unique()


def check_dst():
    """Each day must hold exactly the hours its timezone says it has. The
    earlier version only asked whether an odd day was 23 or 25 hours, which
    let a 22-hour day pass as 'not a DST problem' and said nothing about the
    24-hour days that should have been 23 or 25."""
    print("\n3. DØGNLÆNGDE — timetal skal matche tidszonen, også ved sommertid")
    prices = pd.read_parquet(f"{NORDIC}/prices_all.parquet")
    prices["t"] = pd.to_datetime(prices["t"])
    bad, shown, transitions_ok, fallback = 0, 0, 0, 0
    for z in ZONES:
        s = prices[prices.zone == z].set_index("t").eur_mwh.sort_index()
        if s.empty:
            continue
        per_day = s.groupby(s.index.normalize()).size()
        # Ignore the first and last day, which are partial by construction.
        for d, n in per_day.iloc[1:-1].items():
            exp = expected_hours(d.date())
            if n == exp:
                transitions_ok += exp != 24
            elif exp == 25 and n == 24:
                # Known and accepted: `t` is a naive local timestamp, which
                # cannot distinguish the two 02:00s of the autumn fall-back,
                # so they are averaged into one row. Two hours per zone per
                # year. Recorded rather than silently tolerated — removing it
                # means re-keying the whole pipeline on UTC.
                fallback += 1
            else:
                bad += 1
                if shown < 8:
                    shown += 1
                    report("FAIL", z, f"{d.date()} har {n} timer, forventet {exp}")
    if fallback:
        report("WARN", "alle", f"{fallback} efterårsskift gemt som 24 timer — "
                               f"naiv lokaltid kan ikke rumme den dobbelte 02:00")
    if bad == 0:
        report("OK", "alle", f"alle øvrige døgn korrekte, heraf {transitions_ok} sommertidsskift")
    else:
        report("FAIL", "alle", f"{bad} døgn med forkert timetal")


# ─── 4. Weather ─────────────────────────────────────────────────────────────

def check_weather():
    print("\n4. VEJRDATA — rækkevidde, huller, fysisk plausible værdier")
    # Units are Open-Meteo's defaults, which is why wind is km/h and not m/s —
    # the first version of this check assumed m/s and failed 78 perfectly good
    # series. 150 km/h is ~42 m/s, above any hourly mean seen in these zones.
    limits = {"wind_speed_100m": (0, 150), "direct_radiation": (-2, 1200),
              "temperature_2m": (-55, 45), "precipitation": (0, 100)}
    for z in ZONES:
        for kind in ("prev", "actual"):
            path = f"{NORDIC}/w_{kind}_{z}.parquet"
            if not os.path.exists(path):
                report("FAIL", z, f"vejrfil mangler: w_{kind}_{z}.parquet")
                continue
            df = pd.read_parquet(path)
            df["t"] = pd.to_datetime(df["time"])
            if df["t"].duplicated().any():
                report("FAIL", z, f"{kind}: dublerede timestamps")
            for base, (lo, hi) in limits.items():
                cols = [c for c in df.columns if c.startswith(base)]
                for c in cols:
                    v = pd.to_numeric(df[c], errors="coerce").dropna()
                    if v.empty:
                        continue
                    if v.min() < lo or v.max() > hi:
                        report("FAIL", z, f"{kind}/{c}: værdier uden for "
                                          f"[{lo},{hi}]: {v.min():.1f}..{v.max():.1f}")
            if kind == "prev":
                # Every lead must be present, or a horizon silently loses its weather
                for lead in range(1, 8):
                    if f"wind_speed_100m_previous_day{lead}" not in df.columns:
                        report("FAIL", z, f"mangler lead {lead} i previous-runs")
    report("OK", "vejr", "gennemgået 13 zoner x 2 typer")


# ─── 5. Reservoirs ──────────────────────────────────────────────────────────

def check_reservoir():
    print("\n5. MAGASINDATA — kun vandkraftzoner, ugentlig kadence")
    path = f"{NORDIC}/reservoir_weekly.parquet"
    if not os.path.exists(path):
        report("WARN", "reservoir", "fil mangler — modellen kører uden vandværdi")
        return
    r = pd.read_parquet(path)
    r["t"] = pd.to_datetime(r.t_utc, utc=True)
    have = set(r.zone.unique())
    missing = set(HYDRO) - have
    if missing:
        report("WARN", "reservoir", f"vandkraftzoner uden data: {sorted(missing)}")
    if (r.mwh < 0).any():
        report("FAIL", "reservoir", "negative magasinværdier")
    for z, g in r.groupby("zone"):
        g = g.sort_values("t")
        gaps = g.t.diff().dt.days.dropna()
        if len(gaps) and gaps.max() > 21:
            report("WARN", z, f"magasinhul på {gaps.max():.0f} dage")
        age = (pd.Timestamp.now(tz="UTC") - g.t.max()).days
        if age > 30:
            report("WARN", z, f"seneste magasintal er {age} dage gammelt")
    report("OK", "reservoir", f"{len(have)} zoner, {len(r)} ugentlige målinger")


# ─── 6. Live forecast output ────────────────────────────────────────────────

def check_live():
    print("\n6. LIVE PROGNOSE — struktur, båndenes orden, plausible tal")
    for z in ZONES:
        # Cloudflare rejects urllib's default User-Agent with a 403, which the
        # first run mistook for 13 broken zones.
        req = urllib.request.Request(
            f"https://elpriser.org/api/nordic?zone={z}",
            headers={"User-Agent": "elpriser-qa/1.0 (+https://elpriser.org)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.load(r)
        except Exception as e:
            report("FAIL", z, f"API-fejl: {str(e)[:60]}")
            continue
        days = j.get("days", [])
        if len(days) != 10:
            report("FAIL", z, f"{len(days)} døgn, forventet 10")
        bad_band = bad_hours = nulls = 0
        for d in days:
            if len(d.get("prices", [])) != 24:
                bad_hours += 1
            for p in d.get("prices", []):
                v = p.get("eur_mwh")
                if v is None:
                    nulls += 1
                    continue
                lo, hi = p.get("min_eur_mwh"), p.get("max_eur_mwh")
                if lo is not None and hi is not None and not (lo <= v <= hi):
                    bad_band += 1
        if bad_hours:
            report("FAIL", z, f"{bad_hours} døgn uden 24 timer")
        if bad_band:
            report("FAIL", z, f"{bad_band} timer hvor median ligger uden for båndet")
        if nulls:
            report("WARN", z, f"{nulls} timer uden værdi")
        gen = j.get("generated")
        age = (date.today() - date.fromisoformat(gen)).days if gen else 99
        if age > 2:
            report("FAIL", z, f"prognosen er {age} døgn gammel")
        if not (bad_hours or bad_band or nulls or age > 2):
            report("OK", z, f"10 døgn x 24 timer, bånd i orden, genereret {gen}")


# ─── 7. Cross-zone coherence ────────────────────────────────────────────────

def check_coherence():
    """Coupled zones move together. A zone that stops correlating with its
    neighbours has usually broken rather than genuinely decoupled."""
    print("\n7. SAMMENHÆNG MELLEM ZONER — koblede markeder skal følges ad")
    prices = pd.read_parquet(f"{NORDIC}/prices_all.parquet")
    prices["t"] = pd.to_datetime(prices["t"])
    w = prices.pivot_table(index="t", columns="zone", values="eur_mwh")
    w = w[w.index >= w.index.max() - pd.Timedelta(days=90)]
    pairs = [("dk1", "dk2"), ("dk1", "no2"), ("se3", "se4"), ("se1", "se2"),
             ("no1", "no2"), ("fi", "se3"), ("nl", "dk1")]
    for a, b in pairs:
        if a not in w or b not in w:
            continue
        c = w[a].corr(w[b])
        if c < 0.3:
            report("WARN", f"{a}-{b}", f"korrelation kun {c:.2f} — kontrollér")
        else:
            report("OK", f"{a}-{b}", f"korrelation {c:.2f}")


# ─── 8. Grid tariffs ────────────────────────────────────────────────────────

def check_tariffs():
    """The zone pages add a grid tariff to the spot price, so a wrong tariff is
    a wrong consumer price. Ranges alone would not catch much; the real test is
    the arithmetic identity, which validates the per-company exemption flags
    and the hard-coded tax rates at the same time."""
    print("\n8. NETTARIFFER — sammensætning af forbrugerprisen for NO og SE")
    for cc, lo, hi, min_n in (("no", 25, 130, 60), ("se", 50, 220, 80)):
        req = urllib.request.Request(
            f"https://elpriser.org/api/tariffs?country={cc}",
            headers={"User-Agent": "elpriser-qa/1.0 (+https://elpriser.org)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
        except Exception as e:
            report("FAIL", cc, f"tarif-API-fejl: {str(e)[:60]}")
            continue

        comps = d.get("companies", [])
        if len(comps) < min_n:
            report("FAIL", cc, f"kun {len(comps)} selskaber, forventet mindst {min_n}")
        vals = [c["total_ore_kwh"] for c in comps if c.get("total_ore_kwh")]
        if not vals:
            report("FAIL", cc, "ingen totalpriser")
            continue
        if min(vals) < lo or max(vals) > hi:
            report("FAIL", cc, f"totaler {min(vals):.1f}–{max(vals):.1f} uden for [{lo},{hi}]")
        else:
            report("OK", cc, f"{len(comps)} selskaber, {min(vals):.1f}–{max(vals):.1f} {d['unit']}")

        # Norway publishes the components, so the total can be re-derived:
        # (grid + consumption tax where it applies) x VAT where it applies.
        # Agreement proves the exemption flags and the tax rate together.
        if cc == "no":
            tax = d.get("consumption_tax_ore_kwh", 0)
            vat = 1 + d.get("vat_pct", 0) / 100
            bad = sum(1 for c in comps if c.get("grid_ore_kwh") is not None
                      and abs((c["grid_ore_kwh"] + (tax if c["has_consumption_tax"] else 0))
                              * (vat if c["has_vat"] else 1) - c["total_ore_kwh"]) > 0.6)
            if bad:
                report("FAIL", cc, f"{bad} selskaber hvor total != (net + afgift) x moms")
            else:
                report("OK", cc, f"prissammensætning stemmer for alle {len(comps)} selskaber")
            # Northern Norway has two different exemptions covering different
            # areas, so a county holding only one value is a red flag.
            if len({c["has_vat"] for c in comps}) < 2:
                report("WARN", cc, "ingen momsfritagne selskaber — nordnorge mangler?")

        stale = (date.today() - date.fromisoformat(d["valid_from"])).days
        limit = 70 if cc == "no" else 460      # monthly vs annual publication
        if stale > limit:
            report("WARN", cc, f"tariffer gyldige fra {d['valid_from']} — {stale} dage gamle")


def main():
    print("═" * 70)
    print("KVALITETSSIKRING — 13 prisområder")
    print("═" * 70)
    for fn in (check_cross_source, check_prices, check_dst, check_weather,
               check_reservoir, check_live, check_coherence, check_tariffs):
        try:
            fn()
        except Exception as e:
            import traceback
            report("FAIL", fn.__name__, f"tjekket fejlede: {e}")
            traceback.print_exc()

    fails = [f for f in findings if f[0] == "FAIL"]
    warns = [f for f in findings if f[0] == "WARN"]
    print("\n" + "═" * 70)
    print(f"RESULTAT: {len(fails)} fejl, {len(warns)} advarsler, "
          f"{len([f for f in findings if f[0]=='OK'])} beståede tjek")
    if fails:
        print("\nFEJL:")
        for _, a, m in fails:
            print(f"  ✗ [{a}] {m}")
    if warns:
        print("\nADVARSLER:")
        for _, a, m in warns:
            print(f"  ! [{a}] {m}")
    print("═" * 70)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
