import fs from 'fs'; import crypto from 'crypto';
import { initSync, LiteParse } from '@llamaindex/liteparse-wasm';
import { openPdf } from '../lib/hearshot-doc.js';
initSync({ module: fs.readFileSync(new URL('../node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm', import.meta.url)) });
for (const f of process.argv.slice(2)) { const doc = await openPdf(new Uint8Array(fs.readFileSync(f)), { LiteParse }); const B = []; for await (const p of doc.pages()) B.push(...p.blocks); console.log(f.split('/').pop(), 'node blocks hash', crypto.createHash('sha256').update(B.map(b => b.type + '|' + b.text).join('\n')).digest('hex').slice(0, 16), B.length); }
