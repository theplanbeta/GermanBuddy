// PDF text into the text box: the research layer's clean-up (shown in the box)
// followed by the app's own splitter and spoken forms (voice only) must not
// garble anything by working on the same text twice. Also the messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfText, repairForApp } from '../src/pdf/handoff.js';
import { looksLikePdf, sizeWarning, LARGE_PDF_BYTES, errorKind, pageProblems, resultMessage, progressText, REFUSALS } from '../src/pdf/messages.js';
import { splitText } from '../src/text/splitter.js';
import { spokenForms } from '../src/text/spoken.js';

const block = (text, type = 'paragraph', page = 1, i = 0) => ({ blockId: `p${page}-b${i}`, page, type, text });
/** What the text box shows for one paragraph of a PDF. */
const box = (text, type) => pdfText([block(text, type)]);
/** What the voice is given for it: the text box's sentences, through spoken forms. */
const voice = (text, type) => splitText(box(text, type)).map((s) => spokenForms(s.text));

test('"No." and "Vol." at a sentence start keep a capital, so the sentences stay apart', () => {
  assert.equal(box('It was rebuilt. No. 5 stood empty.'), 'It was rebuilt. Number 5 stood empty.');
  assert.deepEqual(voice('It was rebuilt. No. 5 stood empty.'), ['It was rebuilt.', 'Number 5 stood empty.']);
  assert.equal(box('Vol. 3 is out.'), 'Volume 3 is out.');
  assert.equal(box('No. 10 Downing Street', 'heading'), 'Number 10 Downing Street.');
  // inside a sentence nothing changes
  assert.equal(box('He said no. 5 people came.'), 'He said number 5 people came.');
  assert.equal(box('See vol. 2, p. 4.'), 'See volume 2, page 4.');
});

test('abbreviations both layers know are said once', () => {
  assert.deepEqual(voice('See Fig. 3 and Figs. 4 and 5.'), ['See Figure 3 and Figures 4 and 5.']);
  assert.deepEqual(voice('Read pp. 12–15 and p. 7.'), ['Read pages 12 to 15 and page 7.']);
  assert.deepEqual(voice('It cost €2.5 million vs. $3 million.'), ['It cost 2.5 million euros versus 3 million dollars.']);
  assert.deepEqual(voice('It is approx. 30 °C, ca. 1900.'), ['It is approximately 30 degrees Celsius, circa 1900.']);
  for (const s of voice('No. 5, Fig. 2, pp. 3–4, vs. approx. 5 km, i.e. far.')) {
    assert.doesNotMatch(s, /\b(number number|Figure Figure|pages pages|versus versus|that is, that is)\b/);
  }
});

test('"et al." does not end a sentence, and citation markers are removed', () => {
  assert.deepEqual(voice('As Smith et al. showed, it works. It does.'), ['As Smith et al showed, it works.', 'It does.']);
  assert.equal(box('Rivers move [12] slowly (Lee et al., 2020).'), 'Rivers move slowly.');
});

test('a web address becomes "link to" its site, so its digits are not read as a date', () => {
  assert.deepEqual(voice('Visit https://www.example.org/news/2026-11-12/item?id=4 today.'), ['Visit link to example.org today.']);
});

test('units and currency codes in ALL-CAPS headings are still read out', () => {
  // (only runs of three or more capitalised words are title-cased; the number ends a run)
  assert.equal(box('UP TO 5 GB OF STORAGE', 'heading'), 'UP TO 5 GB Of Storage.');
  assert.deepEqual(voice('UP TO 5 GB OF STORAGE', 'heading'), ['UP TO 5 gigabytes Of Storage.']);
  assert.deepEqual(voice('THE PRICE IN EUR 500 TODAY'), ['The Price In 500 euros TODAY']);
  assert.equal(repairForApp('Only 300 Eur and 2 Tb'), 'Only 300 EUR and 2 TB');
  assert.equal(repairForApp('Gbit and Eurostar stay'), 'Gbit and Eurostar stay');
});

test('dates, times and money are left to the voice layer, as for pasted text', () => {
  assert.equal(box('Meet at 19:30 on 1 March.'), 'Meet at 19:30 on 1 March.');
  assert.deepEqual(voice('Meet at 19:30 on 1 March.'), ['Meet at 19 30 on the 1st of March.']);
});

