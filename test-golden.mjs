// Cross-platform contract: the web app, the Android app and the iOS app each
// carry their own copy of the net list and a few small pieces of logic. Nothing
// else would notice one of them drifting, so they are pinned to one JSON file.
//
//   index.html + tests/golden/reference.mjs  ->  tests/golden/app-contract.json
//                                                   |-> this test (web + source of the apps)
//                                                   |-> Android unit test (ContractTest.kt)
//                                                   '-> iOS unit test (ContractTests.swift)
//
// Run: npm run test:golden. Regenerate the file with: node tests/golden/generate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { build, webNets } from './tests/golden/generate.mjs';

const ROOT = import.meta.dirname;
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/app-contract.json'), 'utf8'));

test('app-contract.json is up to date with index.html and the reference implementation', () => {
  assert.deepEqual(golden, JSON.parse(JSON.stringify(build())),
    'stale: run `node tests/golden/generate.mjs` and commit the result (the net list in index.html or the reference logic changed)');
});

test('the Android net list equals the web net list (name, GLN, area, match strings)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ElpriserAndroid/app/src/main/java/org/elpriser/app/data/Models.kt'), 'utf8');
  const nets = [...src.matchAll(/Net\("([^"]+)", "(\d{13})", "(DK[12])", listOf\(([^)]*)\)\)/g)].map(m => ({
    name: m[1], gln: m[2], area: m[3], match: [...m[4].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  }));
  assert.deepEqual(nets, golden.nets);
});

test('the iOS net list equals the web net list (name, GLN, area, match strings)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ElpriserIOS/Sources/Models.swift'), 'utf8');
  const nets = [...src.matchAll(/Net\(name: "([^"]+)", gln: "(\d{13})", area: "(DK[12])", match: \[([^\]]*)\]\)/g)].map(m => ({
    name: m[1], gln: m[2], area: m[3], match: [...m[4].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  }));
  assert.deepEqual(nets, golden.nets);
});

test('every net the apps know is one the server prices (GLN known to functions/[[path]].js)', () => {
  const fn = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  for (const n of golden.nets) assert.ok(fn.includes(`gln: '${n.gln}'`), `${n.name} (${n.gln}) is not in the server's net list`);
});

test('the contract covers the cases that have bitten before', () => {
  // Longest match wins, a net whose name contains another net's name.
  const m = Object.fromEntries(golden.matchCases.map(c => [c.input, c.expect]));
  assert.equal(m['TREFOR El-net Øst A/S'], 'Trefor Øst');
  assert.equal(m['TREFOR El-Net A/S'], 'Trefor');
  assert.equal(m[''], null);
  // Days that are incomplete are not days; a band on some hours still counts.
  assert.deepEqual(golden.forecast.expect.days.map(d => d.date), ['2026-10-10', '2026-10-11', '2026-10-14']);
  assert.deepEqual(Object.keys(golden.co2.expect), ['2026-10-10']);
});

test('the web app resolves every grid-company name exactly as the contract says', () => {
  // The web's own matchNet(), taken out of index.html and run against the same
  // cases as the apps. (It used to take the FIRST match in list order, which put
  // "TREFOR El-net Øst" on the DK1 Trefor net.)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nets = html.match(/const NETS=(\{[\s\S]*?\]\});/)[1];
  const fn = html.match(/function matchNet\(n\)\{[\s\S]*?\n\}/)[0];
  const web = vm.runInNewContext(`const NETS=${nets};${fn};matchNet`);
  for (const c of golden.matchCases) {
    const got = c.input && c.input.trim() ? web(c.input) : null;
    assert.equal(got ? got.net.name : null, c.expect, `matchNet(${JSON.stringify(c.input)})`);
  }
  assert.ok(webNets().length === golden.nets.length);
});
