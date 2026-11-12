# Hearshot

Hearshot reads text aloud. Paste anything into the box, press Play, and a natural
voice reads it to you. The voice (Kokoro, an open-source model) runs entirely
inside your browser: your text never leaves your device, and nothing needs a
server or an account.

## What it does

- Reads pasted text aloud with a natural flow: neighbouring sentences of a
  paragraph are spoken by the voice model in one go (up to about 480 sound
  symbols, roughly 4 to 6 sentences), so they sound like one connected
  thought instead of a string of separate announcements. The pause after each
  sentence is set on purpose: a little longer after longer sentences, varied
  slightly, and longer between paragraphs.
- Preparation starts as soon as you stop typing or pasting. When you press
  Play and nothing is ready yet, the first sentence is made on its own in the
  quickest way (as earlier versions did), so the voice starts just as fast; it
  is re-made in full quality in the background for the download and for
  listening again. (A long first sentence is split at an early comma.) After
  that the pieces grow as large as this device can prepare before the audio
  already waiting runs out, and never smaller than a group that prepares
  clearly faster than it plays: every piece costs a fixed amount of work
  (about 1.3 s on a 4-core laptop), so a slow device does better with fewer,
  larger pieces. Long texts keep playing while the rest is prepared.
- 28 English voices (American and British, female and male). Default: Heart.
  Changing the voice never interrupts the reading: the sentence you are
  hearing finishes, and the new voice takes over at the next sentence that
  is ready in it, normally the next or the one after ("switching to
  George…" shows meanwhile). Changing the voice several times quickly only
  makes the last choice.
- Tempo from 0.5× to 2.5× without making the voice sound higher or lower.
  Changes apply instantly, even mid-sentence. At fast tempos (about 1.5× and
  above) the voice is also prepared at a faster speed in the background, which
  needs less work, so fast listening keeps up on slower devices.
- Play / pause, stop, previous / next sentence. The sentence being read is
  highlighted, following the sound exactly (the voice model reports when each
  sentence starts); click any sentence to jump there.
  Keyboard: Space = play/pause, ← / → = previous / next sentence.
- Download the whole reading as one WAV audio file once it has all been
  prepared in the current voice. The file is always one voice and one speed:
  at tempos below about 1.5× it is normal speed; at faster tempos it is made at
  about 1.6× or 1.9× speed (the file name and the note under the button say
  which). After a voice or tempo change, the download waits until everything
  has been re-prepared.
- The status line next to the title shows which engine is in use and how fast this
  device prepares speech compared with playing it, e.g. "Standard mode
  (WebAssembly) · preparing 1.7× faster than playback". If a device is slower
  than playback, Hearshot says so once and gathers a few seconds of lead after
  running out, instead of stopping at every sentence.
- Settings (below the text) lets you choose the voice engine: Automatic,
  Graphics chip (WebGPU, only offered where the browser has it), Graphics
  chip with a smaller model (fp16, experimental, half the download) or
  Standard (WebAssembly). Useful to compare them on a phone.
- Remembers your voice, tempo and engine choice.
- On phones the player is a single row; "Heart · 1.00×" opens voice, tempo and
  download.

## Running it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd listen-app
npm install      # once
npm run dev      # then open the address it prints, e.g. http://localhost:5173
```

The first time, the app asks to download the voice model (about 177 MB in
standard mode; about 326 MB in graphics-chip mode, or 163 MB for its smaller
experimental model). It is saved by the browser, so later visits start in a
second or two. Several can be saved side by side.

This version uses a different copy of the Kokoro model than earlier versions
(`Kokoro-82M-v1.0-ONNX-timestamped`: the same voice, plus timings for every
sound). Someone who used an earlier version downloads it once more; as soon
as the new one works, Hearshot deletes the old model files from the browser
to free the space and says so.

Other commands:

```bash
npm test         # checks the sentence splitter, the grouping and cutting rules, the speed rules
npm run build    # makes a finished site in dist/
npm run preview  # serves dist/ at http://localhost:4173 to try the finished site
```

For testing, `?debug` adds the size of the last prepared piece to the status
line and exposes the reader and engine to the browser console; `&threads=2`
(fewer processor cores) or `&slowdown=1.5` (every piece takes 1.5 times as
long) imitate a slower device, and `&dtype=fp32` forces a model file.

## Putting it online

**Vercel (the main host, hearshot.app).** Import the repository in Vercel and
set the project's **Root Directory** to `listen-app`. `vercel.json` sets the
build (`npm run build`, output `dist/`) and sends the two headers below on
every page.

Any other static host works too, with two things to know:

- The site must be served over **https** (or from localhost). On a plain
  `http://` address browsers refuse to save the model, so it downloads again on
  every visit.
- The host should send these two headers (Vercel via `vercel.json`, and the dev
  and preview servers, already do): `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp`. They let the voice use
  several CPU cores. Without them it still works but on one core, which
  measured about 2.5 times slower (slower than real time, so playback
  stutters). For hosts that cannot send headers, the page loads a small helper
  (`public/coi-serviceworker.js`, MIT licensed) that achieves the same thing;
  it reloads the page once on the very first visit.

**Preview builds beside the main one.** Build with
`VITE_KEEP_OLD_MODEL=1 npm run build` to stop the preview from deleting the
voice model files of earlier versions, so a main version on the same site
that still uses them does not have to download them again.

**GitHub Pages (previous host, being retired).** `npm run build:pages` writes
the finished site into the `docs/` folder at the top of the repository, which
GitHub Pages can serve ("Deploy from a branch", `/docs` folder).

## Privacy

No analytics, no tracking. The only network requests are the one-time model and
voice downloads from Hugging Face (huggingface.co and its file servers).
Everything else, including the speech engine itself, is served by the app.

## Known limits

- **Speed depends on the device.** In standard mode the voice is computed on
  the CPU. On a modest 4-core laptop it was measured at about 1.7 times faster
  than it is spoken at normal tempo (about 1.5 times at 2× tempo). On slower
  devices playback may pause ("preparing…") while generation catches up;
  preparation continues while paused, so pausing for a moment builds a lead.
- **Shorter silences mean less time to prepare.** The new way of reading
  keeps the pauses between sentences to their designed length (0.3 to 0.55 s;
  earlier versions left about 0.9 s), so the same text is read about 13%
  faster. The work to prepare it is the same as before, so on a device that
  only just keeps up, there is a little less slack. On a slow device the first
  one or two sentences may be made in the quick plain way to keep the first
  wait short.
- **Graphics chip: shorter pieces.** On the graphics chip one piece occupies
  the chip until it is done, which can make the phone's own animations (for
  example the app switcher) stutter. So pieces there are at most about 180
  sound symbols (2 or 3 sentences, roughly 12 s of speech), shorter while the
  page is hidden and just after it comes back, with a short break between
  pieces. To try other sizes on a phone, add `?gpucap=120` (or another
  number) to the address.
