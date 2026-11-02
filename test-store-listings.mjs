#!/usr/bin/env node
/**
 * The store listings in docs/store/<lang>.md: the limits of App Store Connect and Google Play Console, and the shape of the files.
 * Run: npm run test:store   (hermetic; part of test:unit and so of the gate)
 *
 * Field limits (characters, as the stores count them):
 *   App Store   name 30, subtitle 30, promotional text 170, keywords 100 (comma separated, no space after a comma), what's new 4000, description 4000
 *   Google Play title 30, short description 80, full description 4000, what's new 500
 * App Store Connect has no metadata language for Bulgarian, Estonian, Latvian, Lithuanian, Slovenian, Serbian, Macedonian and Albanian
 * (to be confirmed in App Store Connect): those files carry `n/a` in the ios.* fields and the iOS storefronts show the English listing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const DIR = path.join(ROOT, 'docs/store');
const langs = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/languages.json'), 'utf8')).languages;

export const LIMITS = {
  'ios.name': 30, 'ios.subtitle': 30, 'ios.promo': 170, 'ios.keywords': 100, 'ios.whatsnew': 4000, 'ios.description': 4000,
  'play.title': 30, 'play.short': 80, 'play.description': 4000, 'play.whatsnew': 500,
};
const NO_APPLE_METADATA = ['bg', 'et', 'lv', 'lt', 'sl', 'sr', 'mk', 'sq'];

export function parseListing(text) {
  const fields = {};
  let key = null;
  for (const line of text.split('\n')) {
    const h = /^### ([a-z]+\.[a-z]+)\s*$/.exec(line);
    if (h) { key = h[1]; fields[key] = []; continue; }
    if (/^#{1,2} /.test(line)) { key = null; continue; }
    if (key) fields[key].push(line);
  }
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.join('\n').trim()]));
}

const count = s => [...s].length;
const files = fs.readdirSync(DIR).filter(f => /^[a-z]{2}\.md$/.test(f));

test('docs/store has a listing for each language that has a text catalogue, and no listing for an unknown language', () => {
  const known = langs.map(l => l.code);
  assert.deepEqual(files.map(f => f.slice(0, 2)).filter(c => !known.includes(c)), []);
  assert.ok(files.includes('en.md') && files.includes('da.md'));
});

for (const f of files) {
  const code = f.slice(0, 2);
  test(`${f}: every field present, within the store limits, no placeholders left`, () => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    const fields = parseListing(text);
    const bad = [];
    for (const [k, max] of Object.entries(LIMITS)) {
      const v = fields[k];
      if (v == null || v === '') { bad.push(`${k}: missing`); continue; }
      if (k.startsWith('ios.') && NO_APPLE_METADATA.includes(code)) { if (v !== 'n/a') bad.push(`${k}: App Store Connect has no ${code} metadata; write n/a`); continue; }
      if (v === 'n/a') { bad.push(`${k}: n/a is only for languages without App Store metadata`); continue; }
      if (count(v) > max) bad.push(`${k}: ${count(v)} characters, the limit is ${max}`);
      if (/TODO|FIXME|XXX|\[\[|lorem/i.test(v)) bad.push(`${k}: unfinished text`);
    }
    for (const k of Object.keys(fields)) if (!(k in LIMITS)) bad.push(`${k}: unknown field`);
    if (fields['ios.keywords'] && fields['ios.keywords'] !== 'n/a') {
      if (/,\s/.test(fields['ios.keywords']) || /\s,/.test(fields['ios.keywords'])) bad.push('ios.keywords: no space around the commas (every character counts)');
      const kw = fields['ios.keywords'].toLowerCase().split(',');
      if (new Set(kw).size !== kw.length) bad.push('ios.keywords: a keyword is listed twice');
    }
    for (const k of ['ios.name', 'ios.subtitle', 'play.title', 'play.short']) if (fields[k] && /\n/.test(fields[k])) bad.push(`${k}: one line only`);
    assert.deepEqual(bad, []);
  });
}
