"""D+257 research on a COPY (~/eu-forecast-d257). Combinations of the already out-of-sample recipe columns for al and xk.
All candidates are declared here, a priori; choice (if any) is on the SELECT period (2025-04-01..2026-06-30) only; the hold-out is only reported."""
import os, sys, json
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
import region_scores as RS

df = pd.read_parquet('regions_xk.parquet')
df['zone'] = df['zone'].astype(str)
df['t'] = pd.to_datetime(df['t']); df['date'] = pd.to_datetime(df['date'])
BAL = ('ee', 'lv', 'lt')
bal = df.zone.isin(BAL)
df['ens'] = np.where(bal, df.lgb_base, 0.5 * (df.lear_r365_g + df.lgb_fuel))
df['ens_nf'] = np.where(bal, df.lgb_base, 0.5 * (df.lear_r365 + df.lgb_base))
for w in (0.3, 0.7):
    df[f'ens_w{int(w*10)}'] = np.where(bal, df.lgb_base, w * df.lear_r365_g + (1 - w) * df.lgb_fuel)
df['ens4'] = np.where(bal, df.lgb_base, 0.25 * (df.lear_r365_g + df.lgb_fuel + df.lear_r365 + df.lgb_base))

def nb(zones, name, own_set):
    """neighbour ensemble: mean over zones of (ens_z + own level_7d - level_7d_z), for rows of zones in own_set; levels from the same (t,h) rows."""
    key = ['t', 'h']
    piv = df[df.zone.isin(zones)].pivot_table(index=key, columns='zone', values=['ens', 'level_7d'], aggfunc='first')
    out = pd.Series(np.nan, index=df.index)
    for z in own_set:
        m = df.zone == z
        idx = pd.MultiIndex.from_frame(df.loc[m, key])
        adj = []
        for q in zones:
            e = piv['ens'][q].reindex(idx).to_numpy(); lq = piv['level_7d'][q].reindex(idx).to_numpy()
            adj.append(e + df.loc[m, 'level_7d'].to_numpy() - lq)
        out[m] = np.nanmean(np.vstack(adj), axis=0)
    df[name] = out
ALXK = ('al', 'xk')
nb(['al', 'xk'], 'nb_pair', ALXK)
nb(['al', 'xk', 'mk'], 'nb_3', ALXK)
nb(['al', 'xk', 'mk', 'me', 'rs'], 'nb_5', ALXK)
# the same with a 50/50 weight: own ens and the neighbours' mean (own included in the mean already -> 0.5 own + 0.5 mean of the others)
cols = ['b_lvlshape', 'ens', 'ens_nf', 'ens_w3', 'ens_w7', 'ens4', 'nb_pair', 'nb_3', 'nb_5']
sub = df[df.zone.isin(ALXK)].copy()
s = RS.score(sub, cols=cols)
res = {}
for z in ALXK:
    print('==', z)
    for h in (2, 5, 6, 7):
        line = []
        for c in cols[1:]:
            g = {}
            for p in ('full', 'select', 'hold'):
                m = lambda col: float(s[(s.zone == z) & (s.h == h) & (s.period == p) & (s.col == col)].mae.iloc[0])
                g[p] = 1 - m(c) / m('b_lvlshape')
            line.append(f"{c}: sel {g['select']*100:5.2f} full {g['full']*100:5.2f} hold {g['hold']*100:5.2f}")
        print(f"h{h}", ' | '.join(line))
sub.to_parquet('exp1_frame.parquet', index=False)
