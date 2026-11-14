// Builds ./app/src: a copy of the app's own modules (listen-app/src) with the fiction
// director prototype (research/dialogue-hybrid/kokoro/director) placed beside the app's
// director, which is the layout pipe.mjs and render_scene.mjs expect. Nothing outside
// this folder is changed. Run again after the app or the prototype changes.
import fs from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const appSrc = new URL('../../../listen-app/src/', import.meta.url).pathname;
const director = new URL('../../dialogue-hybrid/kokoro/director/', import.meta.url).pathname;

fs.rmSync(`${here}app`, { recursive: true, force: true });
fs.cpSync(appSrc, `${here}app/src`, { recursive: true });
for (const f of ['director_fiction.js', 'speakers.js']) {
  fs.copyFileSync(`${director}${f}`, `${here}app/src/director/${f}`);
}
fs.mkdirSync(`${here}out`, { recursive: true });
console.log('app/src ready (app modules + fiction director); out/ ready');
