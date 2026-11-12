// Baseline: exactly what the app does today (listen-app splitter + per-piece tts.generate
// + reader pauses 0.3 / 0.75 / 0.1 s and 4 ms fades). node baseline.mjs in.txt out.wav [voice]
import { splitText, splitOpening } from "/home/user/GermanBuddy/listen-app/src/text/splitter.js";
import { loadTTS, textToPhonemes, writeWav, concat, SR } from "./lib.mjs";
import fs from "node:fs";
const [inp, outp, voice = "af_heart"] = process.argv.slice(2);
const text = fs.readFileSync(inp, "utf8");
const pieces = splitOpening(splitText(text));
const tts = await loadTTS();
const parts = []; const log = [];
let t = 0;
for (let i = 0; i < pieces.length; i++) {
  const p = pieces[i];
  const a = (await tts.generate(p.text, { voice })).audio;
  const pause = p.para !== pieces[i + 1]?.para ? 0.75 : p.joined ? 0.1 : 0.3;
  const fade = Math.round(0.004 * SR); const s = a.slice();
  for (let k = 0; k < fade; k++) { s[k] *= k / fade; s[s.length - 1 - k] *= k / fade; }
  parts.push(s, new Float32Array(Math.round(pause * SR)));
  const ph = await textToPhonemes(p.text);
  log.push({ i, start: +t.toFixed(2), dur: +(a.length / SR).toFixed(2), pause, chars: p.text.length, phon: ph.length, text: p.text });
  t += a.length / SR + pause;
}
writeWav(outp, concat(parts));
fs.writeFileSync(outp.replace(/\.wav$/, ".pieces.json"), JSON.stringify(log, null, 1));
for (const l of log) console.log(l.i, l.start, l.dur, l.chars, l.phon, l.text);
