import sys,os,hashlib,glob,json; sys.path.insert(0,'.')
import requests
from asc import *
from ios_meta import VER
ROOT="/Users/cc/elpriser/ElpriserIOS/store/screenshots/"
MAP={'da':'da','en-GB':'en','de-DE':'de','fr-FR':'fr','nl-NL':'nl','it':'it','pl':'pl','sv':'sv','no':'nb','fi':'fi','cs':'cs','hu':'hu','es-ES':'es','pt-PT':'pt','sk':'sk','el':'el','ro':'ro','hr':'hr'}
TYPES=[('APP_IPHONE_61','iphone-6.3'),('APP_IPAD_PRO_3GEN_129','ipad-13')]
only=sys.argv[1:]
s,j=call("GET",f"/v1/appStoreVersions/{VER}/appStoreVersionLocalizations",params={"limit":50}); locs={d['attributes']['locale']:d['id'] for d in j['data']}
def upload(setid,path):
    data=open(path,'rb').read()
    s,j=call("POST","/v1/appScreenshots",{"data":{"type":"appScreenshots","attributes":{"fileName":os.path.basename(path),"fileSize":len(data)},"relationships":{"appScreenshotSet":{"data":{"type":"appScreenshotSets","id":setid}}}}})
    if s>=300: return f"reserve {s} {str(j)[:200]}"
    sid=j['data']['id']
    for op in j['data']['attributes']['uploadOperations']:
        h={x['name']:x['value'] for x in op['requestHeaders']}
        r=requests.request(op['method'],op['url'],headers=h,data=data[op['offset']:op['offset']+op['length']],timeout=120)
        if r.status_code>=300: return f"put {r.status_code}"
    s,j=call("PATCH",f"/v1/appScreenshots/{sid}",{"data":{"type":"appScreenshots","id":sid,"attributes":{"uploaded":True,"sourceFileChecksum":hashlib.md5(data).hexdigest()}}})
    return "ok" if s<300 else f"commit {s} {str(j)[:200]}"
for loc,folder in MAP.items():
    if only and loc not in only: continue
    lid=locs[loc]
    s,j=call("GET",f"/v1/appStoreVersionLocalizations/{lid}/appScreenshotSets")
    have={d['attributes']['screenshotDisplayType']:d['id'] for d in j['data']}
    for dt,sub in TYPES:
        files=sorted(glob.glob(f"{ROOT}{folder}/{sub}/*.png"))
        if not files: print(loc,dt,"no files"); continue
        if dt in have:
            s,j=call("GET",f"/v1/appScreenshotSets/{have[dt]}/appScreenshots")
            if j.get('data'): print(loc,dt,"already has",len(j['data']),"- skipped"); continue
            setid=have[dt]
        else:
            s,j=call("POST","/v1/appScreenshotSets",{"data":{"type":"appScreenshotSets","attributes":{"screenshotDisplayType":dt},"relationships":{"appStoreVersionLocalization":{"data":{"type":"appStoreVersionLocalizations","id":lid}}}}})
            if s>=300: print(loc,dt,"set",s,str(j)[:200]); continue
            setid=j['data']['id']
        res=[upload(setid,f) for f in files]
        print(loc,dt,res,flush=True)
