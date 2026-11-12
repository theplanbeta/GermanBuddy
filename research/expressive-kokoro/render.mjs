#!/usr/bin/env node
// Director + performer prototype for expressive Kokoro (kokoro-js 1.2.1, ONNX, no server).
//
//   node render.mjs <input.txt> <output.wav> [--voice af_heart] [flags]
//
// Techniques (all on unless noted; each can be switched off):
//   --no-director   plain sentence chunks, no cue detection (no quote/narration split, no per-line styles)
//   --no-pauses     keep Kokoro's own edge silence and use the app's fixed 0.3 / 0.75 / 0.1 s gaps
//   --no-styles     no style-vector directions (whisper / firm / pitch)
//   --no-speed      no per-chunk speed changes
//   --no-dsp        no gain / high-shelf post-processing
//   --no-foreign    no German / Spanish phonemes (English rules for everything)
//   --no-normalize  no extra text normalisation (euros, "0.75")
//   --tremolo       (off by default) amplitude tremolo for "voice trembling" cues
//   --emphasis      (off by default) lengthen the stressed vowel of ALL-CAPS words
//   --misaki        (off by default) convert espeak IPA to misaki symbols before synthesis
//   --cast          (off by default) quotes attributed to "he" use --male-voice (default am_michael)
//   --dialogue-voice X   (off by default) every quote in voice X
//   --app           ignore everything above and render exactly like the app today
//   --v1            the previous version of this script (out/B_all_recommended.wav), unchanged
//
// v2 "smooth flow" fixes (default on; switch off individually to compare):
//   --no-group      one model call per chunk (default: 2-4 sentences per call, then the model's own
//                   sentence pauses are found by energy and stretched to the designed length)
//   --row true|min:K|fixed:K   voice-file row used for the style (default true = as v1; pinning measured worse)
//   --edges hard|soft          hard = v1 trim (-45 dB, 40 ms pad, 8 ms fade); soft = keep decay to -60 dB,
//                              30/80 ms pads, 15/40 ms raised-cosine fades (default hard: measured to match untrimmed Kokoro)
//   --no-roomtone   pauses are digital zero (default: -72 dBFS low-passed noise, like Kokoro's own gaps)
//   --pauses v1|natural        natural = slightly shorter clause pauses, sentence pauses scaled by the
//                              length of the sentence before, +-7% deterministic variation (default natural)
//   --no-merge-mild keep v1's split for mild cues (laugh / sigh / soft / "!" / trembling)
//   --max-group N / --max-ph N   sentence-group limits (default 4 sentences / 400 phonemes; D3: 12 / 480)
//   --lookahead     render each group (or lone sentence) together with the next sentence of the paragraph and
//                   discard that sentence (gives the last sentence of a call its in-context ending)
//   --first-alone   the first sentence is its own call (what the app needs for fast first audio)
//   --no-timestamps ignore the timestamped model's token durations (find cut points from the audio instead)
//   --no-ramp       apply styled-chunk gain as a step (default: ramp over 80 ms)
//   --joins split|onecall|compromise|smooth|splice   what to do where the delivery changes INSIDE a sentence
//        split      v1: separate calls, each with its own row, edge trim and a 0.22 s gap
//        onecall    the whole sentence in one call with no style (cue dropped)
//        compromise the whole sentence in one call with the parts' styles blended by phoneme share
//        smooth     separate calls, row pinned to the whole sentence, 0.18 s room-tone gap, gain ramps
//        aligned    like splice, but a timbre/loudness-only change (whisper, firm, gain) is rendered with the
//                   first part's prosody half and speed: timing is sample-identical, the cut needs no pause
//        splice     (default) the WHOLE sentence is rendered once per style; each part is cut out of the
//                   rendering made with its own style at the model's own pause, so every part carries the
//                   intonation of the full sentence; falls back to smooth when the pause is not found
//   --log file.json write the chunk plan with timings
import fs from "node:fs";
import { direct, PAUSE } from "./director.mjs";
import { germanWord, spanishWord, foreignPhrase, FOREIGN_WORDS } from "./foreign.mjs";
import { loadTTS, textToPhonemes, synthPhonemes, makeStyle, toMisaki, writeWav, concat, silence, SR } from "./lib.mjs";
import { trimSilence, gain, highShelf, tremolo, fade, limit, softTrim, cosFade, roomTone, gainRamp } from "./dsp.mjs";
import { findGaps, matchBoundaries, cutPoints } from "./group.mjs";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const [inFile, outFile] = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").match(/^--(voice|log|male-voice|dialogue-voice|row|edges|pauses|max-group|max-ph|joins)$/));
if (!inFile || !outFile) { console.error("usage: node render.mjs <input.txt> <output.wav> [--voice af_heart] [flags]"); process.exit(1); }
const VOICE = opt("--voice", "af_heart");
const ON = {
  director: !flag("--no-director"), pauses: !flag("--no-pauses"), styles: !flag("--no-styles"), speed: !flag("--no-speed"),
  dsp: !flag("--no-dsp"), foreign: !flag("--no-foreign"), normalize: !flag("--no-normalize"),
  tremolo: flag("--tremolo"), emphasis: flag("--emphasis"), misaki: flag("--misaki"), cast: flag("--cast"),
};
const MALE = opt("--male-voice", "am_michael");
const DIALOGUE = opt("--dialogue-voice", null);

