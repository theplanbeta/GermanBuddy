import { direct } from "./director.mjs";
import fs from "node:fs";
for (const c of direct(fs.readFileSync(process.argv[2], "utf8"))) console.log(c.pauseAfter, c.kind, c.lang, c.speaker ?? "-", JSON.stringify(c.tags), JSON.stringify(c.perf).replace(/"(\w+)":/g,"$1:").replace(/,?\w+:0|,?tremolo:null|,?speed:1(?=[,}])/g,""), "|", c.text);
