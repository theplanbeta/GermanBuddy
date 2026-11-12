// Runs the Kokoro voice model in a background thread so the page never freezes.
//
// Messages in:   { type: 'probe', mode, dtype? }   mode: 'auto' | 'webgpu' | 'webgpu-fp16' | 'wasm'
//                { type: 'load', mode, dtype? }  dtype: only for tests (?debug&dtype=fp32)
//                { type: 'phonemize', id, texts, lang }        lang: 'a' (American) | 'b' (British)
//                { type: 'render', id, phonemes, voice, speed, row }
//                { type: 'warmup' }   pays the one-off cost of the first request early
// Messages out:  { type: 'probe', device, dtype, cached, webgpu, previous }
//                { type: 'progress', loaded, total }
//                { type: 'ready', device, dtype }
//                { type: 'phonemes', id, phonemes }
//                { type: 'audio', id, samples, durations, tokens, sampleRate, ms }
//                { type: 'error', id?, phase: 'load' | 'generate', gpu, message }
//
// The app talks to the model directly (tokenizer + model) rather than through
// kokoro-js's generate(): it needs to put several sentences and a look-ahead
// into one call, choose the voice row itself, and get the per-token timings
// that this "timestamped" export of the model adds as a second output.
import { KokoroTTS, env as kokoroEnv } from 'kokoro-js';
import { env, Tensor } from '@huggingface/transformers';
import { textToPhonemes, keepKnown } from './phonemes.js';
// Serve the ONNX Runtime engine file from our own site instead of the CDN that
// transformers.js would otherwise use. Vite copies this file into the build.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

kokoroEnv.wasmPaths = { wasm: ortWasmUrl };
// Use up to 4 CPU cores (the library default is half of them, which measured
// clearly slower; on a 4-core machine 2 / 3 / 4 / 6 threads measured
// 11.4 / 8.4 / 7.0 / 10.2 s for the same text). Only takes effect when the
// page is cross-origin isolated.
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));

// Same network as the original Kokoro export, plus a "durations" output
// (how long each phoneme is spoken), which gives exact sentence boundaries.
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';
const PREVIOUS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'; // the model earlier versions used
const MODEL_FILE = { fp32: 'onnx/model.onnx', fp16: 'onnx/model_fp16.onnx', uint8: 'onnx/model_uint8.onnx' };
// Voice files are identical in both repositories; keep using the address (and
// browser cache) that earlier versions already filled.
const VOICE_URL = (voice) => `https://huggingface.co/${PREVIOUS_MODEL_ID}/resolve/main/voices/${voice}.bin`;

let tts = null;
let plan = null;
let vocabulary = null;
const voices = new Map(); // voice name -> Float32Array of 510 rows x 256 numbers

// WebGPU (the graphics chip) uses full precision (fp32) as the Kokoro README
// recommends, or, as an experiment, the half-size fp16 file. On the CPU use
// the "uint8" file: 2.5x faster than "q8" for a 177 MB instead of 92 MB
// download. ("fp16" on the CPU produced silent, broken audio for some
// sentences with the previous export.)
async function choosePlan(mode = 'auto', forced = null) {
  if (plan) return plan;
  let webgpu = false;
  try {
    webgpu = Boolean(self.navigator?.gpu && (await navigator.gpu.requestAdapter()));
  } catch {
    /* no WebGPU */
  }
  const device = webgpu && mode !== 'wasm' ? 'webgpu' : 'wasm';
  const dtype = forced || (device === 'wasm' ? 'uint8' : mode === 'webgpu-fp16' ? 'fp16' : 'fp32');
  plan = { device, dtype, cached: await isCached(MODEL_ID, dtype), webgpu, previous: await hasPrevious() };
  return plan;
}

async function isCached(model, dtype) {
  try {
    const cache = await caches.open('transformers-cache');
    return Boolean(await cache.match(`https://huggingface.co/${model}/resolve/main/${MODEL_FILE[dtype]}`));
  } catch {
    return false; // Cache API missing (e.g. plain http on a phone)
  }
}

