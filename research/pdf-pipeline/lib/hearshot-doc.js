// Hearshot document API (PDF path). Environment-agnostic: pass in the LiteParse class from
// '@llamaindex/liteparse-wasm' after init(); works in a Web Worker and in Node.
//
//   const doc = await openPdf(bytes, { LiteParse });
//   doc.stats                       -> {pages, title, producer, creator, bodySize, ...} (grows while parsing)
//   for await (const page of doc.pages()) { page.blocks, page.warnings, page.ms }
//   listeningItems(allBlocks, settings)   (see listen.js)
import { DEFAULT_OPTIONS, DocModel, preparePage, classifyPage, StreamStitcher } from './pdf-layer.js';
import { xycut } from './geometry.js';

const LP_CONFIG = { ocrEnabled: false, outputFormat: 'json', extractBlocks: true, extractTextMetadata: true, includeComplexity: true, quiet: true };

export async function openPdf(bytes, { LiteParse, options = {}, batchSize = 8, dict = null, layout = null, password, ocrEngine = null, ocrLanguage = 'eng', ocrDpi = 200 } = {}) {
  const opts = { ...DEFAULT_OPTIONS, orderRepair: false, ...options };
  const lp = new LiteParse({ ...LP_CONFIG, ...(password ? { password } : {}), ...(ocrEngine ? { ocrEnabled: true, ocrEngine, ocrLanguage, dpi: ocrDpi, numWorkers: 1 } : {}) });
  const t0 = performance.now();
  const session = await lp.openBatchSession(bytes, batchSize);
  const doc = new DocModel();
  const stats = { pages: session.totalPages, parsedPages: 0, bodySize: null, openMs: performance.now() - t0, needsOcrPages: [], lowConfidencePages: [], title: null };
  const ctx = { dict, layout }; const stitcher = new StreamStitcher(opts);
  let closed = false;
  async function* pages() {
    try {
      for (;;) {
        const tb = performance.now();
        const batch = await session.nextBatch();
        if (!batch) break;
        const lpMs = (performance.now() - tb) / batch.result.pages.length;
        if (stats.producer === undefined) { stats.producer = batch.result.producer; stats.creator = batch.result.creator; }
        const prepared = batch.result.pages.map(p => { const P = preparePage(p, opts); P.ocr = (p.textItems || []).some(i => i.confidence != null && i.confidence < 1); return P; });
        prepared.forEach(P => doc.addPage(P)); // whole batch first: header/footer repetition sees the batch
        for (const P of prepared) {
          const tc = performance.now();
          const raw = classifyPage(P, doc, opts, ctx);
          const blocks = raw.map((b, i) => stitcher.push({
            page: P.pageNum, blockId: `p${P.pageNum}-b${i}`, type: b.type, text: b.text, bbox: b.bbox ? b.bbox.map(v => Math.round(v * 10) / 10) : null,
            level: b.type === 'heading' ? b.level : undefined, confidence: b.confidence, reason: b.reason, source: 'text', size: b.size ? Math.round(b.size * 10) / 10 : null,
            pageWidth: P.width, pageHeight: P.height, ...(P.ocr ? { source: 'ocr' } : {}),
          }));
          const warnings = pageWarnings(P, raw, opts);
          if (warnings.some(w => w.code === 'needs-ocr')) stats.needsOcrPages.push(P.pageNum);
          if (warnings.some(w => w.code === 'order-uncertain')) stats.lowConfidencePages.push(P.pageNum);
          if (!stats.title) { const h = blocks.find(b => b.type === 'heading'); if (h) stats.title = h.text.slice(0, 200); }
          stats.parsedPages++; stats.bodySize = doc.bodySize;
          yield { page: P.pageNum, label: P.label, width: P.width, height: P.height, blocks, warnings, ms: { liteparse: +lpMs.toFixed(1), layer: +(performance.now() - tc).toFixed(1) } };
        }
        if (closed) break;
      }
    } finally { close(); }
  }
  function close() { if (closed) return; closed = true; try { session.free(); } catch { } try { lp.free(); } catch { } }
  return { stats, pages, close };
}

