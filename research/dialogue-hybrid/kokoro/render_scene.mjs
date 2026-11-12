// Renders prank.txt with the fiction director in Node, with the app's flow rules (plan.js,
// assemble.js, splice, the app's opening-sentence order) and the app's model and kernels
// (BACKEND=web: onnxruntime-web WASM, uint8).
//   BACKEND=web node render_scene.mjs B      -> prank_B_director.wav/.json
//   BACKEND=web node render_scene.mjs C      -> prank_C_voices.wav/.json
import fs from 'node:fs';
import { splitText, splitOpening } from './app/src/text/splitter.js';
import { direct, pausePlan } from './app/src/director/director_fiction.js';
import { engine, renderAll, writeWav, BACKEND } from './pipe.mjs';

const W = new URL('.', import.meta.url).pathname;
const variant = process.argv[2] || 'B';
export const CAST = { narrator: 'af_heart', male: 'am_fenrir', female: 'af_aoede' };
// level correction so the voices sit at af_heart's speech level (measured on 6 lines, see voicestats.py)
export const GAIN = { af_aoede: -4.9, am_fenrir: -3.1 };
const out = { B: 'prank_B_director', C: 'prank_C_voices' }[variant] ?? `prank_${variant}`;
const sentences = splitOpening(splitText(fs.readFileSync(`${W}prank.txt`, 'utf8').trim()));
const deliveries = direct(sentences, { voices: variant === 'C' ? CAST : null });
const pauses = pausePlan(sentences);
await engine('uint8');
const t0 = Date.now();
const r = await renderAll({ sentences, deliveries, pauseFor: (i) => pauses[i], voiceGainDb: variant === 'C' ? GAIN : {} });
writeWav(`${W}${out}.wav`, r.pcm);
fs.writeFileSync(`${W}${out}.json`, JSON.stringify({ backend: BACKEND, sentences, deliveries, pauses, starts: r.starts, calls: r.calls, phonemes: r.known, wallMs: Date.now() - t0 }, null, 1));
console.log(`${out}: ${(r.pcm.length / 24000).toFixed(2)} s, ${r.calls.length} calls, ${r.calls.reduce((a, c) => a + c.renders, 0)} model runs, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
