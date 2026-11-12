// Shared helpers for the expressive-Kokoro experiments.
// Talks to kokoro-js's underlying pieces directly:
//   tts.tokenizer(phonemes)  -> input_ids (adds the "$" pad at both ends, max 512)
//   tts.model({input_ids, style:[1,256], speed:[1]}) -> waveform @ 24 kHz
// That is exactly what KokoroTTS.generate_from_ids does, minus the voice lookup,
// so a custom style vector and our own phoneme string can be fed in.
import { KokoroTTS } from "kokoro-js";
import { Tensor } from "@huggingface/transformers";
import { phonemize } from "phonemizer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SR = 24000;
const VOICE_DIR = path.join(HERE, "node_modules/kokoro-js/voices");

let ttsP = null;
// The "-timestamped" export is the same network (waveform bit-identical, verified) with an extra
// output: per-token durations. KOKORO_MODEL=onnx-community/Kokoro-82M-v1.0-ONNX selects the original.
export const MODEL_ID = process.env.KOKORO_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
export function loadTTS(dtype = "fp32") {
  ttsP ??= KokoroTTS.from_pretrained(MODEL_ID, { dtype, device: "cpu" });
  return ttsP;
}

const voiceCache = new Map();
/** Voice pack: Float32Array of 510*256 (rows indexed by phoneme count). */
export function voicePack(name) {
  if (!voiceCache.has(name)) {
    const buf = fs.readFileSync(path.join(VOICE_DIR, `${name}.bin`));
    voiceCache.set(name, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice());
  }
  return voiceCache.get(name);
}
/** The 256-dim style row kokoro-js would use for `nPhon` phoneme tokens. */
export function styleRow(pack, nPhon) {
  const i = Math.min(Math.max(nPhon, 0), 509);
  return pack.slice(i * 256, i * 256 + 256);
}

// ---- text -> phonemes: a verbatim (de-minified) copy of kokoro-js's private
// normaliser + phonemiser so we can inspect / edit phonemes before synthesis.
function splitNum(e) {
  if (e.includes(".")) return e;
  if (e.includes(":")) { const [a, t] = e.split(":").map(Number); return t === 0 ? `${a} o'clock` : t < 10 ? `${a} oh ${t}` : `${a} ${t}`; }
  const a = parseInt(e.slice(0, 4), 10);
  if (a < 1100 || a % 1000 < 10) return e;
  const t = e.slice(0, 2), r = parseInt(e.slice(2, 4), 10), n = e.endsWith("s") ? "s" : "";
  if (a % 1000 >= 100 && a % 1000 <= 999) { if (r === 0) return `${t} hundred${n}`; if (r < 10) return `${t} oh ${r}${n}`; }
  return `${t} ${r}${n}`;
}
function money(e) {
  const a = e[0] === "$" ? "dollar" : "pound";
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${a}s`;
  if (!e.includes(".")) { const t = e.slice(1) === "1" ? "" : "s"; return `${e.slice(1)} ${a}${t}`; }
  const [t, r] = e.slice(1).split("."), n = parseInt(r.padEnd(2, "0"), 10);
  return `${t} ${a}${t === "1" ? "" : "s"} and ${n} ${e[0] === "$" ? (n === 1 ? "cent" : "cents") : n === 1 ? "penny" : "pence"}`;
}
function pointNum(e) { const [a, t] = e.split("."); return `${a} point ${t.split("").join(" ")}`; }
export function kokoroNormalize(e) {
  return e.replace(/[‘’]/g, "'").replace(/«/g, "“").replace(/»/g, "”").replace(/[“”]/g, '"').replace(/\(/g, "«").replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ").replace(/  +/, " ").replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor").replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister").replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs").replace(/\betc\.(?! [A-Z])/gi, "etc").replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum).replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money).replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ").replace(/(?<=\d)S/g, " S").replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-")).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-").trim();
}
const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`, "g");
export async function textToPhonemes(text, lang = "a", normalize = true) {
  if (normalize) text = kokoroNormalize(text);
  const parts = []; let last = 0;
  for (const m of text.matchAll(PUNCT_RE)) {
    if (last < m.index) parts.push({ match: false, text: text.slice(last, m.index) });
    if (m[0].length) parts.push({ match: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ match: false, text: text.slice(last) });
  const code = lang === "a" ? "en-us" : "en";
  let s = (await Promise.all(parts.map(async ({ match, text }) => (match ? text : (await phonemize(text, code)).join(" "))))).join("");
  s = s.replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ").replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ").replace(/ʲ/g, "j").replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ").replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (lang === "a") s = s.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return s.trim();
}

