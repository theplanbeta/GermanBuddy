import fs from 'fs'; import path from 'path';
import { scorePage, tok } from './score.mjs';
const root = path.resolve('..');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function load(corpus, e) { return JSON.parse(fs.readFileSync(`${root}/out/${corpus}/${e}.json`)); }
function gt(corpus) { if (corpus === 'aeb') { const g = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); return Object.entries(g).map(([id, v]) => ({ id, gt: v.articleBody })); } return JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json')).map(m => ({ id: m.id, gt: m.gt })); }
const agree = (a, b) => scorePage(a, b).f1; // symmetric-ish token F1 between two extractions
const W = t => tok(t).length;
const medoid = (c) => { let best = c[0], bs = -1; for (const a of c) { const s = mean(c.filter(b => b !== a).map(b => agree(a, b))); if (s > bs) { bs = s; best = a; } } return best; };
const strategies = {
  'readability only': (x) => x.R,
  'defuddle only': (x) => x.D,
  'R, fallback D if R<150 words or R<0.5*D': (x) => (W(x.R) < 150 || W(x.R) < 0.5 * W(x.D)) ? x.D : x.R,
  'R, fallback D if R<0.5*D': (x) => (W(x.R) < 0.5 * W(x.D)) ? x.D : x.R,
  'R, fallback D only if R empty/crashed or <60 words': (x) => W(x.R) < 60 ? x.D : x.R,
  'longer of R and D': (x) => W(x.R) >= W(x.D) ? x.R : x.D,
  'shorter of R and D': (x) => W(x.R) <= W(x.D) ? x.R : x.D,
  'medoid of R,D,Postlight': (x) => medoid([x.R, x.D, x.P]),
  'medoid of R,D,Postlight,Extractus': (x) => medoid([x.R, x.D, x.P, x.E]),
  'ORACLE best of R,D (upper bound; uses ground truth)': null,
};
for (const corpus of ['aeb', 'wceb']) {
  const G = gt(corpus); const R = load(corpus, 'readability_linkedom'), D = load(corpus, 'defuddle_linkedom'), P = load(corpus, 'postlight'), E = load(corpus, 'extractus');
  console.log(`\n### ${corpus} (n=${G.length})  [Readability crashes count as empty text]\n| strategy | P | R | F1 | pages F1<0.5 |\n|---|---|---|---|---|`);
  for (const [name, fn] of Object.entries(strategies)) {
    const sc = G.map(g => { const x = { R: R[g.id].text || '', D: D[g.id].text || '', P: P[g.id].text || '', E: E[g.id].text || '' };
      if (!fn) { const a = scorePage(g.gt, x.R), b = scorePage(g.gt, x.D); return a.f1 >= b.f1 ? a : b; } return scorePage(g.gt, fn(x)); });
    console.log(`| ${name} | ${mean(sc.map(s => s.p)).toFixed(3)} | ${mean(sc.map(s => s.r)).toFixed(3)} | ${mean(sc.map(s => s.f1)).toFixed(3)} | ${sc.filter(s => s.f1 < .5).length} |`);
  }
}
