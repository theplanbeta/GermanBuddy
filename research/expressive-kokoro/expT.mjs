import { runVariants, textToPhonemes, toMisaki } from "./lib.mjs";
import fs from "node:fs";
const text = fs.readFileSync("../stress.txt", "utf8").trim();
const sents = ["Meanwhile, Professor O'Sullivan, a 62-year-old neuroscientist, was explaining the difference between Parkinson's disease, multiple sclerosis, and amyotrophic lateral sclerosis to an audience of 1,250 people.",
 "A patient receives 0.75 milligrams of medication every six hours.", "The professor sighed, chuckled softly, and replied, “Well… that was unexpected, wasn't it?”",
 "Most people never finish the articles they save for later. The tab stays open for a week, then quietly disappears.", "I honestly can't believe you did that. Where did you put the keys? We have to leave right now!"];
const V = [];
for (let i = 0; i < sents.length; i++) { const ph = await textToPhonemes(sents[i]); V.push({ name: `t${i}_espeak`, phonemes: ph }, { name: `t${i}_misaki`, phonemes: toMisaki(ph) }); console.log(toMisaki(ph)); }
await runVariants("work/T", V);
