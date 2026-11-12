// Truncated look-ahead: how much of the next sentence must the model see for the kept sentence(s)
// to end like a mid-paragraph sentence?   node la.mjs  -> work/la/*.wav + work/la/results.json
import fs from "node:fs";
import { loadTTS, textToPhonemes, synthPhonemes, styleRow, voicePack, writeWav, SR } from "./lib.mjs";
import { findGaps } from "./group.mjs";
const tts = await loadTTS();
const V = tts.tokenizer.model.tokens_to_ids;
const clean = (p) => [...p].filter((c) => V.has(c)).join("");
const ph = async (t) => clean(await textToPhonemes(t));
const VOW = new Set([..."aeiouæɑɐɒɔəɚɛɜɪʊʌᵻ"]);
fs.mkdirSync("work/la", { recursive: true });

const CASES = {
  opening: { kept: ["Most cities were not designed for the weather they now face."],
    next: "Drains that were sized for the storms of the last century overflow several times a year, and streets that once stayed dry now flood within minutes." },
  join: { kept: ["Engineers have started to respond in two ways.", "The first is to build bigger pipes, which is expensive, slow, and disruptive, because every street has to be dug up."],
    next: "The second is to let the city itself absorb more water." },
  opening2: { kept: ["At precisely 7:43 a.m. on Wednesday, November 12th, Dr. Mueller received an unexpected phone call."],
    next: "There was a long, uncomfortable silence." },
};
function truncations(next) {
  const w = next.replace(/[.!?]$/, "").split(/\s+/);
  const clause = next.includes(",") ? next.slice(0, next.indexOf(",")) : w.slice(0, Math.ceil(w.length / 2)).join(" ");
  const out = { none: null, full: next };
  for (const [k, t] of [["clause", clause], ["8w", w.slice(0, 8).join(" ")], ["4w", w.slice(0, 4).join(" ")], ["2w", w.slice(0, 2).join(" ")]])
    for (const [e, s] of [["bare", ""], ["comma", ","], ["ellipsis", "…"]]) out[`${k}_${e}`] = t.replace(/[,;:]$/, "") + s;
  return out;
}
const results = [];
for (const [cname, C] of Object.entries(CASES)) {
  const keptPh = []; for (const s of C.kept) keptPh.push(await ph(s));
  for (const [lname, la] of Object.entries(truncations(C.next))) {
    const laPh = la ? await ph(la) : null;
    const phs = laPh ? [...keptPh, laPh] : keptPh;
    const all = phs.join(" "); const n = [...all].length;
    const t0 = performance.now();
    const r = await synthPhonemes(all, { style: styleRow(voicePack("af_heart"), n) });
    const ms = performance.now() - t0;
    // last kept sentence: token span
    const off = keptPh.slice(0, -1).reduce((a, p) => a + [...p].length + 1, 0);
    const last = [...keptPh.at(-1)], L = last.length;
    const tok = (i) => r.starts[off + i + 1] / SR; // char i of last kept sentence
    let j = L - 1; while (j > 0 && /[.!?,;:… ]/.test(last[j])) j--;
    let k = j; while (k > 0 && !VOW.has(last[k])) k--;
    const rime = (tok(j + 1) - tok(k)) * 1000;
    // silence the model makes after the kept part, and where we would cut
    const endKept = tok(L); // start of the token after the kept sentence's final punctuation = the space
    const sil = findGaps(r.audio, { minLen: 0.03 }).gaps.filter((g) => g.e >= tok(j + 1) - 0.05 && g.s <= endKept + 0.15).sort((a, b) => b.len - a.len)[0];
    const cut = sil ? (sil.s + sil.e) / 2 : endKept;
    // F0 movement over the last 300 ms of voiced speech before the cut, and start pitch of the look-ahead
    results.push({ case: cname, la: lname, laText: la, n, ms: Math.round(ms), rimeMs: Math.round(rime), modelPause: sil ? +sil.len.toFixed(3) : 0, cut: +cut.toFixed(3),
      cleanCut: !!sil && sil.len >= 0.08, keptEnd: +(sil ? sil.s : endKept).toFixed(3), laStart: laPh ? +(sil ? sil.e : endKept).toFixed(3) : null, audioS: +(r.audio.length / SR).toFixed(2) });
    writeWav(`work/la/${cname}__${lname}.wav`, r.audio);
    const x = results.at(-1); console.log(`${cname.padEnd(9)} ${lname.padEnd(15)} n=${String(n).padStart(3)} ${String(x.ms).padStart(5)} ms  rime ${x.rimeMs} ms  model pause ${x.modelPause}s  clean ${x.cleanCut}`);
  }
}
fs.writeFileSync("work/la/results.json", JSON.stringify(results, null, 1));
