// Runs the Kokoro voice model in a background thread so the page never freezes.
//
// Messages in:   { type: 'probe', mode }            mode: 'auto' | 'webgpu' | 'wasm'
//                { type: 'load', mode }
//                { type: 'generate', id, text, voice, speed }
//                { type: 'warmup' }   pays the one-off cost of the first request early
// Messages out:  { type: 'probe', device, dtype, cached, webgpu }
//                { type: 'progress', loaded, total }
//                { type: 'ready', device, dtype }
//                { type: 'audio', id, samples (Float32Array), sampleRate, ms }
//                { type: 'error', id?, phase: 'load' | 'generate', gpu, message }
import { KokoroTTS, env as kokoroEnv } from 'kokoro-js';
import { env } from '@huggingface/transformers';
// Serve the ONNX Runtime engine file from our own site instead of the CDN that
// transformers.js would otherwise use. Vite copies this file into the build.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

kokoroEnv.wasmPaths = { wasm: ortWasmUrl };
// Use up to 4 CPU cores (the library default is half of them, which measured
// clearly slower; on a 4-core machine 2 / 3 / 4 / 6 threads measured
// 11.4 / 8.4 / 7.0 / 10.2 s for the same text). Only takes effect when the
// page is cross-origin isolated.
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_FILE = { fp32: 'onnx/model.onnx', uint8: 'onnx/model_uint8.onnx' };

let tts = null;
let plan = null;

// WebGPU (the graphics chip) can be fastest when it exists; the Kokoro README
// recommends full precision (fp32) there. On the CPU use the "uint8" file:
// in our tests it was 2.5x faster than the README's "q8" (about 1.6x vs 0.65x
// real time on 4 cores) for a 177 MB instead of 92 MB download. ("fp16" was
// as fast but produced silent, broken audio for some sentences.)
async function choosePlan(mode = 'auto') {
  if (plan) return plan;
  let webgpu = false;
  try {
    webgpu = Boolean(self.navigator?.gpu && (await navigator.gpu.requestAdapter()));
  } catch {
    /* no WebGPU */
  }
  const device = webgpu && mode !== 'wasm' ? 'webgpu' : 'wasm';
  const dtype = device === 'webgpu' ? 'fp32' : 'uint8';
  plan = { device, dtype, cached: await isCached(dtype), webgpu };
  return plan;
}

async function isCached(dtype) {
  try {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${MODEL_FILE[dtype]}`;
    const cache = await caches.open('transformers-cache');
    return Boolean(await cache.match(url));
  } catch {
    return false; // Cache API missing (e.g. plain http on a phone)
  }
}

// Reports download progress of the model file itself (the other files are tiny).
function progressReporter() {
  return (event) => {
    if (event.status === 'progress' && event.total && event.file.endsWith('.onnx')) {
      postMessage({ type: 'progress', loaded: event.loaded, total: event.total });
    }
  };
}

async function load(mode) {
  if (!tts) {
    const { device, dtype } = await choosePlan(mode);
    // A failure here is reported to the page (with gpu: true for WebGPU),
    // which decides whether to fall back to the standard engine.
    tts = await KokoroTTS.from_pretrained(MODEL_ID, { device, dtype, progress_callback: progressReporter() });
  }
  postMessage({ type: 'ready', device: plan.device, dtype: plan.dtype });
}

async function generate({ id, text, voice, speed = 1 }) {
  const started = performance.now();
  const audio = await tts.generate(text, { voice, speed });
  const samples = audio.audio;
  postMessage(
    { type: 'audio', id, samples, sampleRate: audio.sampling_rate, ms: performance.now() - started },
    [samples.buffer],
  );
}

// Messages are handled strictly one after another.
let queue = Promise.resolve();
self.addEventListener('message', ({ data }) => {
  if (!data || typeof data.type !== 'string') return;
  queue = queue.then(async () => {
    try {
      if (data.type === 'probe') postMessage({ type: 'probe', ...(await choosePlan(data.mode)) });
      else if (data.type === 'load') await load(data.mode);
      else if (data.type === 'generate') await generate(data);
      else if (data.type === 'warmup') await tts.generate('Hi.', { voice: 'af_heart' }).catch(() => {});
    } catch (error) {
      const gpu = plan?.device === 'webgpu';
      postMessage({ type: 'error', id: data.id, phase: data.type, gpu, message: String(error?.message || error) });
    }
  });
});
