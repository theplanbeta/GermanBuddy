# Expressive Kokoro: research prototype

Experiments (run in Node, not part of the app) on making the Kokoro voice read
more naturally and expressively without a larger model. The app in
`listen-app/` does not use any of this yet.

The owner compared the renders by ear and chose "D3". Everything was measured
on CPU in Node with the fp32 model; nothing here has run in a browser.

## What D3 does

1. **Group sentences.** Consecutive sentences with the same style and language
   go into one model call, up to 480 phonemes (at most 12 sentences), never
   across a paragraph. Long calls are what make the reading natural: the model
   plans across sentences, and the voice file's style row (chosen by call
   length) lands in its steady range.
2. **Voice row = phoneme count of the call.** Never pin it; forcing a long-call
   row onto a short call damaged short lines.
3. **First sentence alone** for a fast start, rendered with the next sentence
   as look-ahead (the look-ahead audio is discarded).
4. **Look-ahead at joins between calls** when the next sentence has the same
   style and language.
5. **Sentence boundaries and pauses from token timings**, using the
   `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` model (same audio as the
   standard model, plus a `durations` output). Each pause is set to a designed
   length by stretching or shortening the model's own silence.
6. **Mid-sentence changes of delivery** (a whispered or raised quote) are
   rendered as whole sentences, once per style, and spliced at the model's own
   pause, so intonation does not restart.

A rule-based "director" (`director.mjs`) marks up the text first: quotes and
speech-verb cues (whispered, exclaimed, shouted), capitals with "?!", numbers
and currencies, and German or Spanish phrases (`foreign.mjs`). Styles are
small offsets to the voice's style vector (`directions.json`).

## What did not work

Per-word emphasis, punctuation as an intonation control, pinning the voice
row, soft clip edges, and real laughter, sighs, crying or shouting.

## Running it

Needs `kokoro-js` 1.2.1 installed next to these files (`npm i kokoro-js@1.2.1`).

```
node render.mjs texts/stress.txt out.wav --max-group 12 --max-ph 480 --lookahead --first-alone
```

`--v1` reproduces the earlier "B" render, `--no-group` gives "D1", and `--app`
renders the way the app does today. The `.py` files and `asr*.mjs` are the
measurement tools (pitch, pauses, speaking rate, speech-recognition checks);
the `exp*.mjs` and `t_*.mjs` files are one-off experiments kept for reference.
`listening-guides/` holds the notes that accompanied each round of audio.
