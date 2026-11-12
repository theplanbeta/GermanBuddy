// Word timestamps: node asrw.mjs file.wav -> JSON [{text,start,end}]
import { pipeline } from "@huggingface/transformers";
import fs from "node:fs";
const asr = await pipeline("automatic-speech-recognition", process.env.ASR_MODEL || "onnx-community/whisper-base.en_timestamped", { dtype: "fp32", device: "cpu" });
function readWav(f) { const b = fs.readFileSync(f); const n = (b.length - 44) / 2; const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt16LE(44 + i * 2) / 32768; return a; }
function resample(a) { const n = Math.floor(a.length * 2 / 3); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 1.5, j = Math.floor(x), f = x - j; o[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f; } return o; }
for (const f of process.argv.slice(2)) {
  const r = await asr(resample(readWav(f)), { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
  const words = r.chunks.map(c => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] }));
  fs.writeFileSync(f.replace(/\.wav$/, ".words.json"), JSON.stringify(words));
  console.log(f, words.map(w => `${w.w}@${w.s?.toFixed(2)}`).join(" "));
}
