// Controlled single-factor ablation of D1 vs D2 on plain (unstyled) text.
//   node ablate.mjs <in.txt> <outdir> [variant ...]      (no variant = all)
// Each variant = { context, row, edges, pauses }:
//   context  none  : one model call per sentence                      (D1)
//            group : D2's groups (<=4 sentences, <=400 phonemes, same paragraph) in one call, cut at the sentences
//            look  : like group, but each group is rendered with the previous sentence as lead-in and the next
//                    as look-ahead; only the group's own sentences are kept
//            para  : as many sentences as fit under maxPh phonemes inside a paragraph
//   row      own   : row = phoneme count of the call (kokoro-js default; D1 for sentences, D2 for groups)
//            group : a sentence call uses the row its D2 group used      (F2 swap for D1)
//            single: a group call uses the mean row of its sentences alone (F2 swap for D2)
//            fixed:K
//   edges    trim  : v1/D1 hard trim of every piece (-45 dB, 40 ms pad, 8 ms fade)
//            model : keep the model's own silence (cut in the middle of the silent stretch), 40 ms each side
//   pauses   add   : insert the designed pause after the trimmed piece (D1: actual silence = designed + edge residue)
//            exact : make the measured silence between sentences equal to the target exactly (D2)
//            from:<file.json> : exact, with per-boundary targets measured from another render (pause swap)
import fs from "node:fs";
import { direct } from "./director.mjs";
import { loadTTS, textToPhonemes, synthPhonemes, styleRow, voicePack, writeWav, concat, SR } from "./lib.mjs";
import { trimSilence, roomTone, cosFade, limit } from "./dsp.mjs";
import { findGaps } from "./group.mjs";

const [inFile, outDir, ...want] = process.argv.slice(2);
const SPEED = +(process.env.SPEED || 1);
const VOICE = process.env.VOICE || "af_heart";
const MAXPH = +(process.env.MAXPH || 480);
fs.mkdirSync(outDir, { recursive: true });
const tts = await loadTTS();
const VOCAB = tts.tokenizer.model.tokens_to_ids;
const clean = (ph) => [...ph].filter((c) => VOCAB.has(c)).join("");

// ---- plan: sentences with designed pauses (identical to render.mjs "natural" pauses)
const plan = direct(fs.readFileSync(inFile, "utf8"), { mergeMild: true, cues: false, splitQuotes: false });
const words = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;
const jitter = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return 1 + 0.07 * (((h >>> 0) % 2001) / 1000 - 1); };
for (const c of plan) {
  c.ph = clean(await textToPhonemes(c.text));
  c.n = [...c.ph].length;
  c.design = +((c.paraEnd ? 0.85 : 0.3 + 0.01 * Math.min(words(c.text), 25)) * (c.paraEnd ? 1 : jitter(c.text))).toFixed(3);
}
// D2 groups
const groups = [];
for (const c of plan) {
  const g = groups.at(-1);
  const len = g ? g.reduce((n, x) => n + x.n + 1, 0) + c.n : c.n;
  if (g && !g.at(-1).paraEnd && g.length < 4 && len <= 400) g.push(c); else groups.push([c]);
}
const groupRow = new Map();
for (const g of groups) { const n = g.reduce((a, x) => a + x.n + 1, -1); for (const c of g) groupRow.set(c, n); }
// paragraph-max groups
const paraGroups = [];
for (const c of plan) {
  const g = paraGroups.at(-1);
  const len = g ? g.reduce((n, x) => n + x.n + 1, 0) + c.n : c.n;
  if (g && !g.at(-1).paraEnd && len <= MAXPH) g.push(c); else paraGroups.push([c]);
}

