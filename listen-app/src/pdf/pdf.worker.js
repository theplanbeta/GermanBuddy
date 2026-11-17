// Background thread that reads one PDF: LiteParse (WebAssembly, runs on this
// device) plus the research layer (src/pdf/*.js). Based on
// research/pdf-pipeline/app/hearshot-worker.js. The page starts a fresh
// worker for every PDF and ends it afterwards, which frees all its memory and
// is also how a reading is cancelled.
//
// In:  { cmd: 'open', bytes }               (bytes: an ArrayBuffer, transferred)
// Out: { type: 'open', pages }              the PDF opened; it has this many pages
//      { type: 'page', parsed, pages }      one more page has been read
//      { type: 'done', text, scanned, order }
//      { type: 'error', kind }              'password' | 'unreadable'
import init, { LiteParse } from '@llamaindex/liteparse-wasm';
import wasmUrl from '@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url';
import { extractPdf } from './handoff.js';
import { errorKind } from './messages.js';

self.onmessage = async ({ data }) => {
  if (data?.cmd !== 'open') return;
  let opened = false;
  try {
    await init({ module_or_path: wasmUrl });
    const result = await extractPdf(new Uint8Array(data.bytes), {
      LiteParse,
      onOpen: (pages) => {
        opened = true;
        self.postMessage({ type: 'open', pages });
      },
      onPage: (parsed, pages) => self.postMessage({ type: 'page', parsed, pages }),
    });
    self.postMessage({ type: 'done', ...result });
  } catch (error) {
    // No details are shown to the listener; the console keeps them for debugging.
    console.warn('PDF could not be read:', error);
    // Only opening can fail for a password; a failure later means a damaged page.
    self.postMessage({ type: 'error', kind: opened ? 'unreadable' : errorKind(error?.message ?? error) });
  }
};
