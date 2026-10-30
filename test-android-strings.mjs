#!/usr/bin/env node
/**
 * The Android app's translations: nb, sv, fi and nl next to the Danish default.
 * Run: npm run test:android-strings   (hermetic: reads files only, no Gradle, no Android SDK; part of test:unit)
 *
 * Danish (res/values/strings.xml) is the source. What this guards, because nothing else notices before a user does:
 *  (a) every translation has exactly the same string / plurals / string-array names as the default (and none of the
 *      translatable="false" ones), the same plural forms and the same number of array items;
 *  (b) each translation uses the same placeholders (%1$s, %2$d, ...) as the default, every placeholder is positional,
 *      a literal percent sign is written %%, and apostrophes are escaped (an unescaped one breaks the resource compile);
 *  (c) no translation is empty, and none is identical to the Danish text when that is longer than 12 characters
 *      (a string somebody forgot to translate) unless it is in SAME_AS_DANISH below, with a reason;
 *  (d) res/xml/locale_config.xml lists exactly da, nb, sv, fi, nl (the picker), matching the values-* folders (plus the
 *      nn/no aliases, which must be copies of nb), the manifest
 *      attribute and the resourceConfigurations in build.gradle.kts;
 *  (e) a few Danish-only words do not occur in the foreign files ('lige nu', 'døgn', 'netselskab', 'afgifter'),
 *      except where the language really has the word (nb: 'døgn');
 *  (f) no user-visible string literal is hard-coded in the Kotlin sources (they must come from strings.xml through
 *      tx.get / tx.plural / tx.array), and every R.string / R.plurals / R.array the Kotlin sources use exists
 *      (catches a typo here, without compiling) and every default string is used by something.
 *
 * Set ELPRISER_ANDROID_DIR to point the test at another copy of ElpriserAndroid/ (used to mutation-check this test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const ANDROID = process.env.ELPRISER_ANDROID_DIR || path.join(ROOT, 'ElpriserAndroid');
const RES = path.join(ANDROID, 'app/src/main/res');
const KOTLIN = path.join(ANDROID, 'app/src/main/java');
const LANGS = ['nb', 'sv', 'fi', 'nl'];
const EXPECTED_LOCALES = ['da', 'nb', 'sv', 'fi', 'nl'];
// Android does not fall back from Nynorsk (nn) or the legacy Norwegian code (no) to nb, so those users would get Danish.
// values-nn/ and values-no/ are byte-identical copies of values-nb/ and are NOT in the per-app language picker.
const NB_ALIASES = ['nn', 'no'];

/* Strings that are legitimately the same as the Danish text although they are longer than 12 characters.
 * Each entry says why; an entry that is no longer identical (or no longer exists) fails the test, so the list cannot rot. */
const TEMPLATE = 'only placeholders, punctuation and the abbreviations kl./kr, which the language shares';
const SAME_AS_DANISH = {
  nb: {
    part_spot_actual: 'proper noun: Nord Pool',
    part_spot_forecast: 'Norwegian spells it the same',
    savings_today: 'Norwegian spells it the same',
    export_title: 'Norwegian spells it the same (Home Assistant is a product name)',
    view_spot_excl_sub: 'Norwegian spells it the same',
    tile_cheapest: 'Norwegian spells it the same',
    kwh_moved: 'Norwegian spells it the same',
    device_power_line: 'Norwegian spells it the same',
    stat_price_hour: TEMPLATE,
    date_long: TEMPLATE,
    tooltip: TEMPLATE,
    chart_summary_tile: TEMPLATE,
  },
  sv: {
    part_spot_actual: 'proper noun: Nord Pool',
    caption_spot_incl: 'Swedish spells it the same',
    view_spot_incl_title: 'Swedish spells it the same',
    part_vat: 'Moms is the Swedish word too',
    stat_price_hour: TEMPLATE,
    tooltip: TEMPLATE,
    chart_summary_tile: TEMPLATE,
  },
  fi: {
    date_long: TEMPLATE,
  },
  nl: {},
};

/* Danish-only words that must not turn up in the foreign files, and the languages where the word is genuinely fine. */
const DANISH_ONLY = [
  { word: 'lige nu', okIn: [] },
  { word: 'døgn', okIn: ['nb'] },        // Norwegian uses "døgn" too
  { word: 'netselskab', okIn: [] },      // nb "nettselskap", sv "nätbolag", fi "verkkoyhtiö", nl "netbeheerder"
  { word: 'afgifter', okIn: [] },        // nb "avgifter", sv "skatter"
];

