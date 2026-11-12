// Engine-level speed: same inputs, different onnxruntime session options / model files.
import * as ort from "onnxruntime-node";
import { loadTTS, textToPhonemes, styleRow, voicePack } from "./lib.mjs";
const tts = await loadTTS();
const C = "node_modules/@huggingface/transformers/.cache/onnx-community/";
const files = { fp32: "ext/ts/model.onnx", uint8: C + "Kokoro-82M-v1.0-ONNX/onnx/model_uint8.onnx", q8: C + "Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx" };
const inputs = {};
for (const [k, t] of Object.entries({ short: "Most cities were not designed for the weather they now face.", long: "Most cities were not designed for the weather they now face. Drains that were sized for the storms of the last century overflow several times a year, and streets that once stayed dry now flood within minutes." })) {
  const ph = await textToPhonemes(t); const ids = tts.tokenizer(ph).input_ids; const n = ids.dims.at(-1) - 2;
  inputs[k] = { input_ids: new ort.Tensor("int64", BigInt64Array.from(Array.from(ids.data, BigInt)), ids.dims), style: new ort.Tensor("float32", styleRow(voicePack("af_heart"), n), [1, 256]), speed: new ort.Tensor("float32", [1], [1]) };
}
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
async function bench(label, file, opts) {
  const t0 = performance.now(); const s = await ort.InferenceSession.create(file, opts); const load = performance.now() - t0;
  const out = { label, load: Math.round(load) };
  for (const [k, f] of Object.entries(inputs)) {
    const a = performance.now(); await s.run(f); out[`${k}_first`] = Math.round(performance.now() - a);
    const r = []; for (let i = 0; i < 5; i++) { const b = performance.now(); await s.run(f); r.push(performance.now() - b); } out[k] = Math.round(med(r));
  }
  console.log(JSON.stringify(out)); await s.release?.();
}
for (let rep = 0; rep < 2; rep++) {
  await bench("fp32 defaults", files.fp32, {});
  await bench("fp32 opt=disabled t4", files.fp32, { graphOptimizationLevel: "disabled", intraOpNumThreads: 4 });
  await bench("fp32 opt=all t4", files.fp32, { graphOptimizationLevel: "all", intraOpNumThreads: 4 });
}
