// node asr.mjs a.wav ... -> JSON lines {file,text,chunks}; any sample rate (16-bit mono WAV)
import { pipeline, env } from "@huggingface/transformers";
import fs from "node:fs";
const model = process.env.ASR_MODEL || "onnx-community/whisper-base.en";
const asr = await pipeline("automatic-speech-recognition", model, { dtype: "fp32", device: "cpu" });
function readWav(f) { const b = fs.readFileSync(f); let p = 12, sr = 0, data = null;
  while (p < b.length) { const id = b.toString("ascii", p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === "fmt ") sr = b.readUInt32LE(p + 12); if (id === "data") { data = b.subarray(p + 8, p + 8 + sz); break; } p += 8 + sz; }
  const n = data.length / 2, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = data.readInt16LE(i * 2) / 32768; return [a, sr]; }
function resample(a, from, to) { if (from === to) return a; const n = Math.floor(a.length * to / from); const o = new Float32Array(n);
  // simple box low-pass then linear interp
  const k = Math.max(1, Math.round(from / to)); const s = new Float32Array(a.length); let acc = 0;
  for (let i = 0; i < a.length; i++) { acc += a[i]; if (i >= k) acc -= a[i - k]; s[i] = acc / Math.min(i + 1, k); }
  for (let i = 0; i < n; i++) { const x = i * from / to + (k - 1) / 2, j = Math.floor(x), f = x - j; o[i] = (s[j] ?? 0) * (1 - f) + (s[j + 1] ?? 0) * f; } return o; }
for (const f of process.argv.slice(2)) {
  const [a0, sr] = readWav(f); const a = resample(a0, sr, 16000);
  const r = await asr(a, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
  console.log(JSON.stringify({ file: f.split("/").pop(), text: r.text.trim(), words: (r.chunks||[]).map(c => [c.text.trim(), c.timestamp[0], c.timestamp[1]]) }));
}
