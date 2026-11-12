// Writes owner/*.txt: naive extraction (pdf.js text, as most readers do) next to the Hearshot output.
import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf } from '../lib/hearshot-doc.js';
import { listeningItems } from '../lib/listen.js';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const jobs = [
  ['1-research-paper', 'corpus/real/tracemonkey.pdf', [1, 2], 'Two-column research paper. Look for: author/e-mail block and copyright box, figure labels and captions skipped; columns read in order; hyphenated words rejoined.'],
  ['2-book-chapter', 'corpus/real/freeculture.pdf', [50, 51, 52], 'Book pages. Look for: the running head "36 FREE CULTURE" and the download URL at the foot disappear; note numbers glued to words ("generally,10") are removed; the sentence that runs over the page break is read as one sentence.'],
  ['3-government-3-column', 'corpus/real/federal-register-2020-17221.pdf', [2], 'Three-column government notice. Look for: the long small-print footnotes are no longer read in the middle of the text; the printer line "VerDate ..." at the bottom is gone; footnote numbers are removed from sentences.'],
  ['4-magazine', 'corpus/synth/syn-magazine.pdf', [1], 'Magazine page (made for this test). Look for: the big pull quotes (which repeat sentences) are skipped; the drop capital letter is joined to its word; the photo caption and the magazine footer are skipped. Known gap: the "At a glance" sidebar is still read in the middle of the story.'],
  ['5-legal-with-line-numbers', 'corpus/synth/syn-legal.pdf', [1, 2], 'Legal draft with line numbers and a DRAFT watermark (made for this test). Look for: the numbers 1-30 down the margin and the word DRAFT are not read; "Page 1 of 5" and the case number are skipped.'],
];
const wrap = (t, w) => { const out = []; for (const para of t.split('\n')) { let line = ''; for (const word of para.split(' ')) { if ((line + ' ' + word).trim().length > w) { out.push(line); line = word; } else line = (line + ' ' + word).trim(); } out.push(line); } return out; };
for (const [name, file, pages, note] of jobs) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const d = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let naive = '';
  for (const p of pages) { const pg = await d.getPage(p); const tc = await pg.getTextContent(); naive += tc.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join('').replace(/[ \t]+/g, ' ') + '\n'; }
  const doc = await openPdf(bytes, { LiteParse }); const blocks = [];
  for await (const pg of doc.pages()) { if (pg.page > Math.max(...pages)) { doc.close(); break; } if (pages.includes(pg.page)) blocks.push(...pg.blocks); }
  const hs = listeningItems(blocks).map(i => i.text).join('\n\n');
  const W = 62; const L = wrap(naive.trim(), W), R = wrap(hs, W);
  let txt = `${name.replace(/^\d-/, '').replace(/-/g, ' ').toUpperCase()}  (${file.split('/').pop()}, page${pages.length > 1 ? 's' : ''} ${pages.join(', ')})\nWHAT TO LOOK FOR: ${note}\n\n`;
  txt += 'NAIVE EXTRACTION (plain PDF text, as most apps read it)'.padEnd(W) + ' | ' + 'HEARSHOT (what will be read aloud)\n' + '-'.repeat(W) + '-+-' + '-'.repeat(W) + '\n';
  for (let i = 0; i < Math.max(L.length, R.length); i++) txt += (L[i] || '').padEnd(W) + ' | ' + (R[i] || '') + '\n';
  fs.writeFileSync(`owner/${name}.txt`, txt);
  console.log(name, 'naive lines', L.length, 'hearshot lines', R.length);
}
