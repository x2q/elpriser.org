#!/usr/bin/env node
/**
 * The shared catalogue of the apps' texts (i18n/): keys, languages, translations and the files generated from them.
 * Run: npm run test:i18n   (hermetic; part of test:unit and so of the gate)
 *
 * What this guards:
 *  - the catalogue is consistent: keys.json, da.json and en.json have the same keys, no language file has a key the set lacks,
 *    placeholders agree with the Danish text in every language, plural forms are the ones the language needs;
 *  - the first ten languages (tier 1) are COMPLETE — a missing translation fails the gate. Tier 2 and 3 languages may be
 *    partial; a partial language is not shipped (see scripts/i18n/build.mjs) and is listed in the output;
 *  - every file generated from the catalogue (Android strings.xml per language, locale_config.xml, the Gradle language filter,
 *    iOS Localizable.xcstrings and InfoPlist.xcstrings) is up to date, so nobody edits a generated file by hand;
 *  - the iOS catalogue is well formed: no Android-style placeholder left, plural variations, arrays expanded, the location text;
 *  - Serbian Latin is derived from Serbian Cyrillic (the table is correct on words that have digraphs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalogue, shipped, isComplete, missingKeys, expectedFiles, staleAndroidDirs, serbianLatin, iosFiles, iosFormat, androidEscape, ROOT } from './scripts/i18n/build.mjs';

const cat = loadCatalogue();
const byCode = Object.fromEntries(cat.langs.map(l => [l.code, l]));
const placeholders = s => [...String(s).matchAll(/%(\d+)\$([sd])/g)].map(m => `%${m[1]}$${m[2]}`).sort();
/** Every text of a value as [id, text] so strings, plural forms and array items are checked alike. */
function texts(key, v) {
  if (typeof v === 'string') return [[key, v]];
  if (Array.isArray(v)) return v.map((x, i) => [`${key}[${i}]`, x]);
  return Object.entries(v).map(([q, x]) => [`${key}[${q}]`, x]);
}

test('keys.json lists each key once, and da.json / en.json have exactly those keys', () => {
  const keys = cat.keys.map(k => k.key);
  assert.equal(new Set(keys).size, keys.length, 'a key is listed twice in keys.json');
  for (const code of [cat.source, cat.fallback]) {
    assert.deepEqual(Object.keys(cat.strings[code]).sort(), [...keys].sort(), `${code}.json and keys.json disagree`);
  }
  for (const [code, t] of Object.entries(cat.strings)) {
    const extra = Object.keys(t).filter(k => !keys.includes(k));
    assert.deepEqual(extra, [], `${code}.json has keys keys.json does not know`);
  }
  for (const l of cat.langs) assert.ok(l.tier >= 1 && l.tier <= 3 && Array.isArray(l.plural), `language ${l.code} is malformed in languages.json`);
});

test('every language file is a language of languages.json', () => {
  const files = fs.readdirSync(path.join(ROOT, 'i18n/strings')).map(f => f.replace(/\.json$/, ''));
  assert.deepEqual(files.filter(f => !byCode[f]), [], 'a strings file has no entry in languages.json');
});

for (const l of cat.langs) {
  if (!cat.strings[l.code]) continue;
  test(`${l.code}: same kind of value as Danish, same placeholders, positional, no empty text`, () => {
    const da = cat.strings[cat.source], t = cat.strings[l.code], bad = [];
    for (const k of cat.keys) {
      const v = t[k.key];
      if (v == null) continue; // a missing key is the completeness test's business
      const src = da[k.key];
      const kind = x => (Array.isArray(x) ? 'array' : typeof x === 'object' ? 'plurals' : 'string');
      if (kind(v) !== kind(src)) { bad.push(`${k.key}: a ${kind(v)}, Danish is a ${kind(src)}`); continue; }
      if (kind(src) === 'array' && v.length !== src.length) bad.push(`${k.key}: ${v.length} items, Danish has ${src.length}`);
      const srcTexts = texts(k.key, src);
      for (const [id, text] of texts(k.key, v)) {
        if (typeof text !== 'string' || text.trim() === '') { bad.push(`${id}: empty`); continue; }
        if (text !== text.trim()) bad.push(`${id}: leading or trailing whitespace`);
        const noPct = text.replace(/%%/g, '');
        if (/%(?!\d+\$[sd])/.test(noPct)) bad.push(`${id}: a lone % or a non-positional placeholder (write %% for a percent sign): ${text}`);
        // The reference for a plural form or array item is the Danish text of the same slot (plural forms: the 'other' form).
        const ref = kind(src) === 'string' ? src : kind(src) === 'array' ? src[Number(id.match(/\[(\d+)\]$/)[1])] : src.other;
        if (placeholders(text).join(' ') !== placeholders(ref).join(' ')) {
          // a plural form may legitimately drop the number ("one": "ein Gerät") — only the other forms must carry every placeholder of Danish's 'other'
          if (!(kind(src) === 'plurals' && /\[(one|two|zero)\]$/.test(id) && placeholders(text).every(p => placeholders(ref).includes(p)))) bad.push(`${id}: placeholders [${placeholders(text)}] but Danish has [${placeholders(ref)}]: ${text}`);
        }
      }
      void srcTexts;
    }
    assert.deepEqual(bad, []);
  });
}

