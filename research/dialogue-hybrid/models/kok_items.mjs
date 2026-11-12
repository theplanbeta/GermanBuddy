// Kokoro reference render of the same segments (voices only; Kokoro has no expressive controls)
import { KokoroTTS } from "kokoro-js"; import fs from "node:fs";
const [logf, dir] = process.argv.slice(2); const L = JSON.parse(fs.readFileSync(logf, "utf8"));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
function wav(f, a) { const b = Buffer.alloc(44 + a.length * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(a.length * 2, 40); for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a[i] * 32767))), 44 + i * 2); fs.writeFileSync(f, b); }
for (const it of L.items) { const a = (await tts.generate(it.text, { voice: it.voice })).audio; wav(`${dir}/p${String(it.i).padStart(3, "0")}.wav`, a); }
console.log("done");
