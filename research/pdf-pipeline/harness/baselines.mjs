// Baseline extractors over cached data. Each returns {blocks:[{page,type,text}]}.
import { spansFromPdfjs, buildLines, xycut, linesToParagraphs, joinLines, median } from '../lib/geometry.js';

export const LP_KIND = { heading: 'heading', paragraph: 'paragraph', list_item: 'list-item', table: 'table', grid_fallback: 'table', code: 'other', figure: 'figure-text', rule: null };
export function lpBlockText(b) {
  if (b.text != null) return b.text;
  if (b.lines) return b.lines.join('\n');
  if (b.rows) return [b.header || [], ...b.rows].map(r => r.map(c => c.text).join(' ')).join('\n');
  return '';
}

/** LiteParse blocks, honouring LiteParse's own kinds (code/grid/table not spoken). */
export function lpRaw(lp) {
  const blocks = [];
  for (const p of lp.pages) for (const b of p.blocks || []) { const t = LP_KIND[b.kind]; if (!t) continue; const text = lpBlockText(b); if (text.trim()) blocks.push({ page: p.pageNum, type: t, level: b.level, text }); }
  return { blocks };
}
/** LiteParse blocks, every text-bearing block spoken (what a naive reader of its output would say). */
export function lpRawAll(lp) { return { blocks: lpRaw(lp).blocks.map(b => ({ ...b, type: b.type === 'heading' ? 'heading' : 'paragraph' })) }; }

/** pdf.js text items in content-stream order, joined into lines and gap-separated paragraphs. */
export function pdfjsStream(pj) {
  const blocks = [];
  for (const p of pj.pages) {
    const lines = []; let cur = null;
    for (const i of p.items) {
      if (!i.s) { if (i.eol && cur) cur = null; continue; }
      if (cur && Math.abs(i.yb - cur.yb) < Math.max(i.h, cur.h) * 0.5 && i.x >= cur.x2 - 2) { cur.s += (i.x - cur.x2 > i.h * 0.12 && !cur.s.endsWith(' ') ? ' ' : '') + i.s; cur.x2 = i.x + i.w; }
      else { cur = { s: i.s, x: i.x, x2: i.x + i.w, yb: i.yb, h: i.h || 10 }; lines.push(cur); }
      if (i.eol) cur = null;
    }
    const L = lines.filter(l => l.s.trim()).map(l => ({ ...l, s: l.s.replace(/\s+/g, ' ').trim() }));
    const lead = median(L.slice(1).map((l, k) => l.yb - L[k].yb).filter(d => d > 0)) || 12;
    let para = [];
    const flush = () => { if (para.length) blocks.push({ page: p.pageNum, type: 'paragraph', text: joinLines(para) }); para = []; };
    L.forEach((l, k) => { const prev = L[k - 1]; if (prev && (l.yb - prev.yb > lead * 1.6 || l.yb < prev.yb - prev.h)) flush(); para.push(l); });
    flush();
  }
  return { blocks };
}

/** pdf.js geometry + XY-cut + position-and-font header/footer rule + font-size headings. */
export function pdfjsXY(pj) {
  const pages = pj.pages.map(p => { const lines = buildLines(spansFromPdfjs(p)); return { p, lines }; });
  // header/footer: lines in top/bottom 9% band; key = rounded y + font + digit-normalised text
  const band = (l, H) => l.yb < H * 0.09 ? 'T' : l.top > H * 0.91 ? 'B' : null;
  const counts = new Map();
  for (const { p, lines } of pages) { const seen = new Set(); for (const l of lines) { const b = band(l, p.H); if (!b) continue; const k = b + Math.round(l.yb / 4) + l.s.replace(/\d+/g, '#').toLowerCase(); if (!seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); } } }
  const minRep = Math.max(3, Math.ceil(pages.length * 0.4));
  const bodySize = median(pages.flatMap(({ lines }) => lines.map(l => l.h)));
  const blocks = [];
  for (const { p, lines } of pages) {
    const body = [];
    for (const l of lines) {
      const b = band(l, p.H);
      if (b && (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l.s) || /^[ivxlc]{1,6}$/i.test(l.s))) { blocks.push({ page: p.pageNum, type: 'page-number', text: l.s }); continue; }
      if (b && pages.length >= 3 && counts.get(b + Math.round(l.yb / 4) + l.s.replace(/\d+/g, '#').toLowerCase()) >= minRep) { blocks.push({ page: p.pageNum, type: 'header-footer', text: l.s }); continue; }
      body.push(l);
    }
    const ordered = xycut(body);
    for (const para of linesToParagraphs(ordered)) {
      const text = joinLines(para.lines); const h = median(para.lines.map(l => l.h));
      const isHead = h >= bodySize * 1.15 && text.length < 90 && !/[.:,;]$/.test(text) && para.lines.length <= 3;
      blocks.push({ page: p.pageNum, type: isHead ? 'heading' : 'paragraph', text });
    }
  }
  return { blocks };
}