if (flag("--v1")) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [new URL("./render_v1.mjs", import.meta.url).pathname, ...argv.filter((a) => a !== "--v1")], { stdio: "inherit" });
  process.exit(0);
}
const V2 = {
  group: !flag("--no-group"), row: opt("--row", "true"), edges: opt("--edges", "hard"), roomtone: !flag("--no-roomtone"),
  pauses: opt("--pauses", "natural"), joins: opt("--joins", "splice"), noTimestamps: flag("--no-timestamps"), mergeMild: !flag("--no-merge-mild"), ramp: !flag("--no-ramp"), maxGroup: +opt("--max-group", 4), maxPh: +opt("--max-ph", 400), lookahead: flag("--lookahead"), firstAlone: flag("--first-alone"),
};
if (flag("--app")) {
  // exactly today's app behaviour
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [new URL("./baseline.mjs", import.meta.url).pathname, inFile, outFile, VOICE], { stdio: "inherit" });
  process.exit(0);
}

// ---------------------------------------------------------------- style vectors
// Directions measured in this spike (see README): whisper = af_nicole minus the mean of the other
// American female voices (applied to the 128-dim timbre half); "firm" is its negative; pitch =
// am_santa minus am_michael on the 128-dim prosody half (raises F0 without changing timbre).
const AF = ["af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nova", "af_river", "af_sarah", "af_sky", "af_heart"];
const MEAN_AF = { mix: AF.map((v) => [v, 1 / AF.length]) };
// By default the directions are the two 128-float rows in directions.json (averaged over all 510
// length rows: ~2 KB, embeddable in a web app). --per-row-directions uses the exact row for the
// chunk length instead (needs 13 voice packs, ~6.6 MB, in a browser).
const DIR = JSON.parse(fs.readFileSync(new URL("./directions.json", import.meta.url), "utf8"));
const PER_ROW = flag("--per-row-directions");
function rowFor(n) {
  const [mode, k] = V2.row.split(":");
  return mode === "fixed" ? +k : mode === "min" ? Math.max(n, +k) : n;
}
function styleFor(voice, perf, n) {
  const s = makeStyle(voice, rowFor(n)).slice();
  if (!ON.styles) return s;
  let w = (perf.whisper || 0) - (perf.firm || 0);
  if (!PER_ROW && n < 15) w *= 0.7; // the fixed direction is too strong on very short chunks (measured)
  if (w) {
    if (PER_ROW) { const a = makeStyle("af_nicole", n), b = makeStyle(MEAN_AF, n); for (let i = 0; i < 128; i++) s[i] += w * (a[i] - b[i]); }
    else for (let i = 0; i < 128; i++) s[i] += w * DIR.whisper[i];
  }
  if (perf.pitch) {
    if (PER_ROW) { const a = makeStyle("am_santa", n), b = makeStyle("am_michael", n); for (let i = 128; i < 256; i++) s[i] += perf.pitch * (a[i] - b[i]); }
    else for (let i = 128; i < 256; i++) s[i] += perf.pitch * DIR.pitch[i - 128];
  }
  return s;
}

