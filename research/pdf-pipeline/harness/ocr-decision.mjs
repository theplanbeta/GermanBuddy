// Which pages would ask for OCR? Checks corpus text PDFs (should be none), the long book, known
// garbled / scanned PDFs from the pdf.js test suite, and our scans.
import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
import { openPdf } from '../lib/hearshot-doc.js';
import { corpus } from './corpus.mjs';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const S = '../pdf/samples/pdfjs-repo/test/pdfs/';
const files = [...corpus().map(d => d.pdf), S + 'TAMReview.pdf', S + 'scan-bad.pdf', S + 'issue12963.pdf', ...fs.readdirSync('corpus/scan').filter(f => f.endsWith('.pdf')).map(f => 'corpus/scan/' + f)];
for (const f of [...new Set(files)]) {
  const doc = await openPdf(new Uint8Array(fs.readFileSync(f)), { LiteParse });
  let n = 0, flagged = [], lpFlag = 0;
  for await (const p of doc.pages()) { n++; const w = p.warnings.find(x => x.code === 'needs-ocr'); if (w) flagged.push(p.page + ':' + w.reasons); }
  const cx = await new LiteParse({ quiet: true }).isComplex(new Uint8Array(fs.readFileSync(f))); lpFlag = cx.filter(c => c.needsOcr).length;
  console.log(f.split('/').pop().padEnd(44), 'pages', String(n).padStart(3), '| LiteParse needsOcr', String(lpFlag).padStart(3), '| ours', String(flagged.length).padStart(3), flagged.slice(0, 6).join(' '));
}
