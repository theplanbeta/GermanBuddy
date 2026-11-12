# Listen

Listen reads text aloud. Paste anything into the box, press Play, and a natural
voice reads it to you. The voice (Kokoro, an open-source model) runs entirely
inside your browser: your text never leaves your device, and nothing needs a
server or an account.

## What it does

- Reads pasted text aloud, sentence by sentence, starting as soon as the first
  sentence is ready. Long texts keep playing while the rest is prepared.
- 28 English voices (American and British, female and male). Default: Heart.
- Tempo from 0.5× to 2.5× without making the voice sound higher or lower.
  Changes apply instantly, even mid-sentence.
- Play / pause, stop, previous / next sentence. The sentence being read is
  highlighted; click any sentence to jump there.
  Keyboard: Space = play/pause, ← / → = previous / next sentence.
- Download the whole reading as one WAV audio file once it has all been prepared.
- Remembers your voice and tempo.

## Running it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd listen-app
npm install      # once
npm run dev      # then open the address it prints, e.g. http://localhost:5173
```

The first time, the app asks to download the voice model (about 177 MB; about
326 MB in browsers with WebGPU graphics support, which then run much faster).
It is saved by the browser, so later visits start in a second or two.

Other commands:

```bash
npm test         # checks the sentence splitter
npm run build    # makes a finished site in dist/
npm run preview  # serves dist/ at http://localhost:4173 to try the finished site
```

`dist/` can be put on any static web host. Two things to know:

- The site must be served over **https** (or from localhost). On a plain
  `http://` address browsers refuse to save the model, so it downloads again on
  every visit.
- For full speed the host should send these two headers (the dev and preview
  servers already do). Without them it still works, using one CPU core:
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`.

## Privacy

No analytics, no tracking. The only network requests are the one-time model and
voice downloads from Hugging Face (huggingface.co and its file servers).
Everything else, including the speech engine itself, is served by the app.

## Known limits

- **Speed depends on the device.** Without WebGPU the voice is computed on the
  CPU. On a modest 4-core machine it is prepared about 1.5 times faster than it
  is spoken, which keeps up at normal tempo. On slower devices, or at high
  tempo, playback may pause briefly ("preparing…") while generation catches up.
  Preparation continues while paused, so pausing for a moment builds a lead.
- **Memory:** prepared audio is kept in memory for the download, roughly 3 MB
  per minute of speech (a 5,000-word text is about 35 minutes ≈ 100 MB).
- **English only** for now. Very unusual text (long tables of numbers, code)
  may be read oddly.
- **Phones:** not yet tested on real phones. Expect the page to need to stay
  open in the foreground; browsers usually slow or stop background tabs, so
  reading may stop when the screen locks.
- Changing the voice re-prepares the text from the current sentence onward.

## How the code is organised

| File | What it does |
| --- | --- |
| `index.html` | The page layout. |
| `src/main.js` | Connects the page's buttons and text box to the reader. |
| `src/styles.css` | Look and feel, light and dark. |
| `src/text/splitter.js` | Splits text into sentences (handles "Mr.", "U.S.", 3.5, quotes, paragraphs, over-long sentences). |
| `src/reader/reader.js` | Prepares sentences ahead of time, plays them in order, tempo, skip, download. |
| `src/reader/audio.js` | Silence between sentences, click-free joins, WAV files. |
| `src/engine/kokoro-engine.js` | The voice engine as the rest of the app sees it. |
| `src/engine/kokoro.worker.js` | Runs the Kokoro model in a background thread. |
| `src/voices.js` | The list of voices and their plain-English names. |
| `tests/splitter.test.js` | Tests for the sentence splitter. |

Planned additions slot in without touching the reader: new **sources** (PDF or
file import, photo text recognition, web links, a saved library) only need to
produce text and call `splitText` and `reader.load`; a second **voice engine**
(for example a server-hosted one) only needs the same `probe / load / generate`
functions described at the top of `kokoro-engine.js`.

Voices: Kokoro (open source, Apache 2.0), via the `kokoro-js` library.
