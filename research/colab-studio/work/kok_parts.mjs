// Kokoro renders of single parts through the dialogue folder's app pipeline (read-only import), same
// style rules and per-voice gains as prank_C_voices. BACKEND=web node kok_parts.mjs jobs.json outdir
// job: {name, text, voice, style}
import fs from 'node:fs';
// Workbench copy of research/dialogue-hybrid/models/hybrid/kok_parts.mjs; only this folder path differs.
const D = new URL('.', import.meta.url).pathname;
fs.mkdirSync(process.argv[3], { recursive: true });
const { engine, renderRaw, vocabulary, writeWav } = await import(D + 'pipe.mjs');
const { textToPhonemes, keepKnown } = await import(D + 'app/src/engine/phonemes.js');
const { styleShift, styledSpeed, afterEffects } = await import(D + 'app/src/director/styles.js');
const { gainRamp } = await import(D + 'app/src/flow/signal.js');
const { toInt16 } = await import(D + 'app/src/reader/audio.js');
const GAIN = { af_aoede: -4.9, am_fenrir: -3.1 }; // as render_scene.mjs (variant C)
const [jobsF, out] = process.argv.slice(2);
await engine('uint8');
const PLAIN = { whisper: 0, firm: 0, pitch: 0, speed: 1, gainDb: 0, shelfDb: 0 };
for (const j of JSON.parse(fs.readFileSync(jobsF, 'utf8'))) {
  const style = { ...PLAIN, ...(j.style || {}) }; const voice = j.voice || 'af_heart';
  const ph = keepKnown(await textToPhonemes(j.text, 'a'), vocabulary()); const n = [...ph].length;
  const t0 = performance.now();
  const r = await renderRaw({ phonemes: ph, voice, speed: styledSpeed(style, 1), row: n, shift: styleShift(style, n) });
  let s = afterEffects(r.samples, style); if (!j.noGain && GAIN[voice]) s = gainRamp(s, GAIN[voice]);
  writeWav(`${out}/${j.name}.wav`, toInt16(s));
  console.log(j.name, (s.length / 24000).toFixed(2), ((performance.now() - t0) / 1000).toFixed(2));
}
