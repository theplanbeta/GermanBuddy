import { pageLines } from './pdflines.mjs';
const [f, pages] = [process.argv[2], process.argv[3].split(',').map(Number)];
for (const p of pages) {
  const { lines, W, H } = await pageLines(f, p);
  console.log(`=== page ${p} W${W.toFixed(0)} H${H.toFixed(0)}`);
  const runs = [];
  for (const l of lines.slice().sort((a, b) => a.x - b.x || a.yb - b.yb)) {
    const r = runs.find(r => Math.abs(r.h - l.h) < 0.6 && l.x < r.x2 && l.x2 > r.x && l.yb - r.y1 < l.h * 2.2 && l.yb > r.y1);
    if (r) { r.y1 = l.yb; r.x = Math.min(r.x, l.x); r.x2 = Math.max(r.x2, l.x2); r.n++; r.last = l.s; } else runs.push({ x: l.x, x2: l.x2, y0: l.yb - l.h, y1: l.yb, h: l.h, n: 1, first: l.s, last: l.s });
  }
  runs.sort((a, b) => a.y0 - b.y0 || a.x - b.x);
  for (const r of runs) console.log(`[${r.x.toFixed(0)},${r.y0.toFixed(0)},${r.x2.toFixed(0)},${r.y1.toFixed(0)}] h${r.h.toFixed(1)} n${r.n} | ${r.first.slice(0, 45)}${r.n > 1 ? ' … ' + r.last.slice(-30) : ''}`);
}
