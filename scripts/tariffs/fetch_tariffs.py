#!/usr/bin/env python3
"""Grid tariffs for Norway and Sweden, written to Cloudflare KV.

Denmark already has this via Energinet's DataHub Pricelist. Norway and Sweden
each needed a different approach, because the data is published differently:

NORWAY — NVE publishes a genuine open API (no key, NLOD licence) covering ~70
network companies. Crucially it pre-computes `omregnetOrekWhInk`: the
capacity-based tariff (effekttariff) expressed as øre/kWh for a standard
customer. Without that we could not put a Norwegian tariff next to a per-kWh
spot price at all, since the real tariff depends on peak draw, not volume.

Verified against the raw components before trusting it — for Glitre Nett Oslo:
    energileddInk = (energileddEks 21.6 + elavgift 7.13) x 1.25 MVA = 35.91
which matches the API's own figure exactly. So "Ink" means including both the
consumption tax and VAT, and `omregnetOrekWhInk` is the whole grid+tax cost
per kWh, leaving only the spot price to add.

The API also carries `harMva` and `harForbruksavgift` per company, which
matters more than it looks: the two exemption zones in northern Norway are NOT
the same. VAT exemption covers all of Nordland, Troms and Finnmark; the
consumption-tax exemption covers only Finnmark plus seven Nord-Troms
municipalities. The data reflects this — Troms contains companies with both
values — so we take the flags from the data rather than deriving them from the
bidding zone, which would be wrong for Nordland and most of Troms.

SWEDEN — Energimarknadsinspektionen publishes a complete register, but as an
Excel workbook, not an API. It is updated roughly annually. Each company
appears on SEVERAL rows (one per tariff period), so the current figure has to
be taken as the non-empty value per company; naively de-duplicating rows gives
badly wrong company counts.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

import pandas as pd

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"
NVE = "https://nettleietariffer.dataplattform.nve.no/v1"
EI_XLSX = ("https://ei.se/download/18.6586000219eb48404e7ac7/"
           "1781185169892/Hush%C3%A5llskunder.xlsx")

# Rates that are law-set and published only as prose/HTML — no API exists for
# any of them in either country, so they are carried here and must be revisited
# when a budget changes. Sources in the accompanying notes.
NO_ELAVGIFT_ORE = 7.13      # 2026, flat all year (the winter discount ended)
NO_MVA = 0.25
SE_ENERGISKATT_ORE = 36.0   # 2026, cut from 43.9
SE_ENERGISKATT_NORTH_ORE = 26.4   # reduced rate, northern municipalities
SE_MOMS = 0.25


def fetch_json(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def kv_put(key, value, ttl, account, token):
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key)}"
           f"?expiration_ttl={ttl}")
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method="PUT",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read())
    if not resp.get("success"):
        raise RuntimeError(f"KV put failed for {key}: {resp}")


# ─── Norway ─────────────────────────────────────────────────────────────────

def build_norway():
    """One entry per (company, county). Kundegruppe 2 is the mid-size example
    customer (4/6 kW, 20 000 kWh) — closest to a typical house with a heat
    pump, and the same basis used for the Danish comparison."""
    start = date.today().replace(day=1).isoformat()
    url = (f"{NVE}/NettleiePerOmradePrManedHusholdningFritidEffekttariffer"
           f"?FraDato={start}&Tariffgruppe=Husholdning&Kundegruppe=2")
    rows = fetch_json(url)
    if not rows:
        # Early in a month NVE may not have published yet — fall back a month.
        prev = (date.today().replace(day=1) - pd.Timedelta(days=1)).replace(day=1)
        rows = fetch_json(url.replace(f"FraDato={start}", f"FraDato={prev.isoformat()}"))
    if not rows:
        raise RuntimeError("NVE returned no rows")

    latest = max(r["datoId"] for r in rows)
    out, seen = [], set()
    for r in rows:
        if r["datoId"] != latest:
            continue
        key = (r["organisasjonsnr"], r["fylke"])
        if key in seen or not r.get("omregnetOrekWhInk"):
            continue
        seen.add(key)
        out.append({
            "id": f"{r['organisasjonsnr']}-{r['fylkeNr']}",
            "name": r["konsesjonar"].title(),
            "region": r["fylke"],
            "orgnr": r["organisasjonsnr"],
            # All-in grid + consumption tax + VAT, øre/kWh
            "total_ore_kwh": round(r["omregnetOrekWhInk"], 2),
            "grid_ore_kwh": round(r["omregnetOrekWhEks"], 2),
            "fixed_month": round(r["fastleddInk"], 0) if r.get("fastleddInk") else None,
            "energy_ore_kwh": round(r["energileddInk"], 2) if r.get("energileddInk") else None,
            "has_vat": bool(r["harMva"]),
            "has_consumption_tax": bool(r["harForbruksavgift"]),
        })
    out.sort(key=lambda x: (x["region"], x["name"]))
    national = next((r.get("omregnetOrekWhInkLandssnitt") for r in rows
                     if r["datoId"] == latest and r.get("omregnetOrekWhInkLandssnitt")), None)
    return {
        "country": "NO", "currency": "NOK", "unit": "øre/kWh",
        "valid_from": latest[:10],
        "vat_pct": NO_MVA * 100,
        "consumption_tax_ore_kwh": NO_ELAVGIFT_ORE,
        "national_avg_ore_kwh": round(national, 2) if national else None,
        "note": ("total_ore_kwh is grid tariff incl. consumption tax and VAT. "
                 "Add the spot price (also incl. VAT where has_vat) to get the "
                 "full consumer price."),
        "source": "NVE nettleietariffer (NLOD)",
        "companies": out,
    }


# ─── Sweden ─────────────────────────────────────────────────────────────────

def build_sweden():
    with urllib.request.urlopen(EI_XLSX, timeout=300) as r:
        raw = r.read()
    d = pd.read_excel(io.BytesIO(raw), header=None)
    blocks, years = d.iloc[0].ffill(), d.iloc[2]
    year = date.today().year

    def column(code, yr):
        for c in range(3, d.shape[1]):
            if blocks[c] == code and str(years[c]) == str(yr):
                return c
        return None

    def series(code, yr, label):
        c = column(code, yr)
        if c is None:
            return pd.Series(dtype=float, name=label)
        s = d.iloc[3:, [1, c]].copy()
        s.columns = ["company", "v"]
        s["v"] = pd.to_numeric(s["v"], errors="coerce")
        # A company spans several rows (one per tariff period) — take its
        # non-empty value rather than de-duplicating rows blindly, which
        # silently drops most companies.
        return s.dropna(subset=["v"]).groupby("company").v.max().rename(label)

    # NT4000 = Villa 20A, 20 000 kWh/yr — the closest match to the Norwegian
    # example customer, so the two countries stay comparable.
    for yr in (year, year - 1):
        m = pd.concat([series("NT4000", yr, "total_kr_yr"),
                       series("NT4020", yr, "fixed_kr_yr"),
                       series("NT4030", yr, "var_ore_kwh")], axis=1)
        m = m[m.total_kr_yr > 0]
        if len(m) > 20:
            break
    if len(m) <= 20:
        raise RuntimeError("Ei workbook had too few current rows")

    out = []
    for name, r in m.iterrows():
        grid = r.total_kr_yr / 20000 * 100          # öre/kWh, excl. tax and VAT
        out.append({
            "id": str(name)[:60],
            "name": str(name),
            "region": None,                          # Ei publishes no region column
            "grid_ore_kwh": round(grid, 2),
            "fixed_kr_yr": round(r.fixed_kr_yr, 0) if pd.notna(r.fixed_kr_yr) else None,
            "var_ore_kwh": round(r.var_ore_kwh, 2) if pd.notna(r.var_ore_kwh) else None,
            # Grid + energy tax + VAT. The reduced northern rate is offered as a
            # separate figure because Ei's file carries no region, so we cannot
            # tell from the data alone which companies serve those municipalities.
            "total_ore_kwh": round((grid + SE_ENERGISKATT_ORE) * (1 + SE_MOMS), 2),
            "total_ore_kwh_north": round((grid + SE_ENERGISKATT_NORTH_ORE) * (1 + SE_MOMS), 2),
        })
    out.sort(key=lambda x: x["name"])
    return {
        "country": "SE", "currency": "SEK", "unit": "öre/kWh",
        "valid_from": f"{yr}-01-01",
        "vat_pct": SE_MOMS * 100,
        "energy_tax_ore_kwh": SE_ENERGISKATT_ORE,
        "energy_tax_north_ore_kwh": SE_ENERGISKATT_NORTH_ORE,
        "note": ("total_ore_kwh is grid tariff incl. energy tax and VAT for a "
                 "Villa 20A / 20 000 kWh customer. Use total_ore_kwh_north in "
                 "the reduced-tax municipalities of Norrbotten, Västerbotten, "
                 "Jämtland and parts of Västernorrland and Dalarna — Ei's file "
                 "carries no region, so this cannot be resolved automatically."),
        "source": "Energimarknadsinspektionen (xlsx, annual)",
        "companies": out,
    }


def main():
    path = os.path.expanduser("~/.config/elpriser.env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")

    results = {}
    for name, fn in (("no", build_norway), ("se", build_sweden)):
        try:
            data = fn()
            results[name] = data
            print(f"{name.upper()}: {len(data['companies'])} companies, "
                  f"valid from {data['valid_from']}", flush=True)
            vals = [c["total_ore_kwh"] for c in data["companies"]]
            print(f"   total incl. tax+VAT: {min(vals):.1f}–{max(vals):.1f} {data['unit']}",
                  flush=True)
        except Exception as e:
            print(f"{name.upper()} failed: {e}", flush=True)

    out_dir = os.path.dirname(os.path.abspath(__file__))
    for name, data in results.items():
        with open(f"{out_dir}/tariffs_{name}.json", "w") as f:
            json.dump(data, f, ensure_ascii=False)
        if account and token:
            kv_put(f"tariffs-{name}", data, 40 * 86400, account, token)
            print(f"   KV written: tariffs-{name}", flush=True)
    if not (account and token):
        print("Cloudflare creds not set — wrote local JSON only", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
