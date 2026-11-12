// Voice audition: the same dialogue lines in each candidate voice (plain, row = phoneme count).
//   BACKEND=web node audition.mjs -> aud/<voice>__L<i>.wav
import fs from 'node:fs';
import { engine, renderRaw, vocabulary, writeWav } from './pipe.mjs';
import { textToPhonemes, keepKnown } from './app/src/engine/phonemes.js';
import { toInt16 } from './app/src/reader/audio.js';
await engine('uint8');
const LINES = ['Oh, come on, Sarah! What is it this time?', "I can't. He's standing right outside my door.", 'What do you mean, someone? Did you call the police?', "Happy April Fools' Day, you absolute idiot!", 'I am going to kill you.', 'The voice on the other end was barely a whisper.'];
const VOICES = (process.env.VOICES || 'af_heart,af_bella,af_nicole,af_aoede,af_kore,af_sarah,bf_emma,af_bella*0.5+af_kore*0.5,af_nicole*0.5+af_bella*0.5,af_sarah*0.5+af_bella*0.5,am_michael,am_fenrir,am_puck,bm_george,bm_fable,am_michael*0.5+am_fenrir*0.5,am_puck*0.5+am_michael*0.5,am_fenrir*0.5+am_puck*0.5').split(',');
for (const v of VOICES) for (const [i, line] of LINES.entries()) {
  const ph = keepKnown(await textToPhonemes(line, 'a'), vocabulary());
  const r = await renderRaw({ phonemes: ph, voice: v, speed: 1, row: [...ph].length });
  writeWav(`aud/${v.replace(/\*/g, 'x').replace(/\+/g, '_')}__L${i}.wav`, toInt16(r.samples));
}
fs.writeFileSync('aud/lines.json', JSON.stringify(LINES));
