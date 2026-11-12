// Do the style directions survive the uint8 model used by the app on WASM?
import { loadTTS, textToPhonemes, synthPhonemes, styleRow, voicePack, writeWav } from "./lib.mjs";
import fs from "node:fs";
await loadTTS("uint8");
const D = JSON.parse(fs.readFileSync("directions.json", "utf8"));
const tts = await loadTTS();
const ph = await textToPhonemes("I don't think we should be here. Someone is listening.");
const n = tts.tokenizer(ph).input_ids.dims.at(-1) - 2;
for (const [name, w, p] of [["none", 0, 0], ["whisper1.1", 1.1, 0], ["pitch0.55_firm0.6", -0.6, 0.55]]) {
  const st = styleRow(voicePack("af_heart"), n).slice();
  for (let i = 0; i < 128; i++) st[i] += w * D.whisper[i] + 0; for (let i = 128; i < 256; i++) st[i] += p * D.pitch[i - 128];
  const t = Date.now(); const { audio } = await synthPhonemes(ph, { style: st }); writeWav(`work/Q/uint8_${name}.wav`, audio); console.log(name, Date.now() - t, "ms");
}
const ph2 = "das kan dɔχ nˈɪçt vˈaːɐ zaɪn.";
writeWav("work/Q/uint8_german.wav", (await synthPhonemes(ph2, { style: styleRow(voicePack("af_heart"), 29) })).audio);
