// Unit tests: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { buildLines, xycut, findGutters } from '../lib/geometry.js';
import { normalizeText, listeningItems, DEFAULT_SETTINGS } from '../lib/listen.js';
import { stitchGlue, applyGlue, StreamStitcher, makeDehyphenator, DocModel } from '../lib/pdf-layer.js';
import { textToBlocks, formatOf } from '../lib/formats.js';
import { ocrDecision } from '../lib/hearshot-doc.js';
import { score } from '../harness/score.mjs';

const span = (s, x, yb, h = 10, w = s.length * 5) => ({ s, x, x2: x + w, yb, h });

test('buildLines joins words on a baseline and keeps columns apart at a gutter', () => {
  const L = buildLines([span('Hello', 10, 100), span('world', 40, 100), span('Right', 300, 100)], { gutters: [[200, 280]] });
  assert.deepEqual(L.map(l => l.s), ['Hello world', 'Right']);
});
test('buildLines marks raised small items as superscripts', () => {
  const L = buildLines([span('word', 10, 100), { s: '12', x: 31, x2: 37, yb: 96, h: 6 }]);
  assert.equal(L.length, 1); assert.ok(L[0].spans.find(s => s.s === '12').sup);
});
test('xycut reads the left column before the right column', () => {
  const lines = []; for (let i = 0; i < 5; i++) { lines.push({ s: 'L' + i, x: 50, x2: 250, top: 100 + i * 12, bot: 110 + i * 12, yb: 110 + i * 12, h: 10 }); lines.push({ s: 'R' + i, x: 300, x2: 500, top: 100 + i * 12, bot: 110 + i * 12, yb: 110 + i * 12, h: 10 }); }
  assert.deepEqual(xycut(lines).map(l => l.s), ['L0', 'L1', 'L2', 'L3', 'L4', 'R0', 'R1', 'R2', 'R3', 'R4']);
});
test('findGutters finds the gap between two columns', () => {
  const spans = []; for (let i = 0; i < 20; i++) { spans.push(span('leftcolumntext', 50, 100 + i * 12, 10, 200)); spans.push(span('rightcolumntext', 270, 100 + i * 12, 10, 200)); }
  const g = findGutters(spans, 520); assert.equal(g.length, 1); assert.ok(g[0][0] >= 250 && g[0][1] <= 270);
});
test('normalizeText: citations, abbreviations, URLs, bullets, all caps, letter spacing', () => {
  assert.equal(normalizeText('As shown in Fig. 4 and [12], see Smith et al. for details (Lee et al., 2020).'), 'As shown in Figure 4 and, see Smith et al for details.');
  assert.equal(normalizeText('Details at https://www.example.org/a/b?c=1.'), 'Details at link to example.org.');
  assert.equal(normalizeText('• First point'), 'First point');
  assert.equal(normalizeText('THE LONG STORY OF RIVERS', { type: 'heading' }), 'The Long Story Of Rivers.');
  assert.equal(normalizeText('F E A T U R E story'), 'FEATURE story');
  assert.equal(normalizeText('i.e. this, e.g. that'), 'that is, this, for example, that');
  assert.equal(normalizeText('ﬁnal  text­book'), 'final textbook');
});
test('stitchGlue joins continued paragraphs and de-hyphenates across breaks', () => {
  const a = { type: 'paragraph', text: 'the results were incon-', size: 10, page: 1 };
  const b = { type: 'paragraph', text: 'clusive for all groups.', size: 10, page: 2 };
  const g = stitchGlue(a, b, true); assert.equal(g, 'hyphen'); assert.equal(applyGlue(a.text, g, b.text), 'the results were inconclusive for all groups.');
  assert.equal(stitchGlue({ ...a, text: 'It ended.' }, b, true), null);
  assert.equal(stitchGlue({ ...a, text: 'an All-' }, { ...b, text: 'American end' }, true), '');
});
test('StreamStitcher links instead of merging and listeningItems re-joins', () => {
  const st = new StreamStitcher();
  const blocks = [{ blockId: 'p1-b0', page: 1, type: 'paragraph', text: 'This sentence continues on', size: 10, reason: '' }, { blockId: 'p1-b1', page: 1, type: 'header-footer', text: '12', size: 8, reason: '' }, { blockId: 'p2-b0', page: 2, type: 'paragraph', text: 'the next page.', size: 10, reason: '' }].map(b => st.push(b));
  assert.equal(blocks[2].continuesFrom, 'p1-b0');
  const items = listeningItems(blocks, DEFAULT_SETTINGS); assert.equal(items.length, 1); assert.equal(items[0].text, 'This sentence continues on the next page.');
});
test('dehyphenator keeps hyphens that the document itself uses', () => {
  const doc = new DocModel(); doc.vocab.set('mixed-mode', 2);
  const d = makeDehyphenator(doc, 'doc'); assert.equal(d('mixed', 'mode'), false); assert.equal(d('hyphen', 'ation'), true);
});
test('listening settings: skip footnotes, cue tables once, user exclusions, start-from-here', () => {
  const B = [{ blockId: 'a', type: 'heading', text: 'Intro', page: 1 }, { blockId: 'b', type: 'paragraph', text: 'Body.', page: 1 }, { blockId: 'c', type: 'table', text: '1 2 3', page: 1 }, { blockId: 'd', type: 'table', text: '4 5', page: 1 }, { blockId: 'e', type: 'footnote', text: '1 Note.', page: 1 }, { blockId: 'f', type: 'paragraph', text: 'More.', page: 1 }];
  assert.deepEqual(listeningItems(B).map(i => i.text), ['Intro.', 'Body.', 'Table omitted.', 'More.']);
  assert.deepEqual(listeningItems(B, { excluded: ['b'], read: { table: false } }).map(i => i.text), ['Intro.', 'More.']);
  assert.deepEqual(listeningItems(B, { startAt: 'f' }).map(i => i.text), ['More.']);
});
test('formats: sniffing and plain text blocks', () => {
  assert.equal(formatOf('x.pdf', new TextEncoder().encode('%PDF-1.7')), 'pdf');
  assert.equal(formatOf('notes.md', new TextEncoder().encode('# Title')), 'md');
  const b = textToBlocks('CHAPTER ONE\n\nIt was a dark\nand stormy night.\n\n- one\n- two');
  assert.deepEqual(b.map(x => x.type), ['heading', 'paragraph', 'list-item', 'list-item']); assert.equal(b[1].text, 'It was a dark and stormy night.');
});
test('ocrDecision ignores LiteParse sparse-text/embedded-images alone but catches scans and garble', () => {
  assert.equal(ocrDecision({ needsOcr: true, reasons: ['sparse-text'] }, 'A short dedication page.').ocr, false);
  assert.equal(ocrDecision({ needsOcr: true, reasons: ['scanned'] }, '').ocr, true);
  assert.equal(ocrDecision({ reasons: [] }, 'Xkcd prqst wvbn ' + 'tchrst bnmk lkjh '.repeat(10)).ocr, true);
});
test('scorer: perfect output scores 100 on every corpus document', async () => {
  const { corpus } = await import('../harness/corpus.mjs');
  for (const d of corpus()) { const r = score(d.gt, { blocks: d.gt.segments.map(s => ({ page: d.gt.pages ? d.gt.pages[0] : 1, type: s.type === 'neutral' ? 'paragraph' : s.type, text: s.text })) }); assert.ok(r.score >= 99.9, d.id + ' ' + r.score); }
});