/**
 * OCR decision for one page. LiteParse's needsOcr is too eager on its own ("sparse-text" fires on
 * short front-matter pages, "embedded-images" on illustrated pages with full text, "vector-text"
 * on charts), so OCR is proposed only when the text layer is missing or unreadable:
 *  - LiteParse reasons scanned / no-text / garbled, or
 *  - under 100 characters of text and an image covering most of the page, or
 *  - our own garble check: many "words" without vowels or with odd characters (Latin scripts).
 */
export function ocrDecision(cx, text) {
  const reasons = new Set((cx && cx.reasons) || []);
  const letters = text.match(/\p{L}+/gu) || [];
  const latin = letters.filter(w => /^[A-Za-zÀ-ÿ]+$/.test(w) && w.length >= 3);
  const noVowel = latin.filter(w => !/[aeiouyäöüàâéèêëîïôûùAEIOUYÄÖÜ]/.test(w)).length;
  const odd = (text.match(/[\uFFFD\uE000-\uF8FF]|[^\p{L}\p{N}\p{P}\p{Z}\p{S}\s]/gu) || []).length;
  const garbledOwn = (latin.length >= 20 && noVowel / latin.length > 0.25) || (text.length > 50 && odd / text.length > 0.05);
  const bigImage = cx && (cx.fullPageImage || cx.largestImageCoverage > 0.6);
  if (reasons.has('scanned') || reasons.has('no-text') || (cx && cx.isGarbled) || reasons.has('garbled')) return { ocr: true, why: [...reasons].filter(r => r !== 'vector-text').join('+') || 'garbled' };
  if (text.length < 100 && bigImage) return { ocr: true, why: 'little-text-big-image' };
  if (garbledOwn) return { ocr: true, why: 'own-garble-check' };
  return { ocr: false, why: reasons.size ? 'not-needed:' + [...reasons].join('+') : '' };
}

/** Per-page warnings: scanned / garbled text, uncertain reading order, dropped rotated text. */
export function pageWarnings(P, blocks, opts) {
  const w = []; const cx = P.lp.complexity;
  const text = blocks.map(b => b.text).join(' ');
  const d = ocrDecision(cx, text);
  if (d.ocr) w.push({ code: 'needs-ocr', reasons: d.why, message: text.length < 50 ? 'This page looks scanned: no readable text.' : 'Text on this page may be incomplete or garbled.' });
  else if (text.length === 0) w.push({ code: 'empty', message: 'No text on this page.' });
  const agree = P.orderAgreement ?? orderAgreement(blocks);
  if (agree < 0.9) w.push({ code: 'order-uncertain', agreement: +agree.toFixed(2), message: 'Reading order on this page may be wrong.' });
  if (P.rotatedDropped > 0) w.push({ code: 'rotated-text-skipped', count: P.rotatedDropped, message: 'Rotated text (e.g. a watermark) was skipped.' });
  return w;
}

/**
 * Agreement between the block order and an independent XY-cut order of the same text lines
 * (longest increasing subsequence ratio). Measured: < 0.9 flagged 4 of the 6 corpus pages with real
 * order errors, with 1 false alarm in 77 pages.
 */
export function orderAgreement(blocks) {
  const lines = []; blocks.forEach((b, bi) => { if (['paragraph', 'heading', 'list-item'].includes(b.type) && b.bbox) lines.push({ bi, x: b.bbox[0], x2: b.bbox[2], top: b.bbox[1], bot: b.bbox[3], yb: b.bbox[3], h: b.size || 10 }); });
  if (lines.length < 4) return 1;
  const order = xycut(lines.map(l => ({ ...l })));
  const pos = new Map(order.map((l, k) => [l.bi, k]));
  const seq = lines.map(l => pos.get(l.bi));
  const tails = []; for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
  return tails.length / seq.length;
}
