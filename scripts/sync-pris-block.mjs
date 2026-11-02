#!/usr/bin/env node
/**
 * Copies the Pris block (between "// ═══ Pris-skærmen (Design A: ét svar) ═══" and "// ═══ /Pris-skærmen ═══") from
 * functions/[[path]].js — where you edit it — into index.html, so the two copies stay byte for byte the same
 * (test-forecast-chart.mjs fails when they are not).
 *
 *   node scripts/sync-pris-block.mjs          write index.html
 *   node scripts/sync-pris-block.mjs --check  exit 1 when index.html is out of date, change nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const A = '// ═══ Pris-skærmen (Design A: ét svar) ═══', Z = '// ═══ /Pris-skærmen ═══';
const lift = (src, what) => {
  const a = src.indexOf(A), b = src.indexOf(Z);
  if (a < 0 || b < a) throw new Error(`the Pris block was not found in ${what}`);
  return [a, b + Z.length];
};
const srvFile = path.join(ROOT, 'functions/[[path]].js'), idxFile = path.join(ROOT, 'index.html');
const srv = fs.readFileSync(srvFile, 'utf8'), idx = fs.readFileSync(idxFile, 'utf8');
const [sa, sb] = lift(srv, 'functions/[[path]].js'), [ia, ib] = lift(idx, 'index.html');
const block = srv.slice(sa, sb);
if (idx.slice(ia, ib) === block) { console.log('index.html already carries the same Pris block'); process.exit(0); }
if (process.argv.includes('--check')) { console.error('index.html\'s Pris block differs from functions/[[path]].js — run: node scripts/sync-pris-block.mjs'); process.exit(1); }
fs.writeFileSync(idxFile, idx.slice(0, ia) + block + idx.slice(ib));
console.log(`index.html: Pris block replaced (${ib - ia} -> ${block.length} characters)`);
