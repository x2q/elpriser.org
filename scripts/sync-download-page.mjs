#!/usr/bin/env node
/**
 * The Danish app page is the <main data-page="download"> of index.html, plain HTML (the router shows it without a round trip and a
 * crawler reads it without script). It is DERIVED from the one template in functions/_download.js and the Danish entry of the
 * translations table (functions/_download_i18n.js), the same template and table that draw the other 25 languages in the Function, so that
 * a status (Mac, Apple Watch, reminders, widget) or a count (26 languages, 30 countries) is changed in ONE place:
 *
 *   node scripts/sync-download-page.mjs          write index.html
 *   node scripts/sync-download-page.mjs --check  exit 1 when index.html is out of date (the gate runs this)
 *
 * After a merge in which two branches each touched the page, run it again: it is a function of the two files, so there is no conflict to
 * resolve by hand inside the <main>: take either side and run the script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(import.meta.dirname, '..');
const file = path.join(ROOT, 'index.html');
const idx = fs.readFileSync(file, 'utf8');
const { downloadMain } = await import(pathToFileURL(path.join(ROOT, 'functions/_download.js')).href);

const OPEN = '<main style="display:none" data-page="download" class="dl-page">';
const a = idx.indexOf(OPEN);
const b = idx.indexOf('</main>', a) + '</main>'.length;
if (a < 0 || b < a) throw new Error('the download <main> was not found in index.html');
const next = idx.slice(0, a) + downloadMain('da') + idx.slice(b);
if (next === idx) { console.log('index.html already carries the current Danish app page'); process.exit(0); }
if (process.argv.includes('--check')) {
  console.error('index.html\'s <main data-page="download"> is out of date with functions/_download.js — run: node scripts/sync-download-page.mjs');
  process.exit(1);
}
fs.writeFileSync(file, next);
console.log(`index.html: the Danish app page rewritten (${b - a} -> ${downloadMain('da').length} characters)`);
