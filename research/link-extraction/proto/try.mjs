import fs from 'fs';
import { extractForListening } from './hearshot-extract.mjs';
const [d, url] = process.argv.slice(2);
const html = fs.readFileSync(d, 'utf8');
const r = await extractForListening(html, url);
console.log(JSON.stringify(r.meta || r, null, 1));
console.log(r.warnings);
for (const b of (r.blocks||[]).slice(0, 40)) console.log((b.skip?'x ':'  ')+b.type.padEnd(10), b.text.slice(0, 110), b.why? '['+b.why+']':'');
