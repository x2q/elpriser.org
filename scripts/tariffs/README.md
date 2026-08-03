# Grid tariffs outside Denmark

Denmark is served by Energinet's DataHub Pricelist, which is a genuine central
register with an API. Norway and Sweden needed separate handling; Finland and
the Netherlands are deliberately **not** covered here, for reasons below.

## Norway — `tariffs-no`

[NVE's tariff API](https://nettleietariffer.dataplattform.nve.no/v1), open, no
API key, NLOD licence. ~101 company/county combinations.

The field that makes this usable is `omregnetOrekWhInk`: NVE pre-computes the
capacity-based tariff (effekttariff) as an equivalent øre/kWh for a standard
customer. Norwegian grid charges depend on peak draw rather than volume, so
without that conversion there is no honest way to place a Norwegian tariff
next to a per-kWh spot price.

Verified before trusting it — for Glitre Nett Oslo:
`energileddInk = (energileddEks 21.6 + elavgift 7.13) × 1.25 = 35.91`,
matching NVE's own figure exactly. So "Ink" includes both consumption tax and
VAT.

**The two exemption zones in northern Norway are not the same**, and this
matters: VAT exemption covers all of Nordland, Troms and Finnmark, while the
consumption-tax exemption covers only Finnmark plus seven Nord-Troms
municipalities. The API carries `harMva` and `harForbruksavgift` per company
and the data reflects the split — Troms contains companies with both values.
We therefore read the flags from the data rather than deriving them from the
bidding zone, which would overstate the exemption for Nordland and most of
Troms.

## Sweden — `tariffs-se`

Energimarknadsinspektionen publishes a complete register as an Excel workbook,
updated roughly annually — no API. 112 companies with current figures.

**Parsing trap:** each company appears on several rows, one per tariff period.
De-duplicating rows naively gives wildly wrong company counts (we got 146 and
then 28 before doing it properly). Take the non-empty value per company.

Ei's file carries no region column, so the reduced energy-tax rate for northern
municipalities cannot be resolved automatically. Both figures are published
(`total_ore_kwh` and `total_ore_kwh_north`) and the note says which is which.

## Not covered, and why

**Finland** — no central machine-readable register for its 77 DSOs.
Energiavirasto's spreadsheet stalled after July 2024 pending a methodology
change, so the newest machine-readable tariff is roughly two years old.
Fingrid's open API was tested and carries no tariff data at all.

**Netherlands** — grid costs are an annual capacity charge set by connection
amperage, not by consumption. A household using 1,000 kWh and one using 10,000
kWh on the same 3×25A connection pay the same. Converting that to øre/kWh
would require assuming a consumption level and would distort the very price
signal the site exists to show. CBS's OData API does provide national average
figures if an aggregate view is ever wanted.

## Law-set rates

No API exists for any of these in either country; they are constants in
`fetch_tariffs.py` and must be revisited when a budget changes.

| | Value | Note |
|---|---|---|
| NO elavgift | 7.13 øre/kWh | 2026, flat — the winter discount ended |
| NO MVA | 25% | 0% in Nordland/Troms/Finnmark |
| NO Enova-avgift | removed | abolished 1 Jan 2026 |
| SE energiskatt | 36.0 öre/kWh | 2026, cut from 43.9 |
| SE reduced rate | 26.4 öre/kWh | northern municipalities |
| SE moms | 25% | charged on top of the energy tax |
