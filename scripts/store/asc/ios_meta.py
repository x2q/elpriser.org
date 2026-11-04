import sys,re,os,json; sys.path.insert(0,'.')
from asc import *
DOCS="/Users/cc/elpriser/docs/store/"
LOC={'da':'da','en':'en-GB','de':'de-DE','fr':'fr-FR','nl':'nl-NL','it':'it','pl':'pl','sv':'sv','nb':'no','fi':'fi','cs':'cs','hu':'hu','es':'es-ES','pt':'pt-PT','sk':'sk','el':'el','ro':'ro','hr':'hr'}
VER="e87849cb-8d82-4018-9deb-007f25881267"; INFO="3934422d-2d77-4195-931d-4ebea607cad7"
def fields(lang):
    t=open(DOCS+lang+".md").read(); d={}
    for m in re.finditer(r'### (ios\.\w+)\n(.*?)(?=\n### |\n## |\Z)',t,re.S): d[m.group(1)]=m.group(2).strip()
    return d
def existing(path):
    s,j=call("GET",path,params={"limit":200}); return {d['attributes']['locale']:d['id'] for d in j.get('data',[])}
if __name__=="__main__":
    apply = "--apply" in sys.argv
    langs=[l for l in LOC if os.path.exists(DOCS+l+".md")]
    vl=existing(f"/v1/appStoreVersions/{VER}/appStoreVersionLocalizations"); il=existing(f"/v1/appInfos/{INFO}/appInfoLocalizations")
    print("version locs",vl); print("info locs",il); print("langs",langs)
    for l in langs:
        f=fields(l); loc=LOC[l]
        va={"description":f['ios.description'],"keywords":f['ios.keywords'],"promotionalText":f['ios.promo'],"whatsNew":f['ios.whatsnew']}
        ia={"name":f['ios.name'],"subtitle":f['ios.subtitle'],"privacyPolicyUrl":"https://elpriser.org/"+("privatliv" if l=="da" else "privacy")}   # Danish policy for da, the English one everywhere else
        print(l,loc,{k:len(v) for k,v in {**va,**ia}.items() if k!='privacyPolicyUrl'})
        if not apply: continue
        if loc in vl: r=call("PATCH",f"/v1/appStoreVersionLocalizations/{vl[loc]}",{"data":{"type":"appStoreVersionLocalizations","id":vl[loc],"attributes":va}})
        else: r=call("POST","/v1/appStoreVersionLocalizations",{"data":{"type":"appStoreVersionLocalizations","attributes":{"locale":loc,**va},"relationships":{"appStoreVersion":{"data":{"type":"appStoreVersions","id":VER}}}}})
        print("  version",r[0],'' if r[0]<300 else json.dumps(r[1])[:300])
        if loc in il: r=call("PATCH",f"/v1/appInfoLocalizations/{il[loc]}",{"data":{"type":"appInfoLocalizations","id":il[loc],"attributes":{"name":ia['name'],"subtitle":ia['subtitle']}}})
        else: r=call("POST","/v1/appInfoLocalizations",{"data":{"type":"appInfoLocalizations","attributes":{"locale":loc,**ia},"relationships":{"appInfo":{"data":{"type":"appInfos","id":INFO}}}}})
        print("  info",r[0],'' if r[0]<300 else json.dumps(r[1])[:300])
