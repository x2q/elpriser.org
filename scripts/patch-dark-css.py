#!/usr/bin/env python3
"""Re-applies the dark-mode blue-slate remap (commit 93b1ffe) to a freshly
built style.css. Tailwind can't express per-mode palette overrides for the
same token, so the dark: rules are patched post-build:

    npx tailwindcss@3.4.19 -c tailwind.config.cjs -i tailwind.input.css -o style.css --minify
    python3 scripts/patch-dark-css.py style.css
"""
import re, sys

path = sys.argv[1] if len(sys.argv) > 1 else 'style.css'
css = open(path, encoding='utf-8').read()

def patch_rule(m):
    sel, body = m.group(1), m.group(2)
    if 'dark\\:' not in sel:
        return m.group(0)
    b = body
    b = b.replace('rgb(3 7 18/var(--tw-bg-opacity,1))',  '#0d1221')
    b = b.replace('rgb(17 24 39/var(--tw-bg-opacity,1))', '#161d30')
    b = b.replace('rgb(31 41 55/var(--tw-bg-opacity,1))', '#1e2840')
    b = b.replace('rgb(55 65 81/var(--tw-bg-opacity,1))', '#2d3856')
    b = b.replace('rgba(31,41,55,.5)', 'rgba(30,40,64,.5)')
    b = b.replace('rgb(75 85 99/var(--tw-border-opacity,1))', '#404e6e')
    b = b.replace('rgb(55 65 81/var(--tw-border-opacity,1))', '#303c58')
    b = b.replace('rgb(31 41 55/var(--tw-border-opacity,1))', '#242e44')
    return sel + '{' + b + '}'

css = re.sub(r'([^{}]+)\{([^{}]*)\}', patch_rule, css)
open(path, 'w', encoding='utf-8').write(css)
print(f'patched dark rules in {path}')
