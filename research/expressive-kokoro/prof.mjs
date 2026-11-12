// Where the time goes inside one Kokoro call: onnxruntime-node profiling, grouped by module path.
import * as ort from "onnxruntime-node";
import fs from "node:fs";
import { loadTTS, textToPhonemes, styleRow, voicePack } from "./lib.mjs";
const tts = await loadTTS();
const texts = { short: "Most cities were not designed for the weather they now face.", long: fs.readFileSync("work/prose_long.txt", "utf8").split(/(?<=\.)\s/).slice(0, 5).join(" ") };
for (const [label, text] of Object.entries(texts)) {
  const ph = await textToPhonemes(text); const ids = tts.tokenizer(ph, { truncation: true }).input_ids; const n = ids.dims.at(-1) - 2;
  const s = await ort.InferenceSession.create("ext/ts/model.onnx", { enableProfiling: true, profileFilePrefix: `work/prof/${label}`, intraOpNumThreads: 4 });
  const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from(Array.from(ids.data, BigInt)), ids.dims), style: new ort.Tensor("float32", styleRow(voicePack("af_heart"), n), [1, 256]), speed: new ort.Tensor("float32", [1], [1]) };
  await s.run(feeds); // warm-up (also profiled; we keep only the last run)
  const t0 = performance.now(); const r = await s.run(feeds); const ms = performance.now() - t0;
  const file = s.endProfiling();
  console.log(label, "n", n, "audio s", (r.waveform.data.length / 24000).toFixed(1), "run ms", ms.toFixed(0), "profile", file);
}
