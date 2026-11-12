import { runVariants } from "./lib.mjs";
const AF = ["af_alloy","af_aoede","af_bella","af_jessica","af_kore","af_nova","af_river","af_sarah","af_sky","af_heart"];
const MEAN = { mix: AF.map(v => [v, 1 / AF.length]) };
const S = "“Consider this,” he said, deliberately slowing his speech.";
const V = [];
for (const sp of [0.75, 0.85, 1.0, 1.1, 1.2]) V.push({ name: `sp_${sp}`, text: S, speed: sp });
// whisper direction on other narrators (male US, male UK) - does nicole-minus-mean transfer?
for (const v of ["am_michael", "bm_george", "af_bella"]) for (const k of [0, 1.0, 1.5]) V.push({ name: `wg_${v}_${k}`, text: "I don't think we should be here. Someone is listening.", style: { base: v, add: [["af_nicole", MEAN, k]], half: "timbre" } });
await runVariants("work/E", V);
