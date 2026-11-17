// What Hearshot says about an opened PDF, in plain words. Pure code: used by
// the page (src/pdf/open-pdf.js), the PDF worker and tests.

// Above this file size a warning is shown, but the PDF is still read. On a
// desktop a 352-page book needed about 53 MB of working memory while being
// read, and the whole file is held in memory besides. A phone also holds the
// voice model (about 170 to 330 MB), and phone browsers close a page that uses
// too much; 50 MB keeps the PDF's share to roughly 100 MB. Nothing has been
// measured on a phone yet, so this is a cautious guess.
export const LARGE_PDF_BYTES = 50 * 1024 * 1024;

const pages = (n) => (n === 1 ? '1 page' : `${n} pages`);

/** The first bytes say PDF ("%PDF-" within the first 1 kB, as the format allows). */
export function looksLikePdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** A warning for a large file, or '' (the PDF is read either way). */
export function sizeWarning(byteLength) {
  if (byteLength <= LARGE_PDF_BYTES) return '';
  const mb = Math.round(byteLength / (1024 * 1024));
  return `This PDF is large (${mb} MB). On a phone, reading it may be slow, and the page may reload if the phone runs short of memory.`;
}

/** Why a PDF could not be opened, from the reader's error message. */
export function errorKind(message) {
  return /password|encrypt/i.test(String(message)) ? 'password' : 'unreadable';
}

export const REFUSALS = {
  'not-pdf': 'That file is not a PDF, so Hearshot cannot open it. For other documents, copy the text and paste it here.',
  password: 'This PDF is locked with a password. Hearshot cannot open locked PDFs yet.',
  unreadable: 'This PDF could not be read. The file may be damaged or incomplete.',
  failed: 'Hearshot could not finish reading this PDF. If it is very large, try a smaller one; if this device is offline, connect and try again.',
  scanned: 'Nothing could be read from this PDF: its pages are pictures of text, which Hearshot cannot read yet. The text box was not changed.',
  empty: 'No readable text was found in this PDF. The text box was not changed.',
};

/**
 * A page with no text and nothing on it that could be text. The PDF layer
 * flags such a page "needs-ocr" with the single reason "no-text": the PDF
 * reader cannot tell blank from scanned on its text alone, so it names an
 * image when there is one ("scanned" for a full-page picture, "embedded-images"
 * for a large one; both checked with made-up PDFs in tests/pdf-e2e.test.js).
 */
const isBlankPage = (warnings) =>
  warnings.some(({ code }) => code === 'empty') || warnings.some(({ code, reasons }) => code === 'needs-ocr' && reasons === 'no-text');

/**
 * Pages that are pictures of text (no usable text layer), blank pages, and
 * pages whose reading order may be wrong, from the reader's stats and each
 * page's warnings ([{ page, warnings: [{ code, reasons }] }]).
 * A blank page is not a picture of text: it is left out without a word.
 */
export function pageProblems(stats, pageList) {
  const scanned = new Set(stats?.needsOcrPages ?? []);
  const blank = new Set();
  const order = new Set(stats?.lowConfidencePages ?? []);
  for (const { page, warnings = [] } of pageList) {
    if (isBlankPage(warnings)) blank.add(page);
    for (const { code } of warnings) {
      if (code === 'needs-ocr') scanned.add(page);
      if (code === 'order-uncertain') order.add(page);
    }
  }
  for (const page of blank) scanned.delete(page); // (the stats list blank pages as needing OCR too)
  const sorted = (s) => [...s].sort((a, b) => a - b);
  return { scanned: sorted(scanned), blank: sorted(blank), order: sorted(order) };
}

/**
 * What to tell the listener once the PDF has been read.
 * Returns { ok, text }: ok false means nothing could be read (the text box is
 * left alone, and `text` explains why); otherwise `text` holds the notes
 * about skipped pages and reading order, or ''. Blank pages are not passed
 * here: a PDF of only blank pages gets the "no readable text" refusal.
 */
export function resultMessage({ hasText, scanned = [], order = [] }) {
  if (!hasText) return { ok: false, text: scanned.length ? REFUSALS.scanned : REFUSALS.empty };
  const notes = [];
  if (scanned.length === 1) notes.push('1 page of this PDF is a picture of text. Hearshot cannot read it yet; it was skipped.');
  else if (scanned.length) notes.push(`${scanned.length} pages of this PDF are pictures of text. Hearshot cannot read those yet; they were skipped.`);
  if (order.length) notes.push(`The reading order of ${pages(order.length)} may be wrong; you can correct the text in the box.`);
  return { ok: true, text: notes.join(' ') };
}

/** "Reading PDF: page 3 of 40" */
export function progressText(parsed, total) {
  return total ? `Reading PDF: page ${Math.min(parsed + 1, total)} of ${total}` : 'Reading PDF…';
}
