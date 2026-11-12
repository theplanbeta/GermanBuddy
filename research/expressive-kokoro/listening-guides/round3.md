# Why D2 sounds more natural than D1: listening guide (round 3)

Everything is af_heart, fp32, speed 1, plain prose (`work/prose.txt`, 158 words, no dialogue).

## 1. `1_which_factor/`: one question
Each file changes exactly one thing compared with D1 (or removes one thing from D2).

**Listening order:** 1 → 2 (the difference you already heard), then 3, 4, 6, 7, then 5, 8.

**The one question:** which of files 3–8 sound most like file 2 (D2)?

| File | What changes | Measured effect (D1 → this file) |
|---|---|---|
| 1_D1 | One model call per sentence. Voice row = sentence length (rows 29–158). | 12.5 ph/s; sentence-final syllable 457 ms; spread of sentence-start pitch 0.84 st; HNR 12.6 dB; pause 0.52 s |
| 2_D2 | One call per paragraph. Voice row = call length (rows 246–394). The model's own pauses are set to the designed length. | 12.2 ph/s; final syllable 568 ms; start spread 1.79 st; HNR 12.7; pause 0.43 s |
| 3_D1_plus_context_only | Paragraph calls, but with the row a single sentence would get (61–98). D1 edges and pauses. | 14.4 ph/s (15% faster); final 473 ms; start spread 1.69; F0 −7 Hz; HNR 11.4 |
| 4_D1_plus_group_row_only | One call per sentence, but with the paragraph's row. | 11.4 ph/s (9% slower); final 489 ms; start spread 1.37; HNR 13.2 |
| 5_D1_plus_D2_pauses_only | D1's audio with D2's exact pause lengths. | Only the pauses change (0.52 → 0.43 s) |
| 6_D2_minus_context_row_kept | D2's rows and pauses, but one call per sentence. | Like file 4: 11.4 ph/s; final 489 ms |
| 7_D2_with_single_sentence_row | D2's calls and pauses, but single-sentence rows. | Like file 3: 14.4 ph/s; final 473 ms |
| 8_D2_with_D1_pauses | D2 with D1's longer pauses. | Only the pauses change (0.43 → 0.52 s) |

**What I expect from the numbers:**
- 8 is closest to D2, and 5 is closest to D1. The pause lengths alone change nothing else.
- 6 and 4 are next: same clear voice as D2, but slower, and they lose D2's longer sentence endings and varied sentence openings.
- 7 and 3 come last: they sound hurried.
- Neither the context nor the voice row alone reproduces D2. What matters is the combination: a long call gives you both a high voice row and context. In a long call, the faster pace that context brings and the slower pace the high row brings cancel out.

## 2. `2_row_ladder/`: what the voice row does
The first paragraph, rendered with the voice row fixed at 20, 60, 150, 300 and 509. A_* files are one call per sentence; B_* files are one call for the whole paragraph.

| Row | One call per sentence (ph/s, F0, HNR) | One call per paragraph (ph/s, F0, HNR) |
|---|---|---|
| 20 | 15.7 ph/s, 180 Hz, 10.5 dB | 17.2 ph/s, 173 Hz, 10.7 dB |
| 60 | 13.0, 190, 12.5 | 15.2, 182, 11.8 |
| 150 | 11.7, 195, 13.1 | 12.8, 191, 12.7 |
| 300 | 11.3, 196, 13.2 | 12.1, 193, 12.8 |
| 509 | 11.5, 195, 13.0 | 12.6, 191, 12.6 |

Below about row 150 the voice gets faster, lower and breathier. Above about row 200 it barely changes.

## 3. `3_D3_candidates/`: pushing the winning factor further
**Ordinary prose** (`P_*`):
- `P_D2_reference.wav`
- `P_D3_app_ready.wav`: D2, but the first sentence is its own call, as the app needs for fast first audio. It is rendered together with sentence 2, which is then thrown away, so it still ends like a mid-paragraph sentence.

**The same prose as one long paragraph** (`L_*`, text in `L_text.txt`). This is a harder test of the joins between calls:
- `L_D1.wav`
- `L_D2.wav`: groups of up to 4 sentences.
- `L_D3a.wav`: as many sentences per call as fit under 480 phonemes (2 calls).
- `L_D3b.wav` (recommended): D3a, plus the first sentence alone and one sentence of look-ahead at each join between calls.
- `L_D3c.wav`: groups of 4 with look-ahead.

What to listen for: where two calls meet, does the voice "restart"?

**Stress paragraph:** `S_D2_reference.wav` and `S_D3_app_ready.wav` (D3b's settings, with styled quotes spliced as before).

To reproduce: `node ablate.mjs work/prose.txt <dir> [variant]` and `node render.mjs <in> <out> --max-group 12 --max-ph 480 --lookahead --first-alone`.
