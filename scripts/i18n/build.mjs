#!/usr/bin/env node
/**
 * Builds the apps' localisation files from the one shared catalogue in i18n/.
 *
 *   i18n/keys.json            the key set: groups, order, notes for translators, which platform needs a key
 *   i18n/languages.json       the languages (tier, plural categories)
 *   i18n/strings/<lang>.json  the texts of one language (da is the source, en the fallback)
 *
 * Outputs (all committed; `--check` fails when one is stale, which test-i18n.mjs runs in the gate):
 *   Android  ElpriserAndroid/app/src/main/res/values/strings.xml            English (the fallback for any other language)
 *            .../values-<lang>/strings.xml                                  one per shipped language (+ nn/no copies of nb, sr-Latn from sr)
 *            .../xml/locale_config.xml                                      the per-app language picker
 *            ElpriserAndroid/app/build.gradle.kts                           the resourceConfigurations line
 *   iOS      ElpriserIOS/Resources/Localizable.xcstrings                    source language en, every shipped language
 *            ElpriserIOS/Resources/InfoPlist.xcstrings                      the permission text (and the display name)
 *            ElpriserIOS/Resources/localizations.json                       the list of shipped iOS language codes (read by project.yml's CFBundleLocalizations check)
 *
 * Usage: node scripts/i18n/build.mjs [--check] [--status]
 *
 * A text is written in Android's positional style in the catalogue (%1$s, %2$d, %% for a percent sign). The iOS side gets
 * %1$@ and %2$lld. Arrays (weekday and month names) become key_0 … key_N on iOS.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
const I18N = path.join(ROOT, 'i18n');
const RES = path.join(ROOT, 'ElpriserAndroid/app/src/main/res');
const IOS_RES = path.join(ROOT, 'ElpriserIOS/Resources');
const GRADLE = path.join(ROOT, 'ElpriserAndroid/app/build.gradle.kts');

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/* ── Reading the catalogue ────────────────────────────────────────────────────────────── */

export function loadCatalogue() {
  const keysFile = readJson(path.join(I18N, 'keys.json'));
  const langsFile = readJson(path.join(I18N, 'languages.json'));
  const keys = [];
  for (const g of keysFile.groups) for (const k of g.keys) keys.push({ ...k, group: g.title, platforms: k.platforms || ['android', 'ios'] });
  const langs = langsFile.languages;
  const strings = {};
  for (const l of langs) {
    const f = path.join(I18N, 'strings', l.code + '.json');
    if (fs.existsSync(f)) strings[l.code] = readJson(f);
  }
  return { keys, langs, strings, source: langsFile.source, fallback: langsFile.fallback, enforceTier1: !!langsFile.enforceTier1 };
}

/** CLDR 'many' only covers fractions for these languages, so an integer-only app copies 'other' into it. */
function withMany(lang, forms) {
  if (!lang.fillMany || !forms || forms.many != null) return forms;
  return { ...forms, many: forms.other };
}

/** What a language lacks, by key (a plural needs all its categories, an array all its items). */
export function missingKeys(cat, lang) {
  const t = cat.strings[lang.code];
  const out = [];
  const da = cat.strings[cat.source];
  for (const k of cat.keys) {
    const src = da[k.key];
    const v = t && t[k.key];
    if (v == null) { out.push(k.key); continue; }
    if (Array.isArray(src)) { if (!Array.isArray(v) || v.length !== src.length || v.some(x => !x)) out.push(k.key); }
    else if (typeof src === 'object') {
      const forms = withMany(lang, v) || {};
      if (typeof v !== 'object' || lang.plural.some(c => !forms[c])) out.push(k.key);
    } else if (typeof v !== 'string' || !v) out.push(k.key);
  }
  return out;
}

export function isComplete(cat, lang) { return !!cat.strings[lang.code] && missingKeys(cat, lang).length === 0; }

/**
 * The languages that ship: a catalogue file exists and 'ship' is not false, and the language is tier 1 (the build then falls back to English
 * for a key it lacks, as Android does at run time, until the translators have caught up; test-i18n.mjs fails the gate while one is missing),
 * or it is complete, or it says allowPartial. A partial tier 2/3 language is left out of the build.
 */
export function shipped(cat) {
  return cat.langs.filter(l => l.ship !== false && cat.strings[l.code] && (l.tier === 1 || isComplete(cat, l) || l.allowPartial));
}

/** A language's texts with every missing key filled from English (plural categories the language needs but English lacks get English 'other'). */
export function filledTexts(cat, lang) {
  const t = cat.strings[lang.code], en = cat.strings[cat.fallback], out = {};
  for (const k of cat.keys) {
    let v = t[k.key];
    if (v == null || (Array.isArray(en[k.key]) && (!Array.isArray(v) || v.length !== en[k.key].length))) v = en[k.key];
    else if (typeof en[k.key] === 'object' && !Array.isArray(en[k.key])) {
      const forms = { ...v };
      for (const c of lang.plural) if (!forms[c]) forms[c] = en[k.key][c] || en[k.key].other;
      v = forms;
    }
    out[k.key] = v;
  }
  return out;
}

