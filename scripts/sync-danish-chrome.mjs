#!/usr/bin/env node
/**
 * The Danish pages carry their country lists as plain HTML in index.html (so a crawler reads them without running script):
 * the footer's "Andre prisområder" chips and the place dialog (placeHTML('da','dk')). Both are DERIVED from PRIS_COUNTRIES in the
 * Pris block — one link per country, in the table's order, to the country's first page, with its Danish name (`da`) in the footer
 * and its own name in the dialog. This script writes them (and the same two parts of tests/fixtures/chrome-da.html, which pins
 * the Danish chrome byte for byte), so adding a country to PRIS_COUNTRIES never means editing a long line by hand:
 *
 *   node scripts/sync-danish-chrome.mjs          write index.html and the fixture
 *   node scripts/sync-danish-chrome.mjs --check  exit 1 when either is out of date (the gate runs this)
 *
 * After a merge in which two branches each added a country, run it again: it is a function of the table, so there is no
 * conflict to resolve by hand in those lines — take either side and run the script.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(import.meta.dirname, '..');
const idxFile = path.join(ROOT, 'index.html'), fixFile = path.join(ROOT, 'tests/fixtures/chrome-da.html');
let idx = fs.readFileSync(idxFile, 'utf8'), fix = fs.readFileSync(fixFile, 'utf8');

const A = '// ═══ Pris-skærmen (Design A: ét svar) ═══', Z = '// ═══ /Pris-skærmen ═══';
const block = idx.slice(idx.indexOf(A), idx.indexOf(Z) + Z.length);
const ctx = vm.createContext({ console, Date, Math });
vm.runInContext(block + '\nglobalThis.out = { pick: PRIS_PICK, pages: PRIS_COUNTRIES, place: placeHTML("da", "dk"), first: prisPageFor };', ctx);
const { pick, pages, place } = ctx.out;

// The footer chips: Norden, then each country (Denmark is the page's own).
const chips = ['<li><a href="/norden">Norden</a></li>'];
for (const [cc] of pick.slice(1)) {
  const pg = ctx.out.first(cc, 'da');
  chips.push(`<li><a href="/${pg}">${pages[pg].da}</a></li>`);
}
const CH_A = '<p class="sf-h">Andre prisområder</p>\n          <ul class="sf-chips">\n', CH_Z = '\n          </ul>';
const withChips = src => {
  const a = src.indexOf(CH_A);
  if (a < 0) throw new Error('"Andre prisområder" chips not found');
  const s = a + CH_A.length, e = src.indexOf(CH_Z, s);
  return src.slice(0, s) + chips.map(c => '            ' + c).join('\n') + src.slice(e);
};
const withDialog = src => {
  const a = src.indexOf('<dialog id="netDialog"'), b = src.indexOf('</dialog>', a) + '</dialog>'.length;
  if (a < 0) throw new Error('place dialog not found');
  return src.slice(0, a) + place.dialog + src.slice(b);
};

const newIdx = withDialog(withChips(idx));
// The fixture: only the `footer` and `dialog` parts change.
const part = (src, n) => {
  const m = `<!--@@${n}@@-->\n`, a = src.indexOf(m);
  if (a < 0) throw new Error('fixture part ' + n);
  const s = a + m.length, e = src.indexOf('\n<!--@@', s);
  return [s, e < 0 ? src.length : e];
};
let newFix = fix;
for (const [n, fn] of [['footer', withChips], ['dialog', withDialog]]) {
  const [s, e] = part(newFix, n);
  const trail = newFix.slice(s, e).endsWith('\n') ? '\n' : '';
  newFix = newFix.slice(0, s) + fn(newFix.slice(s, e).replace(/\n$/, '')) + trail + newFix.slice(e);
}

if (process.argv.includes('--check')) {
  const bad = [newIdx !== idx && 'index.html', newFix !== fix && 'tests/fixtures/chrome-da.html'].filter(Boolean);
  if (bad.length) { console.error('out of date: ' + bad.join(', ') + ' — run: node scripts/sync-danish-chrome.mjs'); process.exit(1); }
  console.log('the Danish country lists are in step with PRIS_COUNTRIES');
} else {
  fs.writeFileSync(idxFile, newIdx); fs.writeFileSync(fixFile, newFix);
  console.log(`index.html and the fixture: ${chips.length} footer chips, dialog of ${place.dialog.length} characters`);
}
