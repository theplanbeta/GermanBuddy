// Hearshot PDF layer: turns LiteParse pages (blocks + textItems) into typed listening blocks.
// Plain ES module, no DOM; runs in a Web Worker and in Node (for the evaluation harness).
//
// Block: {page, blockId, type, text, bbox:[x0,y0,x1,y1], level?, confidence, reason, source}
// Types: heading, paragraph, list-item, caption, footnote, header-footer, page-number, table,
//        figure-text, equation, reference, toc, other
import { buildLines, linesToParagraphs, median, findGutters, xycut } from './geometry.js';

export const DEFAULT_OPTIONS = {
  rebuildText: true,     // rebuild block text from text items (our own line joining) instead of LP text
  splitParagraphs: true, // split LP blocks that contain several paragraphs (indent / gap)
  headerFooter: true,    // position + font repetition rule with odd/even pages and folio patterns
  pageNumbers: true,
  footnotes: true,
  superscripts: true,    // remove footnote markers glued to words ("word12")
  lineNumbers: true,     // legal / transcript line numbers in the margin
  captions: true,
  figureText: true,
  equations: true,
  tables: true,
  references: true,      // reference / notes sections and citation entries
  toc: true,
  headingFilter: true,   // demote false headings, promote short bold/large lines
  pullQuotes: true,
  watermarks: true,
  stitch: true,          // join paragraphs across columns and pages
  dehyphenate: 'doc',    // 'none' | 'lp' (keep LiteParse joins) | 'doc' (in-document evidence) | 'dict' (word list + evidence)
  monospaceProse: true,  // LiteParse 'code' blocks that are really prose (transcripts, typewriter docs)
  webChrome: true,       // browser print headers/footers (date, URL, "1/3")
  orderRepair: true,     // re-order a page with XY-cut when LiteParse's block order ping-pongs across a gutter
  tableNotes: true,      // small text right under a table -> caption (table footnotes)
};

const LP_KIND = { heading: 'heading', paragraph: 'paragraph', list_item: 'list-item', table: 'table', grid_fallback: 'table', code: 'code', figure: 'figure', rule: 'rule' };
const CAPTION_RE = /^(fig(ure|\.)?|table|tab\.|abb(ildung|\.)|tabelle|chart|exhibit|plate|map|photo(graph)?|source|sources|quelle|graph|diagram|illustration|scheme|box|note)s?\s*[\dIVXLA-Z][\w.\-–]*\s*[.:|—–-]?/i;
const REF_HEAD_RE = /^(\d+(\.\d+)*\.?\s+)?(references|bibliography|works cited|literature( cited)?|literatur(verzeichnis)?|quellen(verzeichnis)?|references and notes|sources|citations)\s*$/i;
const NOTES_HEAD_RE = /^(\d+(\.\d+)*\.?\s+)?(notes|endnotes|footnotes|anmerkungen|fußnoten)\s*$/i;
const TOC_HEAD_RE = /^(table of )?contents$|^inhalt(sverzeichnis)?$|^contents at a glance$|^index$|^register$|^table des matières$|^sommaire$/i;
const FOLIO_RE = /^((page|seite|p\.)\s*)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|von|\/|de)\s*\d{1,4})?$/i;
const MARKER_ITEM_RE = /^(\[?\d{1,3}\]?|[*†‡§¶]+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\d{1,3}(,\s?\d{1,3})*)$/;

