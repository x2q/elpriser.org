# Data quality assurance for the 13 price zones

`qa_zones.py` checks the data behind the multi-zone forecast: the price
history for DK1, DK2, NO1–NO5, SE1–SE4, FI and NL, the weather archive that
feeds it, the Nordic reservoir levels, and the forecast the site actually
serves. It exits non-zero if anything fails, so it can run from cron.

```bash
python3 qa_zones.py
```

It expects the data next to the model, at `~/nordic`, and the Danish mirror at
`~/elpriser-data-backup`.

## What it checks, and why those things

**1. Cross-source validation.** The strongest test available. DK1 and DK2 are
pulled from ENTSO-E for the multi-zone model, but Denmark also has an entirely
independent feed in Energinet's EDS. If the two agree hour by hour after unit
and currency conversion, then the timezone handling, the hour alignment and
the conversion are all validated at once — by a source sharing no code path
with the one under test. The check also correlates at lags −3…+3 and requires
the maximum to sit at lag 0, which is what catches an off-by-one hour.

This is what proved the A03 fix below was real: the correlation rose from
0.99999 to 1.00000 once the missing hours were restored. Hours that match an
independent source were recovered, not invented.

**2–3. Price integrity and day length.** Duplicates, gaps, frozen runs,
implausible values, staleness, and the number of hours in each day.

Two rules here are deliberate, and both exist because of bugs this suite
found:

- A gap is never excused as daylight saving. That excuse is exactly what hid
  the A03 bug — the missing hours looked like scattered DST noise.
- Expected hours come from the timezone, not from a naive hourly range.
  02:00 does not exist on a spring-forward day, so a naive range invents three
  hours a year and reports them as missing.

**4. Weather.** Range, coverage of all seven forecast leads, and physical
plausibility per variable. Note the units are Open-Meteo's defaults, so wind
is **km/h, not m/s**; assuming m/s failed 78 perfectly good series on the
first run.

**5. Reservoir.** Hydro zones only, weekly cadence, no negatives.

**6. Live forecast.** Fetches `/api/nordic` for each zone and checks the shape,
that the uncertainty bands are ordered `lo <= value <= hi`, and freshness.
Requires a real User-Agent — Cloudflare answers urllib's default with a 403.

**7. Cross-zone coherence.** Coupled markets have to move together; a zone
that has come loose from its neighbours is usually mis-mapped.

## Known limitation: the autumn fall-back hour

Prices are keyed on a naive local timestamp, which cannot represent the two
02:00s of the autumn clock change. They are averaged into a single row, so
those days hold 24 hours where the calendar says 25 — two hours per zone per
year, 26 days in the current history.

This is reported as a warning rather than quietly tolerated. Removing it means
re-keying the entire pipeline on UTC and deriving local hour-of-day for the
calendar features, which is a larger change than the defect warrants; it is
recorded here so the choice is visible rather than forgotten.
