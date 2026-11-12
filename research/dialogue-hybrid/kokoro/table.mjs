// Sentence table for B and C: speaker, voice (C), delivery, designed / measured pause after.
import fs from 'node:fs';
import { speakerTable } from './app/src/director/director_fiction.js';
const B = JSON.parse(fs.readFileSync('prank_B_director.json')), C = JSON.parse(fs.readFileSync('prank_C_voices.json'));
const PB = JSON.parse(fs.readFileSync('prank_B_director.pauses.json')), PC = JSON.parse(fs.readFileSync('prank_C_voices.pauses.json'));
const sp = speakerTable(B.sentences);
const whoOf = new Map(sp.table.map((r) => [r.para, r]));
const NAMES = { 'whisper1.1 speed0.92': 'whisper', 'firm0.6 pitch0.55 speed1.06 gainDb4 shelfDb3': 'raised', 'firm0.6 pitch0.55 speed1.0918 gainDb4.5 shelfDb3': 'raised+!', 'firm0.3 pitch0.3 speed1.03 gainDb1.5': 'excited(light)', 'pitch0.35 speed1.04 gainDb1': 'laugh(light)', 'whisper0.6 speed0.95 gainDb-1': 'shaky(light)', 'whisper0.6 gainDb-3': 'soft', 'whisper0.6 speed0.93 gainDb-3': 'soft+calm' };
const st = (p) => { const k = Object.entries(p.style).filter(([k, v]) => v && !(k === 'speed' && v === 1)).map(([k, v]) => `${k}${v}`).join(' '); return k ? NAMES[k] ?? k : 'plain'; };
console.log('| # | text | speaker | B delivery | C voice | pause after (designed / measured B / measured C) |');
console.log('|---|---|---|---|---|---|');
B.sentences.forEach((s, i) => {
  const r = whoOf.get(s.para);
  const quote = B.deliveries[i].parts.length;
  const who = r ? `${r.who}${/guess/.test(r.how) ? ' (guess)' : ''}` : 'narrator';
  const narrOnly = !/[“”"]/.test(s.text) && !C.deliveries[i].parts.some((p) => p.voice);
  const voices = C.deliveries[i].parts.map((p) => p.voice || 'af_heart').join(' + ');
  const pause = i < PB.length ? `${PB[i].design.toFixed(2)} / ${PB[i].measured.toFixed(2)} / ${PC[i].measured.toFixed(2)}` : `${B.pauses[i].toFixed(2)} (end)`;
  console.log(`| ${i} | ${s.text} | ${narrOnly ? 'narrator' : who} | ${B.deliveries[i].parts.map(st).join(' + ')} | ${voices} | ${pause} |`);
});