// ---------------------------------------------------------------- phonemes
const FW = new RegExp(`\\b(${Object.keys(FOREIGN_WORDS).join("|")})\\b`, "giu");
async function phonemesFor(chunk, lang) {
  if (ON.foreign && chunk.lang !== "en") return foreignPhrase(chunk.text, chunk.lang);
  let text = chunk.text;
  if (ON.emphasis) text = text.replace(/\b(\p{Lu}{2,})\b/gu, "⟦$1⟧");
  const parts = ON.foreign ? text.split(FW) : [text];
  let ph = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (i % 2 === 1) { ph += (ph && !ph.endsWith(" ") ? " " : "") + FOREIGN_WORDS[p.toLowerCase()]; continue; }
    const lead = /^\s/.test(p) || /^[,.;:!?]/.test(p) ? "" : "";
    let q = await textToPhonemes(p.replace(/⟦|⟧/g, ""), lang);
    if (/^\s/.test(p) && ph) q = " " + q;
    if (/^[,.;:!?…]/.test(p.trim())) q = q.replace(/^\s+/, "");
    ph += lead + q + (/\s$/.test(p) ? " " : "");
  }
  if (ON.emphasis) {
    // lengthen the vowel after each primary stress inside the words that were in caps
    for (const m of chunk.text.matchAll(/\b(\p{Lu}{2,})\b/gu)) {
      const w = await textToPhonemes(m[1].toLowerCase(), lang);
      const long = w.replace(/ˈ([^\s]*?[ɑæʌɔəɛɪʊiueaoɜ])(?!ː)/u, "ˈ$1ː");
      ph = ph.replace(w, long);
    }
  }
  ph = ph.replace(/\s+/g, " ").trim();
  return ON.misaki ? toMisaki(ph, lang === "b") : ph;
}

// ---------------------------------------------------------------- render
const text = fs.readFileSync(inFile, "utf8");
const plan = direct(text, { splitQuotes: ON.director, cues: ON.director, foreign: ON.foreign, norm: ON.normalize, mergeMild: V2.mergeMild });
const tts = await loadTTS();

// deterministic +-7% variation from the text, so re-renders are identical
const jitter = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return 1 + 0.07 * (((h >>> 0) % 2001) / 1000 - 1); };
const words = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;
function pauseFor(c) {
  if (!ON.pauses) return c.pauseAfter >= PAUSE.paragraph ? 0.75 : c.pauseAfter <= PAUSE.clause ? 0.1 : 0.3;
  if (V2.pauses === "v1") return c.pauseAfter;
  const p = c.pauseAfter;
  let q;
  if (p === PAUSE.paragraph) q = 0.85;
  else if (p === PAUSE.clause) q = 0.16;
  else if (p === PAUSE.chain) q = 0.15;
  else if (p === PAUSE.ellipsisMid) q = 0.4;
  else if (p === PAUSE.ellipsisEnd) q = 0.55;
  else if (p === PAUSE.dramatic) q = 0.65;
  else q = 0.3 + 0.01 * Math.min(words(c.text), 25); // 0.31 .. 0.55 s: longer sentence, longer breath
  return +(q * jitter(c.text)).toFixed(3);
}
function voiceOf(c) {
  let voice = VOICE;
  if (c.kind === "quote" && DIALOGUE) voice = DIALOGUE;
  if (c.kind === "quote" && ON.cast && c.speaker === "m") voice = MALE;
  return voice;
}
const perfKey = (c) => `${voiceOf(c)}|${c.lang}|${JSON.stringify(c.perf)}`;

