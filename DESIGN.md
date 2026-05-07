# elpriser.org — Design

Single-page Danish electricity-price tracker. The whole UI ships as one
`index.html` with a small Cloudflare Pages Function for the API (`/api/*`).
This document captures the visual design system: colors, typography, spacing,
components, and the patterns used across pages.

---

## 1. Architecture at a glance

| Layer | What lives there |
|---|---|
| `index.html` | Markup, embedded `<style>`, all client JS, every page (DK1, DK2, automation, prognose, tariffer, blog, om-elpriser) as `<main data-page="…">` blocks |
| `style.css` | Compiled Tailwind utilities (the only CSS file delivered besides the embedded `<style>` block) |
| `functions/[[path]].js` | Pages Function for SEO meta tags + clean-URL handling |
| `functions/api/[[catchall]].js` | All `/api/*` endpoints with two-layer cache (in-memory + Cloudflare Cache API) |

**SPA but crawlable**: routes like `/dk1/n1`, `/blog/forsta-din-elpris`,
`/tariffer` are real URLs, not `#hash` fragments. The Pages Function rewrites
SEO `<title>`/`<meta>` per route; the client derives state from
`location.pathname` on load.

---

## 2. Color tokens

### Brand (Tailwind config compiled into `style.css`)
| Token | Hex | Use |
|---|---|---|
| `brand-200` | `#bcdaff` | subtle text accents in dark mode |
| `brand-400` | `#59a0ff` | primary in dark mode, focus rings |
| `brand-500` | `#3378ff` | links (`text-brand-500 underline`) |
| `brand-600` | `#1b57f5` | **primary** — buttons, nav active |
| `brand-700` | `#1543e1` | hover, gradient mid-stop |
| `brand-900` | `#19338f` | hero gradient bottom |
| `brand-950` | `#142157` | dark-mode hero base |
| `accent-500` | `#10b981` | emerald — success accents in hero, "live" pulse |

### Semantic surface variables (CSS custom properties in `:root`)
```css
--brand:      #1b57f5;   --brand-dark: #1543e1;   --brand-deep: #0e2a8f;
--ink:        #0b1220;   --ink-soft:   #1e293b;
--surface:    #ffffff;   --surface-muted: #f8fafc;
--ring:       0 1px 2px rgba(15,23,42,.04), 0 8px 24px -8px rgba(15,23,42,.08);
--ring-hover: 0 2px 4px rgba(15,23,42,.06), 0 16px 40px -12px rgba(15,23,42,.14);
```
Dark mode overrides `--ink`, `--surface`, `--ring` via `.dark { … }` — never
hard-codes a dark color in component CSS. Components reference the variables
so a single `.dark` class on `<html>` flips the whole UI.

### Heatmap (price table)
9-stop pastel gradient from green (cheap) → red (expensive), interpolated
linearly in RGB based on each cell's price relative to the visible range:
```
0.00 → green-600 pastel (126,205,155)
0.14 → green-400 pastel (155,237,185)
0.28 → lime-300 pastel  (219,248,170)
0.42 → yellow-200 pastel (254,247,190)
0.55 → amber-300 pastel  (253,231,157)
0.67 → orange-300 pastel (254,217,179)
0.78 → orange-500 pastel (252,178,126)
0.88 → red-400 pastel    (251,177,177)
1.00 → red-700 pastel    (217,130,130)
```
Dark-mode dimming mixes 75 % of the pastel with `rgb(3,7,18)` (gray-950).
Foreground is `#000` light / `rgba(255,255,255,0.85)` dark — chosen for
contrast on every stop, no per-cell calc.

---

## 3. Typography

- **Family**: `Inter, system-ui, sans-serif`
  with `font-feature-settings: 'cv02','cv03','cv04','cv11','ss01'`
  (alternative glyphs that look cleaner at small sizes).
- **Tabular numerals** via `.tabular { font-variant-numeric: tabular-nums }`
  used for price tables — keeps decimals aligned across rows.
- **Heading letter-spacing**: `-0.02em` (`.section-title`),
  `-0.035em` on the hero h1 — tight tracking signals "modern editorial".
- **Body weights**: 400 base, 500 for labels, 600 for buttons, 700 for h2,
  900 for hero h1.
- **Sizes** stick to Tailwind defaults: `text-xs`/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl`/`4xl`.
- **Smoothing**: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`.

---

## 4. Spacing & layout

- **Base unit**: 0.25 rem (Tailwind default).
- **Section rhythm**: `py-12` between major sections, `mb-7`/`mt-10` for
  intra-section gaps.
- **Container**: `max-w-2xl` (about-pages, blog), `max-w-3xl` (tables),
  `max-w-4xl` (start page hero + main grid).
- **Hero padding**: `5rem` top/bottom desktop, `3.75rem` on `<640px`.
- **Card padding**: `p-5` or `p-6` depending on density; corner radius
  `1rem` (`rounded-2xl`) for cards, `1.25rem` for the start-page hero card,
  `9999px` for pills/buttons, `0.75rem` (`rounded-xl`) for inputs.

