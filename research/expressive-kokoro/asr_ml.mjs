// Multilingual ASR: LANG=german node asr_ml.mjs a.wav ...
import { pipeline } from "@huggingface/transformers";
import fs from "node:fs";
const asr = await pipeline("automatic-speech-recognition", process.env.ASR_MODEL || "onnx-community/whisper-small", { dtype: "fp32", device: "cpu" });
function readWav(f) { const b = fs.readFileSync(f); const n = (b.length - 44) / 2; const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt16LE(44 + i * 2) / 32768; return a; }
function resample(a) { const n = Math.floor(a.length * 2 / 3); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 1.5, j = Math.floor(x), f = x - j; o[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f; } return o; }
for (const f of process.argv.slice(2)) {
  const r = await asr(resample(readWav(f)), { language: process.env.LANG_ASR || "german", task: "transcribe" });
  console.log(f.split("/").pop().padEnd(34), r.text.trim());
}
