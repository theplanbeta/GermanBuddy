// Is the look-ahead benefit context or just the higher row? Same inputs, row forced to the full-look-ahead row.
import { loadTTS, textToPhonemes, synthPhonemes, styleRow, voicePack } from "./lib.mjs";
const tts = await loadTTS(); const V = tts.tokenizer.model.tokens_to_ids; const clean = (p) => [...p].filter((c) => V.has(c)).join("");
const VOW = new Set([..."aeiouæɑɐɒɔəɚɛɜɪʊʌᵻ"]);
const k1 = clean(await textToPhonemes("Most cities were not designed for the weather they now face."));
for (const [name, la, row] of [["none,row59", null, null], ["none,row214", null, 214], ["2w,row73", "Drains that", null], ["2w,row214", "Drains that", 214], ["4w,row214", "Drains that were sized", 214], ["clause,row150", "Drains that were sized for the storms of the last century overflow several times a year", null], ["clause,row214", "Drains that were sized for the storms of the last century overflow several times a year", 214]]) {
  const all = la ? k1 + " " + clean(await textToPhonemes(la)) : k1; const n = [...all].length;
  const r = await synthPhonemes(all, { style: styleRow(voicePack("af_heart"), row ?? n) });
  const L = [...k1]; let j = L.length - 1; while (/[.!?,;:… ]/.test(L[j])) j--; let k = j; while (!VOW.has(L[k])) k--;
  console.log(name.padEnd(16), "rime", Math.round((r.starts[j + 2] - r.starts[k + 1]) / 24), "ms  kept rate", (L.filter(c=>!/[ˈˌː\s.,]/.test(c)).length / ((r.starts[L.length + 1] - r.starts[1]) / 24000)).toFixed(1), "ph/s");
}
