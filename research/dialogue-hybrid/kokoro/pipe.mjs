// Node port of the app's reading pipeline (reader.js #prepareNext / #renderStyled / #renderSpliced /
// toWav), using copies of the app's own modules in ./app/src. The model is the app's
// (Kokoro-82M-v1.0-ONNX-timestamped, uint8 as on the app's WASM path) via onnxruntime-node.
// Additions for the prototype (all off by default, so the default is exactly the app):
//   part.voice   a part may name its own voice (or a blend: 'am_michael*0.6+am_fenrir*0.4')
//   voiceGainDb  per-voice level correction applied with the after-effects
//   pauseFor     a function (i) -> designed pause in seconds, instead of designedPause
import fs from 'node:fs';
import { KokoroTTS } from 'kokoro-js';
import { Tensor } from '@huggingface/transformers';
import { textToPhonemes, partToPhonemes, keepKnown } from './app/src/engine/phonemes.js';
import { planCall, firstWords, callLength, MAX_SENTENCES } from './app/src/flow/plan.js';
import { assembleCall, plainClip, designedPause, spliceParts } from './app/src/flow/assemble.js';
import { styleKey } from './app/src/director/director.js';
import { styleShift, styledSpeed, afterEffects } from './app/src/director/styles.js';
import { gainRamp } from './app/src/flow/signal.js';
import { toInt16 } from './app/src/reader/audio.js';

export const RATE = 24000;
const VOICES = new URL('./node_modules/kokoro-js/voices/', import.meta.url).pathname;
const packs = new Map();
export function voicePack(spec) {
  if (packs.has(spec)) return packs.get(spec);
  const terms = spec.split('+').map((t) => { const [n, w] = t.split('*'); return [n, w === undefined ? 1 : +w]; });
  let pack = null;
  for (const [n, w] of terms) {
    const b = fs.readFileSync(`${VOICES}${n}.bin`);
    const p = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (!pack) pack = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) pack[i] += w * p[i];
  }
  packs.set(spec, pack);
  return pack;
}

let tts = null;
// BACKEND=web: the model runs in onnxruntime-web's WASM kernels (the build the app ships),
// loaded in Node, i.e. the same numerics as the app in a browser without WebGPU.
// Otherwise onnxruntime-node (native CPU kernels).
let webSession = null;
let ortWeb = null;
export const BACKEND = process.env.BACKEND === 'web' ? 'web' : 'node';
const MODEL_DIR = new URL('./node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/onnx/', import.meta.url).pathname;
export async function engine(dtype = 'uint8') {
  if (!tts) tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX-timestamped', { dtype, device: 'cpu' });
  if (BACKEND === 'web' && !webSession) {
    ortWeb = await import('/home/user/GermanBuddy/listen-app/node_modules/onnxruntime-web/dist/ort.node.min.mjs');
    ortWeb.env.wasm.numThreads = +(process.env.THREADS || 4);
    webSession = await ortWeb.InferenceSession.create(fs.readFileSync(`${MODEL_DIR}${dtype === 'fp32' ? 'model.onnx' : `model_${dtype}.onnx`}`));
  }
  return tts;
}
export const vocabulary = () => tts.tokenizer.model.tokens_to_ids;

// The worker's render().
export async function renderRaw({ phonemes, voice, speed, row, shift }) {
  const pack = voicePack(voice);
  const t0 = performance.now();
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const tokens = input_ids.dims.at(-1) - 2;
  const r = Math.min(Math.max(row ?? tokens, 0), 509);
  const vector = pack.slice(r * 256, r * 256 + 256);
  if (shift) for (let i = 0; i < 256; i++) vector[i] += shift[i];
  if (BACKEND === 'web') {
    const feeds = { input_ids: new ortWeb.Tensor('int64', BigInt64Array.from(Array.from(input_ids.data, BigInt)), input_ids.dims), style: new ortWeb.Tensor('float32', vector, [1, 256]), speed: new ortWeb.Tensor('float32', new Float32Array([speed]), [1]) };
    const out = await webSession.run(feeds);
    return { samples: new Float32Array(out.waveform.data), durations: Float32Array.from(out.durations.data, Number), tokens, ms: performance.now() - t0 };
  }
  const out = await tts.model({ input_ids, style: new Tensor('float32', vector, [1, 256]), speed: new Tensor('float32', [speed], [1]) });
  return { samples: new Float32Array(out.waveform.data), durations: Float32Array.from(out.durations.data, Number), tokens, ms: performance.now() - t0 };
}

