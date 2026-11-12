// Can the direction vectors be a single 128-float row (tiny, embeddable) instead of 510 rows?
import { runVariants, makeStyle, styleRow, voicePack, loadTTS, textToPhonemes, synthPhonemes, writeWav } from "./lib.mjs";
import fs from "node:fs";
const AF = ["af_alloy","af_aoede","af_bella","af_jessica","af_kore","af_nova","af_river","af_sarah","af_sky","af_heart"];
const MEAN = { mix: AF.map(v => [v, 1 / AF.length]) };
// direction averaged over all 510 rows
const dirAvg = (a, b, lo, hi) => { const d = new Float32Array(hi - lo); for (let r = 0; r < 510; r++) { const x = makeStyle(a, r), y = makeStyle(b, r); for (let i = lo; i < hi; i++) d[i - lo] += (x[i] - y[i]) / 510; } return d; };
const W = dirAvg("af_nicole", MEAN, 0, 128), P = dirAvg("am_santa", "am_michael", 128, 256);
fs.writeFileSync("directions.json", JSON.stringify({ note: "128-float directions averaged over all 510 rows. whisper: af_nicole - mean(10 af voices), timbre half [0:128). pitch: am_santa - am_michael, prosody half [128:256).", whisper: Array.from(W, v => +v.toFixed(5)), pitch: Array.from(P, v => +v.toFixed(5)) }));
const tts = await loadTTS();
const lines = ["I don't think we should be here. Someone is listening.", "No.", "You're telling me that the whole budget has simply disappeared? I don't believe it, not for one second, and neither will the board when they read the report tomorrow morning."];
for (const [li, s] of lines.entries()) {
  const ph = await textToPhonemes(s); const n = tts.tokenizer(ph).input_ids.dims.at(-1) - 2;
  for (const [name, fn] of [
    ["perrow", (st) => { const a = makeStyle("af_nicole", n), b = makeStyle(MEAN, n); for (let i = 0; i < 128; i++) st[i] += 1.1 * (a[i] - b[i]); }],
    ["fixed", (st) => { for (let i = 0; i < 128; i++) st[i] += 1.1 * W[i]; }],
    ["pitch_perrow", (st) => { const a = makeStyle("am_santa", n), b = makeStyle("am_michael", n); for (let i = 128; i < 256; i++) st[i] += 0.55 * (a[i] - b[i]); }],
    ["pitch_fixed", (st) => { for (let i = 128; i < 256; i++) st[i] += 0.55 * P[i - 128]; }],
    ["none", () => {}],
  ]) { const st = styleRow(voicePack("af_heart"), n).slice(); fn(st); const { audio } = await synthPhonemes(ph, { style: st }); writeWav(`work/R/l${li}_${name}.wav`, audio); }
}
