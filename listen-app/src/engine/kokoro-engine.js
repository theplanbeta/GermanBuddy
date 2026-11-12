// The voice engine as seen by the rest of the app. Any future engine (for
// example a server-hosted voice) only needs to offer the same four things:
//
//   probe()                  -> Promise<{ device, dtype, cached }>
//   load(onProgress)         -> Promise<{ device, dtype }>   (safe to call again)
//   generate(text, voice)    -> Promise<{ samples: Float32Array, sampleRate, ms }>
//   sampleRate               -> number (known after the first clip)

export function createKokoroEngine() {
  const worker = new Worker(new URL('./kokoro.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); // id -> { resolve, reject }
  let nextId = 1;
  let probeWaiter = null;
  let loadWaiter = null;
  let loading = null;
  let progressListener = () => {};

  worker.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'probe':
        probeWaiter?.resolve(data);
        break;
      case 'progress':
        progressListener(data.loaded, data.total);
        break;
      case 'ready':
        loadWaiter?.resolve({ device: data.device, dtype: data.dtype });
        break;
      case 'audio': {
        const job = pending.get(data.id);
        pending.delete(data.id);
        engine.sampleRate = data.sampleRate;
        job?.resolve({ samples: data.samples, sampleRate: data.sampleRate, ms: data.ms });
        break;
      }
      case 'error': {
        const error = new Error(data.message);
        error.phase = data.phase;
        if (data.phase === 'load') loadWaiter?.reject(error);
        else if (data.phase === 'probe') probeWaiter?.reject(error);
        else {
          pending.get(data.id)?.reject(error);
          pending.delete(data.id);
        }
        break;
      }
    }
  });

  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The voice engine stopped unexpectedly.');
    loadWaiter?.reject(error);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  });

  const engine = {
    sampleRate: 24000,

    probe() {
      return new Promise((resolve, reject) => {
        probeWaiter = { resolve, reject };
        worker.postMessage({ type: 'probe' });
      });
    },

    load(onProgress) {
      if (onProgress) progressListener = onProgress;
      if (!loading) {
        loading = new Promise((resolve, reject) => {
          loadWaiter = { resolve, reject };
          worker.postMessage({ type: 'load' });
        });
        loading.catch(() => (loading = null)); // allow "Try again"
      }
      return loading;
    },

    async generate(text, voice) {
      await engine.load();
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'generate', id, text, voice });
      });
    },
  };
  return engine;
}
