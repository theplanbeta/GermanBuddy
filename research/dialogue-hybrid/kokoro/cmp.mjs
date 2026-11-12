// Per-sentence comparison of two renders of the same plan: start, length, correlation, level.
//   node cmp.mjs a.json a.wav b.json b.wav
import fs from 'node:fs';
import { readWav } from './pipe.mjs';
import { findGaps } from './app/src/flow/signal.js';
import { specCompare } from './spec.mjs';
const [aj, aw, bj, bw] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(aj)), B = JSON.parse(fs.readFileSync(bj));
const f = (x) => Float32Array.from(x, (v) => v / 32768);
const a = f(readWav(aw)), b = f(readWav(bw));
const seg = (x, st, i) => x.subarray(st[i], st[i + 1] ?? x.length);
const db = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-12); };
const rows = [];
for (let i = 0; i < A.starts.length; i++) {
  const sa = seg(a, A.starts, i), sb = seg(b, B.starts, i);
  const n = Math.min(sa.length, sb.length);
  let ab = 0, aa = 0, bb = 0, md = 0;
  for (let k = 0; k < n; k++) { ab += sa[k] * sb[k]; aa += sa[k] ** 2; bb += sb[k] ** 2; md = Math.max(md, Math.abs(sa[k] - sb[k])); }
  const ga = findGaps(sa, { minLen: 0 }), gb = findGaps(sb, { minLen: 0 });
  const sc = specCompare(sa.subarray(0, n), sb.subarray(0, n));
  rows.push({ i, specCorr: +sc.corr.toFixed(4), specMadDb: +sc.madDb.toFixed(2), dStartMs: +((A.starts[i] - B.starts[i]) / 24).toFixed(1), lenDiffMs: +((sa.length - sb.length) / 24).toFixed(1), corr: +(ab / Math.sqrt(aa * bb)).toFixed(4), maxDiff: +md.toFixed(4), dLevelDb: +(db(sa) - db(sb)).toFixed(2), trailA: +(sa.length / 24000 - ga.offset).toFixed(3), trailB: +(sb.length / 24000 - gb.offset).toFixed(3) });
}
if (process.env.TABLE) console.table(rows);
const abs = (k) => Math.max(...rows.map((r) => Math.abs(r[k])));
console.log(JSON.stringify({ sentences: rows.length, totalA: +(a.length / 24000).toFixed(3), totalB: +(b.length / 24000).toFixed(3), maxStartDiffMs: abs('dStartMs'), maxLenDiffMs: abs('lenDiffMs'), minCorr: Math.min(...rows.map((r) => r.corr)), meanCorr: +(rows.reduce((s, r) => s + r.corr, 0) / rows.length).toFixed(4), maxAbsDiff: abs('maxDiff'), maxLevelDiffDb: abs('dLevelDb'), minSpecCorr: Math.min(...rows.map((r) => r.specCorr)), meanSpecMadDb: +(rows.reduce((s, r) => s + r.specMadDb, 0) / rows.length).toFixed(2), bitIdenticalSentences: rows.filter((r) => r.maxDiff === 0 && r.lenDiffMs === 0).length }));
