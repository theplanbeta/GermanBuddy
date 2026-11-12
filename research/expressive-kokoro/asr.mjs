// Offline ASR intelligibility guard: node asr.mjs a.wav b.wav ...  -> JSON lines {file,text}
import { pipeline } from "@huggingface/transformers";
import fs from "node:fs";
const model = process.env.ASR_MODEL || "onnx-community/whisper-base.en";
const asr = await pipeline("automatic-speech-recognition", model, { dtype: "fp32", device: "cpu" });
function readWav(f) { const b = fs.readFileSync(f); const n = (b.length - 44) / 2; const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt16LE(44 + i * 2) / 32768; return a; }
function resample(a, from, to) { const n = Math.floor(a.length * to / from); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * from / to, j = Math.floor(x), f = x - j; o[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f; } return o; }
for (const f of process.argv.slice(2)) {
  const a = resample(readWav(f), 24000, 16000);
  const r = await asr(a, { chunk_length_s: 30, stride_length_s: 5 });
  console.log(JSON.stringify({ file: f, text: r.text.trim() }));
}
