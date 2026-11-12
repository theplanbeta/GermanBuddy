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
//   --log file.json write the chunk plan with timings
import fs from "node:fs";
import { direct, PAUSE } from "./director_v1.mjs";
import { germanWord, spanishWord, foreignPhrase, FOREIGN_WORDS } from "./foreign.mjs";
import { loadTTS, textToPhonemes, synthPhonemes, makeStyle, toMisaki, writeWav, concat, silence, SR } from "./lib.mjs";
import { trimSilence, gain, highShelf, tremolo, fade, limit } from "./dsp.mjs";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const [inFile, outFile] = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").match(/^--(voice|log|male-voice|dialogue-voice)$/));
if (!inFile || !outFile) { console.error("usage: node render.mjs <input.txt> <output.wav> [--voice af_heart] [flags]"); process.exit(1); }
const VOICE = opt("--voice", "af_heart");
const ON = {
  director: !flag("--no-director"), pauses: !flag("--no-pauses"), styles: !flag("--no-styles"), speed: !flag("--no-speed"),
  dsp: !flag("--no-dsp"), foreign: !flag("--no-foreign"), normalize: !flag("--no-normalize"),
  tremolo: flag("--tremolo"), emphasis: flag("--emphasis"), misaki: flag("--misaki"), cast: flag("--cast"),
};
const MALE = opt("--male-voice", "am_michael");
const DIALOGUE = opt("--dialogue-voice", null);

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
function styleFor(voice, perf, n) {
  const s = makeStyle(voice, n).slice();
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
const plan = direct(text, { splitQuotes: ON.director, cues: ON.director, foreign: ON.foreign, norm: ON.normalize });
const tts = await loadTTS();
const out = [];
const log = [];
let t = 0;
const started = Date.now();
for (const c of plan) {
  let voice = VOICE;
  if (c.kind === "quote" && DIALOGUE) voice = DIALOGUE;
  if (c.kind === "quote" && ON.cast && c.speaker === "m") voice = MALE;
  const lang = c.lang === "en" ? voice[0] : c.lang;
  const ph = await phonemesFor(c, lang);
  const n = tts.tokenizer(ph, { truncation: true }).input_ids.dims.at(-1) - 2;
  if ([...ph].length > 510) console.warn(`chunk too long (${n} phonemes), will be cut: ${c.text.slice(0, 60)}…`);
  const perf = c.perf;
  const speed = ON.speed ? perf.speed : 1;
  const t0 = Date.now();
  let { audio } = await synthPhonemes(ph, { style: styleFor(voice, perf, n), speed });
  const ms = Date.now() - t0;
  let pause;
  if (ON.pauses) {
    audio = trimSilence(audio);
    pause = c.pauseAfter;
  } else {
    fade(audio);
    pause = c.pauseAfter >= PAUSE.paragraph ? 0.75 : c.pauseAfter <= PAUSE.clause ? 0.1 : 0.3;
  }
  if (ON.dsp && perf.shelfDb) audio = highShelf(audio, 2000, perf.shelfDb);
  if (ON.dsp && perf.gainDb) audio = gain(audio, perf.gainDb);
  if (ON.tremolo && perf.tremolo) audio = tremolo(audio, perf.tremolo.rate, perf.tremolo.depth);
  out.push(audio, silence(pause));
  log.push({ start: +t.toFixed(2), dur: +(audio.length / SR).toFixed(2), pause, ms, voice, lang, tags: c.tags, perf, n, text: c.text, phonemes: ph });
  t += audio.length / SR + pause;
  console.log(`${t.toFixed(1).padStart(6)}s ${String(n).padStart(3)}ph ${String(ms).padStart(5)}ms ${voice} ${c.lang} [${c.tags.join(",")}] ${c.text}`);
}
writeWav(outFile, limit(concat(out))); // Kokoro itself occasionally peaks at >= 1.0 on plosives
const audioS = t, genS = (Date.now() - started) / 1000;
console.log(`wrote ${outFile}: ${audioS.toFixed(1)} s audio, ${genS.toFixed(1)} s to render (${(audioS / genS).toFixed(2)}x real time, ${plan.length} chunks)`);
if (opt("--log")) fs.writeFileSync(opt("--log"), JSON.stringify({ flags: ON, voice: VOICE, chunks: log }, null, 1));
