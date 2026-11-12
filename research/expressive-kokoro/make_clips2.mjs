import fs from "node:fs"; import { writeWav, concat, silence } from "./lib.mjs";
const rd = (f) => { const b = fs.readFileSync(f); const n = (b.length - 44) / 2; const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt16LE(44 + i * 2) / 32768; return a; };
const cache = {};
function span(wav, log, a, z) {
  cache[wav] ??= rd(wav); const ch = JSON.parse(fs.readFileSync(log, "utf8")).chunks;
  const i = ch.findIndex((c) => c.text.includes(a)); let j = i; while (j < ch.length && !ch[j].text.includes(z)) j++;
  if (i < 0 || j >= ch.length) throw new Error(`span not found ${a}..${z} in ${log}`);
  return cache[wav].slice(Math.round(ch[i].start * 24000), Math.round((ch[j].start + ch[j].dur) * 24000));
}
const D = "out2/clips"; fs.rmSync(D, { recursive: true, force: true }); fs.mkdirSync(D, { recursive: true });
const W = (n, x) => writeWav(`${D}/${n}.wav`, concat([silence(0.15), x, silence(0.3)]));
const R = { B_previous: ["out2/B_previous.wav", "work/v2/B.json"], onecall: ["work/v2/j_onecall.wav", "work/v2/j_onecall.json"], compromise: ["work/v2/j_compromise.wav", "work/v2/j_compromise.json"],
  smooth: ["work/v2/j_smooth.wav", "work/v2/j_smooth.json"], aligned: ["work/v2/j_aligned.wav", "work/v2/j_aligned.json"], D_splice: ["out2/D1_smooth_per_sentence.wav", "work/v2/D1.json"] };
const S = [["1_wait_what", "Wait", "trembling"], ["2_whisper_german", "Then she whispered", "wahr sein"], ["3_consider_this", "Consider this", "slowing his speech"], ["4_shouted_cuidado", "Suddenly, someone", "Cuidado"], ["5_girl_laugh", "Finally, a little girl", "Relax"], ["6_professor_sigh", "The professor sighed", "wasn't it"]];
for (const [name, a, z] of S) for (const [k, [w, l]] of Object.entries(R)) {
  if ((name.startsWith("5") || name.startsWith("6")) && !["B_previous", "D_splice"].includes(k)) continue;
  W(`W${name}__${k}`, span(w, l, a, z));
}
const f = (p) => rd(p);
const seq = (...xs) => concat(xs.flatMap((x, i) => (i ? [silence(0.9), x] : [x])));
W("X1_row_pinning_then_five__true_row_vs_pinned_row60", seq(f("work/v2/row/t_true_hard.wav"), f("work/v2/row/t_min60_hard.wav"), f("work/v2/row/e_true_hard.wav"), f("work/v2/row/e_min60_hard.wav")));
W("X2_edges__hard_digital_silence", f("work/v2/edge_hard.wav"));
W("X2_edges__soft_with_room_tone", f("work/v2/edge_soft.wav"));
W("X3_prose_paragraph1__per_sentence", span("out2/P_D1_smooth_per_sentence.wav", "work/v2/PD1.json", "Most cities", "how quickly"));
W("X3_prose_paragraph1__grouped_one_call", span("out2/P_D2_smooth_grouped.wav", "work/v2/PD2.json", "Most cities", "how quickly"));
W("X4_beat__per_sentence", span("out2/D1_smooth_per_sentence.wav", "work/v2/D1.json", "A glass", "Then five"));
W("X4_beat__grouped_one_call", span("out2/D2_smooth_grouped.wav", "work/v2/D2.json", "A glass", "Then five"));
console.log(fs.readdirSync(D).length, "clips");
