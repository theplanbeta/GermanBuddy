import fs from 'fs'; import path from 'path'; import { scorePage } from './score.mjs';
const root = path.resolve('..'); const b = JSON.parse(fs.readFileSync(root + '/out/browser_results.json'));
const gt = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json'));
const R = JSON.parse(fs.readFileSync(root + '/out/aeb/readability_linkedom.json')), D = JSON.parse(fs.readFileSync(root + '/out/aeb/defuddle_linkedom.json'));
const ids = Object.keys(b).filter(k => k.endsWith('@1')).map(k => k.slice(0, -2)); const m = a => a.reduce((x, y) => x + y, 0) / a.length;
const rows = { 'Readability in Chromium (DOMParser)': ids.map(i => scorePage(gt[i].articleBody, b[i + '@1'].rText || '').f1), 'Readability in Node (linkedom)': ids.map(i => scorePage(gt[i].articleBody, R[i].text).f1), 'Defuddle in Chromium (DOMParser)': ids.map(i => scorePage(gt[i].articleBody, b[i + '@1'].dText || '').f1), 'Defuddle in Node (linkedom)': ids.map(i => scorePage(gt[i].articleBody, D[i].text).f1) };
console.log('n =', ids.length); for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(40), 'mean F1', m(v).toFixed(3));
const same = ids.filter(i => Math.abs(scorePage(R[i].text, b[i + '@1'].rText || '').f1 - 1) < 0.01).length; console.log('Readability browser vs node: identical-ish (agreement F1>0.99) on', same, 'of', ids.length);
