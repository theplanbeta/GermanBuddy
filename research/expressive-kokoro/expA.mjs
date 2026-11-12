import { synthText, writeWav, concat, silence, textToPhonemes, loadTTS } from "./lib.mjs";
const D = "work/A";
const pause = (s) => silence(s);
async function pieces(name, list, gaps) {
  const parts = [];
  for (let i = 0; i < list.length; i++) { parts.push((await synthText(list[i])).audio); if (i < list.length - 1) parts.push(pause(gaps[i])); }
  writeWav(`${D}/${name}.wav`, concat(parts));
}
async function whole(name, text, speed=1) { const r = await synthText(text, {speed}); writeWav(`${D}/${name}.wav`, r.audio); return r; }
// 1. opening sentence: app split vs whole
await pieces("open_split", ["At precisely 7:43 a.m. on Wednesday,", "November 12th, Dr. Müller received an unexpected phone call."], [0.1]);
await whole("open_whole", "At precisely 7:43 a.m. on Wednesday, November 12th, Dr. Müller received an unexpected phone call.");
// 2. long sentence split at 200 chars vs whole
await pieces("long_split", ["Meanwhile, Professor O'Sullivan, a 62-year-old neuroscientist, was explaining the difference between Parkinson's disease, multiple sclerosis,", "and amyotrophic lateral sclerosis to an audience of 1,250 people."], [0.3]);
await whole("long_whole", "Meanwhile, Professor O'Sullivan, a 62-year-old neuroscientist, was explaining the difference between Parkinson's disease, multiple sclerosis, and amyotrophic lateral sclerosis to an audience of 1,250 people.");
// 3. Wait… | WHAT?! split by the app's ellipsis rule vs whole
await pieces("wait_split", ["“Wait…", "WHAT?!” she exclaimed, her voice trembling."], [0.3]);
await whole("wait_whole", "“Wait… WHAT?!” she exclaimed, her voice trembling.");
// 4. short-sentence beat: separate vs grouped
await pieces("beat_separate", ["A glass shattered.", "Everyone froze.", "Three seconds passed.", "Then five."], [0.3, 0.3, 0.3]);
await whole("beat_grouped", "A glass shattered. Everyone froze. Three seconds passed. Then five.");
// 5. token cap: ~700 phoneme input
const tts = await loadTTS();
const long = "The committee, which had been meeting irregularly since the autumn, finally concluded that the proposed infrastructure investments would require substantially more detailed environmental assessments, community consultations, and independent financial reviews before any construction contracts could reasonably be awarded to the competing firms. ".repeat(2) + "This final sentence is the canary.";
const ph = await textToPhonemes(long); const ids = tts.tokenizer(ph, { truncation: true }).input_ids;
const r = await whole("cap_700", long);
console.log("cap test: phoneme chars", ph.length, "tokens incl pads", ids.dims.at(-1), "audio s", (r.audio.length/24000).toFixed(1));
// 6. long-context quality: 3 sentences in one call (~330 phonemes) vs per sentence
const three = ["Outside, the rain was falling gently on the streets of Zürich, while a French tourist struggled to pronounce Eichhörnchen.", "There was a long, uncomfortable silence.", "And somewhere in the distance, a clock struck midnight—once, twice, three times—although nobody could explain why."];
await pieces("three_separate", three, [0.3, 0.3]);
const r3 = await whole("three_one_call", three.join(" "));
console.log("three phonemes", r3.nTokens);
