import fs from 'fs';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
const [f, pages] = [process.argv[2], process.argv[3]];
const lp = new LiteParse({ ocrEnabled: false, outputFormat: 'json', extractBlocks: true, quiet: true, targetPages: pages, extractTextMetadata: true });
const r = await lp.parse(new Uint8Array(fs.readFileSync(f)));
for (const p of r.pages) {
  console.log('--- page', p.pageNum, p.pageLabel || '', p.width, p.height);
  for (const b of p.blocks) console.log(b.kind.padEnd(9), b.level ?? '', b.bbox ? [b.bbox.x, b.bbox.y, b.bbox.width, b.bbox.height].map(v => v.toFixed(0)).join(',') : '-', JSON.stringify((b.text ?? b.lines?.join(' | ') ?? (b.rows ? b.rows.map(r => r.map(c => c.text).join(' ; ')).join(' || ') : '')).slice(0, Number(process.argv[4] || 160))));
}
