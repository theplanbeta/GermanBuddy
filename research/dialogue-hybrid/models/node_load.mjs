import * as ort from "onnxruntime-node";
for (const f of process.argv.slice(2)) { try { const s = await ort.InferenceSession.create(f); console.log("ok", f); } catch (e) { console.log("FAIL", f, e.message.slice(0, 300)); } }