async function call(ph, row) {
  const n = tts.tokenizer(ph, { truncation: true }).input_ids.dims.at(-1) - 2;
  const r = await synthPhonemes(ph, { style: styleRow(voicePack(VOICE), row ?? n), speed: SPEED });
  return { ...r, n, row: row ?? n };
}
// split a call's audio into its sentences: at the middle of the silent stretch around each token boundary
function splitCall(r, members) {
  const sil = findGaps(r.audio, { minLen: 0.03 }).gaps;
  const cuts = []; let o = 0;
  for (const m of members.slice(0, -1)) {
    const L = m.n; let i1 = L; const ch = [...m.ph]; while (i1 > 0 && /[,;:.!?…—"“”]/.test(ch[i1 - 1])) i1--;
    const a = r.starts[o + i1 + 1] / SR, b = r.starts[o + L + 2] / SR;
    const q = sil.filter((g) => g.e >= a - 0.05 && g.s <= b + 0.05).sort((x, y) => y.len - x.len)[0];
    cuts.push(q ? (q.s + q.e) / 2 : (a + b) / 2);
    o += L + 1;
  }
  const pieces = []; let a0 = 0; o = 0;
  members.forEach((m, k) => {
    const end = k < cuts.length ? Math.round(cuts[k] * SR) : r.audio.length;
    // per-sentence rhythm from token durations
    const st = r.starts.slice(o + 1, o + m.n + 2);
    pieces.push({ m, audio: r.audio.slice(a0, end), tokDur: st.slice(1).map((v, i) => (v - st[i]) / SR), row: r.row, callN: r.n, gi: GI });
    a0 = end; o += m.n + 1;
  });
  GI++;
  return pieces;
}
function silentEdges(x) { // leading / trailing silence of a piece (s), threshold = piece peak - 40 dB on 10 ms frames
  const f = findGaps(x, { minLen: 0 }); return { lead: f.onset, trail: x.length / SR - f.offset };
}
function shrinkEdges(x, keepLead, keepTrail) {
  const { lead, trail } = silentEdges(x);
  const a = Math.max(0, Math.round((lead - keepLead) * SR)), b = x.length - Math.max(0, Math.round((trail - keepTrail) * SR));
  return x.slice(a, b);
}

let GI = 0;
async function render(name, v) {
  let pieces = []; GI = 0;
  if (v.context === "none") {
    for (const c of plan) {
      const row = v.row === "group" ? groupRow.get(c) : v.row?.startsWith?.("fixed:") ? +v.row.slice(6) : null;
      pieces.push(...splitCall(await call(c.ph, row), [c]));
    }
  } else {
    let G = v.context === "para" || v.context === "ramp" ? paraGroups : groups;
    if (v.context === "ramp") { // grow call sizes 1, 2, 4, then up to the cap (never across a paragraph)
      const flat = []; for (const g of paraGroups) flat.push(g);
      G = []; const sizes = [1, 2, 4]; let ci = 0;
      for (const pg of paraGroups) { let i = 0; while (i < pg.length) { const sz = ci < sizes.length ? sizes[ci] : 99; G.push(pg.slice(i, i + sz)); i += sz; ci++; } }
    }
    // the app must render the first sentence alone (fast first audio): split it off its group
    if (v.firstAlone && G[0].length > 1) G = [[G[0][0]], G[0].slice(1), ...G.slice(1)];
    for (const [gi, g] of G.entries()) {
      const ph = g.map((c) => c.ph).join(" ");
      const mean = Math.round(g.reduce((a, c) => a + c.n, 0) / g.length);
      const row = v.row === "single" ? mean : v.row?.startsWith?.("fixed:") ? +v.row.slice(6) : null;
      const lookHere = v.context === "look" || (v.firstLook && gi === 0) || v.laWords;
      if (lookHere) {
        // lead-in = previous sentence in the same paragraph, look-ahead = next sentence in the same paragraph
        const all = plan, i0 = all.indexOf(g[0]), i1 = all.indexOf(g.at(-1));
        const pre = i0 > 0 && !all[i0 - 1].paraEnd ? [all[i0 - 1]] : [];
        let post = !g.at(-1).paraEnd && all[i1 + 1] ? [all[i1 + 1]] : [];
        let pre2 = v.laWords ? [] : pre;
        let rowHere = row;
        if (v.laWords && post.length) { // truncated look-ahead: first N words of the next sentence; row as if it were complete
          const w = post[0].text.split(/\s+/).slice(0, v.laWords).join(" ").replace(/[,.;:!?]$/, "");
          const lp = clean(await textToPhonemes(w));
          if (v.virtualRow) rowHere = g.reduce((a, c) => a + c.n + 1, 0) + post[0].n;
          post = [{ ph: lp, n: [...lp].length, text: w }];
        }
        const mem = [...pre2, ...g, ...post];
        const r = await call(mem.map((c) => c.ph).join(" "), rowHere);
        pieces.push(...splitCall(r, mem).slice(pre2.length, pre2.length + g.length));
      } else pieces.push(...splitCall(await call(ph, row), g));
    }
  }
  // edges and pauses
  const targets = v.pauses.startsWith("from:") ? JSON.parse(fs.readFileSync(v.pauses.slice(5), "utf8")).sentences.map((s) => s.silenceAfter) : null;
  const out = []; const log = []; let t = 0;
  pieces.forEach((p, k) => {
    let a = p.audio;
    const last = k === pieces.length - 1;
    const target = targets ? targets[k] : p.m.design;
    if (v.edges === "trim") a = trimSilence(a);
    else { a = shrinkEdges(a, k === 0 ? 0.04 : 0.04, 0.04); cosFade(a, k === 0 ? 0.008 : 0.002, 0.002); }
    let gap;
    if (v.pauses === "add") gap = target;
    else {
      const nextLead = k + 1 < pieces.length ? silentEdges(v.edges === "trim" ? trimSilence(pieces[k + 1].audio) : shrinkEdges(pieces[k + 1].audio, 0.04, 0.04)).lead : 0;
      gap = Math.max(0, target - silentEdges(a).trail - nextLead);
    }
    const { lead, trail } = silentEdges(a);
    log.push({ text: p.m.text, start: +t.toFixed(3), dur: +(a.length / SR).toFixed(3), speechStart: +(t + lead).toFixed(3), speechEnd: +(t + a.length / SR - trail).toFixed(3), row: p.row, callN: p.callN, gi: p.gi, n: p.m.n, design: p.m.design, tokDur: p.tokDur.map((x) => +x.toFixed(4)), ph: p.m.ph });
    out.push(a, roomTone(gap));
    t += a.length / SR + gap;
  });
  // silence actually between sentences (speech end -> next speech start)
  log.forEach((s, k) => (s.silenceAfter = k + 1 < log.length ? +(log[k + 1].speechStart - s.speechEnd).toFixed(3) : 0.85));
  writeWav(`${outDir}/${name}.wav`, limit(concat(out)));
  fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ variant: v, sentences: log }, null, 1));
  console.log(name.padEnd(34), JSON.stringify(v), `${t.toFixed(1)} s, rows ${[...new Set(log.map((s) => s.row))].join("/")}`);
}

