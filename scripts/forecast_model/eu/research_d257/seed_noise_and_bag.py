"""Seed noise and seed-bagging of the LightGBM part of the production recipe (same rows as production's build_gate: 0.5*(lear_r365_g + LightGBM) vs level+shape).
Declared in advance: single runs = stored (the checked-in research run), ref, s1, s2, s3 (identical parameters; only the seed / thread schedule differs);
bag = mean of the LightGBM predictions of s1, s2, s3 (bag5 adds stored and ref). Nothing is chosen on the hold-out: bagging is a variance reduction, adopted or not by that argument."""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
df = pd.read_parquet('regions_xk.parquet')
df['zone'] = df['zone'].astype(str); df['date'] = pd.to_datetime(df['date']); df['t'] = pd.to_datetime(df['t'])
names = [v for v in ('ref', 's1', 's2', 's3') if os.path.exists(f'exp3_{v}.parquet')]
for v in names:
    e = pd.read_parquet(f'exp3_{v}.parquet'); e['t'] = pd.to_datetime(e['t']); e['zone'] = e['zone'].astype(str)
    df = df.merge(e.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left')
df = df[~df.zone.isin(('ee', 'lv', 'lt'))].dropna(subset=['lear_r365_g', 'lgb_fuel', 'b_lvlshape', 'y'] + [f'lgb_fuel_{v}' for v in names])
df['lgb_fuel_stored'] = df.lgb_fuel
singles = ['stored'] + names
seeds = [v for v in names if v.startswith('s')]
df['lgb_fuel_bag3'] = df[[f'lgb_fuel_{v}' for v in seeds]].mean(axis=1) if len(seeds) >= 3 else np.nan
df['lgb_fuel_bag5'] = df[[f'lgb_fuel_{v}' for v in singles]].mean(axis=1)
cands = singles + (['bag3'] if len(seeds) >= 3 else []) + ['bag5']
for v in cands:
    df[f'ens_{v}'] = 0.5 * (df.lear_r365_g + df[f'lgb_fuel_{v}'])
SEL = df.date < '2026-07-01'; HOLD = df.date >= '2026-07-01'
def gain(d, col):
    num = (d[col] - d.y).abs().groupby(d.zone).mean(); den = (d.b_lvlshape - d.y).abs().groupby(d.zone).mean()
    return 1 - num / den
print('pairwise mean |diff| between single LightGBM runs, EUR/MWh:', {f'{a}-{b}': round(float((df[f'lgb_fuel_{a}'] - df[f'lgb_fuel_{b}']).abs().mean()), 2) for a, b in zip(singles[:-1], singles[1:])})
print('mean over 24 zones, gain vs level+shape %, select/hold')
for v in cands:
    print(f'{v:7s}', ' '.join(f"h{h}: {gain(d[SEL[d.index]], f'ens_{v}').mean()*100:5.2f}/{gain(d[HOLD[d.index]], f'ens_{v}').mean()*100:5.2f}" for h in range(2, 8) for d in [df[df.h == h]]))
print('al / xk (select / full / hold) at D+5, D+7')
for v in cands:
    for z in ('al', 'xk'):
        line = []
        for h in (5, 7):
            d = df[(df.zone == z) & (df.h == h)]
            def f(m):
                dd = d[m[d.index]]; return 1 - (dd[f'ens_{v}'] - dd.y).abs().mean() / (dd.b_lvlshape - dd.y).abs().mean()
            line.append(f"h{h}: {f(SEL)*100:5.2f}/{f(pd.Series(True, index=df.index))*100:5.2f}/{f(HOLD)*100:5.2f}")
        print(f'{v:7s} {z}', ' | '.join(line))
print('zone-horizons whose gate status (>=5 % whole AND hold-out) differs between runs; per run, count of passing cells of 24x6')
st = {}
for v in cands:
    ok = {}
    for h in range(2, 8):
        d = df[df.h == h]
        g1 = gain(d, f'ens_{v}'); g2 = gain(d[HOLD[d.index]], f'ens_{v}')
        for z in g1.index: ok[(z, h)] = bool(min(g1[z], g2[z]) >= .05)
    st[v] = ok
    print(f'{v:7s} passing', sum(ok.values()), 'of', len(ok))
keys = list(st['stored'])
flip = [k for k in keys if len({st[v][k] for v in cands}) > 1]
print('cells that flip between runs:', flip)
