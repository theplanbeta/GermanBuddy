// Ablation: which styles move the voice measurably? Each test line rendered plain, plain at two
// other voice rows (natural render-to-render variation), and in each preset.
//   BACKEND=web node abl.mjs  -> abl/*.wav, then python3 -I analyze.py --json abl/*.wav
import fs from 'node:fs';
import { engine, renderRaw, vocabulary, writeWav } from './pipe.mjs';
import { textToPhonemes, keepKnown } from './app/src/engine/phonemes.js';
import { perfFor } from './app/src/director/director.js';
import { styleShift, styledSpeed, afterEffects } from './app/src/director/styles.js';
import { toInt16 } from './app/src/reader/audio.js';
await engine('uint8');
const LINES = (process.env.LINES || "Oh, come on, Sarah!|What is it this time?|I'm serious.|Sarah, please… say something.|There's someone in the house.|Yes?|Yeah. I really do.|I am going to kill you.").split('|');
const extra = process.env.PRESETS ? JSON.parse(process.env.PRESETS) : {};
const variants = process.env.PRESETS ? { plain: null, ...extra } : { plain: null, rowA: 'rowA', rowB: 'rowB', laugh: ['laugh'], soft: ['soft'], tremble: ['tremble'], sigh: ['sigh'], excited: ['excited'], whisper: ['whisper'], shout: ['shout'], slow: ['slow'], ...extra };
const voice = process.env.VOICE || 'af_heart';
for (const [li, line] of LINES.entries()) {
  const ph = keepKnown(await textToPhonemes(line, 'a'), vocabulary());
  const n = [...ph].length;
  for (const [name, v] of Object.entries(variants)) {
    let style = perfFor([]);
    let row = n;
    if (v === 'rowA') row = n + 12; else if (v === 'rowB') row = Math.max(1, n - 12);
    else if (Array.isArray(v)) style = perfFor(v);
    else if (v && typeof v === 'object') style = { ...perfFor([]), ...v };
    const r = await renderRaw({ phonemes: ph, voice, speed: styledSpeed(style, 1), row, shift: styleShift(style, n) });
    writeWav(`${process.env.OUT || 'abl'}/L${li}_${name}.wav`, toInt16(afterEffects(r.samples, style)));
  }
}
fs.writeFileSync('abl/lines.json', JSON.stringify(LINES));
