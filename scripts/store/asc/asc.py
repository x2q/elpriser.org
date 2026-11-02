import time, json, jwt, requests
KEY="/Users/cc/Downloads/AuthKey_7Q7CCA98A2.p8"; KID="7Q7CCA98A2"; ISS="685df2d2-5a08-48e9-a7c9-cfc80900f5ae"
APP="6820474476"; BASE="https://api.appstoreconnect.apple.com"
def tok():
    return jwt.encode({"iss":ISS,"iat":int(time.time()),"exp":int(time.time())+900,"aud":"appstoreconnect-v1"},open(KEY).read(),algorithm="ES256",headers={"kid":KID})
def call(method,path,body=None,params=None):
    r=requests.request(method,path if path.startswith("http") else BASE+path,headers={"Authorization":"Bearer "+tok(),"Content-Type":"application/json"},json=body,params=params,timeout=60)
    try: j=r.json()
    except Exception: j={"raw":r.text}
    return r.status_code,j
