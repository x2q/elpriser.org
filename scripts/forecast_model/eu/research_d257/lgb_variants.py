"""Research on a COPY (~/eu-forecast-d257), never ~/eu-forecast: LightGBM variants for the long horizons, backtested with the production protocol
(backtest.py: expanding window, retrained every 2 months, 2025-04..2026-11, target = price - level_7d, fuel features, all 26 zones pooled).
Variants are declared here before any result is seen; the decision rule (exp4.py) uses the SELECT period only.
  ref  backtest.py's own PARAMS (reproduction check against lgb_fuel in regions_xk.parquet)
  rw   recency weights 0.5 ** (age_days / 270) on the training rows (the price level regime moves)
  hs   one model per horizon group {2,3} {4,5} {6,7}
  reg  stronger regularisation: num_leaves 31, min_child_samples 300, 300 trees, lr 0.05
"""
import os, sys, time
sys.path.insert(0, os.getcwd())
import lightgbm as lgb, numpy as np, pandas as pd
import backtest as BT

JOBS = int(os.environ.get('JOBS', '6'))
df = pd.read_parquet('dataset_eu_fuel.parquet')
df['t'] = pd.to_datetime(df['t']); df['date'] = df['t'].dt.normalize()
df = df[df['h'] <= 7].sort_values('t')
feats = BT.feats_for('rel+fuel')
req = BT.required(feats) + ['y']
folds = pd.period_range('2025-04', '2026-11', freq='M')
VARIANTS = sys.argv[1:] or ['ref', 'rw', 'hs', 'reg']
t00 = time.time()

def fit_predict(variant, train, test, lo):
    tr = train.dropna(subset=req)
    y = tr['y'] - tr['level_7d']
    params = dict(BT.PARAMS)
    if variant.startswith('s') and variant[1:].isdigit():
        params['random_state'] = int(variant[1:])
    if variant == 'reg':
        params.update(num_leaves=31, min_child_samples=300, n_estimators=300, learning_rate=0.05)
    out = pd.Series(np.nan, index=test.index)
    if variant == 'hs':
        for hs in ((2, 3), (4, 5), (6, 7)):
            a = tr['h'].isin(hs); b = test['h'].isin(hs)
            m = lgb.LGBMRegressor(n_jobs=JOBS, **params); m.fit(tr.loc[a, feats], y[a], categorical_feature=['zone'])
            out[b] = m.predict(test.loc[b, feats]) + test.loc[b, 'level_7d'].to_numpy()
        return out
    w = None
    if variant == 'rw':
        age = (lo - tr['date']).dt.days.to_numpy()
        w = 0.5 ** (age / 270.0)
    m = lgb.LGBMRegressor(n_jobs=JOBS, **params)
    m.fit(tr[feats], y, categorical_feature=['zone'], sample_weight=w)
    return pd.Series(m.predict(test[feats]) + test['level_7d'].to_numpy(), index=test.index)

for variant in VARIANTS:
    parts = []
    for i in range(0, len(folds), 2):
        lo = folds[i].start_time; hi = folds[min(i + 1, len(folds) - 1)].end_time
        train = df[df['date'] < lo]; test = df[(df['date'] >= lo) & (df['date'] <= hi)].copy()
        if len(train) < 100_000 or not len(test):
            continue
        test['p'] = fit_predict(variant, train, test, lo)
        parts.append(test[['zone', 't', 'h', 'p']])
    res = pd.concat(parts, ignore_index=True); res['zone'] = res['zone'].astype(str)
    res.rename(columns={'p': f'lgb_fuel_{variant}'}).to_parquet(f'exp3_{variant}.parquet', index=False)
    print(f'[{time.time() - t00:6.0f}s] {variant} done {len(res):,} rows', flush=True)
print('EXP3 DONE', flush=True)
