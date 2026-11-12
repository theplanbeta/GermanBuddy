// Does disagreement between the LiteParse-based order and pdf.js geometry order predict real order errors?
import { corpus } from './corpus.mjs';
import { load, getExtractors } from './run.mjs';
import { score } from './score.mjs';
const ex = await getExtractors(); const rows = [];
for (const d0 of corpus()) {
  const d = load(d0); const hs = ex['hs-final'](d); const pj = ex['pdfjs-xy'](d); const st = ex['pdfjs-stream'](d);
  const pages = d.gt.pages || [...new Set(hs.blocks.map(b => b.page))];
  for (const pg of pages) {
    const mk = (o) => ({ id: 'x', pages: [pg], segments: o.blocks.filter(b => b.page === pg && ['paragraph', 'heading', 'list-item'].includes(b.type)).map(b => ({ type: 'paragraph', text: b.text })) });
    const hsSpoken = { blocks: hs.blocks.filter(b => b.page === pg).map(b => ({ ...b, parts: undefined })) };
    const agreeXY = score(mk(pj), hsSpoken).order, agreeStream = score(mk(st), hsSpoken).order;
    const truth = score({ ...d.gt, pages: [pg] }, hsSpoken).order;
    rows.push({ id: d.id, pg, agreeXY, agreeStream, truth });
  }
}
const flag = (r) => Math.max(r.agreeXY, r.agreeStream) < 0.9;
const bad = (r) => r.truth < 0.95;
const tp = rows.filter(r => flag(r) && bad(r)).length, fp = rows.filter(r => flag(r) && !bad(r)).length, fn = rows.filter(r => !flag(r) && bad(r)).length;
console.log('pages', rows.length, 'bad-order pages', rows.filter(bad).length, 'flagged', rows.filter(flag).length, 'TP', tp, 'FP', fp, 'FN', fn);
for (const r of rows.filter(r => flag(r) || bad(r))) console.log(r.id.padEnd(28), 'p' + r.pg, 'agreeXY', r.agreeXY.toFixed(2), 'agreeStream', r.agreeStream.toFixed(2), 'trueOrder', r.truth.toFixed(2));