// drop characters Kokoro's tokenizer would silently drop anyway (e.g. syllabic ̩, ¡), so that every
// phoneme character is exactly one token and the timestamped durations map 1:1 onto the string
const VOCAB = tts.tokenizer.model.tokens_to_ids;
const inVocab = (ph) => [...ph].filter((ch) => VOCAB.has(ch)).join("");
for (const c of plan) { c.voice = voiceOf(c); c.ph = inVocab(await phonemesFor(c, c.lang === "en" ? c.voice[0] : c.lang)); }
// ---------------------------------------------------------------- within-sentence joins
// sentence units: runs of chunks that belong to one written sentence
const units = [];
for (const c of plan) {
  const u = units.at(-1);
  if (u && u.at(-1).sentenceCont) u.push(c); else units.push([c]);
}
const blank = { whisper: 0, firm: 0, pitch: 0, speed: 1, gainDb: 0, shelfDb: 0, tremolo: null };
function blendPerf(parts) {
  const L = parts.reduce((n, c) => n + [...c.ph].length, 0), p = { ...blank };
  for (const c of parts) { const w = [...c.ph].length / L; for (const k of ["whisper", "firm", "pitch", "gainDb", "shelfDb"]) p[k] += w * (c.perf[k] || 0); p.speed += w * ((c.perf.speed || 1) - 1); }
  return p;
}
const items = []; // { kind: 'chunk', c } | { kind: 'multi', parts }
for (const u of units) {
  if (u.length === 1 || !ON.director || V2.joins === "split") { for (const c of u) items.push({ kind: "chunk", c }); continue; }
  if (V2.joins === "onecall" || V2.joins === "compromise") {
    const last = u.at(-1);
    const c = { ...last, text: u.map((x) => x.text).join(" "), ph: u.map((x) => x.ph).join(" "), tags: V2.joins === "onecall" ? [] : [...new Set(u.flatMap((x) => x.tags))],
      perf: V2.joins === "onecall" ? { ...blank } : blendPerf(u), lang: "mixed", parts: u.map((x) => ({ text: x.text, ph: x.ph })) };
    items.push({ kind: "chunk", c });
  } else items.push({ kind: "multi", parts: u });
}

// ---------------------------------------------------------------- sentence grouping (secondary)
const groups = [];
for (const it of items) {
  const g = groups.at(-1);
  if (it.kind === "multi") { groups.push(it); continue; }
  const c = it.c;
  const len = (g?.kind === "group" ? g.list.reduce((n, x) => n + [...x.ph].length + 1, 0) : 0) + [...c.ph].length;
  if (V2.group && !(V2.firstAlone && groups.length === 1) && g?.kind === "group" && perfKey(g.list[0]) === perfKey(c) && g.list.at(-1).endsSentence && !g.list.at(-1).paraEnd && g.list.length < V2.maxGroup && len <= V2.maxPh && !c.parts && !g.list.at(-1).parts) g.list.push(c);
  else groups.push({ kind: "group", list: [c] });
}

