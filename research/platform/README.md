# platformspike - hands-on checks for Hearshot's "app platform" side (2026-11-12)

Everything here was run in Playwright's headless Chromium 153 (Linux). Nothing under /home/user/GermanBuddy was modified.
Headless desktop Chromium is NOT Chrome for Android: results marked "needs phone" in the report are not covered here.

| folder | what it proves | how to rerun |
|---|---|---|
| sw/ | own service worker supplies COOP/COEP (page is crossOriginIsolated on a host with no headers), works offline, update-on-consent flow, old tabs keep their lazy chunks; same result on a host that sends the headers (Vercel mode) | `cd sw; node build.js $PWD/dist1 v1; node build.js $PWD/dist2 v2; node run-sw-test.js ghpages` (or `vercel`) |
| storage/ | OPFS sync-access-handle vs createWritable vs IndexedDB vs Cache API write throughput from a worker; quota/persist(); service worker serving OPFS files with Range/206 to an `<audio>`; blob-URL-from-OPFS alternative | `node ../server.js $PWD 8120 &  node run-storage-test.js` (needs audio/web/gen/* from audio/seektest.js) |
| audio/ | WebCodecs/Mediabunny encoder matrix (Opus, AAC via WASM, MP3 via WASM, lamejs), sizes and speed on 6 min of speech, quality proxy, per-chunk join error, seek accuracy, MSE append, MediaRecorder | needs `npm i mediabunny @mediabunny/aac-encoder @mediabunny/mp3-encoder @breezystack/lamejs` in audio/lib and copying the bundles into audio/web (see bench.html); input WAV = concatenation of /scratchpad/expressive/out3 clips, 24 kHz mono, 6:00 |
| pwa/ | manifest with share_target (files), file_handlers etc.: Chromium reports no installability errors; SW receives a multipart share POST with a PDF + text and hands it to the page | `node ../server.js $PWD 8130 & node run-pwa-test.js` |
| results/ | captured output of every run | |
| docs/ | primary-source extracts: Chromium source (page scheduler freeze rule, freezing policy, web-share allow-list) and MDN pages, fetched from raw.githubusercontent.com | |
| server.js | tiny static server with Range support (note: without Range support Chrome mis-reports duration/seek for ogg/wav/fmp4 - a test-harness trap I fell into) | |

Large generated files (WAV inputs, node_modules, decoded WAVs) were deleted to keep the folder small; audio/out/ keeps the encoded outputs.
