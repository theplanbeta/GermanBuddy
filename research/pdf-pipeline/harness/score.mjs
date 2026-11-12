// Listening-quality scorer. Compares extractor output blocks with ground-truth segments.
//
// Alignment: Greedy String Tiling (as in plagiarism detection) over normalised word tokens, so
// reordered text still aligns; first tiles of >= 3 words, then 1-2 word tiles only when they cover
// a whole GT segment / output block or extend an existing tile. Every metric is computed from that
// word mapping.
//
// Classes: READ = heading, paragraph, list-item (spoken by default); NEUTRAL = neutral (bylines,
// sidebars, headings of skipped sections: allowed either way); SKIP = everything else.
export const READ = new Set(['heading', 'paragraph', 'list-item']);
export const DEFAULT_SPOKEN = new Set(['heading', 'paragraph', 'list-item']);

const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
export function rawTokens(text) {
  return text.normalize('NFKC').replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, (c) => LIG[c]).replace(/­/g, '').replace(/[’‘`´]/g, "'").replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .split(/\s+/).map(t => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '')).filter(Boolean);
}
const key = (t) => t.replace(/[^\p{L}\p{N}]/gu, '');

function tokensOf(units, getType, getText) {
  const toks = [];
  units.forEach((u, ui) => { for (const r of rawTokens(getText(u))) { const k = key(r); if (k) toks.push({ k, r, unit: ui, type: getType(u), m: -1 }); } });
  return toks;
}

// Greedy string tiling. A, B arrays of {k, m}; sets A[i].m = j and B[j].m = i for matches.
function gst(A, B, minLen, accept) {
  for (;;) {
    let maxLen = minLen; const tiles = [];
    const idx = new Map();
    for (let j = 0; j + minLen <= B.length; j++) {
      let ok = true; for (let t = 0; t < minLen; t++) if (B[j + t].m >= 0) { ok = false; break; }
      if (!ok) continue;
      const h = B.slice(j, j + minLen).map(x => x.k).join(' ');
      let l = idx.get(h); if (!l) idx.set(h, l = []); if (l.length < 200) l.push(j);
    }
    for (let i = 0; i + minLen <= A.length; i++) {
      if (A[i].m >= 0) continue;
      let ok = true; for (let t = 0; t < minLen; t++) if (A[i + t].m >= 0) { ok = false; break; }
      if (!ok) continue;
      const l = idx.get(A.slice(i, i + minLen).map(x => x.k).join(' ')); if (!l) continue;
      for (const j of l) {
        let n = 0; while (i + n < A.length && j + n < B.length && A[i + n].m < 0 && B[j + n].m < 0 && A[i + n].k === B[j + n].k) n++;
        if (n < minLen) continue;
        if (accept && !accept(i, j, n)) continue;
        if (n > maxLen) { maxLen = n; tiles.length = 0; }
        if (n === maxLen) tiles.push([i, j, n]);
      }
    }
    if (!tiles.length) return;
    let marked = 0;
    for (const [i, j, n] of tiles) {
      let free = true; for (let t = 0; t < n; t++) if (A[i + t].m >= 0 || B[j + t].m >= 0) { free = false; break; }
      if (!free) continue;
      for (let t = 0; t < n; t++) { A[i + t].m = j + t; B[j + t].m = i + t; }
      marked++;
    }
    if (!marked) return;
  }
}

function align(A, B) {
  gst(A, B, 3);
  const unitLen = (T) => { const m = new Map(); T.forEach(t => m.set(t.unit, (m.get(t.unit) || 0) + 1)); return m; };
  const aLen = unitLen(A), bLen = unitLen(B);
  const accept = (i, j, n) => {
    if (n === bLen.get(B[j].unit) && (j === 0 || B[j - 1].unit !== B[j].unit)) return true; // whole GT segment
    if (n === aLen.get(A[i].unit) && (i === 0 || A[i - 1].unit !== A[i].unit)) return true; // whole output block
    if (i > 0 && j > 0 && A[i - 1].m === j - 1) return true; // extends tile on the left
    if (i + n < A.length && j + n < B.length && A[i + n].m === j + n) return true; // extends tile on the right
    return false;
  };
  for (let pass = 0; pass < 3; pass++) { gst(A, B, 2, accept); gst(A, B, 1, accept); }
}

function lisLength(seq) {
  const tails = [];
  for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; } tails[lo] = x; }
  return tails.length;
}

export function score(gt, out, opts = {}) {
  const spokenTypes = opts.spoken || DEFAULT_SPOKEN;
  const pages = gt.pages ? new Set(gt.pages) : null;
  // stitched blocks span pages: keep only the parts on evaluated pages, but as one unit (paragraph)
  const blocks = [];
  out.blocks.forEach((b, ui) => {
    if (b.parts && b.parts.length > 1 && pages) { const ps = b.parts.filter(p => pages.has(p.page)); if (ps.length) blocks.push({ ...b, text: ps.map(p => p.text).join(' '), unitId: ui }); }
    else if (!pages || pages.has(b.page)) blocks.push({ ...b, unitId: ui });
  });
  const segs = gt.segments.concat((gt.chrome || []).map(t => ({ type: 'header-footer', text: t })));
  // page numbers produced by templates are not in the DOM: add all plausible numbers as skip text
  if (gt.chrome) segs.push({ type: 'page-number', text: Array.from({ length: 400 }, (_, i) => i + 1).join(' ') });
  const B = tokensOf(segs, s => s.type, s => s.text);
  const A = tokensOf(blocks, b => b.type, b => b.text);
  const t0 = Date.now();
  align(A, B);
  const alignMs = Date.now() - t0;
  const cls = (t) => READ.has(t) ? 'read' : t === 'neutral' ? 'neutral' : 'skip';
  const spoken = A.map((a, i) => ({ a, i })).filter(({ a }) => spokenTypes.has(a.type));
  const gtRead = B.filter(b => cls(b.type) === 'read');
  // loss
  const lost = gtRead.filter(b => b.m < 0 || !spokenTypes.has(A[b.m].type)).length;
  const loss = gtRead.length ? lost / gtRead.length : 0;
  // leak / noise
  let leak = 0, noise = 0; const leakByType = {};
  for (const { a } of spoken) {
    if (a.m < 0) noise++;
    else { const c = cls(B[a.m].type); if (c === 'skip') { leak++; leakByType[B[a.m].type] = (leakByType[B[a.m].type] || 0) + 1; } }
  }
  const nSp = spoken.length || 1;
  // order: GT read-index sequence of spoken tokens matched to GT read
  const readIdx = new Map(); gtRead.forEach((b, k) => readIdx.set(b, k));
  const seq = spoken.filter(({ a }) => a.m >= 0 && cls(B[a.m].type) === 'read').map(({ a }) => readIdx.get(B[a.m]));
  const order = seq.length ? lisLength(seq) / seq.length : 1;
  let jumps = 0; for (let k = 1; k < seq.length; k++) if (Math.abs(seq[k] - seq[k - 1] - 1) > 3) jumps++;
  // paragraph boundaries
  let tp = 0, fp = 0, fn = 0;
  const sp = spoken.filter(({ a }) => a.m >= 0 && cls(B[a.m].type) === 'read');
  for (let k = 1; k < sp.length; k++) {
    const a0 = sp[k - 1].a, a1 = sp[k].a; const g0 = readIdx.get(B[a0.m]), g1 = readIdx.get(B[a1.m]);
    if (g1 !== g0 + 1) continue;
    const ob = a0.unit !== a1.unit; const gb = gtRead[g0].unit !== gtRead[g1].unit;
    if (ob && gb) tp++; else if (ob) fp++; else if (gb) fn++;
  }
  const pP = tp + fp ? tp / (tp + fp) : 1, pR = tp + fn ? tp / (tp + fn) : 1, paraF1 = pP + pR ? 2 * pP * pR / (pP + pR) : 0;
  // headings
  const gtHeads = new Map(); B.forEach(b => { if (b.type === 'heading') { const s = gtHeads.get(b.unit) || { n: 0, hit: 0 }; s.n++; if (b.m >= 0 && A[b.m].type === 'heading') s.hit++; gtHeads.set(b.unit, s); } });
  const outHeads = new Map(); A.forEach(a => { if (a.type === 'heading') { const s = outHeads.get(a.unit) || { n: 0, hit: 0 }; s.n++; if (a.m >= 0 && B[a.m].type === 'heading') s.hit++; outHeads.set(a.unit, s); } });
  const hR = gtHeads.size ? [...gtHeads.values()].filter(s => s.hit / s.n >= 0.5).length / gtHeads.size : 1;
  const hP = outHeads.size ? [...outHeads.values()].filter(s => s.hit / s.n >= 0.5).length / outHeads.size : (gtHeads.size ? 0 : 1);
  const headF1 = hP + hR ? 2 * hP * hR / (hP + hR) : 0;
  // aux classification (word level)
  const aux = {};
  for (const T of ['footnote', 'caption', 'reference', 'table', 'figure-text', 'header-footer', 'page-number', 'toc', 'equation']) {
    const g = B.filter(b => b.type === T), o = A.filter(a => a.type === T);
    if (!g.length && !o.length) continue;
    const r = g.length ? g.filter(b => b.m >= 0 && A[b.m].type === T).length / g.length : null;
    const p = o.length ? o.filter(a => a.m >= 0 && B[a.m].type === T).length / o.length : null;
    aux[T] = { gtWords: g.length, outWords: o.length, P: p, R: r };
  }
  // hyphenation errors among spoken tokens
  const V = new Set(B.map(b => b.r)); const Vk = new Set(B.map(b => b.k));
  const hyphCompounds = new Map(); B.forEach(b => { if (b.r.includes('-')) hyphCompounds.set(b.r.replace(/-/g, ''), b.r); });
  let wrongJoin = 0, missedJoin = 0, keptHyphen = 0; const hyEx = [];
  for (let k = 0; k < spoken.length; k++) {
    const t = spoken[k].a.r; const nxt = spoken[k + 1]?.a;
    if (V.has(t)) continue;
    if (!t.includes('-') && hyphCompounds.has(t)) { wrongJoin++; hyEx.push(`${t}<${hyphCompounds.get(t)}`); continue; }
    if (t.includes('-') && !t.endsWith('-') && Vk.has(key(t)) && !V.has(t)) { keptHyphen++; hyEx.push(`${t}`); continue; }
    if (/\d/.test(t) || (nxt && /\d/.test(nxt.r))) continue;
    if (nxt && Vk.has(key(t) + nxt.k) && (t.endsWith('-') || (!Vk.has(key(t)) && !Vk.has(nxt.k)) || ((!Vk.has(key(t)) || !Vk.has(nxt.k)) && Math.min(key(t).length, nxt.k.length) <= 3))) { missedJoin++; hyEx.push(`${t}|${nxt.r}`); }
  }
  const hyphErr = wrongJoin + missedJoin + keptHyphen;
  const hyph1k = 1000 * hyphErr / nSp;
  const extra = (leak + noise) / nSp;
  const S = 100 * (1 - (0.35 * loss + 0.25 * Math.min(1, extra) + 0.20 * (1 - order) + 0.10 * (1 - paraF1) + 0.05 * (1 - headF1) + 0.05 * Math.min(1, hyph1k / 5)));
  return {
    score: +S.toFixed(1), loss: +loss.toFixed(4), leak: +(leak / nSp).toFixed(4), noise: +(noise / nSp).toFixed(4), extra: +extra.toFixed(4), order: +order.toFixed(4), jumpsPer1k: +(1000 * jumps / Math.max(1, seq.length)).toFixed(2),
    paraP: +pP.toFixed(3), paraR: +pR.toFixed(3), paraF1: +paraF1.toFixed(3), headP: +hP.toFixed(3), headR: +hR.toFixed(3), headF1: +headF1.toFixed(3),
    hyph: { wrongJoin, missedJoin, keptHyphen, per1k: +hyph1k.toFixed(2), ex: hyEx.slice(0, 8) }, leakByType, aux,
    words: { gtRead: gtRead.length, spoken: spoken.length }, alignMs,
  };
}
