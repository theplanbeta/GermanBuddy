// Test page: runs the worker, renders blocks, tap-to-exclude, listening preview, timing hooks.
import { listeningItems, DEFAULT_SETTINGS } from '../lib/listen.js';
import { openOtherFormat, formatOf } from '../lib/formats.js';
const $ = (id) => document.getElementById(id);
const state = { blocks: [], excluded: new Set(), events: [], t0: 0 };
function render() {
  const settings = { ...DEFAULT_SETTINGS, excluded: [...state.excluded] };
  $('listen').textContent = listeningItems(state.blocks, settings).map(i => i.text).join('\n\n');
}
function addPage(page) {
  const host = $('blocks');
  const h = document.createElement('div'); h.className = 'page';
  h.textContent = `Page ${page.label || page.page}` + (page.warnings?.length ? ' — ' : '');
  for (const w of page.warnings || []) { const s = document.createElement('span'); s.className = 'warn'; s.textContent = w.message + ' '; h.appendChild(s); }
  host.appendChild(h);
  for (const b of page.blocks) {
    const d = document.createElement('div'); d.className = 'blk t-' + b.type; d.dataset.id = b.blockId;
    d.dataset.skip = DEFAULT_SETTINGS.read[b.type] === true ? '0' : '1';
    d.innerHTML = `<span class="tag">${b.type}${b.level ? ' ' + b.level : ''} · ${b.reason}</span>`; d.append(b.text.slice(0, 400));
    d.onclick = () => { state.excluded.has(b.blockId) ? state.excluded.delete(b.blockId) : state.excluded.add(b.blockId); d.classList.toggle('x'); render(); };
    host.appendChild(d);
  }
}
export function openBytes(name, bytes, opts = {}) {
  state.blocks = []; state.excluded.clear(); state.events = []; $('blocks').textContent = ''; state.t0 = performance.now();
  const fmt = formatOf(name, bytes);
  if (fmt !== 'pdf') {
    return openOtherFormat(fmt, bytes, name).then((doc) => { for (const page of doc.pages) { state.blocks.push(...page.blocks); addPage(page); } render(); $('status').textContent = `${fmt}: ${state.blocks.length} blocks`; return { done: true, format: fmt, blocks: state.blocks.length }; });
  }
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./hearshot-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data; state.events.push({ type: m.type, t: performance.now() - state.t0, page: m.page?.page, ms: m.page?.ms, warnings: m.page?.warnings?.map(x => x.code) });
      if (m.type === 'open') $('status').textContent = `${name}: ${m.stats.pages} pages`;
      if (m.type === 'page') { state.blocks.push(...m.page.blocks); if (!opts.headless || m.page.page <= 3) addPage(m.page); $('status').textContent = `${name}: page ${m.stats.parsedPages} of ${m.stats.pages}`; if (m.page.page <= 3 || m.stats.parsedPages === m.stats.pages) render(); }
      if (m.type === 'done') { render(); w.terminate(); resolve({ stats: m.stats, events: state.events, blocks: state.blocks.length }); }
      if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.postMessage({ cmd: 'open', bytes, batchSize: opts.batchSize || 8 }, [bytes]);
  });
}
$('file').onchange = async () => { const f = $('file').files[0]; if (f) openBytes(f.name, await f.arrayBuffer()); };
window.hearshot = { openUrl: async (url, opts) => openBytes(url.split('/').pop(), await (await fetch(url)).arrayBuffer(), opts), state, listeningItems };
window.hearshotReady = true;
