"""Samler App Store-skærmbillederne: appens egne skærmbilleder (store/raw) i en enhedsramme på blå baggrund med dansk overskrift.

iPhone 6.9" (1320 x 2868) og iPad 13" (2752 x 2064, liggende) skrives til store/screenshots/.
De rå billeder tages i simulatoren med -debugTab / -debugBreakdown / -debugPeriod (se AppModel.swift og PrisScreen.swift)
og med statuslinjen sat til 9:41 (xcrun simctl status_bar <enhed> override --time 9:41 ...).
Telefonbillederne beskæres, så fanebjælken ikke ligger oven på indholdet.
Kør:  python3 -I store/make_screenshots.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "..", "ElpriserAndroid", "app", "src", "main", "res", "font", "manrope.ttf")
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "screenshots")

LIGHT = ((27, 87, 245), (25, 51, 143))
DARK = ((20, 36, 84), (8, 14, 34))
SUB = (205, 220, 255)

PHONE = [
    ("phone-1-nu", "01_nu", "Elprisen lige nu", "Med dit netselskab, time for time", LIGHT),
    ("phone-2-opdeling", "02_opdeling", "Se hvordan prisen\ner sammensat", "Spotpris, nettarif, afgifter og moms", LIGHT),
    ("phone-3-5dage", "03_fem_doegn", "5 døgn frem", "Faktiske børspriser og en åben prognose", LIGHT),
    ("phone-4-sted", "04_netselskab", "Find dit netselskab", "Søg, brug din position eller vælg selv", LIGHT),
    ("phone-5-smart", "05_smart_hjem", "Planlæg efter de\nbilligste timer", "Varmepumpe, elbil og vandvarmer", LIGHT),
    ("phone-6-moerk", "06_moerk", "Lys og mørk tilstand", "Følger din iPhone", DARK),
]
PAD = [
    ("ipad-1-nu", "01_nu", "Se hvordan prisen er sammensat", "Spotpris, nettarif, afgifter og moms for dit netselskab", LIGHT),
    ("ipad-2-5dage", "02_fem_doegn", "5 døgn frem", "Faktiske børspriser og en åben prognose", LIGHT),
    ("ipad-4-sted", "03_netselskab", "Find dit netselskab", "Søg, brug din position eller vælg selv", LIGHT),
    ("ipad-3-smart", "04_smart_hjem", "Planlæg efter de billigste timer", "Varmepumpe, elbil og vandvarmer", LIGHT),
    ("ipad-5-moerk", "05_moerk", "Lys og mørk tilstand", "Følger din iPad", DARK),
]


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def gradient(w, h, c1, c2):
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x / 63 * 0.35 + y / 63 * 0.65)
            px[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BICUBIC).convert("RGBA")


def fit(text, weight, size, maxw):
    """Mindsker skriftstørrelsen, til den længste linje passer."""
    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    while size > 20:
        f = font(size, weight)
        if max(d.textlength(line, font=f) for line in text.split("\n")) <= maxw:
            return f
        size -= 4
    return font(size, weight)


def device(shot, width, bezel, radius, island, crop):
    """Skærmbilledet i en mørk ramme. `crop` er den andel af højden, der beholdes (fanebjælken skæres væk)."""
    s = Image.open(shot).convert("RGB")
    s = s.crop((0, 0, s.width, round(s.height * crop)))
    k = width / s.width
    s = s.resize((width, round(s.height * k)), Image.LANCZOS)
    out = Image.new("RGBA", (width + 2 * bezel, s.height + 2 * bezel), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([0, 0, out.width - 1, out.height - 1], radius=radius + bezel, fill=(14, 18, 32, 255))
    mask = Image.new("L", s.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s.width - 1, s.height * 2], radius=radius, fill=255)
    out.paste(s, (bezel, bezel), mask)
    if island:
        iw, ih, top = round(width * 0.285), round(width * 0.085), round(width * 0.026)
        x = bezel + (width - iw) // 2
        d.rounded_rectangle([x, bezel + top, x + iw, bezel + top + ih], radius=ih // 2, fill=(0, 0, 0, 255))
    return out


def compose(size, colors, title, sub, dev, top, title_px, sub_px, title_y, sub_y):
    w, h = size
    img = gradient(w, h, *colors)
    d = ImageDraw.Draw(img)
    ft = fit(title, 800, title_px, w - 160)
    fs = fit(sub, 500, sub_px, w - 160)
    d.multiline_text((w // 2, title_y), title, font=ft, fill="white", anchor="ma", align="center", spacing=int(title_px * 0.12))
    d.text((w // 2, sub_y), sub, font=fs, fill=SUB, anchor="ma")
    x = (w - dev.width) // 2
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x, top + 40, x + dev.width, top + dev.height + 40], radius=200, fill=(0, 0, 25, 110))
    img = Image.alpha_composite(img, shadow)
    img.alpha_composite(dev, (x, top))
    return img.crop((0, 0, w, h)).convert("RGB")


def main():
    for sub in ("iphone-6.9", "ipad-13"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
        for f in os.listdir(os.path.join(OUT, sub)):
            os.remove(os.path.join(OUT, sub, f))
    for raw, name, title, sub, colors in PHONE:
        dev = device(os.path.join(RAW, raw + ".png"), 1135, 22, 165, True, 0.90)
        compose((1320, 2868), colors, title, sub, dev, 640, 112, 54, 150, 150 + 112 * (title.count("\n") + 1) + 70 + 20 * title.count("\n")).save(
            os.path.join(OUT, "iphone-6.9", name + ".png"))
    for raw, name, title, sub, colors in PAD:
        dev = device(os.path.join(RAW, raw + ".png"), 2280, 30, 70, False, 1.0)
        compose((2752, 2064), colors, title, sub, dev, 420, 120, 58, 100, 275).save(os.path.join(OUT, "ipad-13", name + ".png"))
    print("ok")


if __name__ == "__main__":
    main()
