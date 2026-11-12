# Hearshot

Hearshot reads text aloud. Paste anything into the box, press Play, and a natural
voice reads it to you. The voice (Kokoro, an open-source model) runs entirely
inside your browser: your text never leaves your device, and nothing needs a
server or an account.

## What it does

- Reads pasted text aloud, sentence by sentence. Preparation starts as soon as
  you stop typing or pasting, so Play usually starts within a second. A long
  first sentence is split at an early comma so the voice can start sooner.
  Long texts keep playing while the rest is prepared.
- 28 English voices (American and British, female and male). Default: Heart.
  Changing the voice never interrupts the reading: the sentence you are
  hearing finishes, and the new voice takes over at the next sentence that
  is ready in it ("switching to George…" shows meanwhile).
- Tempo from 0.5× to 2.5× without making the voice sound higher or lower.
  Changes apply instantly, even mid-sentence. At fast tempos (about 1.5× and
  above) the voice is also prepared at a faster speed in the background, which
  needs less work, so fast listening keeps up on slower devices.
- Play / pause, stop, previous / next sentence. The sentence being read is
  highlighted; click any sentence to jump there.
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
  Graphics chip (WebGPU, only offered where the browser has it) or Standard
  (WebAssembly). Useful to compare the two on a phone.
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
standard mode; about 326 MB in graphics-chip mode). It is saved by the browser,
so later visits start in a second or two. Both can be saved side by side.

Other commands:

```bash
npm test         # checks the sentence splitter and the reader's rules
npm run build    # makes a finished site in dist/
npm run preview  # serves dist/ at http://localhost:4173 to try the finished site
```

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

**GitHub Pages (previous host, being retired).** `npm run build:pages` writes
the finished site into the `docs/` folder at the top of the repository, which
GitHub Pages can serve ("Deploy from a branch", `/docs` folder).

## Privacy

No analytics, no tracking. The only network requests are the one-time model and
voice downloads from Hugging Face (huggingface.co and its file servers).
Everything else, including the speech engine itself, is served by the app.

## Known limits

- **Speed depends on the device.** In standard mode the voice is computed on
  the CPU. On a modest 4-core laptop it is prepared about 1.7 times faster than
  it is spoken at normal tempo (about 1.5 times at 2× tempo). On slower devices
  playback may pause ("preparing…") while generation catches up; preparation
  continues while paused, so pausing for a moment builds a lead.
- **Graphics-chip mode (WebGPU) is untested on real devices.** It has only
  been built, not measured: our test browser has no graphics chip. On phones it
  may well be slower than standard mode; compare both under Settings (the
  status line shows the speed). If it fails to start, or keeps producing
  broken (silent or garbled) audio, Hearshot switches itself to standard mode
  and says so; that switch may need the standard model's one-time download.
- **Voice changes take a little while to complete.** The new voice is heard
  from the next sentence that has been re-made in it; on a slow device the old
  voice can carry on for a few sentences. The download needs everything
  re-made.
- **Fast tempos:** Kokoro's own speed setting is not exact, so prepared-fast
  sentences are played at a rate measured on average (±6% per sentence); the
  difference is not noticeable as a tempo change. Moving the tempo across 1.5×
  or 1.9× re-prepares the text in the background (only after the slider has
  rested for a second).
- **Memory:** prepared audio is kept in memory for the download, roughly 3 MB
  per minute of speech (a 5,000-word text is about 35 minutes ≈ 100 MB).
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
| `src/reader/reader.js` | Prepares sentences ahead of time, plays them in order, tempo, skip, voice changes without gaps, download. |
| `src/reader/schedule.js` | The reader's rules: what to prepare next, when a prepared sentence is out of date, tempo-to-speed steps, preparation speed. |
| `src/reader/audio.js` | Silence between sentences, click-free joins, WAV files. |
| `src/engine/kokoro-engine.js` | The voice engine as the rest of the app sees it: engine modes, falling back from the graphics chip. |
| `src/engine/kokoro.worker.js` | Runs the Kokoro model in a background thread. |
| `src/engine/check-audio.js` | Spots broken model output (silent, not-a-number, absurd length). |
| `src/voices.js` | The list of voices and their plain-English names. |
| `tests/` | Tests for the splitter, the reader's rules and the broken-audio check. |
| `vercel.json` | Build settings and headers for Vercel. |

Planned additions slot in without touching the reader: new **sources** (PDF or
file import, photo text recognition, web links, a saved library) only need to
produce text and call `splitText` and `reader.load`; a second **voice engine**
(for example a server-hosted one) only needs the same `probe / load / generate`
functions described at the top of `kokoro-engine.js`.

Voices: Kokoro (open source, Apache 2.0), via the `kokoro-js` library.
