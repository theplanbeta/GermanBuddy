# Faster first audio without losing D3 (round 4)

## 1. The opening sentence (`clips/opening_*`): listen first
Each file is only the sentence the app would play ("Most cities were not designed…"). What changes is how much of the next sentence the model was shown while rendering it.

"Ending" is the length of the final syllable. Inside a paragraph it measures about 570–600 ms, and that is the target. Times are CPU synthesis in Node; your phone will differ.

| File | What the model was shown | Ending | Synthesis time |
|---|---|---|---|
| 1_none | the sentence alone | 450 ms (clipped) | 1.07 s |
| 2_2words_own_row | plus "Drains that" | 475 ms | 1.31 s |
| **3_2words_virtual_row** (recommended) | plus "Drains that", with the voice row set as if the whole next sentence were there | **600 ms** | **1.32 s** |
| 4_4words_virtual_row | plus "Drains that were sized", same row | 600 ms | 1.49 s |
| 5_full_next_sentence | the whole next sentence (current D3) | 650 ms | 3.63 s |

**Question:** does 3 sound as good as 5? It reaches the listener 2.3 s sooner.

## 2. A join between two calls (`clips/join_*`)
The same ladder for the end of "…every street has to be dug up.":

| File | Ending |
|---|---|
| none | 375 ms |
| 2 words | 500 ms |
| 2 words + virtual row | 525 ms |
| 4 words + virtual row | 525 ms |
| full next sentence | 550 ms |

## 3. Whole passage (one long paragraph)
| File | How it is rendered | Calls |
|---|---|---|
| `L_D3_current.wav` | First sentence alone with the full next sentence, then paragraph-sized calls. | 1, 5, 5 |
| `L_D4_ramp_2word_lookahead.wav` (recommended) | Calls grow 1 → 2 → 4 → rest. Each call sees only the next 2 words, with the virtual row. | 1, 2, 4, 4 |
| `L_D4b_paragraph_2word_lookahead.wav` | Like D3, but each call sees only 2 words of the next sentence. | 1, 5, 5 |

**Question:** can you hear any difference between D3 and D4? By the round-3 measures they are equal or D4 is slightly better:

| | Ending inside a call | Ending at a join | Sentence-start variety | ASR errors |
|---|---|---|---|---|
| D3 | 559 ms | 525 ms | 1.89 st | 0% |
| D4 | 564 ms | 583 ms | 1.89 st | 0% |
