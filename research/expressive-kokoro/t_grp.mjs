import * as L from "./lib.mjs"; import { findGaps } from "./group.mjs";
const s = ["Most cities were not designed for the weather they now face.", "Drains that were sized for the storms of the last century overflow several times a year, and streets that once stayed dry now flood within minutes.", "The problem is not only the amount of rain, but how quickly it arrives."];
const phs = []; for (const x of s) phs.push(await L.textToPhonemes(x));
const ph = phs.join(" "); const t = await L.loadTTS(); const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2;
const r = await L.synthPhonemes(ph, { style: L.styleRow(L.voicePack("af_heart"), n) });
console.log("n", n, [...ph].length, "dur", r.audio.length / 24000);
let o = 0; for (const p of phs.slice(0, -1)) { const Lp = [...p].length; console.log("punct tok", [...ph][o + Lp - 1], (r.starts[o + Lp] / 24000).toFixed(3), "space", (r.starts[o + Lp + 1] / 24000).toFixed(3), "next", (r.starts[o + Lp + 2] / 24000).toFixed(3)); o += Lp + 1; }
console.log(findGaps(r.audio).gaps.filter((g) => g.len > 0.1).map((g) => `${g.s.toFixed(2)}-${g.e.toFixed(2)}`).join(" "));
