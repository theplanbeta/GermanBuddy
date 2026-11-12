// Converts OmniDocBench v1.0 annotations (human-made layout categories + reading order) for selected
// English pages into our ground-truth format, and keeps pages whose PDF text layer matches the GT.
import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const B = new URL('../dl/omnidoc/', import.meta.url).pathname;
const OUT = new URL('../corpus/omni/', import.meta.url).pathname;
const all = JSON.parse(fs.readFileSync(B + 'OmniDocBench_v1_0.json', 'utf8'));
const byImg = new Map(all.map(x => [x.page_info.image_path, x]));
const MAP = { title: 'heading', text_block: 'paragraph', header: 'header-footer', footer: 'header-footer', page_number: 'page-number', figure_caption: 'caption', table_caption: 'caption', equation_caption: 'caption', figure_footnote: 'caption', table_footnote: 'caption', page_footnote: 'footnote', reference: 'reference', equation_isolated: 'equation', table: 'table', abandon: 'other', code_txt: 'other', text_mask: 'other', table_mask: 'other', need_mask: 'other', figure: null };
const strip = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tok = (s) => s.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const cands = fs.readFileSync(B + 'candidates.txt', 'utf8').trim().split('\n').map(l => l.split('\t'));
const kept = {}; const report = [];
for (const [kind, img] of cands) {
  const x = byImg.get(img); const pdfName = img.replace(/\.jpg$/, '.pdf'); const pdfPath = B + 'pdf/' + pdfName;
  if (!fs.existsSync(pdfPath)) continue;
  const dets = x.layout_dets.filter(b => !b.ignore);
  const trunc = (x.extra?.relation || []).filter(r => r.relation === 'truncated');
  const contOf = new Map(trunc.map(r => [r.target_anno_id, r.source_anno_id]));
  const segs = []; const byAnno = new Map();
  const sorted = dets.slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  for (const b of sorted) {
    const type = MAP[b.category_type]; if (type === null || type === undefined) continue;
    let text = b.category_type === 'table' ? strip(b.html) : b.category_type === 'equation_isolated' ? (b.latex || b.text || '') : (b.text || '');
    text = text.replace(/\s+/g, ' ').trim(); if (!text) continue;
    const src = contOf.get(b.anno_id);
    if (src !== undefined && byAnno.has(src) && byAnno.get(src).type === type) { const s = byAnno.get(src); s.text += ' ' + text; byAnno.set(b.anno_id, s); continue; }
    const s = { type, text, order: b.order ?? null }; segs.push(s); byAnno.set(b.anno_id, s);
  }
  // text-layer check
  let words = [];
  try { const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise; const pg = await doc.getPage(1); const tc = await pg.getTextContent(); words = tok(tc.items.map(i => i.str).join(' ')); } catch (e) { }
  const bag = new Map(); words.forEach(w => bag.set(w, (bag.get(w) || 0) + 1));
  const read = segs.filter(s => ['heading', 'paragraph'].includes(s.type)).flatMap(s => tok(s.text));
  let hit = 0; for (const w of read) { const c = bag.get(w) || 0; if (c > 0) { hit++; bag.set(w, c - 1); } }
  const cov = read.length ? hit / read.length : 0;
  report.push([kind, cov.toFixed(2), read.length, pdfName.slice(0, 60)]);
  kept[kind] = kept[kind] || [];
  if (cov >= 0.9 && read.length >= 60 && kept[kind].length < 3) {
    const id = `omni-${kind}-${kept[kind].length + 1}`;
    kept[kind].push(id);
    fs.copyFileSync(pdfPath, OUT + id + '.pdf');
    fs.writeFileSync(OUT + id + '.gt.json', JSON.stringify({ id, kind: 'omni:' + kind, title: pdfName, source: 'OmniDocBench v1.0 (opendatalab, research use; human annotations: categories, reading order, text). Original PDF slice ' + pdfName, segments: segs.map(({ order, ...s }) => s), chrome: [] }, null, 1));
  }
}
for (const r of report) console.log(r.join('\t'));
console.log(JSON.stringify(kept));
