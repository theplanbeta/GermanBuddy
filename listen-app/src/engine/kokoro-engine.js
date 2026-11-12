// The voice engine as seen by the rest of the app. Any future engine (for
// example a server-hosted voice) only needs to offer the same things:
//
//   probe()                       -> Promise<{ device, dtype, cached, webgpu }>
//   load(onProgress)              -> Promise<{ device, dtype }>   (safe to call again)
//   generate(text, voice, speed)  -> Promise<{ samples: Float32Array, sampleRate, ms }>
//   prefetchVoice(voice)          -> starts fetching a voice's small data file (optional)
//
// generate() waits until load() has been called and has finished; it never
// starts the model download by itself (the page asks the listener first).
//
// Kokoro-specific extras:
//   mode / setMode(mode)   'auto' | 'webgpu' | 'wasm'. setMode restarts the
//                          engine; the page then calls probe() and load() again.
//   device                 'webgpu' | 'wasm' once loaded
//   onFallback(reason)     called when the graphics chip (WebGPU) failed or kept
//                          producing broken audio and the engine switched itself
//                          to the standard mode ('wasm'). The page must then call
//                          probe() / load() again, as after setMode.
//
// Errors carry `phase`: 'load', 'generate', or 'cancelled' (the engine was
// restarted while the request waited; simply ask again).
import { checkAudio } from './check-audio.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
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

export function createKokoroEngine({ mode = 'auto' } = {}) {
  let worker = null;
  const pending = new Map(); // id -> { resolve, reject }
  let nextId = 1;
  let probeWaiter = null;
  let loadWaiter = null;
  let loading = null;
  let ready = deferred(); // settles when the model has loaded
  let progressListener = () => {};
  let strikes = 0;

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
        loadWaiter?.resolve({ device: data.device, dtype: data.dtype });
        ready.resolve();
        break;
      case 'audio': {
        const job = pending.get(data.id);
        pending.delete(data.id);
        engine.sampleRate = data.sampleRate;
        job?.resolve({ samples: data.samples, sampleRate: data.sampleRate, ms: data.ms });
        break;
      }
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

  function run(text, voice, speed) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'generate', id, text, voice, speed });
    });
  }

  const engine = {
    sampleRate: 24000,
    mode,
    device: null,
    onFallback: null,
    check: checkAudio, // replaceable in tests to imitate a misbehaving graphics chip

    probe() {
      return new Promise((resolve, reject) => {
        probeWaiter = { resolve, reject };
        worker.postMessage({ type: 'probe', mode: engine.mode });
      });
    },

    load(onProgress) {
      if (onProgress) progressListener = onProgress;
      if (!loading) {
        loading = new Promise((resolve, reject) => {
          loadWaiter = { resolve, reject };
          worker.postMessage({ type: 'load', mode: engine.mode });
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

    async generate(text, voice, speed = 1) {
      for (;;) {
        await ready.promise;
        const onGpu = engine.device === 'webgpu';
        let result;
        let problem;
        try {
          result = await run(text, voice, speed);
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

    /** Starts downloading a voice's data file (~0.5 MB) into the cache kokoro-js reads from. */
    async prefetchVoice(voice) {
      // Same address and cache name that kokoro-js uses, so the engine finds it there.
      const url = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${voice}.bin`;
      try {
        const cache = await caches.open('kokoro-voices');
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, new Response(await response.arrayBuffer(), { headers: response.headers }));
      } catch {
        /* no cache or offline: the engine fetches it itself when needed */
      }
    },
  };

  startWorker();
  return engine;
}