- **In the background**, phones freeze a hidden page after about a minute
  unless sound is playing, so preparation only continues while it plays. When
  the page comes back, Hearshot carries on by itself.
- **Graphics-chip mode (WebGPU) is untested on real devices**, including the
  smaller fp16 model. It has only been built, not measured: our test browser
  has no graphics chip. On phones it may well be slower than standard mode;
  compare under Settings (the status line shows the speed). If it fails to
  start, or keeps producing broken (silent or garbled) audio, Hearshot
  switches itself to standard mode and says so; that switch may need the
  standard model's one-time download.
- **Voice changes take a little while to complete.** The new voice is heard
  from the next sentence that has been re-made in it. If a large piece was
  being prepared at the moment of the change, it is finished first (it cannot
  be interrupted), so on a slow device the old voice can carry on for a few
  sentences. On a device that prepares more slowly than it plays, the old
  voice can also come back for a sentence after the new one has started
  (Hearshot never leaves a silence while it has something to play). The
  download needs everything re-made.
- **Fast tempos:** Kokoro's own speed setting is not exact, so prepared-fast
  sentences are played at a rate measured on average (±6% per sentence); the
  difference is not noticeable as a tempo change. Moving the tempo across 1.5×
  or 1.9× re-prepares the text in the background (only after the slider has
  rested for a second).
- **Memory:** prepared audio is kept in memory for the download, roughly 3 MB
  per minute of speech (a 5,000-word text is about 35 minutes ≈ 100 MB).
- **Very long sentences** are split into pieces of at most 200 characters (at
  a semicolon, dash or comma where possible). Pieces of one sentence are
  normally spoken in one go, so the split cannot be heard; only where a
  prepared piece has to end is there a short pause.
- **English only** for now. Very unusual text (long tables of numbers, code)
  may be read oddly.
- **Phones:** expect the page to need to stay open in the foreground; browsers
  usually slow or stop background tabs, so reading may stop when the screen
  locks.

## How the code is organised

| File | What it does |
| --- | --- |
| `index.html` | The page layout. |
| `src/main.js` | Connects the page's buttons, text box and settings to the reader and engine. |
| `src/styles.css` | Look and feel, light and dark, phone layout. |
| `src/text/splitter.js` | Splits text into sentences (handles "Mr.", "U.S.", 3.5, quotes, paragraphs, over-long sentences); splits a long opening sentence. |
| `src/flow/plan.js` | Which sentences go into the next model call: grouping within a paragraph, size limits, starting small and growing, the two-word look-ahead and its "voice row". |
| `src/flow/assemble.js` | Cuts one model call into its sentences at the exact boundaries, throws the look-ahead away, sets the designed pauses. |
| `src/flow/signal.js` | Small sound helpers: finding quiet stretches, trimming edges, fades, room tone, limiter. |
| `src/reader/reader.js` | Prepares ahead of time, plays the prepared pieces in order, highlight, tempo, skip, voice changes without gaps, download. |
| `src/reader/schedule.js` | Tempo-to-speed steps and preparation-speed measurements. |
| `src/reader/audio.js` | 16-bit audio and WAV files. |
| `src/engine/kokoro-engine.js` | The voice engine as the rest of the app sees it: engine modes, falling back from the graphics chip, removing the old model. |
| `src/engine/kokoro.worker.js` | Runs the Kokoro model in a background thread. |
| `src/engine/phonemes.js` | Turns text into the sound symbols the model reads (a copy of kokoro-js's own rules). |
| `src/engine/check-audio.js` | Spots broken model output (silent, not-a-number, absurd length). |
| `src/voices.js` | The list of voices and their plain-English names. |
| `tests/` | Tests for the splitter, the call planning and cutting, the speed rules and the broken-audio check. |
| `vercel.json` | Build settings and headers for Vercel. |

Planned additions slot in without touching the reader: new **sources** (PDF or
file import, photo text recognition, web links, a saved library) only need to
produce text and call `splitText` and `reader.load`; a second **voice engine**
(for example a server-hosted one) only needs the same `probe / load / generate`
functions described at the top of `kokoro-engine.js`.

The way sentences are grouped, cut and paused follows the research prototype
in `research/expressive-kokoro` (its "D4" rendering, chosen by ear). Each
model call can later carry its own delivery style, language and speed; that
is the next step (whispered or raised quotes, foreign phrases).

Voices: Kokoro (open source, Apache 2.0), via the `kokoro-js` library; the
`Kokoro-82M-v1.0-ONNX-timestamped` model files (Apache 2.0) from Hugging Face.
