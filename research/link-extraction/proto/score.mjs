// node score.mjs [outdir-extractors...]  -> prints table; writes ../out/scores.json
import fs from 'fs'; import path from 'path';
const root = path.resolve('..');
export const tok = s => (s || '').toLowerCase().normalize('NFKC').replace(/[‘’]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) || [];
function bag(a) { const m = new Map(); for (const t of a) m.set(t, (m.get(t) || 0) + 1); return m; }
function overlap(a, b) { const bb = bag(b); let tp = 0; const ba = bag(a); for (const [t, c] of ba) tp += Math.min(c, bb.get(t) || 0); return tp; }
function lis(a) { const tails = []; for (const x of a) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; } return tails.length; }
// ordering: of the GT 4-gram shingles that occur in the extraction, how many are in monotone order
function orderScore(gt, ex) {
  const sh = (t) => { const o = []; for (let i = 0; i + 4 <= t.length; i++) o.push(t.slice(i, i + 4).join(' ')); return o; };
  const exPos = new Map(); sh(ex).forEach((s, i) => { if (!exPos.has(s)) exPos.set(s, i); });
  const seq = []; for (const s of sh(gt)) if (exPos.has(s)) seq.push(exPos.get(s));
  if (seq.length < 5) return null;
  return lis(seq) / seq.length;
}
// listening leak: extracted blocks (lines) whose tokens are mostly absent from GT; counted in tokens / total extracted tokens
function leak(gtTok, exText) {
  const g = new Set(gtTok); let leakT = 0, total = 0;
  for (const line of exText.split('\n')) { const t = tok(line); if (!t.length) continue; total += t.length; const hit = t.filter(x => g.has(x)).length; if (hit / t.length < 0.5) leakT += t.length; }
  return total ? leakT / total : 0;
}
export function scorePage(gtText, exText) {
  const g = tok(gtText), e = tok(exText);
  const tp = overlap(e, g);
  const p = e.length ? tp / e.length : 0, r = g.length ? tp / g.length : 0;
  const f1 = p + r ? 2 * p * r / (p + r) : 0;
  return { p, r, f1, order: orderScore(g, e), leak: leak(g, exText), nTok: e.length, gTok: g.length };
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] || 0; };
if (process.argv[1].endsWith('score.mjs')) {
  const gt = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json'));
  const dir = root + '/out/aeb'; const res = {};
  for (const f of fs.readdirSync(dir).sort()) {
    const name = f.replace('.json', ''); const o = JSON.parse(fs.readFileSync(`${dir}/${f}`));
    const per = {}; for (const id of Object.keys(gt)) per[id] = scorePage(gt[id].articleBody, (o[id] || {}).text || '');
    res[name] = { per, ms: Object.values(o).map(x => x.ms) };
  }
  fs.writeFileSync(root + '/out/aeb_scores.json', JSON.stringify(res));
  const rows = Object.entries(res).map(([n, { per, ms }]) => { const v = Object.values(per); const ord = v.map(x => x.order).filter(x => x != null);
    return { n, P: mean(v.map(x => x.p)), R: mean(v.map(x => x.r)), F1: mean(v.map(x => x.f1)), medF1: med(v.map(x => x.f1)), ge90: v.filter(x => x.f1 >= .9).length / v.length, lt50: v.filter(x => x.f1 < .5).length, order: mean(ord), leak: mean(v.map(x => x.leak)), ms: med(ms) }; });
  rows.sort((a, b) => b.F1 - a.F1);
  console.log('extractor'.padEnd(24), 'P     R     F1    medF1 >=.9  <.5  order  leak  ms(med)');
  for (const r of rows) console.log(r.n.padEnd(24), [r.P, r.R, r.F1, r.medF1, r.ge90].map(x => x.toFixed(3)).join(' '), String(r.lt50).padStart(4), r.order.toFixed(3), r.leak.toFixed(3), r.ms.toFixed(0).padStart(6));
}
