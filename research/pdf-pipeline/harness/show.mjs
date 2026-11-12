// node harness/show.mjs <docId> <variant> [page] [width]  -> pipeline blocks with type, reason and bbox
import { corpus } from './corpus.mjs';
import { load, getExtractors } from './run.mjs';
const [id, v, pg, w] = process.argv.slice(2);
const d = load(corpus().find(x => x.id === id)); const ex = await getExtractors();
const out = await ex[v](d);
for (const b of out.blocks) if (!pg || b.page === +pg) console.log(String(b.page).padStart(3), (b.type + (b.level ? b.level : '')).padEnd(13), (b.reason || '').padEnd(26), b.bbox ? b.bbox.map(x => Math.round(x)).join(',').padEnd(17) : ''.padEnd(17), (b.size ? b.size.toFixed(1) : '').padStart(5), JSON.stringify(b.text.slice(0, +w || 110)));