/* ── Serbian: Cyrillic is the source, Latin is derived ────────────────────────────────── */

const CYR = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z', И: 'I', Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj',
  О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'Č', Џ: 'Dž', Ш: 'Š',
};
for (const [c, l] of Object.entries({ ...CYR })) CYR[c.toLowerCase()] = l === 'Lj' ? 'lj' : l === 'Nj' ? 'nj' : l === 'Dž' ? 'dž' : l.toLowerCase();
/** Serbian Cyrillic -> Latin. Characters outside the Cyrillic table (placeholders, digits, punctuation) pass through. */
export function serbianLatin(s) { return [...s].map(c => CYR[c] ?? c).join(''); }
const mapDeep = (v, f) => typeof v === 'string' ? f(v) : Array.isArray(v) ? v.map(x => mapDeep(x, f)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapDeep(x, f)]));

/** The (code, texts) pairs a platform writes: every shipped language plus the derived Latin Serbian and the nb aliases. */
function outputLanguages(cat) {
  const out = [];
  for (const l of shipped(cat)) {
    const t = filledTexts(cat, l);
    out.push({ code: l.code, lang: l, texts: t });
    if (l.latin) out.push({ code: l.latin, lang: l, texts: mapDeep(t, serbianLatin), derived: true });
    for (const a of l.aliases || []) out.push({ code: a, lang: l, texts: t, alias: true });
  }
  return out;
}

/* ── Android ──────────────────────────────────────────────────────────────────────────── */

const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function androidEscape(s) {
  let o = xmlEsc(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  if (/^[@?]/.test(o)) o = '\\' + o;
  return o;
}

export function androidFolder(code) {
  if (code === 'sr-Latn') return 'values-b+sr+Latn';
  return `values-${code}`;
}

function androidXml(cat, texts, lang, isDefault) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>',
    '<!-- GENERATED by scripts/i18n/build.mjs from i18n/ — do not edit by hand. -->',
    '<resources>'];
  if (isDefault) {
    lines.push('    <string name="app_name" translatable="false">Elpriser</string>',
      '    <string name="link_site" translatable="false">elpriser.org</string>');
  }
  let group = null;
  for (const k of cat.keys) {
    if (!k.platforms.includes('android')) continue;
    const v = texts[k.key];
    if (v == null) continue;
    if (k.group !== group) { lines.push('', `    <!-- ${k.group} -->`); group = k.group; }
    if (Array.isArray(v)) {
      lines.push(`    <string-array name="${k.key}">`, ...v.map(x => `        <item>${androidEscape(x)}</item>`), '    </string-array>');
    } else if (typeof v === 'object') {
      const forms = withMany(lang, v);
      lines.push(`    <plurals name="${k.key}">`);
      for (const c of ['zero', 'one', 'two', 'few', 'many', 'other']) if (forms[c] != null) lines.push(`        <item quantity="${c}">${androidEscape(forms[c])}</item>`);
      lines.push('    </plurals>');
    } else lines.push(`    <string name="${k.key}">${androidEscape(v)}</string>`);
  }
  lines.push('</resources>', '');
  return lines.join('\n');
}

export function androidFiles(cat) {
  const files = new Map();
  const en = cat.langs.find(l => l.code === cat.fallback);
  files.set('values/strings.xml', androidXml(cat, cat.strings[cat.fallback], en, true));
  const langs = outputLanguages(cat).filter(o => o.code !== cat.fallback);
  for (const o of langs) files.set(`${androidFolder(o.code)}/strings.xml`, androidXml(cat, o.texts, o.lang, false));
  // The per-app language picker: the shipped languages (not the nn/no aliases, which only exist so Nynorsk devices do not fall back to English).
  const picker = outputLanguages(cat).filter(o => !o.alias).map(o => o.code);
  files.set('xml/locale_config.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- GENERATED by scripts/i18n/build.mjs from i18n/languages.json — do not edit by hand. The languages of Android 13+ "Per-app language". English is the default resource set. -->',
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
    ...picker.map(c => `    <locale android:name="${c}" />`),
    '</locale-config>', ''].join('\n'));
  return files;
}

/** The codes in resourceConfigurations: Android qualifiers ('b+sr+Latn' for Latin Serbian), aliases included. */
export function resourceConfigurations(cat) {
  return outputLanguages(cat).map(o => o.code === 'sr-Latn' ? 'b+sr+Latn' : o.code);
}

function gradleWith(cat, text) {
  const list = resourceConfigurations(cat).map(c => `"${c}"`).join(', ');
  const re = /resourceConfigurations \+= listOf\([^)]*\)/;
  if (!re.test(text)) throw new Error('resourceConfigurations line not found in build.gradle.kts');
  return text.replace(re, `resourceConfigurations += listOf(${list})`);
}

/* ── iOS ──────────────────────────────────────────────────────────────────────────────── */

