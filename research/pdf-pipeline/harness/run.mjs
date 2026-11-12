// node harness/run.mjs <extractor,...> [--detail] [--only id-substring]  -> per-doc scores + group means
import fs from 'fs';
import { corpus } from './corpus.mjs';
import { score } from './score.mjs';
import * as base from './baselines.mjs';
const C = new URL('../out/cache/', import.meta.url).pathname;
const RES = new URL('../out/results/', import.meta.url).pathname; fs.mkdirSync(RES, { recursive: true });
export async function getExtractors() {
  const ex = { 'lp-raw': (d) => base.lpRaw(d.lp), 'lp-raw-all': (d) => base.lpRawAll(d.lp), 'pdfjs-stream': (d) => base.pdfjsStream(d.pj), 'pdfjs-xy': (d) => base.pdfjsXY(d.pj) };
  try { const pl = await import('./pipeline-variants.mjs'); Object.assign(ex, pl.variants); } catch (e) { if (!/Cannot find module/.test(e.message)) throw e; }
  return ex;
}
export function load(d) { return { ...d, lp: JSON.parse(fs.readFileSync(C + d.id + '.lp.json')), pj: JSON.parse(fs.readFileSync(C + d.id + '.pdfjs.json')) }; }
export const GROUP = (d) => d.group === 'omni' ? 'omni:' + d.id.replace(/^omni-|-\d$/g, '') : d.group + ':' + d.kind.split(' ')[0];
const keys = ['score', 'loss', 'extra', 'leak', 'order', 'paraF1', 'headF1'];
if (process.argv[1].endsWith('run.mjs')) {
  const names = process.argv[2].split(',');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const ex = await getExtractors();
  const docs = corpus().filter(d => !only || d.id.includes(only)).map(load);
  const table = {};
  for (const n of names) {
    const rows = [];
    for (const d of docs) {
      const t = performance.now(); const out = await ex[n](d); const ms = performance.now() - t;
      const s = score(d.gt, out); s.ms = +ms.toFixed(1); rows.push({ id: d.id, group: d.group, g: GROUP(d), ...s });
      if (process.argv.includes('--detail')) console.log(n.padEnd(14), d.id.padEnd(30), keys.map(k => `${k}=${s[k]}`).join(' '), 'hyph', s.hyph.per1k, JSON.stringify(s.leakByType), s.hyph.ex.slice(0, 4).join(','));
    }
    fs.writeFileSync(RES + n + '.json', JSON.stringify(rows, null, 1));
    table[n] = rows;
  }
  // summary: mean by group set
  const sets = { synthetic: r => r.group === 'synth', 'real (hand GT)': r => r.group === 'real', 'OmniDocBench': r => r.group === 'omni', ALL: r => true };
  console.log('\nextractor'.padEnd(16), Object.keys(sets).map(s => s.padEnd(16)).join(''), '| ALL: loss extra order paraF1 headF1 hyph/1k');
  for (const [n, rows] of Object.entries(table)) {
    const m = (f, k) => { const r = rows.filter(f); return r.reduce((a, x) => a + (k === 'hyph' ? x.hyph.per1k : x[k]), 0) / r.length; };
    console.log(n.padEnd(16), Object.values(sets).map(f => m(f, 'score').toFixed(1).padEnd(16)).join(''), '|', ['loss', 'extra', 'order', 'paraF1', 'headF1', 'hyph'].map(k => m(sets.ALL, k).toFixed(3)).join(' '));
  }
}
