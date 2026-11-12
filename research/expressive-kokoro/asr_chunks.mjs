// Per-chunk intelligibility guard. node asr_chunks.mjs out.wav plan.json [label]
// plan.json: render.mjs --log output ({chunks:[{start,dur,text,lang}]}) or baseline *.pieces.json ([{start,dur,text}])
import { pipeline } from "@huggingface/transformers";
import fs from "node:fs";
const [wav, planFile, label = ""] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(planFile, "utf8")); const chunks = p.chunks ?? p.sentences ?? p;
const en = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", { dtype: "fp32", device: "cpu" });
const ml = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small", { dtype: "fp32", device: "cpu" });
const b = fs.readFileSync(wav); const N = (b.length - 44) / 2; const all = new Float32Array(N); for (let i = 0; i < N; i++) all[i] = b.readInt16LE(44 + i * 2) / 32768;
const res = (a) => { const n = Math.floor(a.length * 2 / 3); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 1.5, j = Math.floor(x), f = x - j; o[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f; } return o; };
const norm = (s) => s.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/[^\p{L}\p{N}%' ]+/gu, " ").replace(/['’]/g, "'").split(/\s+/).filter(Boolean);
function ed(r, h) { const d = Array.from({ length: r.length + 1 }, (_, i) => [i]); for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)); return d[r.length][h.length]; }
const LN = { de: "german", es: "spanish" };
let E = 0, W = 0; const rows = [];
for (const c of chunks) {
  const a = all.slice(Math.round(c.start * 24000), Math.round((c.start + c.dur) * 24000) + Math.min(2400, Math.round((c.pause ?? 0.1) * 24000)));
  const lang = c.lang ?? (/[¡]|cuidado/i.test(c.text) ? "es" : /\b(das|kann|achtung)\b/i.test(c.text) ? "de" : "en");
  const r = lang === "en" ? await en(res(a)) : await ml(res(a), { language: LN[lang], task: "transcribe" });
  const ref = norm(c.text.replace(/zero point seven five/, "0.75")), hyp = norm(r.text.replace(/0\.75/, "0.75"));
  const e = ed(ref, hyp); E += e; W += ref.length;
  rows.push({ lang, wer: +(e / ref.length).toFixed(2), text: c.text, heard: r.text.trim() });
  console.log(`${(100 * e / ref.length).toFixed(0).padStart(4)}% ${lang} | ${c.text} | heard: ${r.text.trim()}`);
}
console.log(`${label} TOTAL WER ${(100 * E / W).toFixed(1)}% over ${W} words`);
fs.writeFileSync(planFile.replace(/\.json$/, ".asr.json"), JSON.stringify(rows, null, 1));
