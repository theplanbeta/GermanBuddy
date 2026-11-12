// LiteParse WASM cost per option set (Node, single thread), whole document.
import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const base = { ocrEnabled: false, outputFormat: 'json', quiet: true };
const sets = { 'plain json': {}, '+blocks': { extractBlocks: true }, '+blocks+textMetadata': { extractBlocks: true, extractTextMetadata: true }, '+blocks+meta+complexity (app)': { extractBlocks: true, extractTextMetadata: true, includeComplexity: true } };
for (const f of process.argv.slice(2)) {
  const bytes = new Uint8Array(fs.readFileSync(f));
  for (const [n, o] of Object.entries(sets)) { const lp = new LiteParse({ ...base, ...o }); const t = performance.now(); const r = await lp.parse(bytes.slice()); const ms = performance.now() - t; lp.free(); console.log(f.split('/').pop().padEnd(18), n.padEnd(32), (ms / r.pages.length).toFixed(1), 'ms/page'); }
  const lp = new LiteParse(base); const t = performance.now(); await lp.isComplex(bytes.slice()); console.log(f.split('/').pop().padEnd(18), 'isComplex (whole doc)'.padEnd(32), ((performance.now() - t)).toFixed(0), 'ms total'); lp.free();
}