/* Hard-coded text the UI-literal check may see in the Kotlin sources. Each entry is [file suffix, regexp on the literal, reason]. */
const HARDCODED_ALLOWLIST = [
  ['data/Models.kt', /.*/, 'the net company list: names and the match strings Green Power Denmark answers with, proper nouns pinned by test-golden.mjs'],
  ['data/Api.kt', /.*/, 'network constants (URL, user agent, JSON keys), nothing the user sees'],
  ['ui/AutomationScreen.kt', /^(\{\\n  \\"area\\"|    \{ \\"name\\")|\\"hours\\"|\\"devices\\"|Elpriser-plan/, 'JSON handed to Home Assistant / Shelly and the clipboard label: a data format, not UI text'],
  ['ui/AutomationScreen.kt', /^(varmepumpe|elbil|vandvarmer)$/, 'device names inside that JSON stay fixed so a user\'s automation does not break when the language changes'],
  ['ui/AutomationScreen.kt', /^[−+]$/, 'stepper glyphs'],
];

/* ── Reading the resource files ───────────────────────────────────────────────────────── */

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** { strings: {name: text}, plurals: {name: {quantity: text}}, arrays: {name: [text]}, nonTranslatable: [names], problems: [] } */
export function parseResources(xml, label = 'file') {
  const out = { strings: {}, plurals: {}, arrays: {}, nonTranslatable: [], problems: [] };
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const seen = new Set();
  const once = (kind, name) => {
    const key = kind + ':' + name;
    if (seen.has(key)) out.problems.push(`${label}: duplicate ${kind} "${name}"`);
    seen.add(key);
  };
  for (const m of body.matchAll(/<string\s+([^>]*?)>([\s\S]*?)<\/string>/g)) {
    const name = /name="([^"]+)"/.exec(m[1])?.[1];
    if (!name) { out.problems.push(`${label}: <string> without a name`); continue; }
    once('string', name);
    if (/translatable="false"/.test(m[1])) { out.nonTranslatable.push(name); continue; }
    out.strings[name] = decodeEntities(m[2]);
  }
  for (const m of body.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    once('plurals', m[1]);
    out.plurals[m[1]] = {};
    for (const it of m[2].matchAll(/<item\s+quantity="([^"]+)"\s*>([\s\S]*?)<\/item>/g)) out.plurals[m[1]][it[1]] = decodeEntities(it[2]);
  }
  for (const m of body.matchAll(/<string-array\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string-array>/g)) {
    once('string-array', m[1]);
    out.arrays[m[1]] = [...m[2].matchAll(/<item\s*>([\s\S]*?)<\/item>/g)].map(it => decodeEntities(it[1]));
  }
  return out;
}

function load(lang) {
  const dir = lang === 'da' ? 'values' : `values-${lang}`;
  const file = path.join(RES, dir, 'strings.xml');
  assert.ok(fs.existsSync(file), `missing ${path.relative(ANDROID, file)}`);
  const r = parseResources(fs.readFileSync(file, 'utf8'), `${dir}/strings.xml`);
  assert.deepEqual(r.problems, [], `${dir}/strings.xml is malformed`);
  return r;
}

/** Every text in a resource set as [id, text, quantityOrIndex] so the checks treat strings, plural forms and array items alike. */
function entries(r) {
  const e = [];
  for (const [k, v] of Object.entries(r.strings)) e.push([k, v]);
  for (const [k, forms] of Object.entries(r.plurals)) for (const [q, v] of Object.entries(forms)) e.push([`${k}[${q}]`, v]);
  for (const [k, items] of Object.entries(r.arrays)) items.forEach((v, i) => e.push([`${k}[${i}]`, v]));
  return e;
}

/** The positional placeholders of a text, sorted: ["%1$s", "%2$d"]. */
function placeholders(text) {
  return [...text.matchAll(/%(\d+)\$([a-zA-Z])/g)].map(m => `%${m[1]}$${m[2]}`).sort();
}

const da = load('da');
const tr = Object.fromEntries(LANGS.map(l => [l, load(l)]));

/* ── (a) the same names ───────────────────────────────────────────────────────────────── */

