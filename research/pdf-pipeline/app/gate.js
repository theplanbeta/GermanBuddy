// Part 1 gate: LiteParse WASM in a module Web Worker on a COOP/COEP page.
const log = (...a) => { document.getElementById('log').textContent += a.join(' ') + '\n'; console.log(...a); };
window.runGate = (file, opts = {}) => new Promise((resolve, reject) => {
  const w = new Worker(new URL('./gate-worker.js', import.meta.url), { type: 'module' });
  const events = [];
  w.onmessage = (e) => { events.push(e.data); if (e.data.type === 'page' && opts.verbose) log(JSON.stringify(e.data)); if (e.data.type === 'done') { w.terminate(); resolve(events); } if (e.data.type === 'error') { w.terminate(); reject(new Error(e.data.message)); } };
  w.onerror = (e) => { reject(new Error('worker error ' + e.message)); };
  w.postMessage({ file, ...opts });
});
log('crossOriginIsolated', self.crossOriginIsolated);
window.gateReady = true;