/** %1$s -> %1$@, %2$d -> %2$lld, %% stays. */
export function iosFormat(s) { return s.replace(/%(\d+)\$s/g, '%$1$@').replace(/%(\d+)\$d/g, '%$1$lld'); }

const unit = v => ({ stringUnit: { state: 'translated', value: v } });

export function iosFiles(cat) {
  const outs = outputLanguages(cat);
  const catalog = { sourceLanguage: cat.fallback, strings: {}, version: '1.0' };
  const infoPlist = { sourceLanguage: cat.fallback, strings: {}, version: '1.0' };
  for (const k of cat.keys) {
    if (!k.platforms.includes('ios')) continue;
    const src = cat.strings[cat.source][k.key];
    const names = Array.isArray(src) ? src.map((_, i) => `${k.key}_${i}`) : [k.key];
    names.forEach((name, i) => {
      const entry = {};
      if (k.note) entry.comment = k.note;
      entry.extractionState = 'manual';
      const localizations = {};
      for (const o of outs) {
        let v = o.texts[k.key];
        if (v == null) continue;
        if (Array.isArray(v)) v = v[i];
        if (typeof v === 'object') {
          const forms = withMany(o.lang, v);
          const plural = {};
          for (const c of ['zero', 'one', 'two', 'few', 'many', 'other']) if (forms[c] != null) plural[c] = unit(iosFormat(forms[c]));
          localizations[o.code] = { variations: { plural } };
        } else localizations[o.code] = unit(iosFormat(v));
      }
      entry.localizations = localizations;
      const target = k.key === 'location_usage' ? infoPlist : catalog;
      const finalName = k.key === 'location_usage' ? 'NSLocationWhenInUseUsageDescription' : name;
      target.strings[finalName] = entry;
    });
  }
  // The home-screen name is the brand and the same in every language; listing it lets the store show it as translated.
  const brand = { extractionState: 'manual', localizations: {} };
  for (const o of outs) brand.localizations[o.code] = unit('Elpriser');
  infoPlist.strings.CFBundleDisplayName = brand;
  const sorted = o => ({ ...o, strings: Object.fromEntries(Object.entries(o.strings).sort(([a], [b]) => a.localeCompare(b, 'en'))) });
  const files = new Map();
  files.set('Localizable.xcstrings', JSON.stringify(sorted(catalog), null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1 : ') + '\n');
  files.set('InfoPlist.xcstrings', JSON.stringify(sorted(infoPlist), null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1 : ') + '\n');
  files.set('localizations.json', JSON.stringify({ _about: 'GENERATED by scripts/i18n/build.mjs. The language codes of the iOS build (project.yml CFBundleLocalizations is checked against this).', development: cat.fallback, languages: outs.map(o => o.code) }, null, 2) + '\n');
  return files;
}

/* ── Driver ───────────────────────────────────────────────────────────────────────────── */

export function expectedFiles(cat) {
  const out = new Map();
  for (const [f, c] of androidFiles(cat)) out.set(path.join(RES, f), c);
  for (const [f, c] of iosFiles(cat)) out.set(path.join(IOS_RES, f), c);
  out.set(GRADLE, gradleWith(cat, fs.readFileSync(GRADLE, 'utf8')));
  return out;
}

/** Generated Android resource folders that no longer correspond to a shipped language (a removed language must not linger). */
export function staleAndroidDirs(cat) {
  const want = new Set([...androidFiles(cat).keys()].map(f => f.split('/')[0]));
  const have = fs.readdirSync(RES).filter(d => /^values(-|$)/.test(d) && fs.existsSync(path.join(RES, d, 'strings.xml')));
  return have.filter(d => !want.has(d));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const cat = loadCatalogue();
  if (args.has('--status')) {
    for (const l of cat.langs) {
      const have = !!cat.strings[l.code];
      const miss = have ? missingKeys(cat, l) : null;
      const state = !have ? 'no file' : miss.length === 0 ? 'complete' : `PARTIAL, ${miss.length} of ${cat.keys.length} keys missing`;
      console.log(`${l.code.padEnd(3)} tier ${l.tier}  ${state}${miss && miss.length && miss.length < 12 ? ': ' + miss.join(', ') : ''}`);
    }
    return;
  }
  const exp = expectedFiles(cat);
  if (args.has('--check')) {
    const bad = [];
    for (const [f, c] of exp) if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c) bad.push(path.relative(ROOT, f));
    for (const d of staleAndroidDirs(cat)) bad.push(`res/${d} (no longer generated)`);
    if (bad.length) { console.error('stale generated files — run node scripts/i18n/build.mjs:\n  ' + bad.join('\n  ')); process.exit(1); }
    console.log('i18n outputs are up to date');
    return;
  }
  for (const [f, c] of exp) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c);
  }
  for (const d of staleAndroidDirs(cat)) fs.rmSync(path.join(RES, d), { recursive: true });
  console.log(`wrote ${exp.size} files for ${outputLanguages(cat).length} language folders`);
}

if (import.meta.url === 'file://' + process.argv[1]) main();