A handful of Tailwind spacing classes were missing from the compiled
stylesheet and are restored manually in the embedded `<style>` block:
`.mt-12`, `.mt-14`, `.mb-5..7`, `.gap-4`, `.py-14`, `.space-y-{5,8,10}`.
A static test guards against silently dropping any of these.

---

## 5. Component vocabulary

All components are defined in the embedded `<style>` block. They follow a
naming convention `.{component}{-modifier}` and rely on CSS variables for
theming. Adding a new component? Pattern: declare base class, then
`.{base}-{primary|soft|ghost}` for emphasis tiers.

### `.zone-btn` — segmented mode buttons (DK1/DK2 cards)
- `.zone-btn-primary` — solid brand gradient, lifted shadow, hover translateY(-1px)
- `.zone-btn-soft` — translucent brand wash, brand text
- `.zone-btn-ghost` — transparent, neutral border

Width fixed at `14rem` so a column of three reads as a segmented control.

### `.card`
White (or `--surface`) background, subtle border (8 % black light,
6 % white dark), 1.25-rem radius, double box-shadow ring (`--ring` →
`--ring-hover` on hover).

### `.net-row` and `.net-chip`
Used inside DK1/DK2 cards to list netselskaber. Row is a flex
space-between with hover-tint; chip is a thin brand-bordered pill that
fills lightly on hover.

### `.nav-pill`
Bottom-of-page secondary navigation. Same surface and shadow treatment as
the card, just more compact and pill-shaped.

### `.gps-bar`
The single hero CTA. Frosted glass effect:
`background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.16);
backdrop-filter: blur(12px)`. Lifts on hover, depresses on active, dims
on `:disabled`.

### `details.faq`
Native disclosure widget styled like a card. `[open]` adds a brand-tinted
border + shadow. Summary hover is a 3 %-opacity brand wash.

### `.cs-{wrap,btn,menu,opt,l,r}` — custom strategy dropdown
Used on the automation page. Native `<option>` cannot render two-column
layouts (label left, use case right), so a custom dropdown was built:
- `<button class="cs-btn">` opens the menu
- `<div class="cs-menu">` is absolutely positioned, `max-height: 60vh`
- `<button class="cs-opt">` rows are flex space-between with `.cs-l`
  (label) on the left and `.cs-r` (muted use-case text) on the right
- A hidden `<input id="autoStrategy">` keeps the existing `.value`
  contract for code that read it as if it were a `<select>`
- Outside-click and Esc close the menu; `aria-expanded` is mirrored
- On `<480px` the row collapses to two stacked lines instead of overflowing

### `.tab-btn`
Pill-shaped toggle for switching between the HA/Shelly export tabs. Outlined
when inactive, solid brand when `.active`.

---

## 6. The hero

A layered mesh-gradient. Three radial gradients (top-left blue, top-right
emerald, bottom-center brand) over a vertical brand gradient, plus:

1. A 22-px dot pattern via `::before` — 4 % white opacity, masked to an
   ellipse so it fades at the edges.
2. Two **floating orbs** (`.hero-orb`) — circular blurred shapes at
   ±60 px from the corners, animated on 14- and 18-second `ease-in-out`
   loops with `float-slow` / `float-slower` keyframes. Opacity ~0.55,
   60-px blur. They give the gradient subtle motion without distracting.

Dark mode swaps the base gradient for a deep-night palette
(`#030712 → #0b1746 → #0e2a8f`) and dials orb opacity down.

---

## 7. Motion

- **Default transition**: `cubic-bezier(.4,0,.2,1)` at 0.15–0.18 s. Used on
  every interactive component (buttons, cards, chips, pills).
- **Hover lift**: `translateY(-1px)` + intensified shadow. Used on
  primary buttons, nav pills, FAQ.
- **Active depress**: `translateY(0)` and reduced shadow.
- **Spinner**: `.spinner` rotates 360° per 0.7 s (used during GPS detect).
- **Pulse**: `pulse` keyframes 0–50–100 → 1, .55, 1 — used on the live-data
  dot in the hero.
- **Float orbs**: 14 s and 18 s ease-in-out loops, ~20 px translate +
  6–8 % scale. Slow enough to feel ambient, not animated.

Any custom animation that runs continuously (`spin`, `pulse`, `float-*`)
must be defined in the embedded `<style>` block — Tailwind utilities only
cover one-shot transitions.

---

## 8. Dark mode

Triggered by toggling `.dark` on `<html>`, with state persisted in
`localStorage('theme')`. `prefers-color-scheme: dark` is honored on first
load if no preference is stored.

The contract for any new component:
1. Use CSS variables (`--surface`, `--ink`) for surfaces and text where
   possible.
2. If you can't, write the component for light first, then add a single
   `.dark .my-component { … }` override for the dark version.
3. Borders on dark mode are typically `rgba(255,255,255,.06–.12)`; on
   light mode `rgba(15,23,42,.08–.14)`.
4. Hover backgrounds use brand-tinted overlays at low opacity (`.04–.13`)
   instead of switching to a lighter grey — keeps the brand accent visible.

---

## 9. Responsiveness