const words = (s) => s.split(/\s+/).filter(Boolean);
const endsSentence = (s) => /[.!?:;…]["”’)\]]*$/.test(s.trim());
const isUpperStart = (s) => /^["“‘(\[]?\p{Lu}/u.test(s.trim());
const isLowerStart = (s) => /^["“‘(\[]?\p{Ll}/u.test(s.trim());
const normKey = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#]+/gu, ' ').trim();
const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
const inside = (x, y, b, tol = 2) => x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol;
const overlapY = (a, b) => Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const overlapX = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));

/** Text items -> spans; uses item height as the size measure (LiteParse fontSize can be a matrix scale). */
function spansOf(items) {
  // Size: LiteParse fontSize (scaled to points by the page's median height/fontSize ratio) when it is
  // meaningful; item height otherwise (some PDFs set size 1 and scale with the text matrix). Heights
  // alone are inflated by tall glyphs, sub/superscripts inside an item, etc.
  const ratios = items.filter(i => i.fontSize > 2 && i.height > 0).map(i => i.height / i.fontSize);
  const k = ratios.length >= items.length * 0.5 ? median(ratios) : 0;
  return items.map((i, idx) => ({ idx, s: i.text, x: i.x, x2: i.x + i.width, yb: i.y + i.height * 0.8, h: k && i.fontSize > 2 ? i.fontSize * k : (i.height || 1), font: (i.fontName || '').replace(/^[A-Z]{6}\+/, ''), bold: (i.fontWeight || 400) >= 600 || /bold|black|heavy|semibold|demi/i.test(i.fontName || ''), italic: /italic|oblique|-it\b|ital/i.test(i.fontName || ''), item: i }));
}

/** Document-level model, updated page by page (streaming). */
export class DocModel {
  constructor() { this.pages = 0; this.sizeHist = new Map(); this.bandKeys = new Map(); this.bandText = new Map(); this.vocab = new Map(); this.hyphenated = new Map(); this.leftEdges = []; this.fnSeq = 0; }
  addPage(p) {
    this.pages++;
    const tables = (p.lp.blocks || []).filter(b => (b.kind === 'table' || b.kind === 'grid_fallback') && b.bbox).map(b => [b.bbox.x, b.bbox.y, b.bbox.x + b.bbox.width, b.bbox.y + b.bbox.height]);
    for (const l of p.lines) {
      if (this.excludeTables && tables.some(t => inside((l.x + l.x2) / 2, l.yb - l.h * 0.3, t, 1))) continue;
      const k = Math.round(l.h * 2) / 2; this.sizeHist.set(k, (this.sizeHist.get(k) || 0) + l.s.length);
      for (const w of l.s.toLowerCase().match(/[\p{L}]+(-[\p{L}]+)*/gu) || []) { this.vocab.set(w, (this.vocab.get(w) || 0) + 1); if (w.includes('-')) this.hyphenated.set(w.replace(/-/g, ''), (this.hyphenated.get(w.replace(/-/g, '')) || 0) + 1); }
    }
    const seenK = new Set(), seenT = new Set();
    for (const l of p.lines) {
      const band = this.band(l, p); if (!band) continue;
      const parity = p.pageNum % 2;
      const kAll = `${band}|${Math.round(l.yb / 4)}|${l.font}|${Math.round(l.h)}`;
      for (const k of [kAll, kAll + '|p' + parity]) if (!seenK.has(k)) { seenK.add(k); this.bandKeys.set(k, (this.bandKeys.get(k) || 0) + 1); }
      const t = band + '|' + normKey(l.s);
      if (!seenT.has(t)) { seenT.add(t); this.bandText.set(t, (this.bandText.get(t) || 0) + 1); }
    }
  }
  get bodySize() {
    // char-weighted size histogram smoothed over +-6%; body = the largest size whose mass is at least
    // 60% of the peak (running text is rarely smaller than notes, captions or footnotes)
    if (this._bs && this._bsPages === this.pages) return this._bs;
    const ks = [...this.sizeHist.keys()]; const mass = (k) => ks.reduce((a, j) => a + (Math.abs(j - k) <= k * 0.06 ? this.sizeHist.get(j) : 0), 0);
    let peak = 0; for (const k of ks) peak = Math.max(peak, mass(k));
    let bk = 10; for (const k of ks.sort((a, b) => a - b)) if (mass(k) >= peak * 0.6 && this.sizeHist.get(k) >= peak * 0.15) bk = k;
    this._bs = bk; this._bsPages = this.pages; return bk;
  }
  band(l, p) { return l.bot < p.height * 0.1 ? 'T' : l.top > p.height * 0.9 ? 'B' : null; }
  bandRepeat(l, p) {
    const band = this.band(l, p); if (!band) return 0;
    const kAll = `${band}|${Math.round(l.yb / 4)}|${l.font}|${Math.round(l.h)}`;
    const all = (this.bandKeys.get(kAll) || 0) / this.pages;
    const par = (this.bandKeys.get(kAll + '|p' + (p.pageNum % 2)) || 0) / Math.max(1, Math.ceil(this.pages / 2));
    const txt = (this.bandText.get(band + '|' + normKey(l.s)) || 0) / this.pages;
    return Math.max(all, par, txt);
  }
}

/** Build per-page geometry (lines) from LiteParse page. */
export function preparePage(lp, opts = DEFAULT_OPTIONS) {
  const items = (lp.textItems || []).filter(i => i.text && i.text.trim());
  const watermark = (i) => opts.watermarks && (Math.abs(((i.rotation || 0) + 360) % 90) > 3 && Math.abs(((i.rotation || 0) + 360) % 90) < 87);
  const kept = items.filter(i => !watermark(i) && !(Math.abs(i.rotation || 0) > 1 && Math.abs((i.rotation || 0) - 360) > 1));
  const spans = spansOf(kept);
  const gutters = findGutters(spans, lp.width);
  const lines = buildLines(spans, { gutters });
  return { gutters, pageNum: lp.pageNum, label: lp.pageLabel, width: lp.width, height: lp.height, lp, spans, lines, rotatedDropped: items.length - kept.length };
}

/** Assign spans to LiteParse blocks (smallest containing bbox); returns block records with features. */
function blocksOfPage(P) {
  const lpBlocks = (P.lp.blocks || []).map((b, i) => ({ i, kind: LP_KIND[b.kind] || b.kind, raw: b, bbox: b.bbox ? [b.bbox.x, b.bbox.y, b.bbox.x + b.bbox.width, b.bbox.y + b.bbox.height] : null }));
  const withBox = lpBlocks.filter(b => b.bbox && b.kind !== 'rule' && b.kind !== 'figure');
  for (const b of lpBlocks) b.spans = [];
  const orphans = [];
  for (const s of P.spans) {
    const cx = (s.x + s.x2) / 2, cy = s.yb - s.h * 0.35;
    let best = null; for (const b of withBox) if (inside(cx, cy, b.bbox, 1.5) && (!best || area(b.bbox) < area(best.bbox))) best = b;
    if (best) best.spans.push(s); else orphans.push(s);
  }
  // LiteParse block boxes are sometimes tighter than their text (first/last lines): attach orphan
  // spans to the block directly above/below in the same column when they are within ~1.6 lines.
  const still = [];
  for (const s of orphans) {
    let best = null, bd = Infinity; const sb = [s.x, s.yb - s.h * 0.8, s.x2, s.yb + s.h * 0.2];
    for (const b of withBox) {
      if (b.kind === 'table' || overlapX(b.bbox, sb) < (s.x2 - s.x) * 0.5) continue;
      const d = sb[1] > b.bbox[3] ? sb[1] - b.bbox[3] : b.bbox[1] > sb[3] ? b.bbox[1] - sb[3] : 0;
      if (d <= s.h * 1.6 && d < bd) { bd = d; best = b; }
    }
    if (best) best.spans.push(s); else still.push(s);
  }
  return { lpBlocks, orphans: still };
}

function lpText(b) {
  if (b.text != null) return b.text.replace(/\*\*/g, '').replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
  if (b.lines) return b.lines.join('\n');
  if (b.rows) return [b.header || [], ...b.rows].map(r => r.map(c => c.text).join(' ')).join('\n');
  return '';
}

/** Remove superscript footnote markers; returns {lines, markers}. */
function stripMarkers(lines, bodySize, opts) {
  const markers = [];
  if (!opts.superscripts) return { lines, markers };
  // a raised marker can end up on a "line" of its own (too little vertical overlap with its line)
  const mh = median(lines.map(l => l.h));
  lines = lines.filter(l => { if (lines.length > 1 && l.s.length <= 4 && MARKER_ITEM_RE.test(l.s.trim()) && l.h < mh * 0.82 && lines.some(o => o !== l && o.h >= mh * 0.9 && l.yb <= o.yb && l.yb >= o.yb - o.h * 1.1 && l.x >= o.x - 2 && l.x <= o.x2 + o.h)) { markers.push(l.s.trim()); return false; } return true; });
  for (const l of lines) {
    const keep = [];
    for (const s of l.spans) {
      const raised = s.h < l.h * 0.82 && s.yb < l.yb - l.h * 0.12;
      if (raised && MARKER_ITEM_RE.test(s.s.trim()) && l.spans.length > 1) { markers.push(s.s.trim()); continue; }
      keep.push(s);
    }
    // glued markers inside one item: "generally,10" / "texture.”11"
    for (const s of keep) {
      const m = s.s.match(/^(.*?[\p{L}][.,;:!?”"’)]+)(\d{1,3})(\s.*)?$/u);
      if (m && s.h > l.h * 1.03) { markers.push(m[2]); s.s = m[1] + (m[3] || ''); }
      else if (m && /[,.;:”"’)]$/.test(m[1]) && +m[2] < 400) { markers.push(m[2]); s.s = m[1] + (m[3] || ''); }
    }
    if (keep.length !== l.spans.length) { l.spans = keep; }
    l.s = rejoin(l.spans);
  }
  return { lines: lines.filter(l => l.s), markers };
}
function rejoin(spans) {
  let t = '', x2 = null, h = 10;
  for (const s of spans.slice().sort((a, b) => a.x - b.x)) { if (t && x2 != null && s.x - x2 > Math.min(h, s.h) * 0.12 && !/\s$/.test(t) && !/^\s/.test(s.s)) t += ' '; t += s.s; x2 = s.x2; h = s.h; }
  return t.replace(/\s+/g, ' ').trim();
}

/** Line numbers: a column of small integers at the far left/right of the text, increasing downwards. */
function stripLineNumbers(P, opts) {
  if (!opts.lineNumbers) return new Set();
  const nums = P.spans.filter(s => /^\d{1,2}$/.test(s.s.trim()));
  if (nums.length < 8) return new Set();
  const byX = new Map(); for (const s of nums) { const k = Math.round(s.x / 6); (byX.get(k) || byX.set(k, []).get(k)).push(s); }
  const out = new Set();
  for (const [, col] of byX) {
    if (col.length < 8) continue;
    col.sort((a, b) => a.yb - b.yb); let inc = 0; for (let k = 1; k < col.length; k++) if (+col[k].s.trim() === +col[k - 1].s.trim() + 1) inc++;
    const others = P.spans.filter(s => !col.includes(s) && s.s.trim().length > 3);
    const left = others.length ? Math.min(...others.map(s => s.x)) : Infinity, right = others.length ? Math.max(...others.map(s => s.x2)) : -Infinity;
    const colX2 = Math.max(...col.map(s => s.x2)), colX = Math.min(...col.map(s => s.x));
    if (inc >= col.length * 0.7 && (colX2 <= left + 1 || colX >= right - 1)) col.forEach(s => out.add(s));
  }
  return out;
}

export function makeDehyphenator(doc, mode, dict) {
  return (a, b) => {
    if (mode === 'none') return false;
    if (mode === 'join') return true;
    const joined = (a + b).toLowerCase(), hy = (a + '-' + b).toLowerCase();
    if (/^\p{Lu}/u.test(b)) return false;
    const inDocJoined = (doc.vocab.get(joined) || 0), inDocHy = (doc.vocab.get(hy) || 0);
    if (inDocHy > inDocJoined) return false;
    if (inDocJoined > 0) return true;
    if (mode === 'dict' && dict) {
      if (dict.has(joined)) return true;
      // both parts real words and joined unknown: a genuine compound ("mixed-mode")
      if (dict.has(a.toLowerCase()) && dict.has(b.toLowerCase()) && a.length > 2 && b.length > 2) return false;
      return true;
    }
    return true; // default: join (most line-end hyphens are typographic)
  };
}

function lineJoin(lines, dehy) {
  let t = '';
  for (const l of lines) {
    const s = l.s; if (!s) continue;
    if (!t) { t = s; continue; }
    const m = t.match(/([\p{L}]+)[-­‐]$/u);
    if (m && /^\p{Ll}/u.test(s)) { const next = s.match(/^[\p{L}]+/u)?.[0] || ''; t = dehy(m[1], next) ? t.slice(0, -1) + s : t + s; }
    else if (/[­]$/.test(t)) t = t.slice(0, -1) + s;
    else t += ' ' + s;
  }
  return t.replace(/­/g, '').replace(/\s+/g, ' ').trim();
}

const bboxOfLines = (L) => [Math.min(...L.map(l => l.x)), Math.min(...L.map(l => l.top)), Math.max(...L.map(l => l.x2)), Math.max(...L.map(l => l.bot))];

/**
 * Classify one page. `doc` must already include this page (doc.addPage) plus whatever pages are known.
 * Returns blocks in reading order.
 */
export function classifyPage(P, doc, opts = DEFAULT_OPTIONS, ctx = {}) {
  const body = doc.bodySize; const W = P.width, H = P.height;
  const lineNums = stripLineNumbers(P, opts);
  if (lineNums.size) P.spans = P.spans.filter(s => !lineNums.has(s));
  const { lpBlocks, orphans } = blocksOfPage(P);
  const dehy = makeDehyphenator(doc, opts.dehyphenate, ctx.dict);
  const out = [];
  const rules = lpBlocks.filter(b => b.kind === 'rule' && b.bbox);
  const figures = lpBlocks.filter(b => b.kind === 'figure' && b.bbox);
  const push = (b) => { b.page = P.pageNum; out.push(b); };
  if (lineNums.size) push({ type: 'page-number', text: [...lineNums].map(s => s.s.trim()).join(' '), bbox: null, reason: 'line-numbers', confidence: 0.9, size: 0 });

  for (const b of lpBlocks) {
    if (b.kind === 'rule' || b.kind === 'figure') continue;
    let lines = b.spans.length ? buildLines(b.spans, { gapEm: 2.5, gutters: P.gutters }) : [];
    let markers = [];
    if (lines.length) ({ lines, markers } = stripMarkers(lines, body, opts));
    const size = lines.length ? median(lines.flatMap(l => l.spans.filter(s => !s.sup).map(s => s.h))) : body;
    const boldFrac = lines.length ? lines.filter(l => l.bold).length / lines.length : 0;
    const italic = lines.length && lines.every(l => l.spans.every(s => s.italic));
    const base = { lpKind: b.kind, level: b.raw.level, size, bold: boldFrac > 0.6, italic, markers, bbox: b.bbox, lines };
    const cells = b.kind === 'table' ? [...(b.raw.header || []), ...(b.raw.rows || []).flat()].map(c => c.text.trim()).filter(Boolean) : [];
    const proseTable = cells.length && cells.reduce((a, c) => a + words(c).length, 0) / cells.length >= 6;
    if (proseTable && opts.tables) b.kind = 'paragraph';
    if (b.kind === 'table') { push({ ...base, type: opts.tables ? 'table' : 'paragraph', text: lpText(b.raw), reason: 'lp-table', confidence: 0.8 }); continue; }
    if (!opts.rebuildText || !lines.length) {
      const t = lpText(b.raw); if (!t.trim()) continue;
      push({ ...base, type: b.kind === 'code' ? 'other' : b.kind, text: t.replace(/\s+/g, ' ').trim(), reason: 'lp-' + b.kind, confidence: 0.6 }); continue;
    }
    // optionally split into paragraphs
    let groups = [lines];
    if (opts.splitParagraphs && ['paragraph', 'code', 'list-item'].includes(b.kind) && lines.length > 1) groups = linesToParagraphs(lines.slice().sort((a, b2) => a.yb - b2.yb || a.x - b2.x)).map(p => p.lines);
    for (const g of groups) {
      let text = lineJoin(g, dehy); if (!text) continue;
      const first = g[0]?.spans?.slice().sort((a, c) => a.x - c.x)[0];
      if (opts.dropCaps !== false && first && /^\p{Lu}$/u.test(first.s.trim()) && first.h > median(g.flatMap(l => l.spans.map(s => s.h))) * 1.6) text = text.replace(/^(\p{Lu})\s+(?=\p{Ll})/u, '$1');
      push({ ...base, lines: g, bbox: bboxOfLines(g), size: median(g.flatMap(l => l.spans.map(s => s.h))), type: b.kind === 'code' ? (opts.monospaceProse ? 'paragraph' : 'other') : b.kind, text, reason: 'lp-' + b.kind, confidence: 0.7 });
    }
  }
  // orphan spans (outside LiteParse blocks): keep as their own blocks so nothing silently disappears
  if (orphans.length) {
    const L = buildLines(orphans, { gutters: P.gutters });
    for (const g of linesToParagraphs(L)) {
      const text = lineJoin(g.lines, dehy); if (!text) continue;
      const ob = { type: 'paragraph', lpKind: 'orphan', text, lines: g.lines, bbox: bboxOfLines(g.lines), size: median(g.lines.map(l => l.h)), bold: g.lines.every(l => l.bold), markers: [], reason: 'orphan-text', confidence: 0.4, orphan: true, page: P.pageNum };
      // insert after the nearest block above in the same column, else before the nearest block below
      let at = -1, bd = Infinity;
      out.forEach((o, k) => { if (!o.bbox || o.orphan) return; if (o.bbox[3] <= ob.bbox[1] + 2 && overlapX(o.bbox, ob.bbox) > 0) { const d = ob.bbox[1] - o.bbox[3]; if (d < bd) { bd = d; at = k + 1; } } });
      if (at < 0) out.forEach((o, k) => { if (!o.bbox || o.orphan) return; if (o.bbox[1] >= ob.bbox[3] - 2 && overlapX(o.bbox, ob.bbox) > 0) { const d = o.bbox[1] - ob.bbox[3]; if (d < bd) { bd = d; at = k; } } });
      if (at < 0) out.push(ob); else out.splice(at, 0, ob);
    }
  }
  // order repair: LiteParse sometimes emits two-column text line by line (left, right, left, ...)
  if (opts.orderRepair && P.gutters.length) {
    const g = P.gutters[0]; const mid = (g[0] + g[1]) / 2;
    const side = (b) => !b.bbox ? 0 : b.bbox[2] <= mid + 1 ? -1 : b.bbox[0] >= mid - 1 ? 1 : 0;
    const seq = out.map(side).filter(x => x); let flips = 0; for (let k = 1; k < seq.length; k++) if (seq[k] !== seq[k - 1]) flips++;
    const sided = out.filter(b => side(b)); const oneLine = sided.filter(b => (b.lines?.length || 1) <= 2).length / Math.max(1, sided.length);
    if (flips >= 4 && flips > seq.length * 0.25 && oneLine >= 0.6) {
      const boxes = out.filter(b => b.bbox).map(b => ({ b, x: b.bbox[0], x2: b.bbox[2], top: b.bbox[1], bot: b.bbox[3], yb: b.bbox[3], h: b.size || body }));
      const ordered = xycut(boxes, { vmin: Math.max(4, g[1] - g[0] - 1) }).map(o => o.b);
      const rest = out.filter(b => !b.bbox); out.length = 0; out.push(...rest, ...ordered);
      for (const b of ordered) b.reason += '+reordered';
    }
  }
  // ---------- typing rules ----------
  const bodyBlocks = out.filter(b => b.type === 'paragraph' && Math.abs(b.size - body) < body * 0.12 && words(b.text).length > 12);
  const bodyTop = bodyBlocks.length ? Math.min(...bodyBlocks.map(b => b.bbox[1])) : H * 0.08;
  const bodyBottom = bodyBlocks.length ? Math.max(...bodyBlocks.map(b => b.bbox[3])) : H * 0.92;
  for (const b of out) {
    if (!b.bbox || b.reason === 'line-numbers') continue;
    const t = b.text.trim(); const nW = words(t).length;
    const top = b.bbox[1], bot = b.bbox[3];
    // header / footer / page number
    if (opts.headerFooter || opts.pageNumbers) {
      const inTop = bot < Math.max(H * 0.1, bodyTop - 2) && bot < H * 0.2, inBot = top > Math.min(H * 0.9, bodyBottom + 2) && top > H * 0.8;
      if ((inTop || inBot) && nW <= 25 && !(opts.captions && CAPTION_RE.test(t) && /^(fig|table|tab|abb)/i.test(t))) {
        const rep = Math.max(...b.lines.map(l => doc.bandRepeat(l, P)), 0);
        if (opts.pageNumbers && FOLIO_RE.test(t)) { set(b, 'page-number', 'folio-in-band', 0.9); continue; }
        if (opts.headerFooter && doc.pages >= 3 && rep >= 0.3) { set(b, 'header-footer', `band-repeat-${rep.toFixed(2)}`, 0.85); continue; }
        if (opts.headerFooter && /^(\d{1,4}\s+\S.*|.*\S\s+\d{1,4})$/.test(t) && nW <= 12 && (b.size <= body * 1.25 || t === t.toUpperCase())) { set(b, 'header-footer', 'folio+title-in-band', 0.75); continue; }
        if (opts.headerFooter && /©|\(c\)\s*\d{4}|\bdoi\b|\bvol\.\s*\d|\bjournal\b|\bdownloaded\b|\bpublished\b|\bissn\b|\bconfidential\b|\ball rights reserved\b|\bview article online\b/i.test(t)) { set(b, 'header-footer', 'publisher-line-in-band', 0.7); continue; }
        if (opts.webChrome && (/https?:\/\/|www\.|\b\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/i.test(t) || /^\d+\s*\/\s*\d+$/.test(t))) { set(b, 'header-footer', 'browser-print-chrome', 0.8); continue; }
        if (opts.headerFooter && (b.size < body * 0.93) && nW <= 15 && !endsSentence(t)) { set(b, 'header-footer', 'small-text-in-band', 0.55); continue; }
      }
    }
  }
  // pieces of a running head split into several blocks: same baseline as a recognised header/footer
  if (opts.headerFooter) for (const b of out) {
    if (!b.bbox || !['paragraph', 'heading', 'other', 'list-item'].includes(b.type) || words(b.text).length > 15) continue;
    if ((b.bbox[3] < H * 0.12 || b.bbox[1] > H * 0.88) && out.some(o => (o.type === 'header-footer' || o.type === 'page-number') && o.bbox && Math.abs(o.bbox[1] - b.bbox[1]) < 3 && Math.abs(o.bbox[3] - b.bbox[3]) < 3)) set(b, 'header-footer', 'same-line-as-header', 0.7);
  }
  // footnotes: small text below the body, under a separator rule or starting with a marker
  if (opts.footnotes) {
    for (const b of out) {
      if (b.type !== 'paragraph' && b.type !== 'list-item' && b.type !== 'other') continue;
      if (!b.bbox || b.bbox[1] < H * 0.45) continue;
      const small = b.size < body * 0.9;
      if (!small) continue;
      const ruleAbove = rules.some(r => r.bbox[3] <= b.bbox[1] + 2 && r.bbox[1] > H * 0.4 && (r.bbox[2] - r.bbox[0]) < W * 0.5 && overlapX(r.bbox, b.bbox) > 0);
      const startsMarker = /^(\d{1,3}|[*†‡§¶]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\(\d+\))[\s.)]/.test(b.text) || /^\d{1,3}\p{Lu}/u.test(b.text);
      const belowBody = !out.some(o => o !== b && o.type === 'paragraph' && Math.abs(o.size - body) < body * 0.1 && o.bbox && o.bbox[1] > b.bbox[3] && overlapX(o.bbox, b.bbox) > 0);
      if ((ruleAbove || startsMarker) && belowBody) set(b, 'footnote', ruleAbove ? 'small-under-rule' : 'small-marker-bottom', ruleAbove && startsMarker ? 0.9 : 0.7);
    }
    // continuation footnote lines that follow a footnote block in the same column
    for (let k = 1; k < out.length; k++) { const b = out[k], p = out[k - 1]; if (p.type === 'footnote' && b.type === 'paragraph' && b.size < body * 0.9 && b.bbox && p.bbox && b.bbox[1] >= p.bbox[1] - 2 && b.bbox[1] > H * 0.45) set(b, 'footnote', 'follows-footnote', 0.6); }
  }
  // footnote markers merged into body text items ("Reports 1 from"): remove a small number between
  // words only when a footnote with that number exists on the same page
  if (opts.footnotes && opts.superscripts) {
    const nums = new Set(out.filter(b => b.type === 'footnote').map(b => (b.text.match(/^(\d{1,3})/) || [])[1]).filter(Boolean));
    const STOP = /^(than|of|to|about|over|under|page|pages|figure|fig|table|section|chapter|part|step|level|group|and|or|the|nearly|approximately|every|with|by|at|in|on|for|from|top|item|no|nr|vol|issue|article|rule|class|grade|phase|day|days|week|weeks|year|years|minus|plus|times)$/i;
    if (nums.size) for (const b of out) if (b.type === 'paragraph' || b.type === 'list-item') b.text = b.text.replace(/(\p{L}{3,})([,.;:)”"’]?) (\d{1,3}) (?=[\p{L}(])/gu, (m, w, p, n) => nums.has(n) && !STOP.test(w) ? (b.markers.push(n), `${w}${p} `) : m);
  }
  // captions
  if (opts.captions) {
    for (const b of out) {
      if (!['paragraph', 'heading', 'other', 'list-item'].includes(b.type)) continue;
      const t = b.text;
      // "Table 2: ..." / "Fig. 5." / "FIGURE 1 |" ; a body line that merely starts with "Table 2 for the" is not a caption
      const labelled = /^(fig(ure|\.)?|table|tab\.|abb(ildung|\.)|tabelle|chart|exhibit|plate|map|photo(graph)?|scheme|box)s?\s*[\dIVXLA-Z][\w.\-–]*\s*([.:|—–]|$)/i.test(t) || (/^(source|sources|quelle|note|notes)\s*:/i.test(t));
      if (CAPTION_RE.test(t) && (labelled || b.size < body * 0.95) && words(t).length <= 120 && !/^(table|figure|fig\.)\s+\d+\s+(shows|lists|summari[sz]es|presents|gives|illustrates|compares|reports)\b/i.test(t) && (b.size <= body * 1.02 || /^(fig|figure|table|abbildung|tabelle)/i.test(t))) { set(b, 'caption', 'caption-prefix', 0.85); continue; }
      const nearFig = b.bbox && figures.some(f => overlapX(f.bbox, b.bbox) > (b.bbox[2] - b.bbox[0]) * 0.5 && ((b.bbox[1] >= f.bbox[3] - 2 && b.bbox[1] - f.bbox[3] < 18) || (f.bbox[1] >= b.bbox[3] - 2 && f.bbox[1] - b.bbox[3] < 12)));
      if (nearFig && b.size < body * 0.95 && words(t).length <= 60) set(b, 'caption', 'small-text-next-to-image', 0.65);
    }
  }
  if (opts.tableNotes) {
    const tabs = out.filter(b => b.type === 'table' && b.bbox);
    for (const b of out) if (['paragraph', 'list-item'].includes(b.type) && b.bbox && b.size < body * 0.95 && words(b.text).length <= 80 && tabs.some(t => b.bbox[1] >= t.bbox[3] - 2 && b.bbox[1] - t.bbox[3] < 14 && overlapX(t.bbox, b.bbox) > 0)) set(b, 'caption', 'note-under-table', 0.6);
  }
  // figure text: inside an image box, or short scattered labels
  if (opts.figureText) {
    for (const b of out) {
      if (!['paragraph', 'heading', 'list-item', 'other'].includes(b.type) || !b.bbox) continue;
      const cx = (b.bbox[0] + b.bbox[2]) / 2, cy = (b.bbox[1] + b.bbox[3]) / 2;
      if (figures.some(f => inside(cx, cy, f.bbox, 0) && area(f.bbox) > area(b.bbox) * 2)) { set(b, 'figure-text', 'inside-image', 0.75); continue; }
      const nW = words(b.text).length;
      const labelish = nW <= 4 && !endsSentence(b.text) && !(b.size > body * 1.1) && b.lines.length <= 2;
      if (labelish && (b.size < body * 0.9 || /^[\d.,%$€£\s\-–kKmM]+$/.test(b.text))) set(b, 'figure-text', 'short-small-label', 0.6);
    }
    // chart clusters: >=4 label-like blocks near each other -> all figure text
    const lab = out.filter(b => b.type === 'figure-text' && b.reason === 'short-small-label');
    if (lab.length >= 1) for (const b of out) if (b.type === 'paragraph' && words(b.text).length <= 6 && !endsSentence(b.text) && lab.filter(l => l.bbox && Math.abs(l.bbox[1] - b.bbox[1]) < 60 && Math.abs(l.bbox[0] - b.bbox[0]) < 200).length >= 3) set(b, 'figure-text', 'near-chart-labels', 0.5);
  }
  // equations
  if (opts.equations) {
    for (const b of out) {
      if (!['paragraph', 'other', 'heading'].includes(b.type)) continue;
      const t = b.text; const toks = words(t);
      const mathChars = (t.match(/[=+−×÷∑∏∫√∞≤≥≈≠∂∇λμσπθαβγδ∈∉⊂⊆∪∩∀∃→⇒⇔|‖^_]/g) || []).length;
      const single = toks.filter(w => w.length <= 2).length;
      if (toks.length && toks.length <= 40 && mathChars >= 1 && (mathChars + single) / toks.length >= 0.6 && !/[.?!]$/.test(t)) set(b, 'equation', 'math-symbol-density', 0.6);
      else if (/^\(\d+(\.\d+)?\)$/.test(t)) set(b, 'equation', 'equation-number', 0.7);
    }
  }
  // tables of contents: dot leaders / trailing page numbers
  if (opts.toc) {
    for (const b of out) {
      if (!['paragraph', 'list-item', 'heading', 'other'].includes(b.type)) continue;
      const L = b.lines.length ? b.lines : [{ s: b.text }];
      const tocLines = L.filter(l => /(\.{3,}|…{2,}|\s{2,}|\.\s\.\s\.)\s*\d{1,4}$/.test(l.s) || /\S\s(\.\s?){3,}\s*\d+$/.test(l.s)).length;
      if (tocLines >= Math.max(1, L.length * 0.6)) set(b, 'toc', 'dot-leaders', 0.8);
      else if (ctx.inToc && /\s\d{1,4}$/.test(b.text) && words(b.text).length <= 14) set(b, 'toc', 'toc-section-line', 0.6);
      else if (/^[\p{L}][\p{L}\s'’-]+,\s*\d{1,4}(,\s*\d{1,4}(–\d+)?)*$/u.test(b.text) && words(b.text).length <= 10) set(b, 'toc', 'index-entry', 0.6);
    }
  }
  // headings: filter false ones, promote real ones
  if (opts.headingFilter) {
    for (const b of out) {
      const t = b.text.trim(); const nW = words(t).length;
      if (b.type === 'heading') {
        if (nW > 25 || (endsSentence(t) && nW > 12 && !(b.size > body * 1.3))) set(b, 'paragraph', 'demoted-long-heading', 0.6);
        else if (FOLIO_RE.test(t)) set(b, 'page-number', 'heading-is-number', 0.6);
        else if (b.size <= body * 1.02 && !b.bold && !/^\d+(\.\d+)*\.?\s+\S/.test(t) && !(t === t.toUpperCase() && /\p{Lu}{3}/u.test(t))) set(b, 'paragraph', 'demoted-not-bold-not-large', 0.5);
        else if (b.italic && b.size > body * 1.2 && nW > 6 && /^[“"]/.test(t)) set(b, 'other', 'pull-quote-heading', 0.5);
      } else if (b.type === 'paragraph' && nW <= 14 && nW >= 1 && !endsSentence(t) && /\p{L}/u.test(t) && (b.size >= body * 1.15 || (b.bold && b.size >= body * 0.97))) {
        if (!/^[\d.,%\s]+$/.test(t)) { set(b, 'heading', b.size >= body * 1.15 ? 'promoted-large-short' : 'promoted-bold-short', 0.6); b.level = b.level || (b.size >= body * 1.6 ? 1 : b.size >= body * 1.25 ? 2 : 3); }
      }
      if (b.type === 'heading' && !b.level) b.level = b.size >= body * 1.6 ? 1 : b.size >= body * 1.25 ? 2 : 3;
      if (b.type === 'heading') { const m = t.match(/^(\d+(\.\d+)*)\.?\s/); if (m) b.level = Math.min(6, m[1].split('.').length + 1); }
    }
  }
  // pull quotes: large/italic text that repeats a sentence from the body on the same page
  if (opts.pullQuotes) {
    const bodyText = out.filter(b => b.type === 'paragraph' && b.size <= body * 1.05).map(b => b.text.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ')).join(' ');
    for (const b of out) {
      if (!['heading', 'paragraph', 'other'].includes(b.type) || b.size < body * 1.15) continue;
      const q = b.text.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
      if (words(q).length >= 5 && bodyText.includes(q.split(' ').slice(0, 6).join(' '))) set(b, 'other', 'pull-quote-duplicate', 0.7);
    }
  }
  // section-based typing (references / notes / toc) is stateful across pages
  if (opts.references || opts.toc) {
    for (const b of out) {
      if (b.type === 'heading') {
        const t = b.text.trim();
        ctx.section = REF_HEAD_RE.test(t) ? 'reference' : NOTES_HEAD_RE.test(t) ? 'footnote' : TOC_HEAD_RE.test(t) ? 'toc' : null;
        ctx.sectionLevel = b.level || 2; ctx.inToc = ctx.section === 'toc';
        if (ctx.section) b.sectionStart = ctx.section;
        continue;
      }
      if (ctx.section && ['paragraph', 'list-item', 'other'].includes(b.type) && ((ctx.section === 'reference' && opts.references) || (ctx.section === 'footnote' && opts.references) || (ctx.section === 'toc' && opts.toc))) set(b, ctx.section, 'in-' + ctx.section + '-section', 0.75);
    }
    if (opts.references) for (const b of out) if (b.type === 'paragraph' && /^\[\d{1,3}\]\s+\p{Lu}/u.test(b.text) && /\b(19|20)\d{2}\b/.test(b.text) && b.size <= body * 1.0) set(b, 'reference', 'numbered-citation-entry', 0.7);
  }
  // optional layout-model assist: ctx.layout(pageNum) -> [{label, score, bbox}] in page points
  if (ctx.layout) applyLayout(out, ctx.layout(P.pageNum) || [], ctx.layoutPolicy || 'skip-only');
  // remaining LiteParse 'code' blocks
  for (const b of out) if (b.type === 'code') set(b, 'other', 'lp-code', 0.4);
  P.orderAgreement = lineOrderAgreement(out);
  return out.map(({ lines, ...rest }) => ({ ...rest, firstLineX: lines?.[0]?.x, lastLineX2: lines?.[lines.length - 1]?.x2, colX: lines?.length ? Math.min(...lines.map(l => l.x)) : rest.bbox?.[0] }));
}
export const LAYOUT_MAP = { header: 'header-footer', header_image: 'header-footer', footer: 'header-footer', footer_image: 'header-footer', number: 'page-number', footnote: 'footnote', vision_footnote: 'caption', figure_title: 'caption', chart_title: 'caption', table_title: 'caption', image: 'figure-text', chart: 'figure-text', table: 'table', formula: 'equation', display_formula: 'equation', formula_number: 'equation', reference: 'reference', reference_content: 'reference', content: 'toc', aside_text: 'other', seal: 'other', paragraph_title: 'heading', doc_title: 'heading', text: 'paragraph', abstract: 'paragraph', algorithm: 'other', inline_formula: null, vertical_text: 'other' };
const SPOKEN = new Set(['heading', 'paragraph', 'list-item']);
function applyLayout(blocks, boxes, policy) {
  for (const b of blocks) {
    if (!b.bbox) continue; const A = area(b.bbox) || 1;
    let best = null, bi = 0;
    for (const x of boxes) { if (!LAYOUT_MAP[x.label]) continue; const i = overlapX(b.bbox, x.bbox) * overlapY(b.bbox, x.bbox) / A; if (i > bi || (i === bi && best && x.score > best.score)) { bi = i; best = x; } }
    if (!best || bi < 0.5 || best.score < 0.5) continue;
    const t = LAYOUT_MAP[best.label]; if (t === b.type) { b.confidence = Math.min(0.99, (b.confidence || 0.5) + 0.2); continue; }
    const fromSpoken = SPOKEN.has(b.type), toSpoken = SPOKEN.has(t);
    if (policy === 'skip-only' && !(fromSpoken && !toSpoken)) continue;
    if (policy === 'skip-only' && t === 'figure-text' && b.lines && b.lines.length > 3) continue;
    if (policy === 'conservative' && !((fromSpoken && !toSpoken && best.score >= 0.7) || (!fromSpoken && toSpoken && best.score >= 0.85 && t !== 'heading'))) continue;
    b.reason += `+layout:${best.label}(${best.score.toFixed(2)})`; b.type = t; if (t === 'heading' && !b.level) b.level = 2;
  }
}
/**
 * Agreement between our block order and an independent XY-cut of the same text lines (longest
 * increasing subsequence ratio over lines of spoken blocks). Low values flag uncertain reading order.
 */
export function lineOrderAgreement(blocks) {
  const L = []; for (const b of blocks) if (['paragraph', 'heading', 'list-item'].includes(b.type) && b.lines) for (const l of b.lines) L.push({ x: l.x, x2: l.x2, top: l.top, bot: l.bot, yb: l.yb, h: l.h, k: L.length, stream: Math.min(...l.spans.map(s => s.idx ?? 0)) });
  if (L.length < 6) return 1;
  const lis = (seq) => { const tails = []; for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; } return tails.length / seq.length; };
  const pos = new Map(xycut(L.map(l => ({ ...l }))).map((l, i) => [l.k, i]));
  // (tried: also accepting agreement with the content-stream order; it caught fewer real errors)
  return lis(L.map(l => pos.get(l.k)));
}
function set(b, type, reason, confidence) { b.type = type; b.reason = reason; b.confidence = confidence; }

/**
 * Should block b continue paragraph `last` (split by a column or page break)? Returns the glue:
 * '' (drop cap or hyphenated compound), 'hyphen' (remove the line-end hyphen), ' ' (plain join),
 * or null. `adjacent` = no other block was emitted in between.
 */
export function stitchGlue(last, b, adjacent) {
  if (!last || b.type !== 'paragraph' || last.type !== 'paragraph') return null;
  const sizeOk = Math.abs((b.size || 0) - (last.size || 0)) < Math.max(0.6, (last.size || 10) * 0.08);
  if (adjacent && /^\p{Lu}$/u.test(last.text.trim()) && isLowerStart(b.text)) return 'dropcap';
  if (/\p{L}-$/u.test(last.text) && isUpperStart(b.text) && sizeOk) return '';
  if (!endsSentence(last.text) && (isLowerStart(b.text) || /^[\d(“"‘]/.test(b.text) || !isUpperStart(b.text)) && sizeOk) return /\p{L}-$/u.test(last.text) && isLowerStart(b.text) ? 'hyphen' : ' ';
  if (!endsSentence(last.text) && isUpperStart(b.text) && b.page !== last.page && Math.abs((b.size || 0) - (last.size || 0)) < 0.6 && /[,;]$|\b(the|a|an|of|and|or|to|in|for|with|by|as|at|on|der|die|das|und|oder|von|mit)$/i.test(last.text)) return ' ';
  return null;
}
export function applyGlue(text, glue, next) {
  if (glue === 'dropcap') return text.trim() + next;
  if (glue === 'hyphen') return text.slice(0, -1) + next;
  return text + glue + next;
}
/** Whole-array stitching (merges continued paragraphs; keeps per-page parts). */
export function stitch(blocks, opts = DEFAULT_OPTIONS) {
  if (!opts.stitch) return blocks;
  const out = []; let last = null;
  for (const b of blocks) {
    const glue = stitchGlue(last, b, last === out[out.length - 1]);
    if (glue !== null) {
      last.text = applyGlue(last.text, glue, b.text); last.reason += glue === 'dropcap' ? '+drop-cap' : '+stitched';
      if (glue === 'dropcap') { last.parts = [{ page: b.page, text: last.text }]; last.size = b.size; } else last.parts.push({ page: b.page, text: b.text, glue });
      continue;
    }
    b.parts = [{ page: b.page, text: b.text }];
    out.push(b);
    if (b.type === 'paragraph') last = b;
    else if (b.type === 'heading' || b.type === 'list-item' || b.type === 'table') last = null;
  }
  return out;
}

/** Streaming stitching: link instead of merge, so already-emitted blocks never change. */
export class StreamStitcher {
  constructor(opts = DEFAULT_OPTIONS) { this.opts = opts; this.last = null; this.lastEmitted = null; }
  push(b) {
    if (this.opts.stitch) {
      const glue = stitchGlue(this.last, b, this.last && this.last === this.lastEmitted);
      if (glue !== null) { b.continuesFrom = this.last.continuesFrom || this.last.blockId; b.glue = glue; b.reason += '+continues'; }
    }
    this.lastEmitted = b;
    if (b.type === 'paragraph') this.last = b.glue === undefined ? b : { ...this.last, text: applyGlue(this.last.text, b.glue, b.text), page: b.page, size: b.size, type: 'paragraph' };
    else if (b.type === 'heading' || b.type === 'list-item' || b.type === 'table') this.last = null;
    return b;
  }
}