// Is the model of earlier Hearshot versions saved in this browser? (Only used
// for the wording of the download card.)
async function hasPrevious() {
  return (await isCached(PREVIOUS_MODEL_ID, 'uint8')) || (await isCached(PREVIOUS_MODEL_ID, 'fp32'));
}

// Reports download progress of the model file itself (the other files are tiny).
function progressReporter() {
  return (event) => {
    if (event.status === 'progress' && event.total && event.file.endsWith('.onnx')) {
      postMessage({ type: 'progress', loaded: event.loaded, total: event.total });
    }
  };
}

async function load(mode, forced) {
  if (!tts) {
    const { device, dtype } = await choosePlan(mode, forced);
    // A failure here is reported to the page (with gpu: true for WebGPU),
    // which decides whether to fall back to the standard engine.
    tts = await KokoroTTS.from_pretrained(MODEL_ID, { device, dtype, progress_callback: progressReporter() });
    vocabulary = tts.tokenizer.model.tokens_to_ids;
  }
  postMessage({ type: 'ready', device: plan.device, dtype: plan.dtype });
}

// The voice file: 510 rows of 256 numbers, one row per call length.
async function voicePack(voice) {
  if (voices.has(voice)) return voices.get(voice);
  const url = VOICE_URL(voice);
  let cache = null;
  let buffer = null;
  try {
    cache = await caches.open('kokoro-voices');
    buffer = await (await cache.match(url))?.arrayBuffer();
  } catch {
    /* no cache available */
  }
  if (!buffer) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn’t download the voice (${response.status}).`);
    buffer = await response.arrayBuffer();
    try {
      await cache?.put(url, new Response(buffer.slice(0), { headers: response.headers }));
    } catch {
      /* storage full: it is simply fetched again next time */
    }
  }
  const pack = new Float32Array(buffer);
  voices.set(voice, pack);
  return pack;
}

async function phonemizeAll({ id, texts, lang }) {
  const phonemes = [];
  for (const text of texts) phonemes.push(keepKnown(await textToPhonemes(text, lang), vocabulary));
  postMessage({ type: 'phonemes', id, phonemes });
}

async function render({ id, phonemes, voice, speed = 1, row }) {
  const pack = await voicePack(voice);
  const started = performance.now();
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const tokens = input_ids.dims.at(-1) - 2;
  const r = Math.min(Math.max(row ?? tokens, 0), 509);
  const output = await tts.model({
    input_ids,
    style: new Tensor('float32', pack.slice(r * 256, r * 256 + 256), [1, 256]),
    speed: new Tensor('float32', [speed], [1]),
  });
  const samples = new Float32Array(output.waveform.data);
  const durations = output.durations ? Float32Array.from(output.durations.data, Number) : null;
  const message = { type: 'audio', id, samples, durations, tokens, sampleRate: 24000, ms: performance.now() - started };
  postMessage(message, [samples.buffer, ...(durations ? [durations.buffer] : [])]);
}

async function warmup() {
  await textToPhonemes('Hi.', 'a'); // starts the phonemiser (about 0.3 s the first time)
  const pack = await voicePack('af_heart');
  const { input_ids } = tts.tokenizer('hˈaɪ.', { truncation: true });
  await tts.model({ input_ids, style: new Tensor('float32', pack.slice(1280, 1536), [1, 256]), speed: new Tensor('float32', [1], [1]) });
}

// Messages are handled strictly one after another.
let queue = Promise.resolve();
self.addEventListener('message', ({ data }) => {
  if (!data || typeof data.type !== 'string') return;
  queue = queue.then(async () => {
    try {
      if (data.type === 'probe') postMessage({ type: 'probe', ...(await choosePlan(data.mode, data.dtype)) });
      else if (data.type === 'load') await load(data.mode, data.dtype);
      else if (data.type === 'phonemize') await phonemizeAll(data);
      else if (data.type === 'render') await render(data);
      else if (data.type === 'warmup') await warmup().catch(() => {});
    } catch (error) {
      const gpu = plan?.device === 'webgpu';
      const phase = data.type === 'render' || data.type === 'phonemize' ? 'generate' : data.type;
      postMessage({ type: 'error', id: data.id, phase, gpu, message: String(error?.message || error) });
    }
  });
});
