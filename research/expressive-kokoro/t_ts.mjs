import * as L from "./lib.mjs";
const ph = await L.textToPhonemes("Consider this, he said."); const t = await L.loadTTS();
const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2;
const r = await L.synthPhonemes(ph, { style: L.styleRow(L.voicePack("af_heart"), n) });
console.log(L.MODEL_ID, n, [...ph].length, r.starts.length, r.audio.length, r.starts.slice(0, 6));
