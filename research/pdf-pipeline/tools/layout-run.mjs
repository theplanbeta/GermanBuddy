// Runs a PP-DocLayout ONNX model on the rendered corpus pages; writes boxes in PDF points.
import fs from 'fs';
import * as ort from 'onnxruntime-node';
const [model] = process.argv.slice(2); // S | V3
const size = model === 'S' ? 480 : 800;
const yml = fs.readFileSync(`dl/layout/${model}.yml`, 'utf8');
const labels = yml.split('label_list:')[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
const meta = JSON.parse(fs.readFileSync(`out/layout/raw/meta-${size}.json`));
const sess = await ort.InferenceSession.create(`dl/layout/${model}.onnx`, { logSeverityLevel: 3, intraOpNumThreads: 2 });
const mean = model === 'S' ? [0.485, 0.456, 0.406] : [0, 0, 0], std = model === 'S' ? [0.229, 0.224, 0.225] : [1, 1, 1];
const out = {}; const times = [];
for (const [key, m] of Object.entries(meta)) {
  const raw = fs.readFileSync(`out/layout/raw/${key}-${size}.rgb`);
  const img = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) img[c * size * size + i] = (raw[i * 3 + c] / 255 - mean[c]) / std[c];
  const feeds = { image: new ort.Tensor('float32', img, [1, 3, size, size]), scale_factor: new ort.Tensor('float32', new Float32Array([size / m.h, size / m.w]), [1, 2]) };
  if (sess.inputNames.includes('im_shape')) feeds.im_shape = new ort.Tensor('float32', new Float32Array([size, size]), [1, 2]);
  const t = performance.now(); const r = await sess.run(feeds); times.push(performance.now() - t);
  const det = r[sess.outputNames[0]]; const cols = det.dims[1]; const boxes = [];
  for (let k = 0; k < det.dims[0]; k++) { const row = det.data.slice(k * cols, k * cols + cols); if (row[1] < 0.4) continue; boxes.push({ label: labels[row[0]], score: +row[1].toFixed(3), bbox: [row[2], row[3], row[4], row[5]].map(v => +v.toFixed(1)), extra: cols > 6 ? [...row.slice(6)] : undefined }); }
  out[key] = boxes;
}
fs.writeFileSync(`out/layout/boxes-${model}.json`, JSON.stringify(out));
times.sort((a, b) => a - b);
console.log(model, 'pages', times.length, 'median ms', times[times.length >> 1].toFixed(0), 'p90', times[Math.floor(times.length * 0.9)].toFixed(0), 'cols', 'example', JSON.stringify(out['syn-paper-2col-p1']?.slice(0, 3)));