// The reader's #ensurePhonemes for all sentences.
export async function phonemize(deliveries, lang = 'a') {
  const vocab = vocabulary();
  const one = async (parts) => {
    if (parts.length === 1 && parts[0].lang === 'en' && !parts[0].names) return [keepKnown(await textToPhonemes(parts[0].text, lang), vocab)];
    return Promise.all(parts.map(async (p) => keepKnown(await partToPhonemes(p, lang), vocab)));
  };
  const known = [];
  for (const d of deliveries) {
    const parts = await one(d.parts);
    const head = (await one([{ ...d.parts[0], text: firstWords(d.parts[0].text) }])).join(' ');
    const ph = parts.join(' ');
    known.push({ ph, parts, head, n: [...ph].length, headN: [...head].length });
  }
  return known;
}

const NARRATOR = 'af_heart';
const voiceOf = (part) => part.voice || NARRATOR;
const partKey = (p) => `${styleKey(p.style)}|${voiceOf(p)}`;
const renderCount = (d) => (d?.spliced ? new Set(d.parts.map(partKey)).size : 1);
function mainPart(known) {
  let best = 0;
  known.parts.forEach((p, k) => { if (p.length > known.parts[best].length) best = k; });
  return best;
}
const callPart = (d, known) => (d.spliced ? d.parts[mainPart(known)] : d.parts[0]);

/** The app's plan when nothing limits the size (every call as large as the rules allow). */
// As in the app's download: the opening sentence is made first on its own (urgent), so the
// rest starts at sentence 1; at the end sentence 0 is re-made in full quality alone, with the
// look-ahead into sentence 1 (an "upgrade" call: its neighbours are already fresh).
export function planAll(sentences, known, deliveries, { appOpening = true } = {}) {
  const calls = [];
  const fresh = sentences.map(() => false);
  let first = 0;
  if (appOpening) {
    first = 1;
    calls.push(planCall({ sentences, phonemes: known, fresh: sentences.map((_, i) => i !== 0), start: 0, rule: { maxSentences: MAX_SENTENCES, maxMs: Infinity }, deliveries }));
    fresh[0] = true;
  }
  for (let start = first; start < sentences.length;) {
    const c = planCall({ sentences, phonemes: known, fresh, start, rule: { maxSentences: MAX_SENTENCES, maxMs: Infinity }, deliveries });
    calls.push(c);
    for (let i = c.first; i <= c.last; i++) fresh[i] = true;
    start = c.last + 1;
  }
  return calls;
}

function post(samples, part, voiceGainDb) {
  let out = afterEffects(samples, part.style);
  const g = voiceGainDb[voiceOf(part)] || 0;
  if (g) out = gainRamp(out, g);
  return out;
}

async function renderStyled({ part, phonemes, speed, row, tokens, voiceGainDb }) {
  const modelSpeed = styledSpeed(part.style, speed);
  const r = await renderRaw({ phonemes, voice: voiceOf(part), speed: modelSpeed, row, shift: styleShift(part.style, tokens) });
  return { ...r, raw: r.samples, samples: post(r.samples, part, voiceGainDb), modelSpeed, stats: [{ tokens: r.tokens, ms: r.ms }] };
}

async function renderSpliced({ delivery, known, speed, voiceGainDb }) {
  const full = known.parts.join(' ');
  const keys = delivery.parts.map(partKey);
  const unique = [...new Set(keys)];
  const renders = [];
  for (const key of unique) {
    const part = delivery.parts[keys.indexOf(key)];
    renders.push(await renderStyled({ part, phonemes: full, speed, row: known.n, tokens: known.n, voiceGainDb }));
  }
  const stats = renders.flatMap((r) => r.stats);
  const ms = renders.reduce((a, r) => a + r.ms, 0);
  const raw = renders.map((r) => ({ samples: r.raw, durations: r.durations }));
  const partRender = keys.map((k) => unique.indexOf(k));
  const samples = spliceParts({ renders: raw, partRender, members: known.parts, post: (piece, k) => post(piece, delivery.parts[k], voiceGainDb) });
  if (samples) return { samples, durations: null, ms, stats, spliced: 'splice', modelSpeed: renders.map((r) => r.modelSpeed) };
  const main = partRender[mainPart(known)];
  return { samples: renders[main].samples, durations: null, ms, stats, spliced: 'splice-fallback', modelSpeed: renders.map((r) => r.modelSpeed) };
}

