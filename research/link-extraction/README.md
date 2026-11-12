# Pasted link to listening text: prototype and findings (2026-11-12)

Research for "paste a link and listen". The app does not use any of this yet.
Extractors were scored on saved pages from 2017 to 2019; no live fetching was
possible from the sandbox, so real-world pass rates are unmeasured.

Labels: [V] verified by running code or reading the source; [S] from search
summaries only (vercel.com and developer.chrome.com were unreachable).

## Recommendation

1. A small Vercel function (Node runtime) fetches one public page and returns
   the raw HTML. Extraction happens in the browser, so the server holds no
   extraction code and stores nothing.
2. Extract with `@mozilla/readability` 0.6.0 (Apache-2.0, 11 kB gzipped) via
   `DOMParser`. Fall back to `defuddle` 0.19.6 (MIT, loaded only when needed)
   if Readability throws or finds under 60 words. [V] in headless Chromium.
3. Offer no-server routes: "Share to Hearshot" (delivers only the link, so it
   feeds the server path; selected text can also be shared), and a paste or
   bookmarklet route for paywalled, logged-in and JavaScript-only pages.
4. Never claim "nothing leaves your device" for the link path: the target
   site and the server both see the request.

Open risk [S]: Vercel's acceptable-use policy reportedly lists "scrape,
proxy" as prohibited, and the Hobby plan is personal, non-commercial use.
Read vercel.com/legal before building; a public Hearshot needs Pro or another
host.

## Extractor scores (411 pages with ground truth, token F1)

| Extractor | Browser? | F1 | Leak | Note |
|---|---|---|---|---|
| trafilatura 2.3.1 (Python) | no | 0.910 to 0.922 | 0.04 | best, cannot run in a browser |
| @mozilla/readability 0.6.0 | yes | 0.893 | 0.063 | threw on 6 of 270 messy pages |
| Postlight 2.2.3 | partly | 0.875 | 0.063 | no release since 2022 |
| Defuddle 0.19.6 | yes | 0.873 | 0.088 | sometimes picks the wrong container |
| @extractus/article-extractor 9 | server | 0.851 | 0.053 | |
| unfluff 3.2.0 | no | 0.794 | | dead since 2018 |
| all page text | | 0.639 | 0.342 | baseline |

"Leak" is the share of extracted words that are page furniture. Combining
extractors gained at most +0.02, mostly from the crash fallback. In Chromium
with 4x CPU throttling, Readability took about 26 ms per page.

## Fetch function (`proto/api-fetch-article.mjs`, 15 tests pass)

`POST /api/fetch-article` with `{url}` in the body, never the query string.
http and https only, ports 80 and 443, no credentials, no local hosts. A
custom DNS lookup refuses any host that resolves to a private address, and
every redirect hop (at most 4) is re-validated. Caps: 3 MB body, 9 s total,
no compressed bodies. HTML and plain text only; a PDF returns `{kind:'pdf'}`
without downloading. Honest user-agent (`HearshotFetcher/1.0`). `no-store`
caching. Logs host, size and time only. Access control for a private tool: an
owner access code checked with a constant-time compare. An origin check alone
stops other websites but not scripts; a secret baked into the page's code is
worthless.

## Cleaning for listening (`proto/hearshot-extract.mjs`, 12 tests pass)

`extractForListening(html, url, {toggles})` returns metadata (title, byline,
date, language, words, listening minutes) and typed blocks: heading,
paragraph, list-item, quote, caption, code, table, footnote, reference, other.

Defaults: read headings, paragraphs, lists and quotes ("Quote ... End
quote"). Skip captions, code and tables (one spoken note each), footnotes,
references and page furniture. Always remove citation markers, emoji, raw
URLs and "Read more". Drop pull quotes repeated in the body, photo credits,
share bars and runs of link-only list items. This cut the leak on the news
corpus from 0.044 to 0.031.

Pages handled specially: Wikipedia (works; prefer its REST HTML endpoint),
documentation (code skipped), PDFs (handed to the PDF pipeline), video and
podcast sites (declined before fetching), other languages (warning).

## Folder

`proto/`: the extractor, the fetch function, tests, benchmark and analysis
scripts. `samples/`: before and after text for five real pages. `out/`:
result tables. The benchmark corpora are not included.

## Needs live testing

Real fetches from Vercel (many sites block cloud addresses), the share flow
and bookmarklet on the phone, today's JavaScript-heavy sites, and every [S]
fact about Vercel's limits and policy.
