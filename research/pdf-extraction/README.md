# PDF to listening text: research notes (2026-11-12)

Research for the "open a PDF and listen" feature. Nothing here is used by the
app yet. The `.mjs` files are the small Node test scripts (pdfjs-dist 6.5.438
and mupdf 1.28.6 on sample PDFs from the mozilla/pdf.js repository).

## Recommendation

Stage 1, fully in the browser: pdf.js text geometry (Apache-2.0) with rules on
top. Start from pdf.js's own stream order, repair pages that interleave with a
small XY-cut / gutter pass, remove headers, footers and page numbers by
cross-page repetition, classify blocks with simple rules, and show a preview
where the user can exclude blocks.

Stage 2: tesseract.js 7 (Apache-2.0, self-hosted, no CDN) for scanned or
garbled pages, fed through the same pipeline, plus a per-page quality warning.

Stage 3, optional: a small layout-detection model for ambiguous pages; an AI
repair pass that is rejected if it changes the text beyond a small edit
distance. MuPDF.js was not chosen: AGPL licence, 10 MB download, and no better
than XY-cut on the chart page tested.

## Block representation

```
{page, blockId, type, text, bbox:[x0,y0,x1,y1], fontSize, confidence,
 source:'text'|'ocr'|'struct', level?, reason, sentences:[...]}
```

`type`: heading, paragraph, caption, footnote, header-footer, page-number,
table, figure-text, reference, toc, other. `reason` names the rule that fired.

Skip settings per type (defaults): captions off, footnotes off, references
skipped, citation markers skipped, URLs skipped, tables off. Corrections: tap
a block to exclude it, "exclude everything like this", a margin crop applied
to all pages, "start reading from here". Store rules per document, not text.

## Measured on the two-column sample paper (tracemonkey.pdf, 14 pages)

- pdf.js stream order was already column-correct on 11 of 14 pages (a LaTeX
  artefact; do not assume it for Word or InDesign files). A plain top-to-bottom
  sort was far worse.
- XY-cut gave a clean left-then-right order on 12 of 14 pages; the title page
  (author block) and a chart page stayed imperfect.
- The header/footer rule caught a report's footer on 22 of 23 pages (missed
  the cover). Page-number handling on a prose book was not tested.
- Font size did not separate chart labels from body text; a geometry rule
  (runs of short narrow lines) did better but missed one chart.
- The caption pattern found all 13 figure captions.
- Tagged-PDF structure was absent in the real papers tested; use it only when
  present.
- pdf.js took 13 to 47 ms per page on desktop Node. Phone speed is unmeasured.

## Starting heuristics

| Rule | Start value | Known failures |
|---|---|---|
| Header/footer | top or bottom 9% of page, digits normalised, repeated on 40%+ of pages (min 3); test odd and even pages separately | cover pages; running titles that change per chapter; very short documents |
| Page number | lone number or roman numeral in the band, or "Page n of m"; check the sequence across pages | a real number alone in a margin |
| Line merge | same baseline within 0.35 x font height, gap under 1.2 x font height | superscripts left as stray lines; wide justified gaps |
| Column gutter | vertical gap of 10 pt or 1.2 em spanning most of the region | figures crossing the gutter; sidebars |
| Horizontal cut | gap of 4 pt or more, largest first, only when no vertical gap | short pages |
| Heading | font 1.15 x body median or bold, under about 80 characters, no final period | large-font body text; run-in headings |
| Caption | line starts with Figure / Fig. / Table + number + "." or ":" | in-text references that start a line |
| Figure text | 5+ consecutive lines of 22 characters or fewer, under 20% page width, no final period | author blocks; charts drawn as images |
| Footnote | font under 0.85 x body, bottom 25% of page, starts with a number or symbol | same-size footnotes; page-bottom captions |
| References | heading "References / Bibliography / Works Cited", then entries; skip to next heading of equal level | appendices after references |
| De-hyphenate | line ends "-" and next starts lowercase; join if the joined word is known | real compounds, names |
| Paragraph break | gap over 0.5 x line height beyond normal leading, first-line indent, or short previous line; join across pages when no sentence end | poems, lists |
| Citation markers | `[12]`, `[3, 4]`, `(Smith et al., 2020)` | brackets in code or maths |
| Equations, tables | replace with a short cue or skip | hard to detect by text rules |

## Not verified

Phone speed and memory on long books; scanned pages with OCR; tables,
equations, footnotes, drop caps and sidebars (no samples); any layout model in
a browser; licences of the layout models (from memory).

## Follow-up: open-source projects to build on (2026-11-12)

Tested on desktop Node only; nothing below has run in a browser or on a phone.

**Base extractor to adopt: `@llamaindex/liteparse-wasm` 2.18.0** (Apache-2.0,
Rust + pdfium, 2.7 MB gzipped). Use `outputFormat: 'json'` with
`extractBlocks: true` and read `page.blocks` (ordered blocks with a kind and a
bounding box). Do not use `page.text` or `page.textItems`: they put columns
side by side. Its `isComplex()` flags scanned and garbled pages (the
`vector-text` reason alone is a false positive for OCR).

What it gave on the samples: correct column order on the two-column paper,
running header, page number and footer removed on a three-column Federal
Register document, numbered headings, charts typed as tables.

Gaps to fill ourselves:
- footnote and caption typing; citation and URL stripping; reference section
- dictionary-aware de-hyphenation (it wrongly fuses real compounds)
- cross-page paragraph joins (OpenReader-WebUI's `stitch.ts`, MIT, is liftable)
- a position-and-font header rule as a safety net: cluster text in the top and
  bottom 9% of the page by (rounded y, font, size) and flag clusters on 50%+
  of pages. This beat the plain text-repetition rule, which missed running
  heads whose chapter title changes.
- false headings (chart labels, author lines)
- the block model, skip toggles and preview UI

OCR: tesseract.js 7 through LiteParse's `ocrEngine.recognize` hook (untested).

Optional later: PP-DocLayoutV3 (130 MB model, about 0.7 s per page on desktop
CPU) for footnote, caption and figure typing; OpenReader-WebUI's
`mergeTextWithRegions` shows how to combine it with text items.

Not adopted: pdf2md (poor headings, no block types), docling.rs-wasm (no
header removal without large models, but also converts DOCX/EPUB/HTML),
pdf-oxide-wasm (scrambled title), MuPDF.js (AGPL), kreuzberg wasm (91 MB),
pdfminer via Pyodide, opendataloader-pdf (needs Java).

Other formats: foliate-js (EPUB, MIT), mammoth (DOCX, BSD-2-Clause),
@mozilla/readability (web articles, Apache-2.0).

Correction to the first round: TAMReview.pdf has a garbled text layer on most
pages, so it is not a usable prose sample.
