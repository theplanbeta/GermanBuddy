import { textToPhonemes } from "./lib.mjs";
for (const s of process.argv.slice(2)) console.log(JSON.stringify(s), "=>", await textToPhonemes(s));
