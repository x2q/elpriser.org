"""Evaluate the exp3 LightGBM variants inside the production recipe (mean of lear_r365_g and the LightGBM), same rows, same level+shape baseline.
Rule fixed in advance: a variant is a candidate only if the mean gain over the 24 non-Baltic zones on the SELECT period (2025-04-01..2026-06-30) beats `ref`
at the long horizons h5-h7; the hold-out (2026-07-01..) is only reported."""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
df = pd.read_parquet('regions_xk.parquet')
df['zone'] = df['zone'].astype(str); df['date'] = pd.to_datetime(df['date']); df['t'] = pd.to_datetime(df['t'])
names = [v for v in ('ref', 'rw', 'hs', 'reg') if os.path.exists(f'exp3_{v}.parquet')]
for v in names:
    e = pd.read_parquet(f'exp3_{v}.parquet'); e['t'] = pd.to_datetime(e['t']); e['zone'] = e['zone'].astype(str)
    df = df.merge(e.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left')
df = df[~df.zone.isin(('ee', 'lv', 'lt'))].dropna(subset=['lear_r365_g', 'lgb_fuel', 'b_lvlshape', 'y'] + [f'lgb_fuel_{v}' for v in names])
print('rows', len(df), 'reproduction of lgb_fuel by ref: mean |diff| EUR/MWh', float((df.lgb_fuel - df.lgb_fuel_ref).abs().mean()) if 'ref' in names else None)
SEL = df.date < '2026-07-01'; HOLD = df.date >= '2026-07-01'
def gains(d, col):
    num = (d[col] - d.y).abs().groupby(d.zone).mean(); den = (d.b_lvlshape - d.y).abs().groupby(d.zone).mean()
    return 1 - num / den
for v in names:
    df[f'ens_{v}'] = 0.5 * (df.lear_r365_g + df[f'lgb_fuel_{v}'])
df['ens_stored'] = 0.5 * (df.lear_r365_g + df.lgb_fuel)
print('mean gain over 24 zones, percent: select / hold per horizon')
rows = {}
for v in ['stored'] + names:
    out = []
    for h in range(2, 8):
        d = df[df.h == h]
        out.append((gains(d[SEL[d.index]], f'ens_{v}').mean() * 100, gains(d[HOLD[d.index]], f'ens_{v}').mean() * 100))
    rows[v] = out
    print(f'{v:7s}', ' '.join(f'h{h}: {a:5.2f}/{b:5.2f}' for h, (a, b) in zip(range(2, 8), out)))
print('al / xk gain at h5, h6, h7 (select / full / hold)')
for v in ['stored'] + names:
    for z in ('al', 'xk'):
        line = []
        for h in (5, 6, 7):
            d = df[(df.zone == z) & (df.h == h)]
            f = lambda m: 1 - (d.loc[m[d.index], f'ens_{v}'] - d.loc[m[d.index], 'y']).abs().mean() / (d.loc[m[d.index], 'b_lvlshape'] - d.loc[m[d.index], 'y']).abs().mean()
            full = pd.Series(True, index=df.index)
            line.append(f'h{h}: {f(SEL)*100:5.2f}/{f(full)*100:5.2f}/{f(HOLD)*100:5.2f}')
        print(f'{v:7s} {z}', ' | '.join(line))
