"""Global ridge/LightGBM weight per horizon, chosen on the SELECT period (all non-Baltic zones pooled), hold-out reported only."""
import os, sys
sys.path.insert(0, os.getcwd())
import numpy as np, pandas as pd
df = pd.read_parquet('regions_xk.parquet')
df['zone'] = df['zone'].astype(str); df['date'] = pd.to_datetime(df['date'])
df = df[~df.zone.isin(('ee', 'lv', 'lt'))].dropna(subset=['lear_r365_g', 'lgb_fuel', 'b_lvlshape', 'y'])
SEL = df.date < '2026-07-01'; HOLD = df.date >= '2026-07-01'
W = (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0)
def zone_gain(d, w):
    p = w * d.lear_r365_g + (1 - w) * d.lgb_fuel
    num = (p - d.y).abs().groupby(d.zone).mean(); den = (d.b_lvlshape - d.y).abs().groupby(d.zone).mean()
    return 1 - num / den
print('mean over 24 zones of gain vs level+shape (percent); rows: h, cols: ridge weight', W)
best = {}
for h in range(2, 8):
    dh = df[df.h == h]
    rs = [zone_gain(dh[SEL[dh.index]], w).mean() * 100 for w in W]
    rh = [zone_gain(dh[HOLD[dh.index]], w).mean() * 100 for w in W]
    print(f'h{h} select', ' '.join(f'{x:6.2f}' for x in rs))
    print(f'h{h} hold  ', ' '.join(f'{x:6.2f}' for x in rh))
    best[h] = W[int(np.argmax(rs))]
print('best on select per horizon:', best)
# how often does each zone-horizon change gate status (>=5 % on full and hold) when using best-on-select weights
def cells(wmap):
    out = {}
    for h in range(2, 8):
        dh = df[df.h == h]
        w = wmap[h] if isinstance(wmap, dict) else wmap
        full = zone_gain(dh, w); hold = zone_gain(dh[HOLD[dh.index]], w)
        for z in full.index: out[(z, h)] = (full[z], hold[z])
    return out
base = cells(0.5); new = cells(best)
chg = [(z, h, round(base[(z, h)][0] * 100, 1), round(base[(z, h)][1] * 100, 1), round(new[(z, h)][0] * 100, 1), round(new[(z, h)][1] * 100, 1)) for (z, h) in base
       if (min(base[(z, h)]) >= .05) != (min(new[(z, h)]) >= .05)]
print('gate status changes (zone, h, base full/hold, new full/hold):', chg)
