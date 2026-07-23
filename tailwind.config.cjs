// Reconstructed from the compiled style.css (built once in April 2026 and
// never regenerated — new markup silently lost its utilities). Keep this in
// the repo so `npm run css` (see package note in README-tailwind below) can
// rebuild style.css whenever markup changes:
//   npx tailwindcss@3.4.19 -c tailwind.config.cjs -i tailwind.input.css -o style.css --minify
// then re-apply the dark blue-slate remap (see scripts/patch-dark-css.py).
module.exports = {
  darkMode: 'class',
  // functions/[[path]].js is scanned too: the SSR intros inject Tailwind
  // classes server-side that never appear in index.html.
  content: ['./index.html', './functions/[[path]].js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff', 100: '#d9ebff', 200: '#bcdaff', 300: '#8ec2ff',
          400: '#59a0ff', 500: '#3378ff', 600: '#1b57f5', 700: '#1543e1',
          800: '#173bb4', 900: '#19338f', 950: '#142157',
        },
        accent: { 500: '#10b981', 600: '#059669' },
      },
    },
  },
};
