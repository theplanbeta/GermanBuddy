// Pauses as heard, clipping, and level per voice, for a scene render.
//   node verify.mjs <name> [designFrom: json|today]
import fs from 'node:fs';
import { readWav } from './pipe.mjs';
import { silentEdges } from './app/src/flow/signal.js';
import { designedPause } from './app/src/flow/assemble.js';
const [name] = process.argv.slice(2);
const J = JSON.parse(fs.readFileSync(`${name}.json`));
const pcm = readWav(`${name}.wav`);
const x = Float32Array.from(pcm, (v) => v / 32768);
const S = J.sentences, n = S.length;
const design = J.pauses ?? S.map((s, i) => designedPause(s, i === n - 1 || S[i + 1].para !== s.para));
const slice = (i) => x.subarray(J.starts[i], J.starts[i + 1] ?? x.length);
// absolute measure: 10 ms frames below -50 dBFS count as silence
const frameDb = (a) => { let s = 0; for (const v of a) s += v * v; return 10 * Math.log10(s / a.length + 1e-12); };
function absEdges(a) {
  const h = 240, m = Math.floor(a.length / h); let f = 0, l = m - 1;
  while (f < m && frameDb(a.subarray(f * h, f * h + h)) < -50) f++;
  while (l > f && frameDb(a.subarray(l * h, l * h + h)) < -50) l--;
  return { lead: f * 0.01, trail: (m - 1 - l) * 0.01 + (a.length - m * h) / 24000 };
}
const rows = [];
for (let i = 0; i < n - 1; i++) {
  const e1 = silentEdges(slice(i)), e2 = silentEdges(slice(i + 1));
  const a1 = absEdges(slice(i)), a2 = absEdges(slice(i + 1));
  rows.push({ i, design: +design[i].toFixed(3), measured: +(e1.trail + e2.lead).toFixed(3), measuredAbs: +(a1.trail + a2.lead).toFixed(3) });
}
const dev = rows.map((r) => Math.abs(r.measured - r.design));
const devAbs = rows.map((r) => Math.abs(r.measuredAbs - r.design));
if (process.env.TABLE) console.table(rows);
let clip = 0, peak = 0;
for (const v of pcm) { const a = Math.abs(v); peak = Math.max(peak, a); if (a >= 32700) clip++; }
// level per voice: speech frames (within 40 dB of the slice peak) of single-part plain/styled sentences
const lv = {};
J.deliveries.forEach((d, i) => {
  if (d.spliced) return;
  const p = d.parts[0];
  const v = (p.voice || 'af_heart') + (p.style.gainDb || p.style.whisper ? ' (styled)' : '');
  const a = slice(i), h = 240, fr = [];
  for (let k = 0; k + h <= a.length; k += h) fr.push(frameDb(a.subarray(k, k + h)));
  const pk = Math.max(...fr); const sp = fr.filter((d) => d > pk - 40);
  const e = 10 * Math.log10(sp.reduce((s, d) => s + 10 ** (d / 10), 0) / sp.length);
  (lv[v] ??= []).push(e);
});
const levels = Object.fromEntries(Object.entries(lv).map(([k, a]) => [k, `${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1)} dB (${a.length} sentences)`]));
console.log(JSON.stringify({ name, seconds: +(x.length / 24000).toFixed(2), boundaries: rows.length, maxPauseDevMs: Math.round(1000 * Math.max(...dev)), meanPauseDevMs: Math.round(1000 * dev.reduce((a, b) => a + b, 0) / dev.length), within20ms: dev.filter((d) => d <= 0.02).length, maxPauseDevAbsMs: Math.round(1000 * Math.max(...devAbs)), within30msAbs: devAbs.filter((d) => d <= 0.03).length, clippedSamples: clip, peak: +(peak / 32768).toFixed(3), levels }, null, 1));
fs.writeFileSync(`${name}.pauses.json`, JSON.stringify(rows, null, 1));
