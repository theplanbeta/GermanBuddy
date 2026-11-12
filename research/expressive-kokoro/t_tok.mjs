import { direct } from "./director.mjs"; import * as L from "./lib.mjs"; import fs from "node:fs";
const t = await L.loadTTS();
for (const c of direct(fs.readFileSync("../stress.txt", "utf8"), { mergeMild: true })) { const ph = await L.textToPhonemes(c.text); const n = t.tokenizer(ph).input_ids.dims.at(-1) - 2; if (n !== [...ph].length) console.log(n, [...ph].length, [...ph].filter(ch => !t.tokenizer.model.vocab?.[ch] && t.tokenizer.model.tokens_to_ids?.get(ch) === undefined).join(""), c.text); }
