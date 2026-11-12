// Pipeline configurations evaluated cumulatively (each adds one idea to the previous one).
import { DEFAULT_OPTIONS, DocModel, preparePage, classifyPage, stitch } from '../lib/pdf-layer.js';
const OFF = Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map(k => [k, false])); OFF.dehyphenate = 'lp';
export const STEPS = [
  ['it00-lp-kinds', {}],
  ['it01-rebuild-text', { rebuildText: true, dehyphenate: 'doc', monospaceProse: true }],
  ['it02-split-paras', { splitParagraphs: true }],
  ['it03-header-footer', { headerFooter: true, pageNumbers: true, webChrome: true }],
  ['it04-footnotes', { footnotes: true, superscripts: true }],
  ['it05-captions-figs', { captions: true, figureText: true }],
  ['it06-eq-tables', { equations: true, tables: true }],
  ['it07-refs-toc', { references: true, toc: true }],
  ['it08-headings', { headingFilter: true, pullQuotes: true }],
  ['it09-linenum-wm', { lineNumbers: true, watermarks: true }],
  ['it10-stitch', { stitch: true }],
  ['it11-order-repair', { orderRepair: true, tableNotes: true }],
];
export function runPipeline(lp, opts, { streaming = false, dict = null, layout = null, layoutPolicy } = {}) {
  const doc = new DocModel(); const pages = lp.pages.map(p => preparePage(p, opts));
  if (!streaming) pages.forEach(P => doc.addPage(P));
  const ctx = { dict, layout, layoutPolicy }; let blocks = [];
  for (const P of pages) { if (streaming) doc.addPage(P); blocks.push(...classifyPage(P, doc, opts, ctx)); }
  return { blocks: stitch(blocks, opts), doc };
}
export const variants = {};
let acc = { ...OFF };
for (const [name, add] of STEPS) { acc = { ...acc, ...add }; const o = { ...acc }; variants[name] = (d) => runPipeline(d.lp, o); }
variants['hs-full'] = (d) => runPipeline(d.lp, DEFAULT_OPTIONS);
variants['hs-stream'] = (d) => runPipeline(d.lp, DEFAULT_OPTIONS, { streaming: true });

import fs from 'fs';
const LB = {}; const lb = (m) => LB[m] || (LB[m] = fs.existsSync(`out/layout/boxes-${m}.json`) ? JSON.parse(fs.readFileSync(`out/layout/boxes-${m}.json`)) : {});
const FINAL = { ...DEFAULT_OPTIONS, orderRepair: false };
export { FINAL };
for (const m of ['S', 'V3']) for (const pol of ['skip-only', 'conservative', 'full']) variants[`hs+${m}-${pol}`] = (d) => runPipeline(d.lp, FINAL, { layout: (pn) => lb(m)[`${d.id}-p${pn}`], layoutPolicy: pol });
variants['hs-final'] = (d) => runPipeline(d.lp, FINAL);
variants['hs-final-stream'] = (d) => runPipeline(d.lp, FINAL, { streaming: true });
const DICT = new Set(fs.readFileSync('lib/data/en-words.txt', 'utf8').split('\n'));
variants['hs-final-dehy-none'] = (d) => runPipeline(d.lp, { ...FINAL, dehyphenate: 'none' });
variants['hs-final-dehy-alwaysjoin'] = (d) => runPipeline(d.lp, { ...FINAL, dehyphenate: 'join' });
variants['hs-final-dehy-dict'] = (d) => runPipeline(d.lp, { ...FINAL, dehyphenate: 'dict' }, { dict: DICT });
variants['hs-final-no-tablexcl'] = variants['hs-final'];
