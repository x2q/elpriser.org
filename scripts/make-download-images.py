#!/usr/bin/env python3
"""Rebuild download/img/*.webp, the app screenshots on /download.

Sources are the real store renders (not the framed marketing images): the unframed iPhone/iPad screens in
ElpriserIOS/store/raw and the Android phone/tablet screens in ElpriserAndroid/store/screenshots. Each is resized
with Lanczos to a 1x and a 2x width (phone 360/720, tablet 640/1280), flattened (the screens are opaque) and
written as WebP q88 (cwebp, sharp YUV, so UI text stays crisp). Needs ImageMagick (`magick`) and `cwebp`.

    python3 scripts/make-download-images.py [quality]

The page references the files by name in index.html (<main data-page="download">); test-static.js pins sizes
(< 120 KB each, < 400 KB hard limit), width/height attributes and that nothing but WebP lives in download/img.
"""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IOS = os.path.join(ROOT, 'ElpriserIOS/store/raw/')
AND = os.path.join(ROOT, 'ElpriserAndroid/store/screenshots/')
OUT = os.path.join(ROOT, 'download/img/')
Q = sys.argv[1] if len(sys.argv) > 1 else '88'

PHONE, TABLET = (360, 720), (640, 1280)
JOBS = [
    (IOS + 'phone-1-nu.png', 'iphone-nu', PHONE),
    (IOS + 'phone-6-moerk.png', 'iphone-moerk', PHONE),
    (IOS + 'phone-2-opdeling.png', 'iphone-opdeling', PHONE),
    (IOS + 'phone-3-5dage.png', 'iphone-5dage', PHONE),
    (IOS + 'phone-4-sted.png', 'iphone-netselskab', PHONE),
    (IOS + 'phone-5-smart.png', 'iphone-smart-hjem', PHONE),
    (AND + 'phone/01_welcome.png', 'android-velkommen', PHONE),
    (AND + 'phone/02_nu.png', 'android-nu', PHONE),
    (AND + 'phone/07_dark.png', 'android-moerk', PHONE),
    (IOS + 'ipad-1-nu.png', 'ipad-nu', TABLET),
    (AND + 'tablet-10/01_nu.png', 'android-tablet-nu', TABLET),
]

os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()
total = 0
for src, name, widths in JOBS:
    for w in widths:
        png = os.path.join(tmp, 'o.png')
        subprocess.run(['magick', src, '-alpha', 'off', '-filter', 'Lanczos', '-resize', f'{w}x', '-strip', png], check=True)
        out = f'{OUT}{name}-{w}.webp'
        subprocess.run(['cwebp', '-quiet', '-q', Q, '-m', '6', '-sharp_yuv', png, '-o', out], check=True)
        total += os.path.getsize(out)
        print(f'{os.path.getsize(out) // 1024:4d} KB  {name}-{w}.webp')
print('total', total // 1024, 'KB')
