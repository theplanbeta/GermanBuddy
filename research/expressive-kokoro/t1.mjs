import { loadTTS, textToPhonemes, synthText, writeWav } from "./lib.mjs";
const tts = await loadTTS();
for (const s of ["Wait… WHAT?!", "At precisely 7:43 a.m. on Wednesday, November 12th, Dr. Müller received an unexpected phone call."]) console.log(await textToPhonemes(s));
let t=Date.now(); const s="Everyone froze. Three seconds passed. Then five.";
const r = await tts.generate(s, {voice:"af_heart"}); console.log("gen", (Date.now()-t)/1000);
const r1 = await tts.generate(s, {voice:"af_heart"});
const r2 = await synthText(s);
const d=(a,b)=>{let m=0;for(let i=0;i<Math.min(a.length,b.length);i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m};
console.log(r.audio.length, r1.audio.length, r2.audio.length, "maxdiff gen/gen", d(r.audio,r1.audio), "gen/mine", d(r.audio,r2.audio));
