import fs from 'fs'; import path from 'path'; import { scorePage, tok } from './score.mjs';
const root = path.resolve('..'); const ext = process.argv[2]; const N = +process.argv[3] || 8;
const gtA = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); const wc = JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json'));
const rows = []; const only = process.argv[4];
for (const [corpus, list] of [['aeb', Object.entries(gtA).map(([id, v]) => ({ id, url: v.url, gt: v.articleBody }))], ['wceb', wc]]) {
  if (only && only !== corpus) continue; const o = JSON.parse(fs.readFileSync(`${root}/out/${corpus}/${ext}.json`));
  for (const c of list) { const ex = o[c.id] || {}; const s = scorePage(c.gt, ex.text || ''); rows.push({ corpus, id: c.id, url: c.url, s, ex, gt: c.gt }); }
}
rows.sort((a, b) => a.s.f1 - b.s.f1);
for (const r of rows.slice(0, N)) {
  const g = new Set(tok(r.gt)); const e = new Set(tok(r.ex.text || ''));
  const leak = (r.ex.text || '').split('\n').filter(l => { const t = tok(l); return t.length >= 3 && t.filter(x => g.has(x)).length / t.length < .5; }).slice(0, 2).map(l => l.slice(0, 100));
  const miss = r.gt.split(/\n+/).filter(l => { const t = tok(l); return t.length >= 6 && t.filter(x => e.has(x)).length / t.length < .5; }).slice(0, 1).map(l => l.slice(0, 100));
  console.log(`${r.corpus} F1=${r.s.f1.toFixed(2)} P=${r.s.p.toFixed(2)} R=${r.s.r.toFixed(2)} ext=${r.s.nTok}w gt=${r.s.gTok}w ${String(r.url).slice(0, 70)} ${r.ex.error ? 'ERROR:' + r.ex.error.slice(0, 50) : ''}\n   LEAK: ${JSON.stringify(leak)}\n   MISSING: ${JSON.stringify(miss)}`);
}