test('tier 1 languages (da en de fr nl it pl sv nb fi) are complete', { skip: !cat.enforceTier1 && 'enforceTier1 is false in languages.json while the translations are being written' }, () => {
  const missing = cat.langs.filter(l => l.tier === 1).map(l => [l.code, cat.strings[l.code] ? missingKeys(cat, l) : ['(no file)']]).filter(([, m]) => m.length);
  assert.deepEqual(missing, [], 'tier 1 languages must be complete: ' + missing.map(([c, m]) => `${c}: ${m.slice(0, 8).join(', ')}${m.length > 8 ? ' …' : ''}`).join(' | '));
});

test('plural forms: a plural has exactly the categories its language needs (many is filled for fractions-only languages)', () => {
  const bad = [];
  for (const l of cat.langs) {
    const t = cat.strings[l.code];
    if (!t) continue;
    for (const k of cat.keys) {
      const v = t[k.key];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const missing = l.plural.filter(c => !v[c]);
      const extra = Object.keys(v).filter(c => !l.plural.includes(c) && !(c === 'many' && l.fillMany));
      if (missing.length || extra.length) bad.push(`${l.code}.${k.key}: missing [${missing}] extra [${extra}]`);
    }
  }
  assert.deepEqual(bad, []);
});

test('shipped languages: tier 1 always (English fills a missing key), tier 2 and 3 only when complete (a partial language never leaks into a build)', () => {
  const ship = shipped(cat).map(l => l.code);
  for (const l of cat.langs) {
    const should = l.ship !== false && !!cat.strings[l.code] && (l.tier === 1 || isComplete(cat, l) || !!l.allowPartial);
    assert.equal(ship.includes(l.code), should, l.code);
  }
  assert.ok(ship.includes('da') && ship.includes('en'));
});

test('the generated Android and iOS files are up to date (do not edit them by hand: node scripts/i18n/build.mjs)', () => {
  const stale = [];
  for (const [f, c] of expectedFiles(cat)) if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c) stale.push(path.relative(ROOT, f));
  assert.deepEqual([...stale, ...staleAndroidDirs(cat).map(d => `res/${d} (not generated any more)`)], []);
});

test('Android escaping: apostrophes, quotes, ampersands, leading @ and ?, newlines', () => {
  assert.equal(androidEscape("l'heure"), "l\\'heure");
  assert.equal(androidEscape('a "b"'), 'a \\"b\\"');
  assert.equal(androidEscape('R&D <x>'), 'R&amp;D &lt;x&gt;');
  assert.equal(androidEscape('?hi'), '\\?hi');
  assert.equal(androidEscape('a\nb'), 'a\\nb');
});

test('iOS placeholders: %1$s -> %1$@, %2$d -> %2$lld, %% unchanged', () => {
  assert.equal(iosFormat('%1$s at %2$d %%'), '%1$@ at %2$lld %%');
});

test('iOS catalogue: source language en, every iOS key in every shipped language, plurals as variations, arrays expanded, no Android placeholder left', () => {
  const files = iosFiles(cat);
  const loc = JSON.parse(files.get('Localizable.xcstrings'));
  const info = JSON.parse(files.get('InfoPlist.xcstrings'));
  assert.equal(loc.sourceLanguage, 'en');
  const codes = JSON.parse(files.get('localizations.json')).languages;
  assert.ok(codes.includes('da') && codes.includes('en') && codes.includes('nn'), 'da, en and the nn alias must be listed');
  const iosKeys = cat.keys.filter(k => k.platforms.includes('ios') && k.key !== 'location_usage');
  const da = cat.strings.da;
  for (const k of iosKeys) {
    const names = Array.isArray(da[k.key]) ? da[k.key].map((_, i) => `${k.key}_${i}`) : [k.key];
    for (const n of names) {
      const e = loc.strings[n];
      assert.ok(e, `Localizable.xcstrings lacks ${n}`);
      for (const c of codes) {
        const l = e.localizations[c];
        assert.ok(l, `${n} has no ${c} localisation`);
        if (typeof da[k.key] === 'object' && !Array.isArray(da[k.key])) assert.ok(l.variations && l.variations.plural && l.variations.plural.other, `${n}/${c}: plural variations`);
        else assert.ok(l.stringUnit && l.stringUnit.value, `${n}/${c}: stringUnit`);
      }
    }
  }
  const values = JSON.stringify(Object.values(loc.strings).map(e => e.localizations));
  assert.ok(!/%\d+\$[sd]/.test(values), 'an Android-style placeholder is left in the iOS catalogue');
  assert.ok(info.strings.NSLocationWhenInUseUsageDescription.localizations.da.stringUnit.value.includes('Brug min position'));
  assert.ok(Object.keys(loc.strings).every(n => !n.startsWith('location_usage')));
});

test('Serbian Latin is derived from Cyrillic: digraphs, capitals, placeholders pass through', () => {
  assert.equal(serbianLatin('Љубав и њива'), 'Ljubav i njiva');
  assert.equal(serbianLatin('Џем, ђак, ћуфта, чај, шума, жена'), 'Džem, đak, ćufta, čaj, šuma, žena');
  assert.equal(serbianLatin('Нађи %1$s у %2$d сати.'), 'Nađi %1$s u %2$d sati.');
  assert.equal(serbianLatin('ЉУБАВ'), 'LjUBAV', 'a capital digraph keeps the title-case form (Lj), which is fine for UI text');
});

test('status: which languages are complete, partial or planned (informational)', () => {
  const lines = cat.langs.map(l => `${l.code}:${!cat.strings[l.code] ? 'planned' : isComplete(cat, l) ? 'complete' : 'PARTIAL'}`);
  console.log('  ' + lines.join('  '));
});
