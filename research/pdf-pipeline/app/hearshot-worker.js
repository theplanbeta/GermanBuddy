// Web Worker: parses PDFs with LiteParse (WASM) + the Hearshot layer and streams pages back.
import init, { LiteParse } from '@llamaindex/liteparse-wasm';
import wasmUrl from '@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url';
import { openPdf } from '../lib/hearshot-doc.js';
let ready = null, current = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.cmd === 'cancel') { current?.close(); current = null; return; }
  if (m.cmd !== 'open') return;
  try {
    const t0 = performance.now();
    if (!ready) ready = init({ module_or_path: wasmUrl });
    await ready;
    const tInit = performance.now() - t0;
    const doc = await openPdf(new Uint8Array(m.bytes), { LiteParse, batchSize: m.batchSize || 8, options: m.options || {} });
    current = doc;
    self.postMessage({ type: 'open', stats: { ...doc.stats }, tInit });
    for await (const page of doc.pages()) {
      self.postMessage({ type: 'page', page, stats: { parsedPages: doc.stats.parsedPages, pages: doc.stats.pages }, t: performance.now() - t0 });
      if (current !== doc) return;
    }
    self.postMessage({ type: 'done', stats: { ...doc.stats }, t: performance.now() - t0 });
  } catch (err) { self.postMessage({ type: 'error', message: String(err?.stack || err) }); }
};
