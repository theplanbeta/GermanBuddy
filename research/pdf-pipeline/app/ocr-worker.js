// OCR spike worker: LiteParse renders the scanned page (pdfium) and calls our ocrEngine; the OCR
// boxes become LiteParse text items, so the same Hearshot layer orders and types them.
import init, { LiteParse } from '@llamaindex/liteparse-wasm';
import wasmUrl from '@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url';
import { openPdf } from '../lib/hearshot-doc.js';
import * as ort from 'onnxruntime-web';
ort.env.wasm.wasmPaths = '/static/ort/'; // never the CDN default
let lpReady = null; const engines = {};
const now = () => performance.now();
async function tesseractEngine(variant) {
  const { createWorker } = await import('tesseract.js');
  const t0 = now();
  const w = await createWorker('eng', 1, { workerPath: '/static/tesseract/worker.min.js', corePath: '/static/tesseract/core/', langPath: variant === 'best' ? '/static/tesseract/lang-best' : '/static/tesseract/lang', workerBlobURL: false, gzip: true, cacheMethod: 'none' });
  const initMs = now() - t0;
  return { initMs, async recognize(png) {
    const r = await w.recognize(new Blob([png], { type: 'image/png' }), {}, { blocks: true });
    const out = [];
    // one item per text line (word-level items made LiteParse/XY-cut split lines apart)
    for (const b of r.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) { const t = l.text.replace(/\s+/g, ' ').trim(); if (t) out.push({ text: t, bbox: [l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1], confidence: l.confidence / 100 }); }
    return out;
  } };
}
async function paddleEngine(variant) {
  const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
  const f = (p) => fetch('/static/paddle/' + p).then(r => r.arrayBuffer());
  const model = variant === 'v6tiny' ? { detection: await f('PP-OCRv6_tiny_det.onnx'), recognition: await f('PP-OCRv6_tiny_rec.onnx'), charactersDictionary: await f('ppocrv6_tiny_dict.txt') }
    : { detection: await f('PP-OCRv5_mobile_det_infer.onnx'), recognition: await f('en_PP-OCRv5_mobile_rec_infer.onnx'), charactersDictionary: await f('ppocrv5_en_dict.txt') };
  const t0 = now();
  const svc = new PaddleOcrService({ model, session: { executionProviders: ['wasm'] } });
  await svc.initialize();
  const initMs = now() - t0;
  return { initMs, async recognize(png) {
    const r = await svc.recognize(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    const out = [];
    for (const line of r.lines || []) {
      // merge the line's items unless a wide gap (column gutter) separates them
      let cur = null;
      for (const it of line.slice().sort((a, b) => a.box.x - b.box.x)) {
        const x0 = it.box.x, x1 = it.box.x + it.box.width, y0 = it.box.y, y1 = it.box.y + it.box.height;
        if (cur && x0 - cur.bbox[2] < (y1 - y0) * 1.5) { cur.text += ' ' + it.text; cur.bbox[2] = x1; cur.bbox[1] = Math.min(cur.bbox[1], y0); cur.bbox[3] = Math.max(cur.bbox[3], y1); cur.confidence = Math.min(cur.confidence, it.confidence); }
        else { cur = { text: it.text, bbox: [x0, y0, x1, y1], confidence: it.confidence }; out.push(cur); }
      }
    }
    return out;
  } };
}
self.onmessage = async (e) => {
  const { file, engine } = e.data;
  try {
    if (!lpReady) lpReady = init({ module_or_path: wasmUrl }); await lpReady;
    const key = engine; const tl = now();
    if (!engines[key]) engines[key] = engine.startsWith('tess') ? await tesseractEngine(engine.split('-')[1]) : await paddleEngine(engine.split('-')[1]);
    const loadMs = now() - tl;
    const eng = engines[key]; let ocrMs = 0, calls = 0;
    const ocrEngine = { async recognize(png, w, h, lang) { const t = now(); const r = await eng.recognize(png); ocrMs += now() - t; calls++; return r; } };
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    const t0 = now();
    const doc = await openPdf(bytes, { LiteParse, ocrEngine, ocrDpi: 200 });
    const blocks = []; const warnings = [];
    for await (const p of doc.pages()) { blocks.push(...p.blocks); warnings.push(...p.warnings.map(w => w.code)); }
    self.postMessage({ ok: true, engine, file, loadMs, initMs: eng.initMs, ocrMs, calls, totalMs: now() - t0, blocks, warnings });
  } catch (err) { self.postMessage({ ok: false, message: String(err?.stack || err) }); }
};
