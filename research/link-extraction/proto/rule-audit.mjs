// For each rule/type that the listening filter drops by default: how many of the dropped tokens were actually in the ground-truth article body (harm) vs not (benefit)
import fs from 'fs'; import path from 'path';
import { extractForListening } from './hearshot-extract.mjs';
import { tok } from './score.mjs';
const root = path.resolve('..'); const prefer = process.argv[2] || 'readability';
const items = [];
const g = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); const zlib = await import('zlib');
for (const [id, v] of Object.entries(g)) items.push({ ds: 'aeb', url: v.url, gt: v.articleBody, html: () => zlib.gunzipSync(fs.readFileSync(`${root}/corpora/article-extraction-benchmark/html/${id}.html.gz`)).toString('utf8') });
for (const m of JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json'))) items.push({ ds: 'wceb', url: m.url, gt: m.gt, html: () => fs.readFileSync(root + '/' + m.path, 'utf8') });
const tally = new Map(); const bump = (k, tot, hit) => { const t = tally.get(k) || { blocks: 0, tot: 0, hit: 0 }; t.blocks++; t.tot += tot; t.hit += hit; tally.set(k, t); };
const examples = new Map();
for (const it of items) {
  const r = await extractForListening(it.html(), it.url, { prefer, toggles: {} }); if (!r.ok) continue;
  const gs = new Set(tok(it.gt));
  for (const b of r.blocks) { if (!b.skip) continue; const t = tok(b.text); if (!t.length) continue; const hit = t.filter(x => gs.has(x)).length;
    const k = `${b.type}${b.why ? ' / ' + b.why : ''}`; bump(k, t.length, hit);
    if (!examples.has(k)) examples.set(k, []); if (examples.get(k).length < 3 && t.length < 60) examples.get(k).push((hit / t.length > 0.8 ? '[IN GT] ' : '[not in GT] ') + b.text.slice(0, 90)); }
}
console.log(`extractor=${prefer}; skipped-by-default block classes. "in-GT share" = share of dropped tokens that appear in the ground-truth article (high = harmful rule)`);
for (const [k, v] of [...tally].sort((a, b) => b[1].tot - a[1].tot)) console.log(k.padEnd(34), 'blocks', String(v.blocks).padStart(5), 'tokens', String(v.tot).padStart(7), 'in-GT share', (v.hit / v.tot).toFixed(2), '\n     e.g.', (examples.get(k) || []).join('\n          '));
