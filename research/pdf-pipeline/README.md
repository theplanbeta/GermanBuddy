# PDF and document pipeline: prototype and findings (2026-11-12)

A working prototype that turns PDFs (and DOCX, EPUB, HTML, Markdown, text)
into listening text in the browser, with the evaluation harness used to tune
it. The app in `listen-app/` does not use it yet. Verified in headless
Chromium and Node on a desktop; nothing has run on a phone.

## Result

Base extractor: `@llamaindex/liteparse-wasm` 2.18.0 (Apache-2.0). It runs in
a module Web Worker on a cross-origin-isolated page with no CDN requests,
streams page by page with flat memory (52.8 MB for a 352-page book), and
gives byte-identical output in Chromium and Node. pdf.js is not needed.

A 0 to 100 "listening score" on 38 documents with ground truth:

| Group | Raw LiteParse | Our pipeline |
|---|---|---|
| All 38 documents | 83.9 | 91.5 |
| Synthetic (12, exact truth) | 89.4 | 96.6 |
| Real with hand-made truth (6) | 83.1 | 96.9 |
| OmniDocBench pages (20) | 81.0 | 86.9 |

Known weak spot: dense academic pages from OmniDocBench score slightly worse
than raw LiteParse (76.5 against 79.4).

Speed on a loaded desktop: first page of the book ready in 0.3 to 0.7 s,
about 10 ms per page for prose, about 130 ms per page for figure-heavy pages.
Bundle: 2.71 MB (LiteParse WASM) plus 16 kB for our layer.

## Layout of this folder

- `lib/hearshot-doc.js`: `openPdf(bytes, {LiteParse, batchSize, ocrEngine})`
  returning `{stats, pages(), close()}`; each page has blocks
  `{page, blockId, type, text, bbox, level?, confidence, reason, source,
  size, continuesFrom?, glue?}` and warnings (needs-ocr, order-uncertain,
  rotated-text-skipped, empty).
- `lib/pdf-layer.js`: the rules, each behind an option switch.
- `lib/listen.js`: listening text from blocks given skip settings, user
  exclusions, "exclude everything like this" rules, margin crop and
  start-from-here; document text normalisation.
- `lib/formats.js`: DOCX (mammoth), EPUB (fflate + DOMParser), HTML
  (Readability), Markdown (marked), plain text, in the same block model.
- `lib/geometry.js`: line building, column detection, XY-cut.
- `app/`: browser test pages and workers. `test/`: unit tests.
- `harness/`: scoring (`score.mjs`) and the iteration runs.
- `tools/`: corpus builders (synthetic PDFs with exact truth, hand-made truth
  for real documents, OmniDocBench mapping), OCR runs.
- `owner/`: side-by-side "naive extraction vs Hearshot" text for five
  documents and an honest list of failures.
- `out/results/iteration-table.txt`: score after each idea.

The test corpus, downloaded models and built files are not included. Needs
`npm install` (see `package.json`). OmniDocBench is research-use only and is
for evaluation, never for shipping.

## What our layer adds, in order of gain

Paragraph splitting; header and footer removal by position and font with
odd/even pages and page-number patterns; footnotes and glued footnote
numbers; captions and figure text; tables and equations (replaced by a short
cue); reference, notes and contents sections; line numbers and watermarks;
joining paragraphs across columns and pages (linked, never rewritten, so
pages already playing do not change). De-hyphenation uses evidence from the
document itself; a 160 kB word list gave no clear gain.

Did not help: a page re-ordering repair step; a small layout model with
skip-only overrides. A large layout model (PP-DocLayoutV3, 130 MB) lifted the
overall score from 91.5 to 92.4 and is not worth shipping by default.

## Defaults proposed for the app

Read: headings, paragraphs, list items. Announce tables and equations with a
one-word cue. Skip: running heads, page numbers, footnotes, captions, figure
labels, references, contents and index pages, watermarks, line numbers;
remove citation markers. Preview with tap-to-exclude, "exclude everything
like this", margin crop, start-from-here, rules saved per document.

## Scanned pages

Our rule proposes OCR only for pages that are scanned, empty with a large
image, or garbled (2 of 352 pages in the book; LiteParse's own flag fired on
44). OCR goes through LiteParse's `ocrEngine` hook, one item per text line.
tesseract.js 7 with the 2.9 MB English data recognised 96 to 99% of words on
synthetic scans and 80 to 94% on two real scans, at 1.8 to 7.6 s per page on
a loaded desktop. PP-OCR variants were worse on noisy pages.

## Known problems

- LiteParse turns long dashes into plain hyphens ("writing is-how").
- Dense academic pages, exam sheets, magazine sidebars and cross-column
  subtitles, slide bullets merged into one paragraph, multi-story newspaper
  pages.
- "No." expands in lower case at a sentence start.
- No German word list. Right-to-left and CJK untested.
- `isComplex()` up front walks the whole file; use `includeComplexity` in the
  batch session.

## Licences

LiteParse WASM Apache-2.0 (includes pdfium); tesseract.js Apache-2.0; mammoth
BSD-2-Clause; fflate MIT; Readability Apache-2.0; marked MIT.