// trim the front and/or back only (hard = v1 thresholds: -45 dB, 40 ms pad, 8 ms fade)
function sideTrim(a, front, back) {
  if (!front && !back) return a;
  const hard = V2.edges === "hard";
  const o = hard ? { dropDb: 45, dropDbIn: 45, padIn: 0.04, padOut: 0.04, fadeIn: 0.008, fadeOut: 0.008 } : {};
  if (!front) Object.assign(o, { dropDbIn: 400, padIn: 0, fadeIn: 0 });
  if (!back) Object.assign(o, { padOut: 1e3, fadeOut: 0 });
  return softTrim(a, o);
}
function edgeTrim(a) { return V2.edges === "hard" ? trimSilence(a) : softTrim(a); }
function gapFill(sec) { return V2.roomtone ? roomTone(sec) : silence(sec); }
function post(audio, perf) {
  if (ON.dsp && perf.shelfDb) audio = highShelf(audio, 2000, perf.shelfDb);
  if (ON.dsp && perf.gainDb) audio = V2.ramp ? gainRamp(audio, perf.gainDb) : gain(audio, perf.gainDb);
  if (ON.tremolo && perf.tremolo) audio = tremolo(audio, perf.tremolo.rate, perf.tremolo.depth);
  return audio;
}
const nOf = (ph) => tts.tokenizer(ph, { truncation: true }).input_ids.dims.at(-1) - 2;
async function synth(ph, voice, perf, nRow = null) {
  const n = nOf(ph);
  if ([...ph].length > 510) console.warn(`chunk too long (${n} phonemes), will be cut`);
  const t0 = Date.now();
  const { audio, starts } = await synthPhonemes(ph, { style: styleFor(voice, perf, nRow ?? n), speed: ON.speed ? perf.speed : 1 });
  // starts are only trusted when every phoneme character became exactly one token
  return { audio, n, ms: Date.now() - t0, starts: starts && n === [...ph].length && !V2.noTimestamps ? starts : null };
}
// Exact cut points from token timings: the middle of the punctuation + space that ends part k.
function tokenCuts(starts, phs) {
  const cuts = []; let o = 0;
  for (const p of phs.slice(0, -1)) {
    const ch = [...p], L = ch.length;
    let i1 = L; while (i1 > 0 && /[,;:.!?…—"“”]/.test(ch[i1 - 1])) i1--;
    const a = starts[o + i1 + 1], b = starts[o + L + 2]; // +1: leading pad token; o+L = the space
    cuts.push({ t: (a + b) / 2 / SR, s: a / SR, e: b / SR, len: (b - a) / SR, exact: true });
    o += L + 1;
  }
  return cuts;
}
// punctuation pauses inside a joined phoneme string: which one ends each part, and how many there are
const PUN = /[,;:.!?…—]+["”]?(?= )/g;
const punctOf = (phs) => { let acc = 0; const at = []; for (const p of phs.slice(0, -1)) { acc += (p.match(PUN) || []).length + (/[,;:.!?…—]["”]?$/.test(p) ? 1 : 0); at.push(acc - 1); }
  return at.some((i) => i < 0) ? null : { total: (phs.join(" ").match(PUN) || []).length, at }; };
const fractionsOf = (phs) => { const total = [...phs.join(" ")].length; let acc = 0; return phs.slice(0, -1).map((p) => (acc += [...p].length + 1) / total); };

const out = [], log = [];
let t = 0, fallbacks = 0, grouped = 0, calls = 0, joinFallbacks = 0;
const started = Date.now();
const emit = (audio, c, pause, extra) => {
  out.push(audio, gapFill(pause));
  log.push({ start: +t.toFixed(3), dur: +(audio.length / SR).toFixed(3), pause, voice: c.voice, lang: c.lang, tags: c.tags, perf: c.perf, text: c.text, phonemes: c.ph, ...extra });
  t += audio.length / SR + pause;
};
// a one-call chunk that contains several parts: log its internal join (found the same way) for analysis/highlighting
function partsLog(audio, c) {
  if (!c.parts) return {};
  const ch = cutPoints(audio, fractionsOf(c.parts.map((p) => p.ph)), { punct: punctOf(c.parts.map((p) => p.ph)) });
  return { joinsAt: ch ? ch.map((g) => +g.t.toFixed(3)) : null };
}

for (const G of groups) {
  if (G.kind === "multi") {
    const parts = G.parts, phs = parts.map((c) => c.ph), full = phs.join(" "), nFull = nOf(full), fr = fractionsOf(phs);
    let pieces = null;
    if (V2.joins === "splice" || V2.joins === "aligned") {
      // aligned: parts whose change is timbre/loudness only are rendered with the FIRST part's prosody
      // half and speed, so the duration predictor sees identical input and timing is sample-identical.
      const base = parts[0];
      const perfOf = (c) => {
        if (V2.joins !== "aligned" || c === base) return c.perf;
        const p = { ...c.perf, pitch: base.perf.pitch, speed: base.perf.speed, prosodyFrom: true };
        return p;
      };
      const renders = new Map();
      for (const c of parts) {
        const pf = perfOf(c), key = `${c.voice}|${JSON.stringify(pf)}`;
        c._rkey = key; c._perf = pf;
        if (renders.has(key)) continue;
        const r = await synth(full, c.voice, pf); calls++;
        renders.set(key, { ...r, cuts: r.starts ? tokenCuts(r.starts, phs) : cutPoints(r.audio, fr, { punct: punctOf(phs) }) });
      }
      if ([...renders.values()].every((r) => r.cuts)) {
        pieces = parts.map((c, k) => {
          const r = renders.get(c._rkey);
          const XF = Math.round(0.012 * SR); // 12 ms equal-power overlap at each cut
          const a = k ? Math.max(0, Math.round(r.cuts[k - 1].t * SR) - XF) : 0;
          const b = k < parts.length - 1 ? Math.round(r.cuts[k].t * SR) + XF : r.audio.length;
          let piece = r.audio.slice(a, b);
          if (k) cosFade(piece, 0.012, 0); if (k < parts.length - 1) cosFade(piece, 0, 0.012);
          // trim only the outer edges of the sentence; the cut ends keep their half of the model's own pause
          piece = sideTrim(piece, k === 0, k === parts.length - 1);
          return { piece: post(piece, c._perf), c, ms: r.ms, own: k < parts.length - 1 ? r.cuts[k].len : 0, exact: !!r.starts };
        });
        // overlap-add the 12 ms crossfades
        const XF = Math.round(0.012 * SR);
        for (let k = 1; k < pieces.length; k++) {
          const A = pieces[k - 1].piece, B = pieces[k].piece, y = new Float32Array(A.length + B.length - XF);
          y.set(A, 0); for (let i = 0; i < B.length; i++) y[A.length - XF + i] += B[i];
          pieces[k - 1].piece = y.slice(0, A.length - XF); pieces[k].piece = y.slice(A.length - XF);
        }
        // the gap at a join = second half of the model's own pause in part k + first half in part k+1: already inside the pieces
        for (const [k, p] of pieces.entries()) emit(p.piece, p.c, k < pieces.length - 1 ? 0 : pauseFor(p.c), { join: k < pieces.length - 1 ? V2.joins : undefined, exactCut: p.exact, ms: p.ms, n: nFull, group: 1 });
        continue;
      }
      joinFallbacks++;
      console.warn("splice: model pause not found at a join, using smooth separate calls");
    }
    // smooth separate calls (also the splice fallback)
    for (const [k, c] of parts.entries()) {
      const { audio, n, ms } = await synth(c.ph, c.voice, c.perf, V2.row === "true" ? null : nFull); calls++;
      const piece = post(edgeTrim(audio), c.perf);
      emit(piece, c, k < parts.length - 1 ? 0.18 : pauseFor(c), { join: k < parts.length - 1 ? "smooth" : undefined, ms, n, group: 1 });
    }
    continue;
  }
  const g = G.list, perf = g[0].perf;
  // look-ahead: render the next sentence of the same paragraph too (in this group's style) and discard it,
  // so the last sentence of the call is not spoken as the end of the input
  let look = null;
  if (V2.lookahead && !g.at(-1).paraEnd && g.at(-1).endsSentence) {
    const nx = groups[groups.indexOf(G) + 1];
    const nc = nx ? (nx.kind === "group" ? nx.list[0] : nx.parts[0]) : null;
    if (nc && perfKey(nc) === perfKey(g[0]) && [...nc.ph].length + g.reduce((a, c) => a + [...c.ph].length + 1, 0) <= 505) look = nc;
  }
  if (g.length > 1 || look) {
    const phsAll = [...g.map((c) => c.ph), ...(look ? [look.ph] : [])];
    const ph = phsAll.join(" ");
    const { audio, n, ms, starts } = await synth(ph, g[0].voice, perf); calls++;
    // exact sentence boundaries from token timings; energy-based detection only without them
    const chosen = starts ? tokenCuts(starts, phsAll) : matchBoundaries(findGaps(audio), fractionsOf(phsAll));
    if (chosen) {
      grouped++;
      // The token timing says WHERE the boundary is; the actual silence around it is wider (the model
      // often spends 0.3-0.6 s of the last phoneme tokens in silence). Take the silent stretch that
      // touches the boundary, keep 40 ms of the model's own silence on each side, and set the total
      // pause to the designed value (shortening or lengthening the model's own pause).
      const sil = findGaps(audio, { minLen: 0.03 }).gaps;
      const KEEP = 0.04;
      const spans = chosen.map((cu) => {
        cu = { ...cu, t: cu.t ?? (cu.s + cu.e) / 2 };
        const near = sil.filter((q) => q.e >= cu.s - 0.05 && q.s <= cu.e + 0.05).sort((a, b) => b.len - a.len)[0];
        return near ? { s: Math.min(near.s, cu.t), e: Math.max(near.e, cu.t) } : { s: cu.t, e: cu.t };
      });
      let a0 = 0;
      for (let k = 0; k < g.length; k++) {
        const c = g[k];
        const end = k < spans.length ? Math.round(Math.min(spans[k].s + KEEP, (spans[k].s + spans[k].e) / 2) * SR) : audio.length;
        let piece = audio.slice(a0, end);
        const own = k < spans.length ? spans[k].e - spans[k].s : 0;
        piece = sideTrim(piece, k === 0, k === g.length - 1 && !look);
        piece = post(piece, perf);
        if (k < spans.length) cosFade(piece, 0, Math.min(KEEP, own / 2));
        const kept = k < spans.length ? Math.min(2 * KEEP, own) : 0;
        const pause = k < g.length - 1 ? Math.max(0, pauseFor(c) - kept) : pauseFor(c); // (with look-ahead the kept 40 ms + the next front pad measured ~equal to D2's)
        emit(piece, c, pause, { group: g.length, ms: k ? 0 : ms, n: k ? 0 : n, ownGap: +own.toFixed(3), ...partsLog(piece, c) });
        if (k < spans.length) { a0 = Math.round(Math.max(spans[k].e - KEEP, (spans[k].s + spans[k].e) / 2) * SR); }
      }
      continue;
    }
    fallbacks++;
    console.warn(`group of ${g.length}: pauses not found reliably, rendering sentence by sentence`);
  }
  for (const c of g) {
    const { audio, n, ms } = await synth(c.ph, c.voice, c.perf); calls++;
    let a = ON.pauses ? edgeTrim(audio) : fade(audio);
    a = post(a, c.perf);
    emit(a, c, pauseFor(c), { group: 1, ms, n, ...partsLog(a, c) });
  }
}
writeWav(outFile, limit(concat(out))); // Kokoro itself occasionally peaks at >= 1.0 on plosives
const genS = (Date.now() - started) / 1000;
console.log(`wrote ${outFile}: ${t.toFixed(1)} s audio, ${genS.toFixed(1)} s to render (${(t / genS).toFixed(2)}x real time), ${plan.length} chunks, ${calls} model calls (${grouped} sentence groups, ${fallbacks} group fallbacks, ${joinFallbacks} join fallbacks), joins=${V2.joins}`);
if (opt("--log")) fs.writeFileSync(opt("--log"), JSON.stringify({ flags: { ...ON, ...V2 }, voice: VOICE, chunks: log }, null, 1));
