import { loadTTS } from "./lib.mjs";
const tts = await loadTTS();
const s = tts.model.sessions; console.log(Object.keys(s));
for (const k in s) console.log(k, s[k].inputNames, s[k].outputNames);
