// The voice engine as seen by the rest of the app. Any future engine (for
// example a server-hosted voice) only needs to offer the same things:
//
//   probe()                    -> Promise<{ device, dtype, cached, webgpu, previous }>
//   load(onProgress)           -> Promise<{ device, dtype }>   (safe to call again)
//   phonemize(texts, voice)    -> Promise<string[]>   one phoneme string per text
//   render({ phonemes, voice, speed, row, text })
//                              -> Promise<{ samples: Float32Array, durations, tokens, sampleRate, ms }>
//                                 one model call; `durations` = per-token timings or null
//   prefetchVoice(voice)       -> starts fetching a voice's small data file (optional)
//   removePreviousModel()      -> deletes the model files of earlier versions; resolves to the bytes freed
//
// phonemize() and render() wait until load() has been called and has
// finished; they never start the model download by themselves (the page asks
// the listener first).
//
// Kokoro-specific extras:
//   mode / setMode(mode)   'auto' | 'webgpu' | 'webgpu-fp16' | 'wasm'. setMode restarts
//                          the engine; the page then calls probe() and load() again.
//   device                 'webgpu' | 'wasm' once loaded
//   onFallback(reason)     called when the graphics chip (WebGPU) failed or kept
//                          producing broken audio and the engine switched itself
//                          to the standard mode ('wasm'). The page must then call
//                          probe() / load() again, as after setMode.
//
// Errors carry `phase`: 'load', 'generate', or 'cancelled' (the engine was
// restarted while the request waited; simply ask again).
import { checkAudio } from './check-audio.js';

const PREVIOUS_MODEL = '/onnx-community/Kokoro-82M-v1.0-ONNX/'; // files of earlier Hearshot versions
const VOICE_URL = (voice) => `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`;
const GPU_STRIKES = 3; // broken results in a row before giving up on WebGPU

function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => Object.assign(d, { resolve, reject }));
  d.promise.catch(() => {}); // a rejection nobody is waiting for is fine
  return d;
}

function failure(message, phase) {
  const error = new Error(message);
  error.phase = phase;
  return error;
}

