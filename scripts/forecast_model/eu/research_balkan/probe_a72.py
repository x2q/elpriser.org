"""(d) Hydro: does ENTSO-E publish reservoir filling (A72 / A16) for the EU job's bidding zones?  One request per zone for 2024-01-01 .. today, read-only, the token comes from the
environment (ENTSOE_TOKEN, never printed).  Prints per zone: documents, weekly points, first / last period start, publication coverage."""
import os, re, sys, urllib.request, urllib.parse, urllib.error
from datetime import date, timedelta
sys.path.insert(0, os.getcwd())
from zones import ZONES

tok = os.environ["ENTSOE_TOKEN"]
extra = {"no-ref-ch": "10YCH-SWISSGRIDZ", "it-sud": "10Y1001A1001A788", "ba": "10YBA-JPCC-----D", "ua-ref": "10Y1001C--00003F"}
rows = []
for z, (eic, _, _) in list(ZONES.items()):
    url = "https://web-api.tp.entsoe.eu/api?" + urllib.parse.urlencode({
        "securityToken": tok, "documentType": "A72", "processType": "A16", "in_Domain": eic,
        "periodStart": "202401010000", "periodEnd": (date.today() + timedelta(days=1)).strftime("%Y%m%d0000")})
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            xml = r.read().decode("utf-8", "replace")
        code = 200
    except urllib.error.HTTPError as ex:
        xml, code = ex.read().decode("utf-8", "replace"), ex.code
    n = len(re.findall(r"<Point>", xml))
    starts = re.findall(r"<start>([^<]+)</start>", xml)
    ends = re.findall(r"<end>([^<]+)</end>", xml)
    qs = [float(x) for x in re.findall(r"<quantity>([^<]+)</quantity>", xml)]
    reason = re.findall(r"<text>([^<]+)</text>", xml)
    rows.append((z, code, n, min(starts) if starts else "", max(ends) if ends else "", (min(qs), max(qs)) if qs else "", reason[0][:60] if reason and not n else ""))
    print(rows[-1], flush=True)
