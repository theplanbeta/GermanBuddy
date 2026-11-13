// Make reference clips with Kokoro (synthetic voices, no real people). 24 kHz mono 16-bit.
import { KokoroTTS } from "kokoro-js"; import fs from "node:fs";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
const text = "The morning was quiet, and the old house creaked softly in the wind. She poured a cup of tea, opened the window, and listened to the birds outside.";
// Workbench copy of research/dialogue-hybrid/models/kokoro_refs.mjs; only the output folder differs.
const W = new URL('./out/refs', import.meta.url).pathname;
fs.mkdirSync(W, { recursive: true });
for (const v of process.argv.slice(2)) {
  const a = (await tts.generate(text, { voice: v })).audio; const b = Buffer.alloc(44 + a.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(`${W}/${v}.wav`, b); console.log(v, (a.length / 24000).toFixed(2));
}
