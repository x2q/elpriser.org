"""Ridge window 365 / 540 / 730 days inside the production recipe, LightGBM part fixed (mean of 5 independent runs, 'bag5'), same rows and baseline."""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
df = pd.read_parquet('regions_xk.parquet', columns=['zone', 't', 'date', 'h', 'y', 'b_lvlshape', 'lgb_fuel'])
df['zone'] = df['zone'].astype(str); df['date'] = pd.to_datetime(df['date']); df['t'] = pd.to_datetime(df['t'])
lg = ['ref', 's1', 's2', 's3']
for v in lg:
    e = pd.read_parquet(f'exp3_{v}.parquet'); e['t'] = pd.to_datetime(e['t']); e['zone'] = e['zone'].astype(str)
    df = df.merge(e.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left')
L = pd.read_parquet('exp6_lear.parquet'); L['t'] = pd.to_datetime(L['t']); L['zone'] = L['zone'].astype(str)
df = df.merge(L.drop_duplicates(['zone', 't', 'h']), on=['zone', 't', 'h'], how='left')
df = df[~df.zone.isin(('ee', 'lv', 'lt'))]
df['lgb_bag5'] = df[['lgb_fuel'] + [f'lgb_fuel_{v}' for v in lg]].mean(axis=1)
W = (365, 540, 730)
for w in W:
    df[f'ens_{w}'] = 0.5 * (df[f'lear_r{w}_g'] + df['lgb_bag5'])
df = df.dropna(subset=['y', 'b_lvlshape'] + [f'ens_{w}' for w in W])
SEL = df.date < '2026-07-01'; HOLD = df.date >= '2026-07-01'
def gain(d, col):
    return 1 - (d[col] - d.y).abs().groupby(d.zone).mean() / (d.b_lvlshape - d.y).abs().groupby(d.zone).mean()
print('rows', len(df))
print('mean over 24 zones gain %, select/hold')
for w in W:
    print(f'win{w}', ' '.join(f"h{h}: {gain(d[SEL[d.index]], f'ens_{w}').mean()*100:5.2f}/{gain(d[HOLD[d.index]], f'ens_{w}').mean()*100:5.2f}" for h in range(2, 8) for d in [df[df.h == h]]))
print('ridge alone (fuel), mean gain select/hold')
for w in W:
    print(f'win{w}', ' '.join(f"h{h}: {gain(d[SEL[d.index]], f'lear_r{w}_g').mean()*100:5.2f}/{gain(d[HOLD[d.index]], f'lear_r{w}_g').mean()*100:5.2f}" for h in (2, 5, 7) for d in [df[df.h == h]]))
print('al / xk ensemble (select / full / hold)')
full = pd.Series(True, index=df.index)
for w in W:
    for z in ('al', 'xk'):
        line = []
        for h in (5, 6, 7):
            d = df[(df.zone == z) & (df.h == h)]
            def f(m):
                dd = d[m[d.index]]; return 1 - (dd[f'ens_{w}'] - dd.y).abs().mean() / (dd.b_lvlshape - dd.y).abs().mean()
            line.append(f"h{h}: {f(SEL)*100:5.2f}/{f(full)*100:5.2f}/{f(HOLD)*100:5.2f}")
        print(f'win{w} {z}', ' | '.join(line))
def passing(w):
    ok = {}
    for h in range(2, 8):
        d = df[df.h == h]; g1 = gain(d, f'ens_{w}'); g2 = gain(d[HOLD[d.index]], f'ens_{w}')
        for z in g1.index: ok[(z, h)] = bool(min(g1[z], g2[z]) >= .05)
    return ok
p = {w: passing(w) for w in W}
for w in W: print(f'win{w} passing', sum(p[w].values()), 'of', len(p[w]))
print('cells whose status differs from win365:', [(k, p[365][k], p[540][k], p[730][k]) for k in p[365] if len({p[w][k] for w in W}) > 1])
