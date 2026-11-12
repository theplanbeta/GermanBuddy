import fs from 'fs'; import path from 'path'; import { scorePage } from './score.mjs';
const root = path.resolve('..'); const m = a => a.reduce((x, y) => x + y, 0) / a.length;
const A = Object.entries(JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json'))).map(([id, v]) => ({ c: 'aeb', id, gt: v.articleBody }));
const W = JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json')).filter(x => x.dataset !== 'readability').map(x => ({ c: 'wceb', id: x.id, gt: x.gt }));
const ALL = [...A, ...W]; const exts = ['readability_linkedom', 'readability_lxml', 'trafilatura', 'trafilatura_recall', 'defuddle_linkedom', 'postlight', 'newspaper4k', 'extractus', 'goose3', 'unfluff', 'justext', 'baseline_body', 'hs_readability', 'hs_auto', 'hs_readability_all'];
console.log(`pooled n=${ALL.length} (181 aeb + ${W.length} wceb without the circular 'readability' set)\n| extractor | P | R | F1 | median F1 | F1<0.5 pages | leak | median ms |\n|---|---|---|---|---|---|---|---|`);
const rows = [];
for (const e of exts) { const o = { aeb: JSON.parse(fs.readFileSync(`${root}/out/aeb/${e}.json`)), wceb: JSON.parse(fs.readFileSync(`${root}/out/wceb/${e}.json`)) }; const sc = ALL.map(g => scorePage(g.gt, (o[g.c][g.id] || {}).text || '')); const ms = ALL.map(g => o[g.c][g.id].ms).sort((a, b) => a - b); const f = sc.map(s => s.f1).sort((a, b) => a - b);
  rows.push([e, m(sc.map(s => s.p)), m(sc.map(s => s.r)), m(sc.map(s => s.f1)), f[f.length >> 1], sc.filter(s => s.f1 < .5).length, m(sc.map(s => s.leak)), ms[ms.length >> 1]]); }
rows.sort((a, b) => b[3] - a[3]); for (const r of rows) console.log(`| ${r[0]} | ${r[1].toFixed(3)} | ${r[2].toFixed(3)} | ${r[3].toFixed(3)} | ${r[4].toFixed(3)} | ${r[5]} | ${r[6].toFixed(3)} | ${r[7].toFixed(0)} |`);
