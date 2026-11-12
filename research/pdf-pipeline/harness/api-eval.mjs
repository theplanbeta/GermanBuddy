// Scores the public streaming API (openPdf) exactly as the app would call it, and checks the
// order-uncertain warning against ground-truth order errors.
import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
import { openPdf } from '../lib/hearshot-doc.js';
import { corpus } from './corpus.mjs';
import { score } from './score.mjs';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const rows = []; const flags = [];
for (const d of corpus()) {
  const doc = await openPdf(new Uint8Array(fs.readFileSync(d.pdf)), { LiteParse });
  const blocks = []; const warn = {};
  for await (const p of doc.pages()) { blocks.push(...p.blocks); warn[p.page] = p.warnings; }
  // merge continuations the way listeningItems does, keeping per-page parts for the scorer
  const merged = []; const byChain = new Map();
  for (const b of blocks) { if (b.continuesFrom && byChain.has(b.continuesFrom)) { const m = byChain.get(b.continuesFrom); m.parts.push({ page: b.page, text: b.text }); m.text += ' ' + b.text; continue; } const m = { ...b, parts: [{ page: b.page, text: b.text }] }; merged.push(m); byChain.set(b.blockId, m); }
  const s = score(d.gt, { blocks: merged }); rows.push({ id: d.id, group: d.group, score: s.score });
  for (const pg of d.gt.pages || Object.keys(warn).map(Number)) {
    const o = score({ ...d.gt, pages: [pg] }, { blocks: merged.filter(b => b.page === pg).map(b => ({ ...b, parts: undefined })) }).order;
    flags.push({ id: d.id, pg, bad: o < 0.95, flagged: (warn[pg] || []).some(w => w.code === 'order-uncertain'), o, ag: (warn[pg] || []).find(w => w.code === 'order-uncertain')?.agreement });
  }
}
const m = (f) => { const r = rows.filter(f); return (r.reduce((a, x) => a + x.score, 0) / r.length).toFixed(1); };
console.log('openPdf API scores: synthetic', m(r => r.group === 'synth'), 'real', m(r => r.group === 'real'), 'omni', m(r => r.group === 'omni'), 'ALL', m(() => true));
const tp = flags.filter(f => f.bad && f.flagged).length, fp = flags.filter(f => !f.bad && f.flagged).length, fn = flags.filter(f => f.bad && !f.flagged).length;
console.log('order-uncertain warning: pages', flags.length, 'bad', flags.filter(f => f.bad).length, 'TP', tp, 'FP', fp, 'FN', fn);
flags.filter(f => f.bad || f.flagged).forEach(f => console.log('  ', f.id, f.pg, 'trueOrder', f.o.toFixed(2), 'flag', f.flagged, f.ag ?? ''));
