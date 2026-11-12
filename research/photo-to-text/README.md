# Photo to listening text: desk research (2026-11-12)

Research for "snap a photo and hear it". Reading and comparing only: no OCR
was run, nothing was measured, and the app does not use any of this yet.
The hands-on comparison is still to do.

Labels: [V] seen in a primary source (repository, model card, npm or Hugging
Face metadata, Tesseract docs); [S] search snippets only (developer.chrome.com,
MDN, chromestatus.com and arxiv.org were unreachable); [R] recalled,
unverified; [D] our own judgement. Package versions, licences and the
PP-OCRv6 model list were re-checked by the reviewer.

## Main findings

1. **No usable built-in text recognition in Chrome on Android.** [S] The
   Shape Detection `TextDetector` is still behind a flag; the Prompt API with
   image input shipped on desktop only. We must ship our own engine.
2. **The steps before recognition matter more than the engine, and are
   cheap.** A camera photo is not a scan: perspective, page curl, shadows,
   blur and small text each hurt. `scanic` 1.7.1 (MIT, under 100 kB gzipped,
   runs in a Web Worker, has a touch corner editor) finds the page and
   straightens it, replacing OpenCV.js (15 to 30 MB). [V]
3. **Text size is the key capture constraint.** Tesseract works best when a
   lower-case letter is about 20 px tall, and gets worse below 10 px and
   above 30 px. [V] A whole A4 page in a 12 MP photo gives about 12 to 18 px
   [D]: marginal, so capture guidance and resizing matter.
4. **PP-OCRv6 (June 2026, Apache-2.0) is unsettled, not ruled out.** Models:
   tiny 6.2 MB, small 31 MB, medium 139 MB; one model covers 46 Latin-script
   languages including German. [V] Our earlier scan test
   (`research/pdf-pipeline/tools/ocr-run.mjs`) only ran v5 and v6 tiny, on
   flat scans, so "PP-OCR was worse" does not cover v6 small on photos. The
   `paddleocr` npm package 1.2.1 (MIT) runs it on onnxruntime-web, which the
   app already ships. Its accuracy figures are the vendor's own.

## Pipelines to prototype

Common front end [D]: `<input type=file accept="image/*" capture=environment>`
(system camera, full resolution, no permission prompt), decode with EXIF
orientation and downscale, page detection with corner editor, perspective
warp to a long side of 2200 to 3000 px, lighting flattened by dividing by a
blurred background, grey (no black-and-white conversion), deskew, engine,
then the existing `research/pdf-pipeline` geometry and listening layer, a
confidence gate, and a preview.

| | Pipeline | Download | Why | Main risks |
|---|---|---|---|---|
| A | scanic + tesseract.js 7 | about 8 to 10 MB [D] | Already works through our OCR hook; boxes and confidences; German data exists | Curved or shadowed pages, small text |
| B | scanic + PP-OCRv6 small | about 31 MB (+32 MB optional page-flattening model UVDoc) | Likely better on photos | Unmeasured on a phone; may need a newer onnxruntime-web than the app's 1.22; no reading-order logic of its own |
| C | Granite-Docling 258M or Florence-2 base on WebGPU | 220 to 260 MB | Page in, ordered text out | Size, speed, invented or skipped lines; only if A and B fail |

Not recommended: `TextDetector`, the Prompt API, docTR and EasyOCR (no
browser version), TrOCR (single lines only), stock OpenCV.js, and the large
OCR language models (465 to 750 MB, need transformers.js 4).

## Photo defects and fixes

| Defect | Fix that runs in a browser |
|---|---|
| Perspective | Find the page corners and warp (scanic) |
| Page curl, book spine | Ask the user to flatten; UVDoc (31.7 MB, Apache-2.0) on demand |
| Shadows, uneven light | Divide by a large-kernel background estimate; Sauvola threshold as a comparison branch |
| Blur | Cannot be fixed: detect and ask for a retake |
| Two-page spread | Split at the widest vertical gap, then read left, right |
| Small text | Move closer, crop, upscale |
| Wrong rotation | EXIF, plus an orientation classifier (6.8 MB) |

## From recognised lines to listening text [D]

- Reading order: reuse `lib/geometry.js` (columns, XY-cut) on the
  straightened page.
- Page furniture: one photo has no repeated pages to compare, so default to
  reading everything; remove only a lone page number in the top or bottom 8%;
  keep tap-to-exclude.
- Garbage gate: from word or line confidences plus simple text checks. Read
  when confident; show doubtful lines highlighted with "read anyway / retake";
  refuse with a concrete tip (too small, blurred, too dark) when most lines
  fail.

## Evaluation

No public set of ordinary phone photos of text pages with full ground truth
and a permissive licence was found (SmartDoc 2015 challenge 1 is CC BY 4.0
but is about page detection; the DocUNet family is research-use). Build our
own: print pages whose text we know (the synthetic PDFs from
`research/pdf-pipeline`), photograph them on the phone under varied light,
tilt, distance and curl (about 100 photos), and score with the existing
listening score. Before that, degrade the synthetic pages in software to
rank pipelines early.

## To measure in the hands-on round

1. Pipelines A and B end to end on the phone and desktop: time per stage,
   memory, accuracy per condition.
2. Input size (long side 1600 to 4000 px) against accuracy and time.
3. Lighting correction variants; with and without UVDoc on curved pages.
4. scanic's classical detector against its small neural one (1.9 MB) and
   manual corners.
5. PP-OCRv6 tiny, small and medium; whether they run on the app's
   onnxruntime-web.
6. Capture path on the phone: resolution delivered, JPEG or HEIC, whether the
   page survives a trip to the camera app.
7. A ten-page session with the voice model loaded in the same tab.

## Not verified

Chrome platform status from primary pages; every speed and accuracy figure on
a phone; dataset licences other than SmartDoc; the maturity of the `paddleocr`
wrapper; whether tesseract.js 7 exposes Tesseract's Sauvola option; capture
details (torch, focus, installed-app behaviour).

## Licences

Apache-2.0: tesseract.js, PP-OCRv5 and v6, UVDoc weights, Granite-Docling.
MIT: scanic, the `paddleocr` wrapper, Florence-2. Cautions: Surya (unknown)
and Liquid's LFM models (own licence) were not considered.
