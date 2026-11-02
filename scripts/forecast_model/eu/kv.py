"""Workers KV writes for the EU forecast job (stdlib only). The same REST call and namespace as
scripts/forecast_model/nordic/train_daily.py and scripts/eu_prices/build_eu_prices.py. Credentials come from the environment
(~/.config/elpriser.env), are never logged, and never appear in an error message (the URL carries none, the header is not echoed)."""
import json
import urllib.error
import urllib.parse
import urllib.request

KV_NAMESPACE = "126700e66e8d4a19b289b0e8afdaff69"
UA = "elpriser.org/1.0 (+https://elpriser.org; hello@elpriser.org)"
FORECAST_TTL = 3 * 86400          # like eu-prices-<zone>: a job that stops makes the forecast vanish rather than go stale
ARCHIVE_TTL = 200 * 86400


def _url(key, account):
    return (f"https://api.cloudflare.com/client/v4/accounts/{account}"
            f"/storage/kv/namespaces/{KV_NAMESPACE}/values/{urllib.parse.quote(key, safe='')}")


def canonical(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def put(key, value, ttl, account, token):
    req = urllib.request.Request(f"{_url(key, account)}?expiration_ttl={int(ttl)}", data=canonical(value).encode("utf-8"),
                                 method="PUT", headers={"Authorization": f"Bearer {token}",
                                                        "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"KV put {key}: HTTP {e.code}")
    if not resp.get("success"):
        raise RuntimeError(f"KV put {key} failed")


def get(key, account, token):
    req = urllib.request.Request(_url(key, account), headers={"Authorization": f"Bearer {token}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f"KV get {key}: HTTP {e.code}")
