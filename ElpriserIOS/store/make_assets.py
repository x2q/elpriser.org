"""Genererer App Store-produktsidens header og søgeresultat-asset (5244 x 2950 px).

Kurven på headeren er dagens rigtige N1-priser fra elpriser.org/api; søgeresultat-
assetet bruger appens egne skærmbilleder (store/screenshots/iphone-6.3).
Alt vigtigt ligger i den midterste del af billedet, fordi App Store beskærer kanterne.
Kør:  python3 -I store/make_assets.py
"""
import json, os, urllib.request
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "..", "ElpriserAndroid", "app", "src", "main", "res", "font", "manrope.ttf")
SHOTS = os.path.join(HERE, "screenshots", "iphone-6.3")
W, H = 5244, 2950
BOLT = [(294, 60), (150, 290), (232, 290), (206, 452), (374, 206), (278, 206), (304, 100)]
C1, C2 = (27, 87, 245), (25, 51, 143)


def gradient(w, h):
    # to-trins lineær gradient uden per-pixel-løkke: lav en lille og skalér op
    small = Image.new("RGB", (64, 36))
    px = small.load()
    for y in range(36):
        for x in range(64):
            t = (x / 63 + y / 35) / 2
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BICUBIC)


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def ramp(t):
    stops = [(0, (52, 199, 89)), (.35, (168, 216, 74)), (.6, (255, 204, 0)), (.85, (255, 149, 0)), (1, (255, 59, 48))]
    t = max(0, min(1, t))
    for i in range(1, len(stops)):
        if t <= stops[i][0]:
            (p0, c0), (p1, c1) = stops[i - 1], stops[i]
            k = (t - p0) / (p1 - p0)
            return tuple(round(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return stops[-1][1]


def prices():
    url = "https://elpriser.org/api/prices?area=DK1&mode=net_inkl_alt&gln=5790001089030"
    req = urllib.request.Request(url, headers={"User-Agent": "ElpriserIOS-assets/1.0"})
    d = json.load(urllib.request.urlopen(req, timeout=20))
    return [p["price"] for p in d["prices"]]


def logo(d, x, y, size):
    d.rounded_rectangle([x, y, x + size, y + size], radius=size // 4, fill="white")
    k = size / 512
    d.polygon([(x + px * k, y + py * k) for px, py in BOLT], fill=C1)


def header():
    img = gradient(W, H).convert("RGBA")
    d = ImageDraw.Draw(img)
    # tekst til venstre i den midterste del
    x = 950
    logo(d, x, 740, 230)
    d.text((x + 230 + 70, 770), "elpriser", font=font(170, 800), fill="white")
    d.text((x, 1090), "Elprisen\ntime for time", font=font(280, 800), fill="white", spacing=30)
    d.text((x, 1960), "Med dit netselskab · 10 døgn frem", font=font(110, 500), fill=(205, 220, 255))
    # kurve med dagens rigtige priser i et hvidt kort til højre
    vals = prices()
    px0, px1, py0, py1 = 3450, 4150, 1050, 1900
    lo, hi = min(vals), max(vals)
    pts = [(px0 + i / 23 * (px1 - px0), py1 - (v - lo) / (hi - lo) * (py1 - py0)) for i, v in enumerate(vals)]
    panel = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle([px0 - 150, py0 - 190, px1 + 150, py1 + 190], radius=140, fill=(255, 255, 255, 238))
    img = Image.alpha_composite(img, panel)
    d = ImageDraw.Draw(img)
    r = 26
    for (xa, ya), (xb, yb), v in zip(pts, pts[1:], vals[1:]):
        c = ramp((v - lo) / (hi - lo))  # højt = rødt, lavt = grønt
        d.line([(xa, ya), (xb, yb)], fill=c, width=50)
        d.ellipse([xb - r, yb - r, xb + r, yb + r], fill=c)
    c0 = ramp((vals[0] - lo) / (hi - lo))
    d.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], fill=c0)
    img.convert("RGB").save(os.path.join(HERE, "header-5244x2950.png"))


def phone(shot, height):
    s = Image.open(os.path.join(SHOTS, shot)).convert("RGB")
    w = round(s.width * height / s.height)
    s = s.resize((w, height), Image.LANCZOS)
    pad = round(height * 0.012)
    out = Image.new("RGBA", (w + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    rad = round(w * 0.12)
    d.rounded_rectangle([0, 0, out.width - 1, out.height - 1], radius=rad + pad, fill=(15, 20, 35, 255))
    mask = Image.new("L", s.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s.width - 1, s.height - 1], radius=rad, fill=255)
    out.paste(s, (pad, pad), mask)
    return out


def search():
    img = gradient(W, H).convert("RGBA")
    d = ImageDraw.Draw(img)
    d.text((W // 2, 520), "Elprisen time for time", font=font(300, 800), fill="white", anchor="mm")
    d.text((W // 2, 800), "Med dit netselskab · 10 døgn frem · til iPhone og iPad", font=font(105, 500), fill=(205, 220, 255), anchor="mm")
    ph = 1700
    shots = ["02_nu.png", "03_prognose.png", "04_time.png"]
    gap = 170
    ims = [phone(s, ph) for s in shots]
    total = sum(i.width for i in ims) + gap * (len(ims) - 1)
    x = (W - total) // 2
    y = 1040
    for im in ims:
        shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle([x, y + 40, x + im.width, y + im.height + 40], radius=220, fill=(0, 0, 20, 90))
        img = Image.alpha_composite(img, shadow)
        img.alpha_composite(im, (x, y))
        x += im.width + gap
    img.convert("RGB").save(os.path.join(HERE, "search-results-5244x2950.png"))


if __name__ == "__main__":
    header()
    search()
    print("ok")
