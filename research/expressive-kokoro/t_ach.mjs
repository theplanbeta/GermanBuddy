import * as L from "./lib.mjs"; import { softTrim, trimSilence } from "./dsp.mjs";
const t = await L.loadTTS(); const ph = "ˈaχtʊŋ!"; const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2;
const { audio } = await L.synthPhonemes(ph, { style: L.styleRow(L.voicePack("af_heart"), n) });
const vs = { hard: trimSilence(audio), soft: softTrim(audio), soft_tail_only: softTrim(audio, { padOut: 0.0, fadeOut: 0.008, dropDb: 45 }), soft_noTailPad: softTrim(audio, { padOut: 0.04 }), soft_front_only_hard: (() => { const h = trimSilence(audio); return h; })() };
for (const [k, v] of Object.entries(vs)) { L.writeWav(`work/v2/ach/a_${k}.wav`, L.concat([L.silence(0.2), v, L.silence(0.2)])); console.log(k, (v.length / 24000).toFixed(3)); }
