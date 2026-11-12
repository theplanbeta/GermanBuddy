# Smooth flow: listening guide (round 2)

All files use af_heart and the fp32 model. Rendering is deterministic.
`B_previous.wav` is byte-identical to round 1's `B_all_recommended.wav`.

## 1. Changes of delivery inside a sentence (listen first)
Each folder group is one sentence that changes register partway through. Compare them in this order:
- **B_previous**: round 1. The sentence is cut into separately generated pieces with a 0.22 s gap inserted between them. You actually hear 0.33 to 0.56 s, because Kokoro's own edge silence adds to the gap.
- **onecall**: the whole sentence in one model call with no style. This is the "natural flow" reference, but the whisper or raised voice is lost.
- **compromise**: one call, with the styles blended in proportion to how long each part is (so the whisper is diluted).
- **smooth**: separate calls with a short 0.18 s gap and the loudness ramped in.
- **aligned**: the whole sentence is rendered twice. The register change (whisper, firm voice, loudness) touches only the timbre half of the style, so the timing of the two renders is identical, sample for sample. Each part is taken from the render that matches it.
- **D_splice (recommended)**: the whole sentence is rendered once per style. Each part is cut out of the render made with its own style, exactly at the model's own pause, using token timings. Every part therefore carries the intonation of the complete sentence, and no pause is inserted.

| Clip | What to listen for |
|---|---|
| `W1_wait_what__*` | "Wait… what?!" she exclaimed. B has a 0.56 s hole after "Wait…". In D, "Wait… what" runs on as the model says it (0.0 s gap), and "what?!" is still raised. |
| `W2_whisper_german__*` | "Then she whispered, almost to herself, Das kann…". Does the change into the whisper feel continuous? |
| `W3_consider_this__*` | "Consider this," (slower) "he said…". B has a 0.35 s gap. In D the model makes no pause at that comma, and neither does the clip. |
| `W4_shouted_cuidado__*` | "…from the back: ¡Cuidado!". The jump to the shout is intended. Listen for the gap and the attack. |
| `W5_girl_laugh__*`, `W6_professor_sigh__*` | B split these sentences for small cues (laugh, sigh). D keeps each one whole and drops the cue. Is anything lost? |

## 2. Full paragraph
- `B_previous.wav`
- `D1_smooth_per_sentence.wav`: one model call per sentence, except where a sentence changes register (splice). Pauses vary from 0.31 to 0.55 s depending on the length of the sentence before. Pauses are filled with very quiet room tone instead of digital zero.
- `D2_smooth_grouped.wav`: D1, but 2 to 4 neighbouring sentences in the same style share one model call. The model's own pauses between them are then set to the designed length, using exact token timings.

## 3. Ordinary prose (no dialogue): the case that matters most
- `P_A_app_today.wav`
- `P_B_previous.wav`
- `P_D1_smooth_per_sentence.wav`
- `P_D2_smooth_grouped.wav`

Plain prose has no mid-sentence joins, so B and D1 differ only in pause lengths and room tone. D2 differs in how connected neighbouring sentences sound.

## 4. Isolated checks
| Clip | What to listen for |
|---|---|
| `X1_row_pinning_*` | "Then five." and "Everyone froze.", each rendered first with the true voice row, then with the row pinned to at least 60. Pinning made them slower, and ASR heard "Then fives". This fix was rejected. |
| `X2_edges__hard_digital_silence` / `__soft_with_room_tone` | Three sentences. Can you hear any difference at all? The measurements say v1's edges already match Kokoro's natural release. |
| `X3_prose_paragraph1__per_sentence` / `__grouped_one_call` | Does the grouped version sound more like one connected thought? |
| `X4_beat__per_sentence` / `__grouped_one_call` | "A glass shattered. Everyone froze. Three seconds passed. Then five." |

## Reproduce
`node render.mjs in.txt out.wav` gives D2. Add `--no-group` for D1, `--v1` for B, `--app` for today's app.
To compare the joins: `--joins split|onecall|compromise|smooth|aligned|splice`.
Other switches: `--row true|min:K|fixed:K`, `--edges hard|soft`, `--no-roomtone`, `--pauses v1|natural`, `--no-merge-mild`, `--no-ramp`, `--no-timestamps`.
