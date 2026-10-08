"""Genererer Play-butikkens ikon (512x512) og feature graphic (1024x500).

Grafen på feature graphic er dagens rigtige N1-priser fra elpriser.org/api.
Kør:  python3 -I store/make_assets.py
"""
import json, os, urllib.request
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "app", "src", "main", "res", "font", "manrope.ttf")
BOLT = [(294, 60), (150, 290), (232, 290), (206, 452), (374, 206), (278, 206), (304, 100)]
S = 4  # supersampling


def gradient(w, h, c1=(27, 87, 245), c2=(25, 51, 143)):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / (w - 1) + y / (h - 1)) / 2
            px[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def icon():
    n = 512 * S
    img = gradient(n, n)
    d = ImageDraw.Draw(img)
    d.polygon([(x * S, y * S) for x, y in BOLT], fill="white")
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(HERE, "icon-512.png"))


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
    req = urllib.request.Request(url, headers={"User-Agent": "ElpriserAndroid-assets/1.0"})
    d = json.load(urllib.request.urlopen(req, timeout=20))
    return [p["price"] for p in d["prices"]]


def feature():
    W, H = 1024, 500
    img = gradient(W * S, H * S)
    d = ImageDraw.Draw(img)
    # logo
    lx, ly, ls = 64, 64, 64
    d.rounded_rectangle([lx * S, ly * S, (lx + ls) * S, (ly + ls) * S], radius=16 * S, fill="white")
    k = ls / 512
    d.polygon([((lx + x * k) * S, (ly + y * k) * S) for x, y in BOLT], fill=(27, 87, 245))
    d.text(((lx + ls + 18) * S, (ly + 6) * S), "elpriser", font=font(44 * S, 800), fill="white")
    d.text((64 * S, 190 * S), "Elprisen\ntime for time", font=font(68 * S, 800), fill="white", spacing=6 * S)
    d.text((64 * S, 360 * S), "Med dit netselskab \u00b7 10 d\u00f8gn frem", font=font(26 * S, 500), fill=(205, 220, 255))
    # kurve med dagens rigtige priser
    vals = prices()
    x0, x1, y0, y1 = 560, 980, 130, 390
    lo, hi = min(vals), max(vals)
    pts = [(x0 + i / 23 * (x1 - x0), y1 - (v - lo) / (hi - lo) * (y1 - y0)) for i, v in enumerate(vals)]
    img = img.convert("RGBA")
    panel = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle([(x0 - 24) * S, (y0 - 34) * S, (x1 + 24) * S, (y1 + 34) * S], radius=28 * S, fill=(255, 255, 255, 235))
    img = Image.alpha_composite(img, panel)
    d = ImageDraw.Draw(img)
    r = 5 * S
    for (xa, ya), (xb, yb), v in zip(pts, pts[1:], vals[1:]):
        c = ramp((v - lo) / (hi - lo))  # h\u00f8jt = r\u00f8dt, lavt = gr\u00f8nt
        d.line([(xa * S, ya * S), (xb * S, yb * S)], fill=c, width=10 * S)
        d.ellipse([xb * S - r, yb * S - r, xb * S + r, yb * S + r], fill=c)
    c0 = ramp((vals[0] - lo) / (hi - lo))
    d.ellipse([pts[0][0] * S - r, pts[0][1] * S - r, pts[0][0] * S + r, pts[0][1] * S + r], fill=c0)
    img.convert("RGB").resize((W, H), Image.LANCZOS).save(os.path.join(HERE, "feature-graphic-1024x500.png"))


if __name__ == "__main__":
    icon()
    feature()
    print("ok")
