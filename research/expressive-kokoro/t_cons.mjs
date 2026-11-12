import * as L from "./lib.mjs"; import { findGaps } from "./group.mjs";
const phs = ["kənsˈɪdɚ ðˈɪs,", "hiː sˈɛd, dᵻlˈɪbɚɹətli slˈoʊɪŋ hɪz spˈiːtʃ."]; const ph = phs.join(" ");
const t = await L.loadTTS(); const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2;
for (const sp of [1, 0.85]) {
  const r = await L.synthPhonemes(ph, { style: L.styleRow(L.voicePack("af_heart"), n), speed: sp });
  const L0 = [...phs[0]].length;
  console.log("speed", sp, "tokens: s", (r.starts[L0 - 1 + 1 - 1 + 1] / 24000).toFixed(3), ", ", (r.starts[L0] / 24000).toFixed(3), "space", (r.starts[L0 + 1] / 24000).toFixed(3), "h", (r.starts[L0 + 2] / 24000).toFixed(3), "| gaps", findGaps(r.audio, { minLen: 0.03 }).gaps.map((g) => `${g.s.toFixed(2)}-${g.e.toFixed(2)}`).join(" "));
}
{
  const ph2 = "ðə kˈæt sˈæt. ðə dˈɑːɡ ɹˈæn.";
  const n2 = t.tokenizer(ph2).input_ids.dims.at(-1) - 2;
  const r = await L.synthPhonemes(ph2, { style: L.styleRow(L.voicePack("af_heart"), n2) });
  const f = findGaps(r.audio, { minLen: 0.03 });
  console.log("onset", f.onset.toFixed(3), "offset", f.offset.toFixed(3), "gaps", f.gaps.map((g) => `${g.s.toFixed(2)}-${g.e.toFixed(2)}`).join(" "));
  console.log([...ph2].map((c, i) => `${c}@${(r.starts[i + 1] / 24000).toFixed(2)}`).join(" "), " end", (r.starts.at(-2) / 24000).toFixed(2), (r.audio.length / 24000).toFixed(2));
}
