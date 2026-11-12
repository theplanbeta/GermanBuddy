// Geometry helpers shared by the baselines and the Hearshot pipeline. Plain ES module, no DOM.
// Coordinates: top-left origin, PDF points. A "span" is {s, x, x2, yb (baseline), h (font size), font, bold?}.

export const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

/** Normalise pdf.js text items (already in viewport space) into spans. */
export function spansFromPdfjs(page) {
  return page.items.filter(i => i.s && i.s.trim() && Math.abs(i.rot || 0) < 0.05)
    .map(i => ({ s: i.s, x: i.x, x2: i.x + i.w, yb: i.yb, h: i.h || 1, font: page.fonts?.[i.font] ? i.font : i.font }));
}

/** Normalise LiteParse textItems (top-left box) into spans. */
export function spansFromLiteParse(page) {
  return (page.textItems || []).filter(i => i.text && i.text.trim() && Math.abs(i.rotation || 0) < 3)
    .map(i => ({ s: i.text, x: i.x, x2: i.x + i.width, yb: i.y + i.height * 0.8, h: i.fontSize || i.height, font: i.fontName || '', bold: (i.fontWeight || 400) >= 600 || /bold|black|heavy|semibold/i.test(i.fontName || '') }));
}

/** Group spans into lines: same baseline (within 0.4 x height) and small horizontal gap. */
export function buildLines(spans, { gapEm = 0.9, gutters = [] } = {}) {
  // Phase 1: rows = items whose vertical extents overlap by >= 45% of the smaller height (robust to
  // inflated heights of items with tall glyphs). Phase 2: within a row, sort by x and split at
  // gaps wider than gapEm x the typical height (column gutters). Smaller raised items are superscripts.
  const ext = (o) => [o.yb - o.h * 0.8, o.yb + o.h * 0.2];
  const its = spans.slice().sort((a, b) => (a.yb - a.h * 0.4) - (b.yb - b.h * 0.4) || a.x - b.x);
  const rows = [];
  for (const it of its) {
    const [t0, t1] = ext(it); let best = null, bestOv = 0;
    for (let k = rows.length - 1; k >= 0 && k >= rows.length - 8; k--) {
      const r = rows[k]; const ov = Math.min(r.b, t1) - Math.max(r.t, t0); const hm = Math.min(r.hn, it.h);
      if (ov >= hm * 0.45 && ov / hm > bestOv && !r.items.some(o => o.x < it.x2 - 0.5 && it.x < o.x2 - 0.5 && Math.abs(o.yb - it.yb) > 0.3 * hm)) { best = r; bestOv = ov / hm; }
    }
    if (best) { best.items.push(it); if (it.h >= best.hn * 0.8) { best.t = Math.min(best.t, t0 * 0.5 + best.t * 0.5); best.b = Math.max(best.b, t1 * 0.5 + best.b * 0.5); } }
    else rows.push({ t: t0, b: t1, hn: it.h, items: [it] });
  }
  const lines = [];
  for (const r of rows) {
    const items = r.items.sort((a, b) => a.x - b.x);
    const hRef = median(items.map(i => i.h));
    let cur = null;
    for (const it of items) {
      if (cur && it.x - cur.x2 < Math.min(hRef, it.h) * gapEm + 0.5 && !gutters.some(g => g[0] >= cur.x2 - 1 && g[1] <= it.x + 1)) {
        const gap = it.x - cur.x2;
        cur.s += (gap > Math.min(hRef, it.h) * 0.12 && !/\s$/.test(cur.s) && !/^\s/.test(it.s) ? ' ' : '') + it.s;
        cur.x2 = Math.max(cur.x2, it.x2); cur.spans.push(it);
      } else { cur = { s: it.s, x: it.x, x2: it.x2, spans: [it] }; lines.push(cur); }
    }
  }
  for (const l of lines) {
    l.s = l.s.replace(/\s+/g, ' ').trim();
    const hs = median(l.spans.map(s => s.h)); const yb = median(l.spans.map(s => s.yb));
    for (const s of l.spans) if (s.h < hs * 0.82 && s.yb < yb - hs * 0.12 && l.spans.length > 1) s.sup = true;
    const big = l.spans.filter(s => !s.sup); const ref = big.length ? big : l.spans;
    l.h = median(ref.map(s => s.h)); l.yb = median(ref.map(s => s.yb));
    l.top = l.yb - l.h * 0.8; l.bot = l.yb + l.h * 0.2; l.font = ref[0]?.font; l.bold = ref.every(s => s.bold);
  }
  return lines.filter(l => l.s).sort((a, b) => a.yb - b.yb || a.x - b.x);
}

