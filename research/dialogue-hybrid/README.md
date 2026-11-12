# Fiction dialogue: wider rules, character voices and a second "studio" voice (2026-11-12)

Prototype work only. Nothing here is in the app yet. It answers the owner's
test of a dialogue scene (`kokoro/prank.txt`) that the `/next/` preview read
in a "not very impressive" way.

All judgements of sound are the owner's, by ear. Everything else is measured
(loudness, pitch, speech recognition); the agents could not listen.

## What was wrong

The director styled 7 of the scene's 64 sentences. Its rules were tuned on
one paragraph where the cue sits next to the quote ("she whispered, …").
In fiction the cue is often in a neighbouring sentence or paragraph, mild
cues (softly, quietly) were dropped on purpose, capitals with commas were
split wrongly, every paragraph break had the same 0.85 s pause, and one voice
played everyone.

## Renders and the owner's verdicts

| File | What | Verdict |
|---|---|---|
| A | The app as published | not impressive |
| B | Wider rules, designed pauses, one voice | (not singled out) |
| C | B plus a voice per character (narration af_heart, Sarah af_aoede, Daniel am_fenrir) | "really good" |
| Chatterbox Turbo, whole scene | Another model, with its tags | far better than C |
| Supertonic 3, whole scene | Another model | (not singled out) |
| H1 | C, with Chatterbox only on the lines Kokoro cannot act, plus laugh sounds | "good": chosen |
| H1 without laugh sounds, H2 (all dialogue by Chatterbox) | | "not so good" |

The audio files are not kept in the repository.

## Kokoro side (`kokoro/`)

- `director/director_fiction.js`: the app's director with rules F1 to F8;
  `director/speakers.js`: who speaks each quote (F9). `tests/` holds the app's
  director tests pointed at the copy plus extra cases; all pass, the stress
  paragraph and plain prose are unchanged.
- `pipe.mjs`, `render_scene.mjs`: a Node pipeline that reuses the app's
  modules. With the app's own onnxruntime-web WASM build it reproduces the
  app's download byte for byte (`faith.mjs`, `cmp.mjs`), so B and C are what
  the app would produce. Native onnxruntime-node is not sample-identical.
- `prank_*.json`: per sentence the delivery, speaker, voice and pause.

Rules added (details in the file header):

- F1: a short sentence right after or before a quote ("Daniel whispered.",
  "Her voice cracked.") gives its cue, and covers both quotes around it.
- F2: a short lead-in paragraph ending in a dash, colon or comma ("Then,
  softly—") gives its cue to the next quote.
- F3: a paragraph describing the voice ("The voice … was barely a whisper.")
  gives its cue back to the quote before it.
- F4: mild cues are kept on free-standing quotes, with stronger measured
  values (soft: whisper 0.6, −3 dB; shaky: whisper 0.6, speed 0.95, −1 dB;
  laugh: pitch 0.35, speed 1.04, +1 dB; sweet: pitch 0.35, whisper 0.25).
- F5: an all-capitals quote is raised as a whole; "Wait… WHAT?" is raised.
- F6: a narration paragraph that is only a capitals exclamation ("BANG!").
- F7: a short, calm final quote is read 7% slower.
- F8: pauses after a paragraph: 0.5 s between short dialogue lines, 1.0 to
  1.6 s around suspense beats ("Silence.", "And then—", "Then… nothing.").
- F9: quotes in the speaker's voice, with a level correction per voice
  (af_aoede −4.9 dB, am_fenrir −3.1 dB).

Cost in the app, estimated from the browser's own timings: B +6%, C +7%
preparation time. App work: B about 200 lines (director, pause plan, reader,
tests); C adds about 150 to 200 more (speakers, a voice per part in the
reader, a switch).

Kokoro cannot laugh, scream, sound frightened or trembling, or stress one
word. A "whisper" is a breathy voice.

## Other models (`models/`)

Run on a 4-core CPU, no graphics card. Scripts only; no weights or
third-party code are kept here (`st3.py` is a port of Supertonic's MIT
helper, `cbt.py` follows Chatterbox's MIT model-card example).

| | Supertonic 3 | Chatterbox Turbo (q4) |
|---|---|---|
| Size | 99M parameters, 398 MB (fp32 only) | 350M, 718 MB (q4f16 about 560 MB) |
| Licence | OpenRAIL-M (code MIT) | MIT |
| Controls that work | separate voices; `<laugh>` only as its own utterance | [laugh] [chuckle] [gasp] [groan] [sigh] [cough] make real sounds; [angry] +5 dB; [fear] widens pitch |
| Controls that do not | no whisper, shout or emotion | [whispering] (68% voiced, −1 dB), [happy], [surprised] |
| Shouted vs whispered lines | 0.5 dB apart (Kokoro 0.3) | 6.5 dB apart |
| Word errors in the scene | 1 to 3% | 4 to 8%, one invented mumble; ALL-CAPS words must be lower-cased |
| Speed on this CPU | 0.2 to 0.4 s per second of audio | 1.0 to 1.8 s per second of audio; 7 s to first audio |
| In the browser (WASM) | works, about Kokoro's speed | about 15 times slower than playback; needs ORT-web 1.31 and transformers.js 4 |
| Needs a voice sample | no (10 preset voices) | yes, over 5 s |

NeuTTS-2E (one emotion per call) could not be tested: its files are gated
behind a Hugging Face login and a personal-details form. WebGPU and a real
phone were not tested for any model.

## Hybrid (`models/hybrid/`)

Kokoro C stays the base. Lines Kokoro cannot act (shout, laugh, tremble or
ALL-CAPS: 13 of the scene's quoted lines) are spoken by Chatterbox with a
voice cloned from the same Kokoro voice (a 9 s reference clip per character).
Laugh sounds are placed in the pause after narration that says someone
laughs.

- 21% of the audio and 16% of the letters go to Chatterbox; 48 s of compute
  for the scene on this CPU.
- One gain per cloned voice (+6.3 dB Sarah, +4.9 dB Daniel) is enough: level
  steps at the 12 engine switches are no larger than ordinary steps.
- Daniel's clone measures like the same voice, 24% slower. Sarah's is about
  2 semitones lower and duller on top; the owner accepted it in H1.
- A guard per line (speech recognition, length, silence gaps) with one retry
  and a Kokoro fallback: 0 of 19 lines failed in H1. Without speech
  recognition, length and silence checks catch rambling output but not a
  misread word.
- Chatterbox cannot whisper, so whispered lines stay with Kokoro.

## Not decided

Where Chatterbox would run (a ready-made provider, Google Cloud Run, the
owner's computer; Colab only for trials), and the order of building: Kokoro C
in the app first, the studio service second.
