#!/usr/bin/env python3
"""Rebuild download/img/*.webp, the app screenshots on /download and on the other languages' download pages.

Danish page (/download). Sources are the real store renders (not the framed marketing images): the unframed iPhone/iPad
screens in ElpriserIOS/store/raw and the Android phone/tablet screens in ElpriserAndroid/store/screenshots. Each is resized
with Lanczos to a 1x and a 2x width (phone 360/720, tablet 640/1280), flattened (the screens are opaque) and written as WebP
q88 (cwebp, sharp YUV, so UI text stays crisp). Needs ImageMagick (`magick`) and `cwebp`.

    python3 scripts/make-download-images.py [quality]

The other 25 languages (/<lang>/download) use screens captured in each language: the raw captures of
ElpriserIOS/store/make_screenshots.py and ElpriserAndroid/store/make_assets.py, one folder per language
(<dir>/<lang>/phone-1-pris.png ... for iOS, <dir>/<lang>/phone-price.png ... for Android).

    python3 scripts/make-download-images.py localized [--ios DIR] [--android DIR] [--quality 88]

writes download/img/<lang>/<slot>-<w>.webp and functions/_download_img.js, the manifest the page template reads
(docs/localized-download.md). The raw captures are not kept in the repository (ElpriserIOS/store/.gitignore, ElpriserAndroid/store/.gitignore),
so this is run when a screenshot set is retaken; the WebP files are what is committed.

The pages reference the files by name; test-static.js and test-download-i18n.mjs pin sizes (< 120 KB each), width/height
attributes and that nothing but WebP lives in download/img.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IOS = os.path.join(ROOT, 'ElpriserIOS/store/raw/')
AND = os.path.join(ROOT, 'ElpriserAndroid/store/screenshots/')
OUT = os.path.join(ROOT, 'download/img/')
Q = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1][0].isdigit() else '88'

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


def webp(src, width, out, q):
    png = os.path.join(tempfile.mkdtemp(), 'o.png')
    subprocess.run(['magick', src, '-alpha', 'off', '-filter', 'Lanczos', '-resize', f'{width}x', '-strip', png], check=True)
    subprocess.run(['cwebp', '-quiet', '-q', q, '-m', '6', '-sharp_yuv', png, '-o', out], check=True)
    return os.path.getsize(out)


def danish():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for src, name, widths in JOBS:
        for w in widths:
            size = webp(src, w, f'{OUT}{name}-{w}.webp', Q)
            total += size
            print(f'{size // 1024:4d} KB  {name}-{w}.webp')
    print('total', total // 1024, 'KB')


# ── The other languages ──────────────────────────────────────────────────────────────────────────────────────────────
# Six slots per language. A language without an iPhone capture (the iOS app set has 18 languages) shows its own Android
# screens in the phone slots; a language without an iPad capture shows the English iPad. `dev` is the frame the page draws.
LOC_LANGS = ['en', 'de', 'fr', 'nl', 'it', 'pl', 'sv', 'nb', 'fi', 'cs', 'hu', 'sl', 'es', 'pt', 'sk', 'el', 'ro', 'bg', 'hr', 'sr', 'et', 'lv', 'lt', 'mk', 'sq']


def dims(path):
    out = subprocess.run(['magick', 'identify', '-format', '%w %h', path], capture_output=True, text=True, check=True).stdout.split()
    return int(out[0]), int(out[1])


def localized(ios_dir, and_dir, q):
    manifest, total, files, m_en = {}, 0, 0, None
    for lang in LOC_LANGS:
        def I(n):
            return os.path.join(ios_dir, lang, n)

        def A(n):
            return os.path.join(and_dir, lang, n)
        has_ios = os.path.exists(I('phone-1-pris.png'))
        slots = {
            'hero1': (I('phone-1-pris.png'), 'ios', PHONE) if has_ios else (A('phone-price.png'), 'and', PHONE),
            'hero2': (A('phone-price.png'), 'and', PHONE) if has_ios else (A('phone-dark.png'), 'and', PHONE),
            'country': (I('phone-2-land.png'), 'ios', PHONE) if has_ios else (A('phone-country.png'), 'and', PHONE),
            'smart': (I('phone-4-smart.png'), 'ios', PHONE) if has_ios else (A('phone-smart.png'), 'and', PHONE),
            'ipad': (I('pad-1-pris.png'), 'ios', TABLET) if os.path.exists(I('pad-1-pris.png')) else None,
            'tablet': (A('tablet-10-price.png'), 'and', TABLET),
        }
        m = {}
        for slot, spec in slots.items():
            if spec is None:   # no iPad capture in this language: the English one (the 'en' set is built first)
                m[slot] = dict(m_en['ipad'])
                continue
            src, dev, widths = spec
            w0, h0 = dims(src)
            m[slot] = {'dir': lang, 'dev': dev, 'w': widths[0], 'h': round(widths[0] * h0 / w0), 'big': widths[1]}
            os.makedirs(os.path.join(OUT, lang), exist_ok=True)
            for w in widths:
                out = os.path.join(OUT, lang, f'{slot}-{w}.webp')
                size = webp(src, w, out, q)
                if size > 110 * 1024:   # every file stays under the 120 KB the tests allow
                    size = webp(src, w, out, '80')
                total += size
                files += 1
        manifest[lang] = m
        if lang == 'en':
            m_en = m
        print(lang, 'iPhone' if has_ios else 'Android in the phone slots', '| iPad', 'own' if m['ipad']['dir'] == lang else 'English')
    lines = ['// GENERATED by `python3 scripts/make-download-images.py localized` (docs/localized-download.md): which screenshot each slot of',
             '// /<lang>/download shows. dir = folder under /download/img, dev = the frame the page draws (ios: with the Dynamic Island),',
             '// w and h = the 1x size, big = the 2x width. A slot whose dir is not its language is the English fallback. Do not edit by hand.',
             'export const DL_IMG = ' + json.dumps(manifest, indent=1) + ';', '']
    open(os.path.join(ROOT, 'functions/_download_img.js'), 'w').write('\n'.join(lines))
    print(f'{files} files, {total // 1024} KB ({total / 1048576:.1f} MB)')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == 'localized':
        def opt(n, d):
            return args[args.index(n) + 1] if n in args else d
        localized(opt('--ios', os.path.join(ROOT, 'ElpriserIOS/store/raw')), opt('--android', os.path.join(ROOT, 'ElpriserAndroid/store/raw')),
                  opt('--quality', '88'))
    else:
        danish()