function gaps(boxes, get, min) {
  const iv = boxes.map(get).sort((a, b) => a[0] - b[0]); const g = []; let end = iv[0][1];
  for (let k = 1; k < iv.length; k++) { if (iv[k][0] - end >= min) g.push({ pos: (iv[k][0] + end) / 2, size: iv[k][0] - end }); end = Math.max(end, iv[k][1]); }
  return g;
}

/** Recursive XY-cut: prefer vertical gutters, then horizontal gaps. Returns lines in reading order. */
export function xycut(lines, { vmin = 10, hmin = 4, emV = 1.0 } = {}) {
  const out = [];
  const rec = (L) => {
    if (L.length <= 1) { out.push(...L); return; }
    const em = median(L.map(l => l.h));
    const v = gaps(L, l => [l.x, l.x2], Math.max(vmin, em * emV));
    if (v.length) { const g = v.sort((a, b) => b.size - a.size)[0]; rec(L.filter(l => (l.x + l.x2) / 2 < g.pos)); rec(L.filter(l => (l.x + l.x2) / 2 >= g.pos)); return; }
    const h = gaps(L, l => [l.top, l.bot], hmin);
    if (h.length) { const g = h.sort((a, b) => b.size - a.size)[0]; rec(L.filter(l => (l.top + l.bot) / 2 < g.pos)); rec(L.filter(l => (l.top + l.bot) / 2 >= g.pos)); return; }
    out.push(...L.sort((a, b) => a.yb - b.yb || a.x - b.x));
  };
  rec(lines);
  return out;
}

/** Split an ordered list of lines into paragraphs using vertical gap, indent and short previous line. */
export function linesToParagraphs(lines, { gapFactor = 1.45 } = {}) {
  const paras = []; let cur = null;
  const lineGaps = []; for (let k = 1; k < lines.length; k++) { const d = lines[k].yb - lines[k - 1].yb; if (d > 0 && Math.abs(lines[k].x - lines[k - 1].x) < 40) lineGaps.push(d); }
  const lead = median(lineGaps) || 12;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k], p = lines[k - 1];
    let brk = !cur;
    if (!brk) {
      const dy = l.yb - p.yb; const sameCol = Math.abs(l.x - cur.x) < l.h * 4;
      if (!sameCol || dy < -l.h || dy > lead * gapFactor) brk = true;
      else if (Math.abs(l.h - p.h) > Math.max(1, p.h * 0.15)) brk = true;
      else if (l.x > cur.x + l.h * 0.6 && l.x < cur.x + l.h * 4 && p.x <= cur.x + l.h * 0.3) brk = true; // first-line indent
      else if (cur.x2 - p.x2 > l.h * 4 && /[.!?:"”)]$/.test(p.s)) brk = true; // short previous line ending a sentence
    }
    if (brk) { cur = { lines: [], x: l.x, x2: l.x2 }; paras.push(cur); }
    cur.lines.push(l); cur.x = Math.min(cur.x, l.x); cur.x2 = Math.max(cur.x2, l.x2);
  }
  return paras;
}

/** Join lines of a paragraph into text, removing line-end hyphens before lowercase continuations. */
export function joinLines(lines, { dehyphenate = (a, b) => true } = {}) {
  let t = '';
  for (const l of lines) {
    const s = l.s;
    if (!t) { t = s; continue; }
    const m = t.match(/([\p{L}]+)[-­‐]$/u);
    if (m && /^\p{Ll}/u.test(s)) { const next = s.match(/^[\p{L}]+/u)?.[0] || ''; t = dehyphenate(m[1], next) ? t.slice(0, -1) + s : t + s; }
    else t += ' ' + s;
  }
  return t;
}

/**
 * Column gutters: vertical strips (>= minW points wide) that almost no text crosses, between 12% and
 * 88% of the page width. Returns [[x0,x1], ...] in page coordinates.
 */
export function findGutters(spans, W, { minW = 5 } = {}) {
  const n = Math.ceil(W); const cov = new Float32Array(n + 1);
  const body = spans.filter(s => s.s.trim().length > 1);
  for (const s of body) for (let x = Math.max(0, Math.floor(s.x)); x <= Math.min(n, Math.ceil(s.x2)); x++) cov[x] += 1;
  const textBins = [...cov].filter(c => c > 0); if (!textBins.length) return [];
  const thr = Math.max(0.5, median(textBins) * 0.06);
  const out = []; let st = -1;
  for (let x = 0; x <= n; x++) {
    const empty = cov[x] <= thr;
    if (empty && st < 0) st = x;
    if ((!empty || x === n) && st >= 0) { const en = x; if (en - st >= minW && st > W * 0.12 && en < W * 0.88) {
      const leftText = body.filter(s => s.x2 <= st + 1).length, rightText = body.filter(s => s.x >= en - 1).length;
      if (leftText >= 5 && rightText >= 5) out.push([st, en]); } st = -1; }
  }
  return out;
}