- **Mobile-first**: every component renders correctly down to ~360 px.
- **Breakpoints** (Tailwind defaults): `sm` 640 px, `md` 768 px, `lg` 1024 px.
- **Tables**: price grids use `tabular-nums` and shrink padding on
  `<640px` (`px-0.5` mobile → `sm:px-1.5`). Cells stay tappable (≥24 px).
- **Hero**: pads `3.75 rem` mobile / `5 rem` desktop.
- **Custom dropdown**: stacks rows vertically on `<480 px` to keep the
  use-case text readable.

---

## 10. Accessibility

- `<html lang="da">` — every page is Danish, set this once.
- Each `<main data-page>` contains exactly **one `<h1>`** (verified by
  static test).
- Every `<button>` with `onclick` has readable text content (verified by
  static test) — never just an icon without an `aria-label` or visible label.
- The custom dropdown sets `aria-haspopup="listbox"`, `aria-expanded`, and
  options are `<button>` elements (focusable and keyboard-actionable).
  Esc closes the menu.
- Focus rings use Tailwind's `focus:ring-2 focus:ring-brand-400`. Don't
  remove them.
- Color is never the only signal: ON/OFF cells in the schedule grid have
  text labels; price cells have numeric values; current hour gets a ring,
  not just a background tint.

---

## 11. Iconography

Inline SVG only — no icon font, no external loads. Most icons live as
`<svg class="ico" viewBox="0 0 24 24">` with `stroke="currentColor"`,
`stroke-width: 1.5`, `stroke-linecap: round`, `stroke-linejoin: round`.
This means the icon inherits the surrounding text color and dark/light
mode "just works".

The exception is the chevron in the custom strategy dropdown, which uses
`fill="currentColor"` for a solid arrow.

---

## 12. Heatmap & price detail

- **Cells**: heat-mapped background, tabular numerals, click → modal.
- **Current hour**: ring-inset 2 px, `gray-800/40` light / `white/50` dark —
  *not* a color change so it stays legible regardless of the heatmap stop
  it lands on.
- **Click → `<dialog id="priceDetail">`**: stacked breakdown of the
  components (spot + sys + trans + afgift + tarif), each with the same
  3 %-opacity brand wash row treatment as the FAQ summaries.

---

## 13. Adding a new page

1. Add a `<main data-page="my-route" class="…">…</main>` block to `index.html`.
2. Inside, follow the section pattern:
   - Header row with title + home icon
     (`<a href="/" title="Startside" class="…">` — never `href="#"`)
   - One or more `.card`/`.section-title` blocks
3. If the route should be crawlable, add it to:
   - `_routes.json` `include` array
   - `PATH_ROUTES` map in `index.html` (pathname → hash)
   - `SEO_PAGES` map in `functions/[[path]].js` (title + description + hash)
4. Bottom-of-page nav pills and footer auto-render.

---

## 14. Adding a new strategy (automation page)

1. **Server**: add a `else if (strategy === 'my_strategy')` branch to
   `computeSchedule()` in `functions/api/[[catchall]].js`. Return a 24-element
   `on[]` array.
2. **Client**: add the same branch to `getStrategyHours()` in
   `index.html`. The two implementations must agree.
3. **UI**: add a `<button class="cs-opt" data-value="my_strategy">` to the
   custom dropdown with `<span class="cs-l">` (label) and `<span class="cs-r">`
   (typical use case).
4. **Help text**: add an entry to `STRATEGY_HELP` describing what it does.
5. **Param input**: handle in `onAutoStrategyChange()` — show/hide
   `#autoParamDiv`/`#autoParam2Div`, set default values.
6. **API URL**: extend `buildApiUrl()` to emit the right query string.
7. **Export label**: extend the `labels` object in `generateExports()`.
8. **Regression test**: add a case in `test-regressions.js` verifying the
   schedule shape matches the strategy's contract.

---

## 15. Don'ts

- **Don't re-add a hash redirect** (`location.replace('/#…')`) for SEO
  routes. It clobbered crawlable URLs and is guarded by a regression test.
- **Don't fetch upstream APIs directly from the browser**. Energi Data
  Service and GreenPowerDenmark both return CORS-broken responses when
  an `Origin` header is sent. Route through `/api/raw/*` or
  `/api/supplierlookup`.
- **Don't use `getCurrentPosition`**. macOS CoreLocation often emits
  transient `kCLErrorLocationUnknown` errors that abort the call. Use
  `watchPosition` with an outer timeout instead.
- **Don't use `href="#"`** on home icons. It strips the pathname when
  clicked from a clean URL like `/dk1/n1`. Use `href="/"`.
- **Don't strip dots from street names** in the supplier-lookup
  normaliser. `"P.O." → "PO"` returns 500 from upstream; `"P.O." → "P O"`
  returns 200. Replace with space, never remove.
- **Don't introduce localStorage caching** for `/api/*` data. The server
  is the source of truth — Cloudflare's edge cache + browser HTTP cache
  cover it. The only client-side dedup we keep is `dedupedFetch()` for
  in-flight request coalescing.

Each "don't" above corresponds to a fix already shipped, with a
regression test in `test-regressions.js`. Adding code that violates one
will fail CI.
