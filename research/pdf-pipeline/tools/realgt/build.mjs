// Builds ground truth for real PDFs from hand-written region specs (specs.mjs).
// Procedure (reproducible): pdf.js text lines are assigned to the first region (in reading order)
// whose rectangle contains the line centre; region lines are sorted top-to-bottom; paragraphs are
// split by first-line indent and/or vertical gap; line-end hyphens are joined unless listed in
// `keepHyphen`; `fix` string replacements remove glued footnote markers etc. Every region and every
// join was checked by eye against the rendered page image. Unassigned lines are reported.
import fs from 'fs';
import { pageLines } from './pdflines.mjs';
import { specs } from './specs.mjs';
const OUT = new URL('../../corpus/real/', import.meta.url).pathname;
const only = process.argv[2];
for (const spec of specs) {
  if (only && spec.id !== only) continue;
  const segs = []; const joins = []; const unassigned = [];
  for (const [pnStr, regions] of Object.entries(spec.pages)) {
    const pn = +pnStr; const { lines } = await pageLines(spec.file, pn);
    const buckets = regions.map(() => []);
    for (const l of lines) {
      const k = regions.findIndex(([, r]) => l.cx >= r[0] && l.cx <= r[2] && l.cy >= r[1] && l.cy <= r[3]);
      if (k < 0) unassigned.push(`p${pn} (${l.x.toFixed(0)},${l.yb.toFixed(0)}) ${l.s.slice(0, 60)}`); else buckets[k].push(l);
    }
    regions.forEach(([type, r, o = {}], k) => {
      const L = buckets[k].sort((a, b) => a.yb - b.yb || a.x - b.x);
      // merge lines on same baseline within the region (e.g. superscripts split off)
      const rows = [];
      for (const l of L) { const last = rows[rows.length - 1]; if (last && Math.abs(last.yb - l.yb) < Math.max(3, 0.45 * Math.max(l.h, last.parts[0].h))) { last.parts.push(l); } else rows.push({ yb: l.yb, parts: [l] }); }
      const rl = rows.map(rw => { rw.parts.sort((a, b) => a.x - b.x); return { s: rw.parts.map(p => p.s).join(' '), x: rw.parts[0].x, x2: rw.parts[rw.parts.length - 1].x2, yb: rw.yb, h: Math.max(...rw.parts.map(p => p.h)) }; });
      if (!rl.length) { if (!o.optional) unassigned.push(`EMPTY REGION p${pn} ${type} ${r}`); return; }
      const split = o.split ?? (['paragraph', 'footnote', 'reference', 'list-item'].includes(type) ? 'indent' : 'none');
      const minX = Math.min(...rl.map(l => l.x)), maxX2 = Math.max(...rl.map(l => l.x2));
      const gaps = rl.slice(1).map((l, i) => l.yb - rl[i].yb).sort((a, b) => a - b); const medGap = gaps.length ? gaps[gaps.length >> 1] : 0;
      let paras = [[]];
      rl.forEach((l, i) => {
        if (i > 0) {
          const prev = rl[i - 1];
          const ind = l.x > minX + (o.indent ?? 4) && (split === 'indent' || split === 'both');
          const gap = (split === 'gap' || split === 'both') && l.yb - prev.yb > medGap * 1.35;
          const startsMark = split === 'marker' && /^(\d+|[a-z]|\*|†|‡|•|[A-Z]\.|\(\w+\))[.)]?\s/.test(l.s);
          if (ind || gap || startsMark || split === 'line') paras.push([]);
        }
        paras[paras.length - 1].push(l);
      });
      paras.forEach((p, pi) => {
        let text = '';
        p.forEach((l, i) => {
          if (!text) { text = l.s; return; }
          const m = text.match(/(\S+)-$/);
          if (m && /^[a-zäöüßàâçéèêëîïôûùüÿœ]/.test(l.s)) {
            const nextWord = l.s.split(' ')[0]; const hyph = m[1] + '-' + nextWord.replace(/[^\p{L}-]+$/u, '');
            const keep = (spec.keepHyphen || []).some(k => hyph.toLowerCase().startsWith(k.toLowerCase()));
            joins.push(`${keep ? 'KEEP' : 'join'} ${hyph}`);
            text = keep ? text + l.s : text.slice(0, -1) + l.s;
          } else text += ' ' + l.s;
        });
        for (const [a, b] of spec.fix || []) text = text.split(a).join(b);
        text = text.replace(/\s+/g, ' ').trim();
        const prev = [...segs].reverse().find(x => x.type === type);
        if (pi === 0 && o.cont && prev && prev.type === type) prev.text += (prev.text.endsWith('-') ? '' : ' ') + text;
        else segs.push({ type, level: o.level, text, page: pn });
      });
    });
  }
  const gt = { id: spec.id, kind: spec.kind, title: spec.title, source: spec.source, pages: Object.keys(spec.pages).map(Number), segments: segs, chrome: spec.chrome || [] };
  fs.writeFileSync(OUT + spec.id + '.gt.json', JSON.stringify(gt, null, 1));
  console.log(`## ${spec.id}: ${segs.length} segments; unassigned ${unassigned.length}`);
  if (process.argv.includes('-v')) { for (const s of segs) console.log(`  [${s.type}${s.level ? s.level : ''}] ${s.text.slice(0, 110)}${s.text.length > 110 ? ' … ' + s.text.slice(-50) : ''}`); joins.forEach(j => console.log('   ', j)); }
  unassigned.forEach(u => console.log('   UNASSIGNED', u));
}