for (const lang of LANGS) {
  test(`(a) ${lang}: exactly the same strings, plurals and arrays as the Danish default`, () => {
    const t = tr[lang];
    for (const kind of ['strings', 'plurals', 'arrays']) {
      const want = Object.keys(da[kind]).sort();
      const got = Object.keys(t[kind]).sort();
      assert.deepEqual(got.filter(k => !want.includes(k)), [], `values-${lang} has ${kind} the default lacks`);
      assert.deepEqual(want.filter(k => !got.includes(k)), [], `values-${lang} lacks ${kind} the default has (untranslated)`);
    }
    for (const n of da.nonTranslatable) {
      assert.ok(!(n in t.strings), `values-${lang} redefines the non-translatable string "${n}"`);
    }
    for (const [k, forms] of Object.entries(da.plurals)) {
      assert.deepEqual(Object.keys(t.plurals[k] || {}).sort(), Object.keys(forms).sort(), `values-${lang} plurals "${k}": different quantity forms`);
    }
    for (const [k, items] of Object.entries(da.arrays)) {
      assert.equal((t.arrays[k] || []).length, items.length, `values-${lang} string-array "${k}": ${items.length} items expected`);
    }
  });
}

/* ── (b) placeholders, percent signs, apostrophes ─────────────────────────────────────── */