// Test-only options: `dtype` forces a model file (e.g. 'fp32' on the standard
// engine), `threads` the number of CPU threads, and `slowdown` (> 1) makes
// every model call take that many times as long, to imitate a slower device.
export function createKokoroEngine({ mode = 'auto', dtype = null, threads = null, slowdown = 1 } = {}) {
  let worker = null;
  const pending = new Map(); // id -> { resolve, reject }
  let nextId = 1;
  let probeWaiter = null;
  let loadWaiter = null;
  let loading = null;
  let ready = deferred(); // settles when the model has loaded
  let progressListener = () => {};
  let strikes = 0;
  let waiting = 0; // requests waiting for the model to load

  function startWorker() {
    worker?.terminate();
    const cancelled = failure('The voice engine was restarted.', 'cancelled');
    for (const job of pending.values()) job.reject(cancelled);
    pending.clear();
    probeWaiter?.reject(cancelled);
    loadWaiter?.reject(cancelled);
    ready.reject(cancelled);
    probeWaiter = loadWaiter = loading = null;
    ready = deferred();
    engine.device = null;
    strikes = 0;
    worker = new Worker(new URL('./kokoro.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (event) => {
      const error = failure(event.message || 'The voice engine stopped unexpectedly.', 'load');
      loadWaiter?.reject(error);
      for (const job of pending.values()) job.reject(error);
      pending.clear();
    });
  }

  function settle(id, value) {
    const job = pending.get(id);
    pending.delete(id);
    job?.resolve(value);
  }

  function onMessage({ data }) {
    switch (data.type) {
      case 'probe':
        probeWaiter?.resolve(data);
        break;
      case 'progress':
        progressListener(data.loaded, data.total);
        break;
      case 'ready':
        engine.device = data.device;
        engine.dtype = data.dtype;
        loadWaiter?.resolve({ device: data.device, dtype: data.dtype });
        ready.resolve();
        // The very first request pays a one-off setup cost (about 0.9 s on a
        // 4-core laptop). If nobody is waiting yet, pay it now.
        if (!waiting) worker.postMessage({ type: 'warmup' });
        break;
      case 'phonemes':
        settle(data.id, data.phonemes);
        break;
      case 'audio':
        engine.sampleRate = data.sampleRate;
        settle(data.id, data);
        break;
      case 'error': {
        const error = failure(data.message, data.phase);
        if (data.phase === 'load' && data.gpu) {
          fallBack('start'); // WebGPU could not start: try the standard engine
        } else if (data.phase === 'load') {
          loadWaiter?.reject(error);
          ready.reject(error);
          ready = deferred(); // allow "Try again"
        } else if (data.phase === 'probe') {
          probeWaiter?.reject(error);
        } else {
          pending.get(data.id)?.reject(error);
          pending.delete(data.id);
        }
        break;
      }
    }
  }

  function fallBack(reason) {
    engine.mode = 'wasm';
    startWorker();
    engine.onFallback?.(reason);
  }

  // Sends a request to the worker once the model is ready.
  async function ask(message) {
    waiting++;
    try {
      await ready.promise;
    } finally {
      waiting--;
    }
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  const engine = {
    sampleRate: 24000,
    mode,
    device: null,
    dtype: null,
    onFallback: null,
    check: checkAudio, // replaceable in tests to imitate a misbehaving graphics chip

    probe() {
      return new Promise((resolve, reject) => {
        probeWaiter = { resolve, reject };
        worker.postMessage({ type: 'probe', mode: engine.mode, dtype });
      });
    },

    load(onProgress) {
      if (onProgress) progressListener = onProgress;
      if (!loading) {
        loading = new Promise((resolve, reject) => {
          loadWaiter = { resolve, reject };
          worker.postMessage({ type: 'load', mode: engine.mode, dtype, threads });
        });
        loading.catch(() => (loading = null)); // allow "Try again"
      }
      return loading;
    },

    setMode(newMode) {
      if (newMode === engine.mode) return;
      engine.mode = newMode;
      startWorker();
    },

    /** Phoneme strings for texts, in American ('a…' voices) or British ('b…') English. */
    phonemize(texts, voice) {
      return ask({ type: 'phonemize', texts, lang: voice[0] === 'b' ? 'b' : 'a' });
    },

    async render({ phonemes, voice, speed = 1, row, text = '' }) {
      for (;;) {
        // Wait for the model first, so the device checked below is the one used.
        waiting++;
        try {
          await ready.promise;
        } finally {
          waiting--;
        }
        const onGpu = engine.device === 'webgpu';
        let result;
        let problem;
        try {
          result = await ask({ type: 'render', phonemes, voice, speed, row });
          if (slowdown > 1) {
            await new Promise((resolve) => setTimeout(resolve, (slowdown - 1) * result.ms));
            result.ms *= slowdown;
          }
          problem = engine.check(result.samples, result.sampleRate, text, speed);
        } catch (error) {
          if (!onGpu || error.phase === 'cancelled') throw error;
          problem = 'error';
        }
        // On the standard engine, results are passed on as they are.
        if (!problem || !onGpu) {
          strikes = 0;
          return result;
        }
        // The graphics chip gave broken audio: try again; after a few broken
        // results in a row, switch to the standard engine and retry there.
        if (++strikes >= GPU_STRIKES) fallBack(problem);
      }
    },

    /** Starts downloading a voice's data file (~0.5 MB) into the cache the worker reads from. */
    async prefetchVoice(voice) {
      const url = VOICE_URL(voice);
      try {
        const cache = await caches.open('kokoro-voices');
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, new Response(await response.arrayBuffer(), { headers: response.headers }));
      } catch {
        /* no cache or offline: the worker fetches it itself when needed */
      }
    },

    /**
     * Deletes the files of the model earlier Hearshot versions used (it has
     * been replaced by the timestamped one). Only touches that model's files
     * in the model cache; voices are kept. Resolves to the bytes freed (0 if
     * there was nothing to remove).
     */
    async removePreviousModel() {
      let freed = 0;
      try {
        const cache = await caches.open('transformers-cache');
        for (const request of await cache.keys()) {
          if (!new URL(request.url).pathname.startsWith(PREVIOUS_MODEL)) continue;
          const response = await cache.match(request);
          const size = Number(response?.headers.get('content-length'));
          if (Number.isFinite(size) && size > 0) freed += size;
          await cache.delete(request);
        }
      } catch {
        /* no cache: nothing to free */
      }
      return freed;
    },
  };

  startWorker();
  return engine;
}
