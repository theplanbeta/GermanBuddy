import * as L from "./lib.mjs"; import fs from "node:fs";
const D = JSON.parse(fs.readFileSync("directions.json", "utf8"));
const ph = "ðˈɛn ʃiː wˈɪspɚd, ˈɔːlmoʊst tə hɜːsˈɛlf, das kan dɔχ nˈɪçt vˈaːɐ zaɪn.";
const t = await L.loadTTS(); const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2;
const base = L.styleRow(L.voicePack("af_heart"), n);
const mk = (w, p) => { const s = base.slice(); for (let i = 0; i < 128; i++) s[i] += w * D.whisper[i]; for (let i = 128; i < 256; i++) s[i] += p * D.pitch[i - 128]; return s; };
const a = await L.synthPhonemes(ph, { style: base });
for (const [name, w, p, sp] of [["whisper timbre only", 1.1, 0, 1], ["firm timbre only", -0.6, 0, 1], ["pitch 0.55 (prosody)", 0, 0.55, 1], ["speed 0.92", 1.1, 0, 0.92]]) {
  const b = await L.synthPhonemes(ph, { style: mk(w, p), speed: sp });
  const same = a.starts.length === b.starts.length && a.starts.every((v, i) => v === b.starts[i]);
  const maxShift = Math.max(...a.starts.map((v, i) => Math.abs(v - (b.starts[i] ?? 0)))) / 24000;
  console.log(name.padEnd(22), "identical timing:", same, " max token shift", maxShift.toFixed(3), "s  len", a.audio.length, b.audio.length);
}