/** One call of the reader's #prepareNext (after planning). Returns the clip. */
export async function makeCall({ call, sentences, known, deliveries, speed = 1, pauseFor, voiceGainDb = {} }) {
  const n = sentences.length;
  const indices = [];
  for (let i = call.first; i <= call.last; i++) indices.push(i);
  const members = indices.map((i) => known[i].ph);
  if (call.lookahead >= 0) members.push(known[call.lookahead].head);
  const d0 = deliveries[call.first];
  const result = call.spliced && !call.plain
    ? await renderSpliced({ delivery: d0, known: known[call.first], speed, voiceGainDb })
    : await renderStyled({ part: callPart(d0, known[call.first]), phonemes: members.join(' '), speed, row: call.row, tokens: call.tokens, voiceGainDb });
  const endsParagraph = (i) => i === n - 1 || sentences[i + 1].para !== sentences[i].para;
  const pauses = indices.map((i) => (pauseFor ? pauseFor(i) : designedPause(sentences[i], endsParagraph(i))));
  const joinedInside = indices.map((i) => i < call.last && Boolean(sentences[i].joined));
  const built = call.plain ? plainClip(result.samples, pauses[0], call.first + 1) : assembleCall({
    audio: result.samples, durations: result.durations, members: result.spliced ? [members.join(' ')] : members,
    lookahead: call.lookahead >= 0, pauses, joinedInside, fadeIn: call.first === 0 ? 0.008 : 0.002, seed: call.first + 1,
  });
  if (!built) throw new Error(`call ${call.first}-${call.last} could not be cut`);
  const method = result.spliced ? result.spliced : built.method;
  return {
    clip: { pcm: toInt16(built.samples), offsets: built.offsets, first: call.first, last: call.last },
    log: { ...call, method, key: d0.key, renders: result.stats.length, modelSpeed: result.modelSpeed, ms: result.ms, stats: result.stats, voice: [...new Set((call.spliced ? d0.parts : [callPart(d0, known[call.first])]).map(voiceOf))] , pauses },
  };
}

/** The reader's toWav: every sentence's slice of its clip, in order. Returns { pcm, starts }. */
export function joinClips(segments) {
  const parts = segments.map(({ clip, k }) => clip.pcm.subarray(clip.offsets[k], clip.offsets[k + 1]));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const pcm = new Int16Array(total);
  const starts = [];
  let o = 0;
  for (const p of parts) { starts.push(o); pcm.set(p, o); o += p.length; }
  return { pcm, starts };
}

export function writeWav(file, pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(b, 44);
  fs.writeFileSync(file, b);
}
export function readWav(file) {
  const b = fs.readFileSync(file);
  const n = (b.length - 44) / 2;
  const x = new Int16Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + 2 * i);
  return x;
}

/** Renders a whole text: plan (or a given call list), make each call, join. */
export async function renderAll({ sentences, deliveries, calls = null, pauseFor, voiceGainDb, lang = 'a', log = console.log }) {
  const known = await phonemize(deliveries, lang);
  calls ??= planAll(sentences, known, deliveries);
  const segments = new Array(sentences.length).fill(null);
  const logs = [];
  for (const call of calls) {
    const { clip, log: l } = await makeCall({ call, sentences, known, deliveries, pauseFor, voiceGainDb });
    for (let i = clip.first; i <= clip.last; i++) segments[i] = { clip, k: i - clip.first };
    logs.push(l);
    log(`  [${call.first}-${call.last}] la ${call.lookahead} tokens ${call.tokens} row ${call.row} ${l.method} key "${l.key}" voice ${l.voice} renders ${l.renders} ${Math.round(l.ms)} ms`);
  }
  const { pcm, starts } = joinClips(segments);
  return { pcm, starts, known, calls: logs };
}