const V = {
  D1: { context: "none", row: "own", edges: "trim", pauses: "add" },
  D2: { context: "group", row: "own", edges: "model", pauses: "exact" },
  D1_plus_context_only: { context: "group", row: "single", edges: "trim", pauses: "add" },
  D1_plus_group_row_only: { context: "none", row: "group", edges: "trim", pauses: "add" },
  D1_plus_D2_pauses_only: { context: "none", row: "own", edges: "trim", pauses: `from:${outDir}/D2.json` },
  D1_plus_D2_edges_and_pauses: { context: "none", row: "own", edges: "model", pauses: "exact" },
  D2_minus_context_row_kept: { context: "none", row: "group", edges: "model", pauses: "exact" },
  D2_with_single_sentence_row: { context: "group", row: "single", edges: "model", pauses: "exact" },
  D2_with_D1_pauses: { context: "group", row: "own", edges: "model", pauses: `from:${outDir}/D1.json` },
  D3a_paragraph_groups: { context: "para", row: "own", edges: "model", pauses: "exact" },
  D3b_lookahead_context: { context: "look", row: "own", edges: "model", pauses: "exact" },
  D3c_groups_row300: { context: "group", row: "fixed:300", edges: "model", pauses: "exact" },
  D3d_lookahead_row300: { context: "look", row: "fixed:300", edges: "model", pauses: "exact" },
  D3e_paragraph_row300: { context: "para", row: "fixed:300", edges: "model", pauses: "exact" },
  D1_row300: { context: "none", row: "fixed:300", edges: "model", pauses: "exact" },
  D3_ref_para_first_alone_full_lookahead: { context: "para", row: "own", edges: "model", pauses: "exact", firstAlone: true, firstLook: true },
  R1_ramp_2w_virtualrow: { context: "ramp", row: "own", edges: "model", pauses: "exact", laWords: 2, virtualRow: true },
  R2_ramp_2w_ownrow: { context: "ramp", row: "own", edges: "model", pauses: "exact", laWords: 2 },
  R3_para_2w_virtualrow_first_alone: { context: "para", row: "own", edges: "model", pauses: "exact", laWords: 2, virtualRow: true, firstAlone: true },
  D3f_para_row300_first_alone: { context: "para", row: "fixed:300", edges: "model", pauses: "exact", firstAlone: true },
  D3g_para_row300_first_alone_lookahead: { context: "para", row: "fixed:300", edges: "model", pauses: "exact", firstAlone: true, firstLook: true },
  D3h_para_ownrow_first_alone: { context: "para", row: "own", edges: "model", pauses: "exact", firstAlone: true },
};
for (const K of [20, 60, 100, 150, 200, 300, 400, 509]) {
  V[`row_single_fixed${K}`] = { context: "none", row: `fixed:${K}`, edges: "model", pauses: "exact" };
  V[`row_group_fixed${K}`] = { context: "group", row: `fixed:${K}`, edges: "model", pauses: "exact" };
}
for (const [k, v] of Object.entries(V)) if (!want.length || want.includes(k)) await render(k, v);
