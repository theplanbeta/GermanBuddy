// Look-ahead ladder with "virtual row" (row = phonemes of the call + the FULL next sentence, even if only a few
// words of it are rendered). Saves the kept part only, as the app would play it.
import fs from "node:fs";
import { loadTTS, textToPhonemes, synthPhonemes, styleRow, voicePack, writeWav, concat, silence, SR } from "./lib.mjs";
import { findGaps } from "./group.mjs";
const tts = await loadTTS(); const V = tts.tokenizer.model.tokens_to_ids; const clean = (p) => [...p].filter((c) => V.has(c)).join("");
const ph = async (t) => clean(await textToPhonemes(t)); const VOW = new Set([..."aeiouæɑɐɒɔəɚɛɜɪʊʌᵻ"]);
const CASES = {
  opening: { kept: ["Most cities were not designed for the weather they now face."], next: "Drains that were sized for the storms of the last century overflow several times a year, and streets that once stayed dry now flood within minutes." },
  join: { kept: ["Engineers have started to respond in two ways.", "The first is to build bigger pipes, which is expensive, slow, and disruptive, because every street has to be dug up."], next: "The second is to let the city itself absorb more water." },
};
const rows = [];
for (const [cn, C] of Object.entries(CASES)) {
  const kp = []; for (const s of C.kept) kp.push(await ph(s));
  const nextPh = await ph(C.next); const w = C.next.split(/\s+/);
  const nFull = kp.reduce((a, p) => a + [...p].length + 1, 0) + [...nextPh].length;
  for (const [name, la, virtual] of [["1_none", null, false], ["2_2words_own_row", w.slice(0, 2).join(" "), false], ["3_2words_virtual_row", w.slice(0, 2).join(" "), true], ["4_4words_virtual_row", w.slice(0, 4).join(" "), true], ["5_full_next_sentence", C.next, false]]) {
    const all = [...kp, ...(la ? [await ph(la)] : [])].join(" "); const n = [...all].length;
    const t0 = performance.now(); const r = await synthPhonemes(all, { style: styleRow(voicePack("af_heart"), virtual ? nFull : n) }); const ms = performance.now() - t0;
    const off = kp.slice(0, -1).reduce((a, p) => a + [...p].length + 1, 0), L = [...kp.at(-1)];
    let j = L.length - 1; while (/[.!?,;:… ]/.test(L[j])) j--; let k = j; while (!VOW.has(L[k])) k--;
    const rime = Math.round((r.starts[off + j + 2] - r.starts[off + k + 1]) / 24);
    let end = r.audio.length;
    if (la) { const tb = r.starts[off + L.length + 1] / SR; const g = findGaps(r.audio, { minLen: 0.03 }).gaps.filter((q) => q.e >= tb - 0.6 && q.s <= tb + 0.15).sort((a, b) => b.len - a.len)[0]; end = Math.round(((g ? g.s : tb) + 0.08) * SR); }
    const kept = r.audio.slice(0, end); writeWav(`out4/clips/${cn}_${name}.wav`, concat([kept, silence(0.5)]));
    rows.push({ case: cn, variant: name, n, row: virtual ? nFull : n, ms: Math.round(ms), rime });
    console.log(cn.padEnd(8), name.padEnd(24), "n", n, "row", virtual ? nFull : n, "synth", Math.round(ms), "ms  rime", rime, "ms");
  }
}
fs.writeFileSync("work/la/ladder.json", JSON.stringify(rows, null, 1));