function checkSyntax(label, r) {
  const bad = [];
  for (const [id, text] of entries(r)) {
    const noPct = text.replace(/%%/g, '');
    if (/%(?!\d+\$[sd])/.test(noPct)) bad.push(`${label} ${id}: a lone % or a non-positional placeholder (write %% for a percent sign, %1$s / %2$d for values): ${text}`);
    if (/(^|[^\\])'/.test(text)) bad.push(`${label} ${id}: unescaped apostrophe (write \\'): ${text}`);
    if (/(^|[^\\])"/.test(text)) bad.push(`${label} ${id}: unescaped double quote: ${text}`);
    if (text !== text.trim()) bad.push(`${label} ${id}: leading/trailing whitespace is stripped by Android: "${text}"`);
    if (/^[@?]/.test(text)) bad.push(`${label} ${id}: a leading @ or ? needs a backslash`);
    if (/<|&(?!amp;|lt;|gt;|quot;|apos;)/.test(text)) bad.push(`${label} ${id}: markup or a bare & in a plain string: ${text}`);
  }
  return bad;
}

test('(b) the Danish default itself is well formed', () => {
  assert.deepEqual(checkSyntax('values', da), []);
});

for (const lang of LANGS) {
  test(`(b) ${lang}: same placeholders as the Danish text, positional, percent signs and apostrophes right`, () => {
    const t = tr[lang];
    assert.deepEqual(checkSyntax(`values-${lang}`, t), []);
    const want = new Map(entries(da));
    const bad = [];
    for (const [id, text] of entries(t)) {
      if (!want.has(id)) continue; // reported by (a)
      const a = placeholders(want.get(id)).join(' ');
      const b = placeholders(text).join(' ');
      if (a !== b) bad.push(`${id}: Danish uses [${a}] but ${lang} uses [${b}]  (${text})`);
    }
    assert.deepEqual(bad, [], `values-${lang}: placeholder mismatch`);
  });
}

/* ── (c) not empty, not left in Danish ────────────────────────────────────────────────── */

for (const lang of LANGS) {
  test(`(c) ${lang}: nothing empty, nothing left in Danish`, () => {
    const t = tr[lang];
    const want = new Map(entries(da));
    const empty = entries(t).filter(([, v]) => v.trim() === '').map(([k]) => k);
    assert.deepEqual(empty, [], `values-${lang} has empty texts`);
    const same = [];
    for (const [id, text] of entries(t)) {
      if (!want.has(id) || text.length <= 12 || text !== want.get(id)) continue;
      const base = id.replace(/\[.*\]$/, '');
      if (SAME_AS_DANISH[lang][base]) continue;
      same.push(`${id}: "${text}"`);
    }
    assert.deepEqual(same, [], `values-${lang}: identical to the Danish text (translate it, or list it in SAME_AS_DANISH with a reason if the languages really agree)`);
    for (const k of Object.keys(SAME_AS_DANISH[lang])) {
      assert.ok(k in da.strings && k in t.strings, `SAME_AS_DANISH.${lang}.${k} is not a string in the files (stale allowlist entry)`);
      assert.equal(t.strings[k], da.strings[k], `SAME_AS_DANISH.${lang}.${k} is no longer identical to the Danish text: remove it from the allowlist`);
    }
  });
}

/* ── (d) locale list ──────────────────────────────────────────────────────────────────── */

test('(d) locale_config.xml lists exactly da, nb, sv, fi, nl — and the folders, manifest and Gradle agree', () => {
  const cfg = fs.readFileSync(path.join(RES, 'xml/locale_config.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const listed = [...cfg.matchAll(/<locale\s+android:name="([^"]+)"\s*\/>/g)].map(m => m[1]);
  assert.deepEqual([...listed].sort(), [...EXPECTED_LOCALES].sort(), 'locale_config.xml must list exactly da, nb, sv, fi, nl (once each)');
  const folders = fs.readdirSync(RES).filter(d => /^values-/.test(d) && fs.existsSync(path.join(RES, d, 'strings.xml'))).map(d => d.slice('values-'.length));
  assert.deepEqual(folders.sort(), [...LANGS, ...NB_ALIASES].sort(), 'res/values-* folders with a strings.xml must be exactly nb, sv, fi, nl plus the aliases nn, no');
  const manifest = fs.readFileSync(path.join(ANDROID, 'app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:localeConfig="@xml\/locale_config"/, 'the manifest <application> must set android:localeConfig="@xml/locale_config"');
  const gradle = fs.readFileSync(path.join(ANDROID, 'app/build.gradle.kts'), 'utf8');
  const cfgLine = /resourceConfigurations\s*\+?=\s*listOf\(([^)]*)\)|localeFilters\s*\+?=\s*listOf\(([^)]*)\)/.exec(gradle);
  assert.ok(cfgLine, 'build.gradle.kts must restrict the bundled languages (resourceConfigurations / localeFilters)');
  const filtered = [...(cfgLine[1] || cfgLine[2]).matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...filtered].sort(), [...EXPECTED_LOCALES, ...NB_ALIASES].sort(), 'the Gradle language filter must list the five languages plus the aliases nn and no (otherwise they are stripped from the bundle)');
});

test('(d2) values-nn and values-no are byte-identical copies of values-nb (Nynorsk and legacy "no" fall back to Bokmål, not Danish)', () => {
  const nb = fs.readFileSync(path.join(RES, 'values-nb/strings.xml'));
  for (const alias of NB_ALIASES) {
    const file = path.join(RES, `values-${alias}/strings.xml`);
    assert.ok(fs.existsSync(file), `values-${alias}/strings.xml is missing: Android does not fall back from ${alias} to nb`);
    assert.ok(nb.equals(fs.readFileSync(file)), `values-${alias}/strings.xml differs from values-nb/strings.xml — edit nb and copy it (cp values-nb/strings.xml values-${alias}/strings.xml)`);
  }
});

/* ── (e) Danish-only words ────────────────────────────────────────────────────────────── */

for (const lang of LANGS) {
  test(`(e) ${lang}: no Danish-only words`, () => {
    const bad = [];
    for (const [id, text] of entries(tr[lang])) {
      for (const { word, okIn } of DANISH_ONLY) {
        if (okIn.includes(lang)) continue;
        if (text.toLowerCase().includes(word)) bad.push(`${id}: contains the Danish word "${word}": ${text}`);
      }
    }
    assert.deepEqual(bad, [], `values-${lang}`);
  });
}

/* ── (f) no hard-coded UI text in Kotlin; resource references resolve ─────────────────── */

function kotlinFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? kotlinFiles(p) : e.name.endsWith('.kt') ? [p] : [];
  });
}

/** Source with comments blanked out and every string literal recorded: { code (literals kept, comments removed), literals: [{ text, start, end, line }] }. */
export function scanKotlin(src) {
  let code = '';
  const literals = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; }
        else if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; }
        else { if (src[i] === '\n') { line++; code += '\n'; } i++; }
      }
      continue;
    }
    if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end < 0 ? n : end + 3;
      literals.push({ text: src.slice(i + 3, end < 0 ? n : end), start: code.length, line });
      code += '""';
      line += (src.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1, text = '', depth = 0;
      while (j < n) {
        if (src[j] === '\\') { text += src[j] + src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; text += '${'; j += 2; continue; }
        if (depth > 0) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          text += src[j]; j++; continue;
        }
        if (src[j] === '"') break;
        text += src[j]; j++;
      }
      literals.push({ text, start: code.length, line });
      code += '""';
      i = j + 1;
      continue;
    }
    if (c === "'") { // char literal
      let j = i + 1;
      while (j < n && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      code += "'x'";
      i = j + 1;
      continue;
    }
    if (c === '\n') line++;
    code += c;
    i++;
  }
  return { code, literals };
}

/** The visible words of a literal: interpolations ${...} / $name and escapes removed. */
function visibleText(lit) {
  return lit.replace(/\$\{[^}]*\}/g, ' ').replace(/\$[A-Za-z_]\w*/g, ' ').replace(/\\./g, ' ');
}

const UI_CALLS = /\b(Text|SectionLabel|PrimaryButton|SoftButton|TextAction|ScreenHeader|NavItem|ErrorCard|Segmented|Stepper)\s*\(/g;
const A11Y_ASSIGN = /\b(contentDescription|onClickLabel|stateDescription)\s*=\s*$/;

function allowed(file, text) {
  return HARDCODED_ALLOWLIST.some(([suffix, re]) => file.endsWith(suffix) && re.test(text));
}

export function findHardcoded(file, src) {
  const { code, literals } = scanKotlin(src);
  const problems = [];
  const flagged = new Set();
  const flag = (lit, why) => {
    if (flagged.has(lit.start)) return;
    flagged.add(lit.start);
    if (allowed(file, lit.text)) return;
    problems.push(`${path.relative(ANDROID, file)}:${lit.line}: hard-coded text "${lit.text.slice(0, 60)}" (${why})`);
  };
  // every literal is a '""' pair in `code` at lit.start
  const positions = literals.map(l => l.start);
  const byPos = new Map(literals.map(l => [l.start, l]));
  // 1. Danish letters in any literal
  for (const lit of literals) if (/[æøåÆØÅ]/.test(visibleText(lit.text))) flag(lit, 'Danish letters; texts belong in res/values/strings.xml');
  // 2. literals that are direct arguments of a text-showing call (not inside a lambda, a nested call or a comparison), or assigned to an accessibility label
  for (const m of code.matchAll(UI_CALLS)) {
    let paren = 1, brace = 0, j = m.index + m[0].length;
    const from = j;
    while (j < code.length && paren > 0) {
      const ch = code[j];
      if (ch === '"') {
        const lit = byPos.get(j);
        const prev = code.slice(Math.max(from, j - 4), j).trimEnd();
        const next = code.slice(j + 2, j + 8).trimStart();
        const operand = /(==|!=)$/.test(prev) || next.startsWith('->') || next.startsWith('to ');
        if (lit && paren === 1 && brace === 0 && !operand && /[A-Za-zÀ-ÿ]{2,}/.test(visibleText(lit.text))) flag(lit, `argument of ${m[1]}(…)`);
        j += 2;
        continue;
      }
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '{') brace++;
      else if (ch === '}') brace--;
      j++;
    }
  }
  for (const p of positions) {
    const before = code.slice(Math.max(0, p - 40), p);
    if (A11Y_ASSIGN.test(before)) flag(byPos.get(p), 'accessibility label');
  }
  // 3. multi-word phrases anywhere
  for (const lit of literals) if (/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(visibleText(lit.text))) flag(lit, 'a phrase of several words');
  return problems;
}

const kt = kotlinFiles(KOTLIN).map(f => [f, fs.readFileSync(f, 'utf8')]);

test('(f) no hard-coded user-visible text in the Kotlin sources', () => {
  const problems = kt.flatMap(([f, src]) => findHardcoded(f, src));
  assert.deepEqual(problems, [], 'Hard-coded UI text found. Put it in app/src/main/res/values/strings.xml (and the four translations), show it with tx.get(R.string.name) / tx.plural / tx.array '
    + '(see ui/Strings.kt), or — only for data that is not UI text — add it to HARDCODED_ALLOWLIST in test-android-strings.mjs with a reason.');
});

test('(f) every R.string / R.plurals / R.array used in Kotlin exists in the default file, and every default string is used', () => {
  const used = { string: new Set(), plurals: new Set(), array: new Set() };
  for (const [, src] of kt) {
    const { code } = scanKotlin(src);
    for (const m of code.matchAll(/\bR\.(string|plurals|array)\.(\w+)/g)) used[m[1]].add(m[2]);
  }
  const have = { string: new Set([...Object.keys(da.strings), ...da.nonTranslatable]), plurals: new Set(Object.keys(da.plurals)), array: new Set(Object.keys(da.arrays)) };
  const missing = [];
  for (const k of Object.keys(used)) for (const n of used[k]) if (!have[k].has(n)) missing.push(`R.${k}.${n}`);
  assert.deepEqual(missing, [], 'Kotlin refers to resources that strings.xml does not define');
  const unused = [];
  for (const k of Object.keys(have)) for (const n of have[k]) if (!used[k].has(n)) unused.push(`${k}:${n}`);
  assert.deepEqual(unused, [], 'strings.xml defines texts nothing uses (delete them, or use them)');
});

test('the Android main manifest uses string resources for its label', () => {
  const manifest = fs.readFileSync(path.join(ANDROID, 'app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:label="@string\/app_name"/);
  assert.ok(da.nonTranslatable.includes('app_name'), 'app_name is the brand and must stay translatable="false"');
});
