import fs from 'fs';
const C = new URL('../corpus/', import.meta.url).pathname;
const REAL_PDF = { 'real-tracemonkey': 'tracemonkey.pdf', 'real-freeculture': 'freeculture.pdf', 'real-fedreg': 'federal-register-2020-17221.pdf', 'real-scotus': 'scotus-transcript-p1.pdf', 'real-pv-fr': '2023-06-20-PV.pdf', 'real-multicolumn': 'multicolumn.pdf' };
export function corpus() {
  const docs = [];
  for (const dir of ['synth', 'real', 'omni']) {
    for (const f of fs.readdirSync(C + dir).filter(f => f.endsWith('.gt.json')).sort()) {
      const gt = JSON.parse(fs.readFileSync(C + dir + '/' + f, 'utf8'));
      const pdf = dir === 'real' ? C + 'real/' + REAL_PDF[gt.id] : C + dir + '/' + gt.id + '.pdf';
      docs.push({ id: gt.id, group: dir, kind: gt.kind, pdf, gt });
    }
  }
  return docs;
}