/** Synthesise from a phoneme string with an explicit 256-dim style. */
export async function synthPhonemes(phonemes, { style, speed = 1 } = {}) {
  const tts = await loadTTS();
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const n = input_ids.dims.at(-1) - 2;
  const out = await tts.model({ input_ids, style: new Tensor("float32", style, [1, 256]), speed: new Tensor("float32", [speed], [1]) });
  const audio = new Float32Array(out.waveform.data);
  // token timings (samples) from the durations output: round, clamp >= 1, 600 samples per frame
  let starts = null;
  if (out.durations) {
    const d = Array.from(out.durations.data, (v) => Math.max(1, Math.round(v)));
    const per = audio.length / d.reduce((a, b) => a + b, 0); // 600 when the rounding matches the model's
    starts = []; let acc = 0; for (const v of d) { starts.push(Math.round(acc * per)); acc += v; } starts.push(audio.length);
  }
  return { audio, nTokens: n, starts }; // starts[i] = first sample of token i (token 0 = leading "$" pad)
}

/** Convenience: same as tts.generate(text, {voice, speed}) but via our path. */
export async function synthText(text, { voice = "af_heart", speed = 1, styleFn = null } = {}) {
  const ph = await textToPhonemes(text, voice[0]);
  const tts = await loadTTS();
  const n = tts.tokenizer(ph, { truncation: true }).input_ids.dims.at(-1) - 2;
  const style = styleFn ? styleFn(n) : styleRow(voicePack(voice), n);
  return { ...(await synthPhonemes(ph, { style, speed })), phonemes: ph };
}

export function silence(sec) { return new Float32Array(Math.round(sec * SR)); }
export function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function writeWav(file, samples, sr = SR) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}

// ---- style construction ---------------------------------------------------
// spec: "af_heart" | { mix: [["af_heart", .7], ["af_bella", .3]] }
//       | { timbre: specA, prosody: specB }          (first 128 dims from A, last 128 from B)
//       | { base: spec, add: [[specA, specB, k]], half: "both"|"timbre"|"prosody" }  (base + k*(A-B))
//       | { spec, index: 120 } (use a different row than the true phoneme count)
//       | { spec, scaleProsody: 1.3 } (scale the prosody half about the voice's mean row)
export function makeStyle(spec, n) {
  if (typeof spec === "string") return styleRow(voicePack(spec), n);
  if (spec.index != null) return makeStyle(spec.spec, spec.index);
  if (spec.mix) {
    const out = new Float32Array(256);
    for (const [s, w] of spec.mix) { const r = makeStyle(s, n); for (let i = 0; i < 256; i++) out[i] += w * r[i]; }
    return out;
  }
  if (spec.timbre) {
    const a = makeStyle(spec.timbre, n), b = makeStyle(spec.prosody, n);
    const out = new Float32Array(256); out.set(a.subarray(0, 128), 0); out.set(b.subarray(128), 128); return out;
  }
  if (spec.base) {
    const out = makeStyle(spec.base, n).slice();
    const lo = spec.half === "prosody" ? 128 : 0, hi = spec.half === "timbre" ? 128 : 256;
    for (const [sa, sb, k] of spec.add) { const a = makeStyle(sa, n), b = makeStyle(sb, n); for (let i = lo; i < hi; i++) out[i] += k * (a[i] - b[i]); }
    return out;
  }
  if (spec.scaleProsody) {
    const r = makeStyle(spec.spec, n).slice();
    for (let i = 128; i < 256; i++) r[i] *= spec.scaleProsody; return r;
  }
  throw new Error("bad style spec " + JSON.stringify(spec));
}

/** Render a list of variants: {name, text | phonemes, style (spec), speed} -> dir/name.wav */
export async function runVariants(dir, variants) {
  const tts = await loadTTS();
  for (const v of variants) {
    const ph = v.phonemes ?? (await textToPhonemes(v.text, (typeof v.style === "string" ? v.style : "a")[0] === "b" ? "b" : "a"));
    const n = tts.tokenizer(ph, { truncation: true }).input_ids.dims.at(-1) - 2;
    const style = makeStyle(v.style ?? "af_heart", n);
    let { audio } = await synthPhonemes(ph, { style, speed: v.speed ?? 1 });
    if (v.post) audio = v.post(audio);
    writeWav(`${dir}/${v.name}.wav`, audio);
    console.log(v.name.padEnd(28), n, ph);
  }
}

// ---- espeak IPA -> misaki symbols (what Kokoro v1.0 was trained on, per misaki/EN_PHONES.md) ----
export function toMisaki(ps, british = false) {
  const pairs = [["dʒ", "ʤ"], ["tʃ", "ʧ"], ["aɪ", "I"], ["aʊ", "W"], ["ɔɪ", "Y"], ["eɪ", "A"], ["ɚ", "əɹ"], ["ɐ", "ə"], ["ʔ", "t"], ["ç", "k"], ["ɬ", "l"], ["̃", ""]];
  for (const [a, b] of pairs) ps = ps.split(a).join(b);
  if (british) { ps = ps.replace(/əʊ/g, "Q").replace(/eə/g, "ɛː").replace(/iə/g, "ɪə"); }
  else { ps = ps.replace(/oʊ/g, "O").replace(/ɜːɹ/g, "ɜɹ").replace(/ɜː/g, "ɜɹ").replace(/ɪə/g, "iə").replace(/ː/g, ""); }
  ps = ps.replace(/(?<![\s\p{P}])e(?![ɪə])/gu, "A");
  return ps;
}
