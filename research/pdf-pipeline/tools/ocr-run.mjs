// Runs OCR engines on scanned PDFs in headless Chromium through LiteParse's ocrEngine hook and the
// Hearshot layer; scores word recall/precision (order-free) and CER (order-sensitive) vs reference.
import fs from 'fs';
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rawTokens } from '../harness/score.mjs';
const meta = JSON.parse(fs.readFileSync('corpus/scan/meta.json'));
import { buildLines, xycut } from '../lib/geometry.js';
// reference: the source page's text layer, items joined by geometry (pdf.js splits words at soft-hyphen points)
async function pageText(f, p) { const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0 }).promise; const pg = await d.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
  const spans = tc.items.filter(i => i.str.trim()).map(i => { const [x, yb] = vp.convertToViewportPoint(i.transform[4], i.transform[5]); const h = Math.hypot(i.transform[2], i.transform[3]); return { s: i.str, x, x2: x + i.width, yb, h }; });
  return xycut(buildLines(spans)).map(l => l.s).join('\n').replace(/([a-z])-\n([a-z])/g, '$1$2'); }
const refs = {};
for (const [id, m] of Object.entries(meta)) refs[id] = await pageText(m.src, m.page);
const omni = JSON.parse(fs.readFileSync('dl/omnidoc/OmniDocBench_v1_0.json'));
for (const [id, img] of [['omni-scan-exam', 'jiaocaineedrop_jiaocai_needrop_en_854.jpg'], ['omni-scan-textbook', 'jiaocaineedrop_jiaocai_needrop_en_1898.jpg']]) { const x = omni.find(o => o.page_info.image_path === img); refs[id] = x.layout_dets.filter(b => !b.ignore && b.text).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).map(b => b.text).join('\n'); }
const lev = (a, b) => { const m = a.length, n = b.length; let prev = new Uint32Array(n + 1).map((_, j) => j), cur = new Uint32Array(n + 1); for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; } return prev[n]; };
const bag = (t) => { const m = new Map(); for (const w of rawTokens(t).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)) m.set(w, (m.get(w) || 0) + 1); return m; };
const norm = (t) => rawTokens(t).join(' ');
const engines = (process.argv[2] || 'tess-fast,tess-best,paddle-v5,paddle-v6tiny').split(',');
const browser = await chromium.launch({ headless: true }); const ctx = await browser.newContext();
const ext = []; await ctx.route('**/*', r => { const u = r.request().url(); if (!u.startsWith('http://localhost')) { ext.push(u); return r.abort(); } return r.continue(); });
const page = await ctx.newPage(); page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:5190/ocr.html'); await page.waitForFunction(() => window.ocrReady);
const rows = [];
for (const eng of engines) for (const id of Object.keys(refs)) {
  const r = await page.evaluate(([f, e]) => window.runOcr(f, e), [`/corpus/scan/${id}.pdf`, eng]);
  if (!r.ok) { console.log(eng, id, 'ERROR', r.message.slice(0, 300)); continue; }
  const all = r.blocks.map(b => b.text).join('\n');
  const spoken = r.blocks.filter(b => ['heading', 'paragraph', 'list-item'].includes(b.type)).map(b => b.text).join(' ');
  const R = bag(refs[id]), O = bag(all); let hit = 0, nR = 0, nO = 0; for (const [w, c] of R) { nR += c; hit += Math.min(c, O.get(w) || 0); } for (const [, c] of O) nO += c;
  const a = norm(all), b = norm(refs[id]); const cer = lev(a, b) / Math.max(1, b.length);
  rows.push({ eng, id, recall: hit / nR, precision: hit / Math.max(1, nO), cer, ms: r.ocrMs, calls: r.calls, loadMs: r.loadMs, initMs: r.initMs, types: r.blocks.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {}), warnings: [...new Set(r.warnings)], src: [...new Set(r.blocks.map(x => x.source))] });
  const x = rows[rows.length - 1];
  console.log(eng.padEnd(14), id.padEnd(20), 'wordRecall', x.recall.toFixed(3), 'wordPrec', x.precision.toFixed(3), 'CER', x.cer.toFixed(3), 'ocr ms', x.ms.toFixed(0), 'calls', x.calls, 'load', x.loadMs.toFixed(0), JSON.stringify(x.types), x.src.join(','), x.warnings.join(','));
  if (process.argv.includes('-v')) console.log('   ', spoken.slice(0, 300));
}
fs.writeFileSync('out/results/ocr.json', JSON.stringify(rows, null, 1));
console.log('external requests', ext.length, ext.slice(0, 3));
await browser.close();
