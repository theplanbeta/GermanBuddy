import fs from "node:fs"; import { writeWav, concat, silence } from "./lib.mjs";
const rd = (f) => { const b = fs.readFileSync(f); const n = (b.length - 44) / 2; const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt16LE(44 + i * 2) / 32768; return a; };
for (const K of [20, 60, 150, 300, 509]) for (const kind of ["single", "group"]) {
  const base = `work/abl3/prose/row_${kind}_fixed${K}`; const d = JSON.parse(fs.readFileSync(base + ".json", "utf8")).sentences; const x = rd(base + ".wav");
  writeWav(`out3/2_row_ladder/${kind === "single" ? "A" : "B"}_${kind}_calls_row${String(K).padStart(3, "0")}.wav`, concat([x.slice(0, Math.round((d[2].start + d[2].dur) * 24000)), silence(0.3)]));
}
