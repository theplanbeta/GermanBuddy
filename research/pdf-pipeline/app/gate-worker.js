import init, { LiteParse } from '@llamaindex/liteparse-wasm';
import wasmUrl from '@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url';
let wasm = null;
const now = () => performance.now();
self.onmessage = async (e) => {
  const { file, batchSize = 1, maxPages = 2000, blocks = true, metadata = false } = e.data;
  try {
    const t0 = now();
    if (!wasm) wasm = await init({ module_or_path: wasmUrl });
    const tInit = now() - t0;
    const t1 = now();
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    const tFetch = now() - t1;
    const lp = new LiteParse({ ocrEnabled: false, outputFormat: 'json', extractBlocks: blocks, extractTextMetadata: metadata, quiet: true, maxPages });
    const t2 = now();
    const cx = await lp.isComplex(bytes);
    const tComplex = now() - t2;
    const t3 = now();
    const sess = await lp.openBatchSession(bytes, batchSize);
    const tOpen = now() - t3;
    self.postMessage({ type: 'open', tInit, tFetch, tComplex, tOpen, totalPages: sess.totalPages, bytes: bytes.length, needsOcr: cx.filter(p => p.needsOcr).length, wasmMem: wasm.memory.buffer.byteLength });
    let firstPageAt = null, n = 0, tPrev = now(), maxWasm = 0, words = 0;
    const per = [];
    for (;;) {
      const b = await sess.nextBatch();
      if (!b) break;
      for (const p of b.result.pages) {
        n++; const dt = now() - tPrev; tPrev = now();
        const nb = (p.blocks || []).length; words += (p.text || '').split(/\s+/).length;
        per.push(dt);
        if (firstPageAt === null) firstPageAt = now() - t0;
        maxWasm = Math.max(maxWasm, wasm.memory.buffer.byteLength);
        if (n <= 3 || n % 50 === 0) self.postMessage({ type: 'page', page: p.pageNum, ms: +dt.toFixed(1), blocks: nb, wasmMB: +(wasm.memory.buffer.byteLength / 1048576).toFixed(1), kinds: [...new Set((p.blocks||[]).map(x=>x.kind))].join(',') });
      }
    }
    sess.free(); lp.free();
    per.sort((a, b) => a - b);
    self.postMessage({ type: 'done', pages: n, words, totalMs: now() - t0, firstPageAt, medianPageMs: per[per.length >> 1], p95PageMs: per[Math.floor(per.length * 0.95)], maxPageMs: per[per.length - 1], maxWasmMB: maxWasm / 1048576 });
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.stack || err) }); }
};
