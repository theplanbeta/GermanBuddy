// End to end without a browser: tiny PDFs written here in code go through the
// real PDF reader (LiteParse's WebAssembly from node_modules, which gives the
// same output in Node as in Chromium) and the same code the worker runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { LiteParse } from '@llamaindex/liteparse-wasm';
import { extractPdf } from '../src/pdf/handoff.js';
import { errorKind, resultMessage, REFUSALS } from '../src/pdf/messages.js';

await init({ module_or_path: readFileSync(new URL(import.meta.resolve('@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm'))) });

/**
 * A minimal PDF: one page per entry, each a list of [fontSize, y, text] lines
 * in Helvetica (an empty list makes a page with no text at all).
 * `trailerExtra` / `extraObjects` let a test add e.g. password protection.
 */
function makePdf(pages, { extraObjects = [], trailerExtra = '' } = {}) {
  const objects = [];
  const add = (body) => objects.push(body);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(null); // the page list, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // A tiny white picture (object 4); the entry 'scan' makes a page that is only this picture, page-sized, as a scan is.
  const pixels = 'ff'.repeat(3 * 4 * 4);
  add(`<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`);
  const kids = [];
  for (const lines of pages) {
    const ops = lines === 'scan' ? 'q 612 0 0 792 0 0 cm /Im1 Do Q' : lines.map(([size, y, text]) => `BT /F1 ${size} Tf 72 ${y} Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
    add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objects.length} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  for (const body of extraObjects) add(body);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const read = (bytes) => extractPdf(bytes, { LiteParse });

test('a two-page PDF: heading, paragraph joined across lines, the next page', async () => {
  const pdf = makePdf([
    [
      [20, 700, 'A Short Title'],
      [11, 660, 'The first paragraph has a few words in it.'],
      [11, 646, 'It continues on this line. See No. 5 on p. 3.'],
    ],
    [[11, 700, 'Second page text here.']],
  ]);
  assert.ok(pdf.length < 2048, 'the test PDF stays tiny');
  const progress = [];
  const result = await extractPdf(pdf, { LiteParse, onOpen: (n) => progress.push(`open ${n}`), onPage: (p, n) => progress.push(`${p}/${n}`) });
  assert.deepEqual(progress, ['open 2', '1/2', '2/2']);
  assert.equal(result.text, 'A Short Title.\n\nThe first paragraph has a few words in it. It continues on this line. See number 5 on page 3.\n\nSecond page text here.');
  assert.deepEqual(result.scanned, []);
  assert.deepEqual(result.order, []);
});

test('a blank page is left out without a word; the rest is read', async () => {
  const result = await read(makePdf([[[11, 700, 'Only this page has words on it.']], []]));
  assert.equal(result.text, 'Only this page has words on it.');
  assert.deepEqual(result.scanned, []);
  assert.deepEqual(result.blank, [2]);
  assert.deepEqual(resultMessage({ hasText: true, scanned: result.scanned }), { ok: true, text: '' });
});

test('a page that is a picture (a scan) is reported and the rest is read', async () => {
  const result = await read(makePdf([[[11, 700, 'Only this page has words on it.']], 'scan']));
  assert.equal(result.text, 'Only this page has words on it.');
  assert.deepEqual(result.scanned, [2]);
  assert.match(resultMessage({ hasText: true, scanned: result.scanned }).text, /^1 page of this PDF is a picture of text/);
});

test('a PDF with no text at all: nothing to put in the text box', async () => {
  // Only blank pages: refused as "no readable text", not as pictures of text.
  const blank = await read(makePdf([[], []]));
  assert.equal(blank.text, '');
  assert.deepEqual(resultMessage({ hasText: false, scanned: blank.scanned }), { ok: false, text: REFUSALS.empty });
  // Only scans: refused as pictures of text.
  const scans = await read(makePdf(['scan', 'scan']));
  assert.equal(scans.text, '');
  assert.deepEqual(resultMessage({ hasText: false, scanned: scans.scanned }), { ok: false, text: REFUSALS.scanned });
});

test('a damaged file and a password-protected PDF are refused with the right reason', async () => {
  await assert.rejects(read(new TextEncoder().encode('%PDF-1.4\nnot really a pdf')), (e) => errorKind(e?.message ?? e) === 'unreadable');
  // The standard password lock (made-up keys: the reader asks for a password before anything else).
  const key = `<${'ab'.repeat(32)}>`;
  const locked = makePdf([[[11, 700, 'Secret.']]], {
    extraObjects: [`<< /Filter /Standard /V 1 /R 2 /O ${key} /U ${key} /P -4 >>`],
    trailerExtra: `/Encrypt 7 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] `,
  });
  await assert.rejects(read(locked), (e) => errorKind(e?.message ?? e) === 'password');
});
