"""(1) consistency of the 730-day ridge against the 365-day one: per zone and per hold-out sub-period; (2) what build_gate.py (the unchanged gate code) publishes
for the recipe with the 730-day ridge (fuel and no-fuel modes), against the checked-in gate."""
import os, sys, json
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
import build_gate as BG
df = pd.read_parquet('regions_xk.parquet')
df['zone'] = df['zone'].astype(str); df['date'] = pd.to_datetime(df['date']); df['t'] = pd.to_datetime(df['t'])
L = pd.read_parquet('exp6_lear.parquet'); L['t'] = pd.to_datetime(L['t']); L['zone'] = L['zone'].astype(str)
df = df.merge(L.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left', suffixes=('', '_w'))
for v in ('ref', 's1', 's2', 's3'):
    e = pd.read_parquet(f'exp3_{v}.parquet'); e['t'] = pd.to_datetime(e['t']); e['zone'] = e['zone'].astype(str)
    df = df.merge(e.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left')
df['lgb_bag5'] = df[['lgb_fuel'] + [f'lgb_fuel_{v}' for v in ('ref', 's1', 's2', 's3')]].mean(axis=1)
nb = df[~df.zone.isin(('ee', 'lv', 'lt'))].dropna(subset=['lear_r365_g', 'lear_r730_g', 'lgb_bag5', 'y', 'b_lvlshape'])
def gain(d, col):
    return 1 - (d[col] - d.y).abs().groupby(d.zone).mean() / (d.b_lvlshape - d.y).abs().groupby(d.zone).mean()
nb['e365'] = 0.5 * (nb.lear_r365_g + nb.lgb_bag5); nb['e730'] = 0.5 * (nb.lear_r730_g + nb.lgb_bag5)
print('zones where the 730-day recipe beats the 365-day one (hold-out, MAE gain vs level+shape), of 24:')
for h in (2, 5, 7):
    for name, m in (('hold', nb.date >= '2026-07-01'), ('Jul-Aug', (nb.date >= '2026-07-01') & (nb.date < '2026-09-01')), ('Sep-Nov', nb.date >= '2026-09-01')):
        d = nb[(nb.h == h) & m]
        g3, g7 = gain(d, 'e365'), gain(d, 'e730')
        print(f'  h{h} {name:8s}: {(g7 > g3).sum():2d}/24 zones better, mean gain {g3.mean()*100:5.2f} -> {g7.mean()*100:5.2f}')
# the gate, unchanged code, on the 730 recipe
cur = json.load(open('publish_gate.json')) if os.path.exists('publish_gate.json') else None
cols = ['zone', 't', 'date', 'h', 'hour', 'y', 'level_7d', 'b_lag7', 'b_seasonal', 'b_persist', 'b_lvlshape', 'lear_r365_g', 'lear_r365', 'lgb_fuel', 'lgb_base']
for tag, lg_col in (('730 ridge + stored LightGBM', 'lgb_fuel'), ('730 ridge + 5-run LightGBM mean', 'lgb_bag5')):
    f = df[cols].copy()
    f['lear_r365_g'] = df['lear_r730_g']; f['lear_r365'] = df['lear_r730']
    f['lgb_fuel'] = df[lg_col]
    gate, acc, notes = BG.build(f, None)
    print('==', tag, '| horizons published, fuel mode:', sum(len(v['fuel']) for v in gate['zones'].values()), 'of 156; no-fuel:', sum(len(v['nofuel']) for v in gate['zones'].values()))
    for z in ('al', 'xk'):
        print('  ', z, 'fuel', gate['zones'][z]['fuel'], 'nofuel', gate['zones'][z]['nofuel'])
        for h in (5, 6, 7):
            c = acc['zones'][z]['fuel'].get(str(h))
            print(f'      D+{h}:', None if c is None else {k: c[k] for k in ('mae', 'baseMae', 'gain', 'gainHold', 'gainRecent', 'low', 'days')})
    print('   nofuel it-n', gate['zones']['it-n']['nofuel'], 'was', cur['zones']['it-n']['nofuel'], '| ie', gate['zones']['ie']['nofuel'], 'was', cur['zones']['ie']['nofuel'])
    if cur:
        diff = [(z, m, sorted(set(gate['zones'][z][m]) ^ set(cur['zones'][z][m]))) for z in gate['zones'] if z in cur['zones'] for m in ('fuel', 'nofuel') if set(gate['zones'][z][m]) != set(cur['zones'][z][m])]
        print('   horizon sets that differ from the gate file in this directory:', diff)
    print('   notes (not published):', [n for n in notes])
