// Faithfulness check: the scene rendered in Node with the UNCHANGED director (copy of today's
// director.js), (1) with the very calls the browser app made (from prank_A_today.json) and
// (2) with the Node planner's own calls (planAll), then compared with prank_A_today.wav.
//   node faith.mjs
import fs from 'node:fs';
import { splitText, splitOpening } from './app/src/text/splitter.js';
import { direct } from './app/src/director/director_today.js';
import { engine, renderAll, writeWav, phonemize, planAll, BACKEND } from './pipe.mjs';

const W = new URL('.', import.meta.url).pathname;
const A = JSON.parse(fs.readFileSync(`${W}prank_A_today.json`, 'utf8'));
const sentences = splitOpening(splitText(fs.readFileSync(`${W}prank.txt`, 'utf8').trim()));
await engine('uint8');
const deliveries = direct(sentences);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
console.log('sentences same as app:', same(sentences, A.sentences), sentences.length, A.sentences.length);
console.log('deliveries same as app:', same(deliveries, A.deliveries));
const known = await phonemize(deliveries);
const appKnown = A.phonemes['a+'];
console.log('phonemes same as app:', known.every((k, i) => same(k, appKnown[i])), known.filter((k, i) => !same(k, appKnown[i])).length, 'differ');

// The calls whose clips ended up in the download: for each sentence the last call covering it.
const owner = new Array(sentences.length).fill(-1);
A.calls.forEach((c, j) => { for (let i = c.first; i <= c.last; i++) owner[i] = j; });
const used = [...new Set(owner)].sort((a, b) => a - b).map((j) => A.calls[j]);
console.log('app calls', A.calls.length, 'in the download', used.length);
const mine = planAll(sentences, known, deliveries);
const k = (c) => `${c.first}-${c.last}/${c.lookahead}/${c.row}/${c.tokens}/${Boolean(c.spliced)}`;
const byFirst = (a, b) => a.first - b.first; mine.sort(byFirst); const usedSorted = [...used].sort(byFirst);
console.log('Node planner calls', mine.length, 'same as the download calls:', same(mine.map(k), usedSorted.map(k)));
for (let j = 0; j < Math.max(mine.length, used.length); j++) if (k(mine[j] ?? {}) !== k(usedSorted[j] ?? {})) console.log('   differs', j, mine[j] && k(mine[j]), usedSorted[j] && k(usedSorted[j]));

if (process.env.NORENDER) process.exit(0);
const r = await renderAll({ sentences, deliveries, calls: used, log: () => {} });
writeWav(`${W}node_A_replay_${BACKEND}.wav`, r.pcm);
fs.writeFileSync(`${W}node_A_replay_${BACKEND}.json`, JSON.stringify({ sentences, deliveries, starts: r.starts, calls: r.calls }, null, 1));
console.log('wrote node_A_replay_${BACKEND}.wav', (r.pcm.length / 24000).toFixed(2), 's');
