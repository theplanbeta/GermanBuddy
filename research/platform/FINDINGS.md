# Offline, library, background listening and sharing: findings (2026-11-12)

Research for making Hearshot installable, usable offline, able to keep a
library, and able to share audio in and out. The app does not use any of this
yet. Hands-on results are from headless Chromium 153 on Linux, not from a
phone. The folders beside this file hold the small prototypes and their
captured results (`README.md` lists them).

Labels: [V] verified by running it here; [S] read in Chromium or MDN source;
[R] recalled or secondary; [PHONE] only a real phone can settle it.

## Conclusions

1. **Own service worker instead of coi-serviceworker.** [V] A hand-written
   worker of about 100 lines kept the page cross-origin isolated on a server
   that sends no headers: online, offline and after an update. It adds COOP
   `same-origin`, COEP `require-corp` and CORP `same-origin` to same-origin
   responses and leaves Hugging Face requests alone. Serve the shell from the
   current versioned cache by name (a plain `caches.match` returned the old
   version after an update). Update only when the user taps "Update"; never
   reload mid-reading. Precache the tiny shell at install; put the 21.6 MB
   ONNX Runtime file in a separate cache filled on first use.
2. **Store audio compressed.** [V] Opus at 32 kbps is about 14 MB per hour
   (WAV is 173 MB per hour) and encodes at roughly 70 times real time with the
   browser's own encoder. One file per chunk, WebM container, in OPFS.
3. **Share as M4A (AAC-LC, about 48 kbps), made on demand.** Chrome's share
   allow-list accepts `.m4a` only with MIME type `audio/x-m4a`, not
   `audio/mp4`. [S] Limits: 10 files and 50 MiB per share. Fall back to MP3 or
   a plain download.
4. **Keep one `<audio>` element** with `playbackRate` and `preservesPitch`.
   [V] Per-chunk files and OPFS-backed URLs both seek correctly. Media Source
   Extensions and Web Audio add complexity for no gain, and Web Audio gets no
   Android media notification.
5. **Background listening rule on Android phones.** [S] Chrome freezes a
   hidden page and its workers 60 seconds after it was hidden or went silent.
   Audible playback exempts it; silent audio does not. So generation keeps
   running only while sound is playing. If playback catches up and falls
   silent, generation stops until the screen is on again. Design: generate
   far ahead, save every chunk, offer "prepare for offline listening", and
   make a discarded tab a non-event by saving position and chunks. Samsung
   battery management and Doze are [PHONE].
6. **What needs installation.** [S] "Share to Hearshot" (share target) works
   only for an installed app, on Chrome for Android and desktop Chrome. "Open
   with" (file handlers) does not exist on Chrome for Android. File pickers,
   the camera picker, drag-and-drop and paste work in a normal tab.

## Storage

- Chrome allows an origin up to about 60% of the disk. Eviction removes a
  whole origin at once, so offer `persist()`, export, and keep text separate
  from audio that can be regenerated. Storage is per origin: moving from the
  GitHub Pages address to hearshot.app loses the model and library.
- IndexedDB (via `idb`, ISC) for documents, positions, settings and the audio
  index; OPFS for audio files; Cache API stays for the model.
- `navigator.storage.estimate()` gives a "storage used" breakdown for free.

| Format | MB per hour | Hours per GB |
|---|---|---|
| WAV 16-bit | 172.8 | 5.8 |
| AAC 48 kbps | 21.8 | 46 |
| Opus 32 kbps | 14.3 | 70 |
| Opus 24 kbps | 10.7 | 93 |

## Encoders measured (6 minutes of 24 kHz speech)

| Route | Size | Speed (x real time) | Note |
|---|---|---|---|
| Browser Opus 32 kbps (Ogg/WebM) | 1.4 to 1.6 MB | about 70 | only encoder available everywhere |
| WASM AAC 48 kbps (M4A) | 2.2 MB | about 40 | 1.1 MB encoder, loaded on demand |
| WASM MP3 64 kbps | 2.9 MB | about 120 | fallback for sharing |
| WAV | 17.3 MB | n/a | reference |

Quality was ranked with an objective proxy only, not by listening: Opus 32
was about level with AAC 48 and better than MP3 64. Mediabunny (MPL-2.0) was
used for muxing and supports feeding chunks one after another into a single
gapless file. Chrome for Android has a native AAC encoder; its quality on the
phone is [PHONE].

## Model delivery

Hugging Face supports Range requests and CORS for the model files, and
exposes a SHA-256. [V] A chunked, resumable download into OPFS with a hash
check is possible. Keep Hugging Face as the host: Vercel's hobby transfer
allowance would cover only a few hundred model downloads a month. [R]

## Staged build plan

1. Own service worker, manifest and icons: installable, offline shell.
2. Library and resume position, "storage used", delete controls.
3. Compressed saved audio and offline listening from the library.
4. Share out as M4A with a download fallback.
5. Share in (installed app), photo picker, drag-and-drop and paste.
6. Resumable, verified model download; update and delete.
7. Background-aware generation: lead target, "prepare offline" mode.

## Phone test protocol (background listening)

Run on the phone with a long text. Note "Prepared x of y" before and after.

1. Screen on for 2 minutes: note the prepared count.
2. Lock the screen while audio plays; wait 10 minutes; unlock. Did audio
   stop? How far did the prepared count move?
3. Pause, lock for 5 minutes, unlock, play. Did the count grow while locked?
4. Play, switch to another app for 10 minutes. Same questions.
5. Set Chrome's battery setting to Unrestricted and repeat step 2. Then try
   Battery Saver and Bluetooth earbuds.
6. Install to the home screen and repeat steps 2 and 4; try the earbud
   play/pause button with the screen off.
7. Open several heavy apps during a locked run; did the page reload?

## Top risks

Background freezing on the phone; whole-origin eviction wiping the library;
the origin change to hearshot.app; native AAC quality; share-target behaviour
on a real phone; iPhone limits (7-day eviction, no share target).
