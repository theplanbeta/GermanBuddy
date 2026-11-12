// Inspect the timestamped Kokoro export and compare its audio with the standard model.
import * as ort from "onnxruntime-node";
import { loadTTS, textToPhonemes, styleRow, voicePack, synthPhonemes, writeWav } from "./lib.mjs";
const s = await ort.InferenceSession.create("ext/ts/model.onnx");
console.log("inputs", s.inputNames, "outputs", s.outputNames);
const tts = await loadTTS();
const ph = await textToPhonemes("“Consider this,” he said, deliberately slowing his speech.");
const ids = tts.tokenizer(ph).input_ids; const n = ids.dims.at(-1) - 2;
const style = styleRow(voicePack("af_heart"), n);
const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from(Array.from(ids.data, BigInt)), ids.dims), style: new ort.Tensor("float32", style, [1, 256]), speed: new ort.Tensor("float32", [1], [1]) };
const t0 = Date.now(); const r = await s.run(feeds); console.log("ms", Date.now() - t0);
for (const k of s.outputNames) console.log(k, r[k].type, r[k].dims, Array.from(r[k].data).slice(0, 12));
const ref = (await synthPhonemes(ph, { style })).audio;
const a = r.waveform.data; let m = 0; for (let i = 0; i < Math.min(a.length, ref.length); i++) m = Math.max(m, Math.abs(a[i] - ref[i]));
console.log("len ts", a.length, "std", ref.length, "max abs diff", m);
const d = r[s.outputNames.find((k) => k !== "waveform")].data; const tot = Array.from(d).reduce((x, y) => x + Number(y), 0);
console.log("tokens", ids.dims.at(-1), "durations", d.length, "sum", tot, "samples/unit", (a.length / tot).toFixed(1));
console.log([...("$" + ph + "$")].map((c, i) => `${c}:${Number(d[i]).toFixed(1)}`).join(" "));
