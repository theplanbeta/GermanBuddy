// Caches raw LiteParse (WASM build, run in Node) and pdf.js outputs for every corpus document.
import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { corpus } from './corpus.mjs';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const OUT = new URL('../out/cache/', import.meta.url).pathname;
const force = process.argv.includes('-f');
for (const d of corpus()) {
  const lpPath = OUT + d.id + '.lp.json', pjPath = OUT + d.id + '.pdfjs.json';
  if (!force && fs.existsSync(lpPath) && fs.existsSync(pjPath)) continue;
  const bytes = new Uint8Array(fs.readFileSync(d.pdf));
  const target = undefined; // parse whole documents; the scorer filters to GT pages
  let t = performance.now();
  const lp = new LiteParse({ ocrEnabled: false, outputFormat: 'json', extractBlocks: true, extractTextMetadata: true, quiet: true, targetPages: target });
  const r = await lp.parse(bytes.slice());
  const lpMs = performance.now() - t;
  const cx = await lp.isComplex(bytes.slice());
  lp.free();
  const pages = r.pages.map(p => ({ pageNum: p.pageNum, pageLabel: p.pageLabel, width: p.width, height: p.height, blocks: p.blocks, complexity: cx[p.pageNum - 1],
    textItems: p.textItems.map(i => ({ text: i.text, x: i.x, y: i.y, width: i.width, height: i.height, fontName: i.fontName, fontSize: i.fontSize, fontWeight: i.fontWeight, rotation: i.rotation })) }));
  fs.writeFileSync(lpPath, JSON.stringify({ totalPages: r.totalPages, lpMs, pages }));
  t = performance.now();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pj = [];
  const want = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  for (const pn of want) {
    const pg = await doc.getPage(pn); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
    const items = tc.items.map(i => { const h = Math.hypot(i.transform[2], i.transform[3]); const [x, yb] = vp.convertToViewportPoint(i.transform[4], i.transform[5]); return { s: i.str, x, yb, w: i.width, h, font: i.fontName, eol: i.hasEOL, dir: i.dir, rot: Math.atan2(i.transform[1], i.transform[0]) }; });
    const fonts = {}; for (const [k, v] of Object.entries(tc.styles)) fonts[k] = v.fontFamily;
    pj.push({ pageNum: pn, W: vp.width, H: vp.height, items, fonts });
  }
  fs.writeFileSync(pjPath, JSON.stringify({ numPages: doc.numPages, ms: performance.now() - t, pages: pj }));
  console.log(d.id, 'pages', pages.length, 'lpMs', lpMs.toFixed(0));
}
