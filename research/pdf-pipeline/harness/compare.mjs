// node harness/compare.mjs A B  -> per-doc score/loss/extra/order/paraF1/headF1 side by side from out/results
import fs from 'fs';
const R = new URL('../out/results/', import.meta.url).pathname;
const [a, b] = process.argv.slice(2).map(n => JSON.parse(fs.readFileSync(R + n + '.json')));
const f = (r) => `${r.score.toFixed(1).padStart(5)} L${r.loss.toFixed(2)} X${r.extra.toFixed(2)} O${r.order.toFixed(2)} P${r.paraF1.toFixed(2)} H${r.headF1.toFixed(2)}`;
for (let i = 0; i < a.length; i++) console.log(a[i].id.padEnd(28), f(a[i]), ' | ', f(b[i]), (b[i].score - a[i].score).toFixed(1).padStart(6), JSON.stringify(b[i].leakByType));
