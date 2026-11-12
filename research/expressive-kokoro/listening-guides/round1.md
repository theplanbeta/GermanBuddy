# Expressive Kokoro: listening guide

Everything here uses voice af_heart and the fp32 model, on CPU in Node (kokoro-js 1.2.1).
Rendering is deterministic: the same input always gives the same audio.
Numbers in brackets are measurements. Only your ears can say whether a clip sounds natural.

## Full paragraph (listen first)
1. `A_baseline_app_today.wav`: exactly what the app does today. It uses the listen-app splitter, including the early split of the opening sentence. Each piece is generated separately, and the gaps are 0.3 s, 0.1 s and 0.75 s. Kokoro adds about 0.3 s of silence at the start of each piece and about 0.5 s at the end, so the gap you actually hear between sentences is about 1.0 to 1.1 s, almost everywhere.
2. `B_all_recommended.wav`: the director and performer (`render.mjs`) with every recommended technique on. It keeps sentences whole, trims Kokoro's edge silence, varies the pauses (0.15 to 0.9 s), uses German and Spanish phonemes, adds a whisper on the German line, raises the voice on the shouted lines, and slows down the "deliberately slowing" lines.
3. `C_optional_all_plus_tremolo.wav`: the same as B, plus a 5.5 Hz amplitude tremolo on "Wait… what?!" (cue: "her voice trembling"). You may want to turn this one down.
4. `C_optional_all_plus_male_voice_for_he.wav`: the same as B, but quotes said by "he" use am_michael.

## Short A/B clips (`clips/`), in listening order
| # | Files | What to listen for |
|---|---|---|
| 01 | sentence_gaps A / B / C | "A glass shattered. Everyone froze. Three seconds passed. Then five." A is today's app, with about 1.1 s gaps. B is one model call, where Kokoro's own gaps are only about 0.17 s and they sound like commas. C trims the edge silence and inserts about 0.83 s on purpose. Which beat feels right? |
| 02 | opening_split A / B | Today the opening sentence is cut after "Wednesday,", which leaves a 0.9 s hole (0.3 s when the sentence is whole). Kokoro keeps the rising "comma" tune either way, so the gap is the only problem. |
| 03 | long_sentence_split A / B | The 200-character cut after "sclerosis," gives a 1.05 s gap. Whole, it is 0.32 s. |
| 04 | wait_what A / B / C / D | A is today's app: "Wait…" and "WHAT?!" become two separate sentences, 1.0 s apart. B is one call, very rushed. C is "Wait…", then 0.5 s, then a raised "what?!" (+2.3 semitones, +4.8 dB). D is C plus tremolo. |
| 05 | whisper A / B / C | "Das kann doch nicht wahr sein." A is English rules ("dass can dock nisht war sane"). B is German phonemes only. C is German phonemes plus the whisper vector (voiced fraction 0.59 to 0.28, HNR 11 to 4 dB, 4.7 dB quieter). Does C sound like a whisper, or like a broken voice? |
| 05b | whisper_strength_ladder | The same sentence at whisper strength 0, 0.5, 1.0, 1.5 and 2.0 (voiced fraction 0.58, 0.49, 0.37, 0.18, 0.02). Where does it stop sounding natural? The recommended setting is 1.1. |
| 06 | foreign_words A / B | Müller, Zürich, Eichhörnchen, ¡Cuidado!, Achtung!. A is English rules ("Mueller", "Zurich", "eye-ker-n-chen", "kyoo-ih-dah-doh", "etch-tung"). B is German or Spanish sounds mapped onto Kokoro's symbols. Kokoro has no "ü" (ʏ), so "y" stands in for it. |
| 07 | slow_consider_this A / B | The professor's lines at speed 1 and at 0.85. Same pitch, 15% slower. |
| 08 | shout A / B / C / D | "¡Cuidado! Achtung! Watch out!". A is today's app. B adds only gain (+4 dB) and a 2 kHz shelf. C uses only the style vectors (pitch up about 2 semitones and a firmer voice). D uses both, and is the recommended one. None of them is a real shout. Which gets closest? |
| 09 | laugh_sigh A / B | The girl's lines are a little higher and faster. The professor's "Well…" is softer and breathier. Kokoro cannot laugh or sigh. |
| 10 | punctuation_pause | One sentence with six joins: none, "…", "...", ",", " — " and ". ". The pause Kokoro makes itself is 0, 0.19, 0.30, 0.18, 0.23 and 0.34 s. So "..." pauses longer than "…". |
| 11 | caps_and_stress_marks (negative result) | Lower case and ALL CAPS give identical audio: kokoro-js drops the capitals. Moving or adding stress marks by hand changes almost nothing. |
| 12 | animated_prosody | Heart, then heart with the prosody half borrowed 50% from am_santa (pitch varies about 14% more), then heart with the pitch direction (+3.5 semitones). This one is experimental. |
| 13 | length_row_pace | The same sentence using voice row 20, the true row (81), and row 300. The pace changes by about ±10%, and nothing else does. This setting is marginal. |
| 14 | misaki_symbols (neutral) | Kokoro v1.0 was trained on "misaki" phoneme symbols, but kokoro-js sends raw espeak symbols. Converting them made no difference I could measure. |

How to reproduce: `node render.mjs <in.txt> <out.wav> [--voice af_heart] [--no-director --no-pauses --no-styles --no-speed --no-dsp --no-foreign --no-normalize] [--tremolo --emphasis --misaki --cast --dialogue-voice X --per-row-directions] [--app] [--log plan.json]`
