// node cut.mjs out.wav plan.json prefix  -> writes work/seg/<prefix>_<i>.wav per chunk
import fs from "node:fs"; import { writeWav } from "./lib.mjs";
const [wav, planFile, pre] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(planFile, "utf8")); const chunks = p.chunks ?? p;
const b = fs.readFileSync(wav); const N = (b.length - 44) / 2; const all = new Float32Array(N); for (let i = 0; i < N; i++) all[i] = b.readInt16LE(44 + i * 2) / 32768;
chunks.forEach((c, i) => writeWav(`work/seg/${pre}_${String(i).padStart(2, "0")}.wav`, all.slice(Math.round(c.start * 24000), Math.round((c.start + c.dur) * 24000))));
