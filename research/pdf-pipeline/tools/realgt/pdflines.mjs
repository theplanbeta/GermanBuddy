// pdf.js text items -> lines in top-left page coordinates (points). Used only to author ground truth.
import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
export async function pageLines(file, pageNo) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const pg = await doc.getPage(pageNo); const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  const items = tc.items.filter(i => i.str && i.str.trim()).map(i => { const h = Math.hypot(i.transform[2], i.transform[3]) || Math.abs(i.transform[3]); const [x, yb] = vp.convertToViewportPoint(i.transform[4], i.transform[5]); return { s: i.str, x, x2: x + i.width, yb, h, top: yb - h * 0.8 }; });
  items.sort((a, b) => a.yb - b.yb || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const l = lines.find(l => Math.abs(l.yb - it.yb) < Math.max(l.h, it.h) * 0.4 && it.x >= l.x2 - 2 && it.x - l.x2 < Math.max(l.h, it.h) * 0.9);
    if (l) { l.s += (it.x - l.x2 > l.h * 0.12 && !l.s.endsWith(' ') && !it.s.startsWith(' ') ? ' ' : '') + it.s; l.x2 = Math.max(l.x2, it.x2); l.h = Math.max(l.h, it.h); }
    else lines.push({ ...it });
  }
  await (doc.cleanup?.() ?? null);
  return { lines: lines.map(l => ({ ...l, s: l.s.replace(/\s+/g, ' ').trim(), cy: l.yb - l.h * 0.35, cx: (l.x + l.x2) / 2 })), W: vp.width, H: vp.height };
}
if (process.argv[1].endsWith('pdflines.mjs')) {
  const { lines, W, H } = await pageLines(process.argv[2], +process.argv[3]);
  console.log('W', W.toFixed(0), 'H', H.toFixed(0));
  for (const l of lines) console.log(`${l.x.toFixed(0).padStart(4)} ${l.x2.toFixed(0).padStart(4)} ${l.yb.toFixed(0).padStart(4)} ${l.h.toFixed(1).padStart(5)} | ${l.s.slice(0, +process.argv[4] || 100)}`);
}