test('each block becomes its own paragraph; skipped pages and block types stay out', () => {
  const blocks = [
    block('Rivers', 'heading', 1, 0),
    block('Rivers carry water.', 'paragraph', 1, 1),
    block('3', 'page-number', 1, 2),
    block('1 A footnote.', 'footnote', 1, 3),
    block('a | b | c', 'table', 1, 4),
    block('xq zvb', 'paragraph', 2, 0),
    block('They end in the sea.', 'paragraph', 3, 0),
  ];
  const text = pdfText(blocks, { skipPages: [2] });
  assert.equal(text, 'Rivers.\n\nRivers carry water.\n\nTable omitted.\n\nThey end in the sea.');
  assert.deepEqual([...new Set(splitText(text).map((s) => s.para))], [0, 1, 2, 3]);
});

test('a PDF is recognised by its first bytes', () => {
  const bytes = (s) => new TextEncoder().encode(s);
  assert.equal(looksLikePdf(bytes('%PDF-1.7\n...')), true);
  assert.equal(looksLikePdf(bytes('\n\n  junk %PDF-1.4')), true);
  assert.equal(looksLikePdf(bytes('PK\u0003\u0004 a zip file')), false);
  assert.equal(looksLikePdf(bytes('')), false);
});

test('a large PDF is warned about, not refused', () => {
  assert.equal(sizeWarning(LARGE_PDF_BYTES), '');
  assert.equal(sizeWarning(3e6), '');
  assert.match(sizeWarning(80 * 1024 * 1024), /^This PDF is large \(80 MB\)\. On a phone/);
});

test('errors: a password, anything else is "could not be read"', () => {
  assert.equal(errorKind('Error: open failed: PDF error: password required'), 'password');
  assert.equal(errorKind(new Error('incorrect password')), 'password');
  assert.equal(errorKind('Error: open failed: PDF error: invalid PDF format'), 'unreadable');
  assert.equal(errorKind(undefined), 'unreadable');
  for (const text of Object.values(REFUSALS)) assert.doesNotMatch(text, /error|exception|stack/i);
});

test('page problems combine the stats and each page’s warnings', () => {
  const pages = [
    { page: 1, warnings: [] },
    { page: 2, warnings: [{ code: 'empty' }] },
    { page: 3, warnings: [{ code: 'needs-ocr' }, { code: 'order-uncertain' }] },
    { page: 4, warnings: [{ code: 'rotated-text-skipped' }] },
    // As the PDF layer flags a blank page (it is also in the stats' needsOcrPages):
    { page: 7, warnings: [{ code: 'needs-ocr', reasons: 'no-text' }] },
    // A picture without text, and a full-page scan: pictures of text.
    { page: 8, warnings: [{ code: 'needs-ocr', reasons: 'no-text+embedded-images' }] },
    { page: 9, warnings: [{ code: 'needs-ocr', reasons: 'scanned' }] },
  ];
  // Blank pages (2, 7) are not pictures of text.
  assert.deepEqual(pageProblems({ needsOcrPages: [3, 5, 7, 8, 9], lowConfidencePages: [6] }, pages), { scanned: [3, 5, 8, 9], blank: [2, 7], order: [3, 6] });
  assert.deepEqual(pageProblems(undefined, []), { scanned: [], blank: [], order: [] });
});

test('messages after reading', () => {
  assert.deepEqual(resultMessage({ hasText: true }), { ok: true, text: '' });
  assert.deepEqual(resultMessage({ hasText: true, scanned: [2, 3] }), {
    ok: true,
    text: '2 pages of this PDF are pictures of text. Hearshot cannot read those yet; they were skipped.',
  });
  assert.equal(resultMessage({ hasText: true, scanned: [4] }).text, '1 page of this PDF is a picture of text. Hearshot cannot read it yet; it was skipped.');
  assert.equal(resultMessage({ hasText: true, order: [1] }).text, 'The reading order of 1 page may be wrong; you can correct the text in the box.');
  assert.match(resultMessage({ hasText: true, scanned: [1], order: [2, 3] }).text, /skipped\. The reading order of 2 pages may be wrong/);
  assert.deepEqual(resultMessage({ hasText: false, scanned: [1, 2] }), { ok: false, text: REFUSALS.scanned });
  assert.deepEqual(resultMessage({ hasText: false }), { ok: false, text: REFUSALS.empty });
});

test('progress: "Reading PDF: page N of M"', () => {
  assert.equal(progressText(0, 0), 'Reading PDF…');
  assert.equal(progressText(0, 12), 'Reading PDF: page 1 of 12');
  assert.equal(progressText(4, 12), 'Reading PDF: page 5 of 12');
  assert.equal(progressText(12, 12), 'Reading PDF: page 12 of 12');
});
