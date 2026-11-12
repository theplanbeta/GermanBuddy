// Scorer sanity checks: GT vs itself = 100; known perturbations move the right metrics.
import { corpus } from './corpus.mjs';
import { score } from './score.mjs';
const docs = corpus();
const pick = docs.find(d => d.id === 'syn-paper-2col');
const asOut = (segs) => ({ blocks: segs.map(s => ({ page: s.page || 1, type: s.type === 'neutral' ? 'paragraph' : s.type, text: s.text })) });
const perfect = score(pick.gt, asOut(pick.gt.segments));
console.log('perfect', perfect.score, perfect.loss, perfect.extra, perfect.order, perfect.paraF1, perfect.headF1, perfect.hyph.per1k);
// 1. drop a paragraph
const s1 = pick.gt.segments.filter((s, i) => !(s.type === 'paragraph' && i === 5));
console.log('drop para', JSON.stringify(score(pick.gt, asOut(s1))).slice(0, 120));
// 2. read footnotes and refs (leak)
const s2 = pick.gt.segments.map(s => ({ ...s, type: ['footnote', 'reference', 'caption'].includes(s.type) ? 'paragraph' : s.type }));
const r2 = score(pick.gt, asOut(s2)); console.log('leak all aux', r2.score, 'leak', r2.leak, JSON.stringify(r2.leakByType));
// 3. swap two halves (order)
const segs = pick.gt.segments; const h = segs.length >> 1; const r3 = score(pick.gt, asOut([...segs.slice(h), ...segs.slice(0, h)]));
console.log('swap halves', r3.score, 'order', r3.order, 'jumps', r3.jumpsPer1k);
// 4. merge all paragraphs into one block (para F1)
const r4 = score(pick.gt, { blocks: [{ page: 1, type: 'paragraph', text: segs.filter(s => s.type === 'paragraph').map(s => s.text).join(' ') }] });
console.log('one block', r4.score, 'paraF1', r4.paraF1, 'paraR', r4.paraR);
// 5. hyphenation errors: split some long words
const r5 = score(pick.gt, asOut(segs.map(s => s.type === 'paragraph' ? { ...s, text: s.text.replace(/\b(\w{4})(\w{5,})\b/g, '$1- $2') } : s)));
console.log('split words', r5.score, 'loss', r5.loss, 'hyph', JSON.stringify(r5.hyph).slice(0, 150));
for (const d of docs) { const r = score(d.gt, asOut(d.gt.segments.map(s => ({ ...s, page: d.gt.pages ? d.gt.pages[0] : 1 })))); if (r.score < 99.9) console.log('NOT PERFECT', d.id, r.score, r.loss, r.extra, r.order, r.paraF1, r.headF1); }
console.log('self-check done for', docs.length, 'docs');
