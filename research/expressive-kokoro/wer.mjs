// node wer.mjs reference.txt transcripts.jsonl  -> WER per file (whisper-style normalisation)
import fs from "node:fs";
const norm = (s) => s.toLowerCase().replace(/[“”"]/g, "").replace(/(\d),(\d)/g, "$1$2").replace(/[^\p{L}\p{N}%.' ]+/gu, " ").replace(/\.(?!\d)/g, " ").replace(/['’]/g, "'").split(/\s+/).filter(Boolean);
function wer(r, h) { const d = Array.from({ length: r.length + 1 }, (_, i) => [i]); for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length; }
const ref = norm(fs.readFileSync(process.argv[2], "utf8"));
for (const line of fs.readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean)) { const { file, text } = JSON.parse(line); console.log(file.split("/").pop().padEnd(40), "WER", (100 * wer(ref, norm(text))).toFixed(1) + "%", "|", text.slice(0, 400)); }
