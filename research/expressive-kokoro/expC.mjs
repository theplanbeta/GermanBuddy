import { runVariants, voicePack } from "./lib.mjs";
import fs from "node:fs";
const S = "You're telling me that the whole budget has simply disappeared? I don't believe it.";
const AF = ["af_alloy","af_aoede","af_bella","af_jessica","af_kore","af_nova","af_river","af_sarah","af_sky","af_heart"];
const MEAN = { mix: AF.map(v => [v, 1 / AF.length]) };       // "average American female" (excl. nicole)
const V = [];
V.push({ name: "c00_heart", style: "af_heart" });
for (const w of [0.25, 0.5, 0.75]) V.push({ name: `c1_mix_nicole_${w}`, style: { mix: [["af_heart", 1 - w], ["af_nicole", w]] } });
for (const w of [0.3, 0.5]) V.push({ name: `c1_mix_bella_${w}`, style: { mix: [["af_heart", 1 - w], ["af_bella", w]] } });
for (const d of ["af_nicole", "af_bella", "af_sarah", "af_aoede", "am_santa", "am_puck", "af_river", "bf_emma"]) V.push({ name: `c2_tim_heart_pros_${d}`, style: { timbre: "af_heart", prosody: d } });
V.push({ name: `c2_tim_nicole_pros_heart`, style: { timbre: "af_nicole", prosody: "af_heart" } });
// whisper direction = nicole - mean, added to heart (both halves / timbre only / prosody only)
for (const half of ["both", "timbre", "prosody"]) for (const k of [0.5, 1.0, 1.5, 2.0]) V.push({ name: `c3_whisper_${half}_${k}`, style: { base: "af_heart", add: [["af_nicole", MEAN, k]], half } });
// exaggerate heart's own prosody away from the average ("caricature")
for (const k of [0.5, 1.0, 1.5]) V.push({ name: `c3_exag_pros_${k}`, style: { base: "af_heart", add: [["af_heart", MEAN, k]], half: "prosody" } });
for (const s of [0.8, 1.2, 1.5]) V.push({ name: `c3_scale_pros_${s}`, style: { spec: "af_heart", scaleProsody: s } });
// row index override
for (const i of [5, 20, 40, 160, 300, 509]) V.push({ name: `c4_index_${i}`, style: { spec: "af_heart", index: i } });
await runVariants("work/C", V.map(v => ({ ...v, text: S })));
