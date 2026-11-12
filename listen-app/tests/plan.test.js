// Which sentences go into each model call (the "D4" rules, see src/flow/plan.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCall, chooseStart, sizeRule, freshAhead, takeoverStart, callLength, firstWords, growthLast, MAX_SENTENCES, GROWTH } from '../src/flow/plan.js';

// n sentences with given paragraph numbers and phoneme counts
function doc(paras, n = 100, headN = 8) {
  const sentences = paras.map((para, i) => ({ text: `Sentence number ${i}.`, para }));
  const phonemes = paras.map(() => ({ n, headN }));
  return { sentences, phonemes, fresh: paras.map(() => false) };
}
const FULL = { maxSentences: MAX_SENTENCES, maxMs: Infinity };

test('groups the sentences of a paragraph up to 480 phonemes', () => {
  const d = doc([0, 0, 0, 0, 0, 0, 0]);
  const call = planCall({ ...d, start: 0, rule: FULL });
  // 100 + 101 + 101 + 101 = 403; a fifth would make 504 > 480
  assert.deepEqual([call.first, call.last], [0, 3]);
  assert.equal(callLength(d.phonemes, 0, 3), 403);
});

test('at most 12 sentences per call', () => {
  const d = doc(Array(20).fill(0), 10);
  const call = planCall({ ...d, start: 0, rule: FULL });
  assert.equal(call.last - call.first + 1, 12);
});

test('never crosses a paragraph; a call ending a paragraph has no look-ahead', () => {
  const d = doc([0, 0, 1, 1]);
  const call = planCall({ ...d, start: 0, rule: FULL });
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 1, -1]);
  assert.equal(call.row, 201); // row = phonemes of the call
  assert.equal(call.tokens, 201);
});

test('mid-paragraph calls get two look-ahead words and the virtual row', () => {
  const d = doc([0, 0, 0, 0, 0, 0, 0]);
  const call = planCall({ ...d, start: 0, rule: { maxSentences: 2, maxMs: Infinity } });
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 1, 2]);
  assert.equal(call.tokens, 201 + 1 + 8); // the look-ahead words are sent
  assert.equal(call.row, 201 + 1 + 100); // the row counts the WHOLE next sentence
});

test('the virtual row is capped at the last row of the voice file', () => {
  const d = doc([0, 0, 0, 0, 0, 0], 120);
  const call = planCall({ ...d, start: 0, rule: FULL }); // 120 + 121 + 121 = 362; next would be 483 > 480
  assert.equal(call.last, 2);
  assert.equal(call.lookahead, 3);
  assert.equal(call.row, 362 + 1 + 120);
  const big = doc([0, 0, 0], 400);
  assert.equal(planCall({ ...big, start: 0, rule: FULL }).row, 509); // 400 + 1 + 400
});

test('no look-ahead if it would not fit into the model', () => {
  const d = doc([0, 0], 505, 8);
  const call = planCall({ ...d, start: 0, rule: FULL });
  assert.deepEqual([call.first, call.last, call.lookahead, call.row], [0, 0, -1, 505]);
});

test('a single sentence over the cap still gets its own call', () => {
  const d = doc([0, 0, 0], 100);
  d.phonemes[1].n = 470;
  const call = planCall({ ...d, start: 0, rule: FULL });
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 0, 1]);
  assert.deepEqual([planCall({ ...d, start: 1, rule: FULL }).last], [1]);
});

test('stops before a sentence that is already prepared, but still looks ahead into it', () => {
  const d = doc([0, 0, 0, 0]);
  d.fresh[2] = true;
  const call = planCall({ ...d, start: 0, rule: FULL });
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 1, 2]);
});

test('sentences marked "single" are made alone without look-ahead', () => {
  const d = doc([0, 0, 0, 0]);
  const single = new Set([1]);
  assert.deepEqual([planCall({ ...d, start: 0, rule: FULL, single }).last], [0]);
  const alone = planCall({ ...d, start: 1, rule: FULL, single });
  assert.deepEqual([alone.first, alone.last, alone.lookahead, alone.row], [1, 1, -1, 100]);
});

test('does not stop between two pieces of one sentence, except in the smallest calls', () => {
  const d = doc([0, 0, 0, 0]);
  d.sentences[1].joined = true; // sentence 1 continues in piece 2
  const two = planCall({ ...d, start: 0, rule: { maxSentences: 2, maxMs: Infinity } });
  assert.deepEqual([two.first, two.last], [0, 2]);
  const one = planCall({ ...d, start: 1, rule: { maxSentences: 1, maxMs: Infinity } });
  assert.deepEqual([one.first, one.last, one.lookahead], [1, 1, 2]);
});

test('ramp sizing: 1, 2, 4, then full calls', () => {
  const sizes = [0, 1, 2, 3, 9].map((ordinal) => sizeRule({ ordinal, sizing: 'ramp' }).maxSentences);
  assert.deepEqual(sizes, [1, 2, 4, MAX_SENTENCES, MAX_SENTENCES]);
  // a whole short text in ramp sizing
  const d = doc(Array(9).fill(0), 50);
  const calls = [];
  for (let start = 0, ordinal = 0; start < 9; ordinal++) {
    const c = planCall({ ...d, start, rule: sizeRule({ ordinal, sizing: 'ramp' }) });
    calls.push([c.first, c.last]);
    start = c.last + 1;
  }
  assert.deepEqual(calls, [[0, 0], [1, 2], [3, 6], [7, 8]]);
});

test('adaptive sizing: first call alone, then as much as fits in the waiting audio', () => {
  assert.deepEqual(sizeRule({ ordinal: 0, budgetSeconds: 99, measured: true }), { maxSentences: 1, maxMs: Infinity });
  assert.deepEqual(sizeRule({ ordinal: 3, budgetSeconds: 5, measured: false }), { maxSentences: 1, maxMs: Infinity });
  const rule = sizeRule({ ordinal: 1, budgetSeconds: 5, measured: true }); // 5 s * 80% = 4000 ms
  assert.equal(rule.maxMs, 4000);
  const d = doc(Array(8).fill(0), 100);
  // 10 ms per phoneme: 2 sentences + look-ahead = 210 tokens = 2.1 s; 3 = 311 = 3.1 s; 4 = 412 = 4.1 s
  const predict = (tokens) => tokens * 10;
  const call = planCall({ ...d, start: 0, rule, predict });
  assert.deepEqual([call.first, call.last], [0, 2]);
  // nothing waiting: never less than one sentence
  const none = planCall({ ...d, start: 0, rule: sizeRule({ ordinal: 1, budgetSeconds: 0, measured: true }), predict });
  assert.deepEqual([none.first, none.last], [0, 0]);
  // preparing earlier text after the end: full calls
  assert.equal(sizeRule({ ordinal: 4, budgetSeconds: Infinity, measured: true }).maxMs, Infinity);
});

test('chooseStart works forward from the listener, then wraps round', () => {
  assert.equal(chooseStart([false, false, false, false], 2), 2);
  assert.equal(chooseStart([false, false, true, true], 2), 0);
  assert.equal(chooseStart([true, true, true, true], 2), -1);
  // a sentence heard from an old clip keeps playing and is redone last
  assert.equal(chooseStart([false, false, false, false], 2, 2), 3);
  assert.equal(chooseStart([true, true, false, true], 2, 2), 2);
});

test('fresh audio ahead of the listener; old-voice audio does not count', () => {
  const seconds = [4, 3, 5, 2];
  assert.equal(freshAhead({ fresh: [true, true, true, false], seconds, current: 0, elapsed: 1, start: 3 }), 11);
  assert.equal(freshAhead({ fresh: [false, true, true, false], seconds, current: 0, elapsed: 1, start: 3 }), 8);
  assert.equal(freshAhead({ fresh: [true, true, false, false], seconds, current: 2, start: 2 }), 0);
  assert.equal(freshAhead({ fresh: [false, true, true, true], seconds, current: 2, start: 0 }), Infinity);
});

test('re-planning after a voice change: next sentence, alone, then growing', () => {
  // 8 sentences prepared in the old voice; the listener is in sentence 3.
  const d = doc(Array(8).fill(0), 60);
  const seconds = d.sentences.map(() => 4);
  const start = chooseStart(d.fresh, 3, 3);
  assert.equal(start, 4);
  const budget = freshAhead({ fresh: d.fresh, seconds, current: 3, elapsed: 1, start });
  assert.equal(budget, 0);
  const predict = (tokens) => tokens * 10;
  const first = planCall({ ...d, start, rule: sizeRule({ ordinal: 9, budgetSeconds: budget, measured: true }), predict });
  assert.deepEqual([first.first, first.last, first.lookahead], [4, 4, 5]);
  // once sentence 4 is ready in the new voice, the next call may be larger
  d.fresh[4] = true;
  const budget2 = freshAhead({ fresh: d.fresh, seconds, current: 3, elapsed: 1, start: 5 });
  assert.equal(budget2, 4);
  const second = planCall({ ...d, start: 5, rule: sizeRule({ ordinal: 10, budgetSeconds: budget2, measured: true }), predict });
  assert.ok(second.last > 5);
});

test('takeover starts at the first sentence the new voice can be ready for', () => {
  const seconds = [3, 3, 3, 3, 3, 3, 3, 3];
  const takes = (ms) => () => ms;
  // 1.5 s of work, 2 s left in sentence 3: the very next sentence
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 2, seconds, predictMs: takes(1500) }), 4);
  // 1 s left: sentence 5 (the listener reaches it in 1 + 3 s)
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 1, seconds, predictMs: takes(1500) }), 5);
  // a slow device (8 s per sentence): sentence 6 is reached in 1 + 3 + 3 = 7 s, sentence 7 in 10 s
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 1, seconds, predictMs: takes(8000) }), 7);
  // a sentence already made in the new voice is skipped, never redone
  const fresh = [false, false, false, false, false, true, false, false];
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 1, seconds, predictMs: takes(1500), fresh }), 6);
  // nothing fits before the end: the sentence that comes closest (here the last one)
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 0, seconds, predictMs: takes(99999) }), 7);
  // a sentence with nothing to play yet: the listener will wait there, so start there at the latest
  assert.equal(takeoverStart({ start: 4, current: 3, remaining: 0.5, seconds: [3, 3, 3, 3, null, 3], predictMs: takes(5000) }), 4);
});

test('look-ahead text is the first two words without trailing punctuation', () => {
  assert.equal(firstWords('Drains that were sized for the storms.'), 'Drains that');
  assert.equal(firstWords('Then five.'), 'Then five');
  assert.equal(firstWords('But together, they buy time.'), 'But together');
});

test('urgent calls are plain: the sentence alone, no look-ahead, its own row', () => {
  const d = doc([0, 0, 0]);
  const call = planCall({ ...d, start: 0, rule: FULL, plain: true });
  assert.deepEqual([call.first, call.last, call.lookahead, call.row, call.tokens, call.plain], [0, 0, -1, 100, 100, true]);
});

test('calls can be capped in length (shorter calls on the graphics chip)', () => {
  const d = doc(Array(6).fill(0), 60);
  const call = planCall({ ...d, start: 0, rule: FULL, maxPhonemes: 180 }); // 60 + 61 = 121; + 61 = 182 > 180
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 1, 2]); // the look-ahead is kept
  const alone = planCall({ ...doc([0, 0], 300), start: 0, rule: FULL, maxPhonemes: 180 });
  assert.equal(alone.last, 0); // a sentence longer than the cap is still made
});

test('growth floor: the smallest group that prepares clearly faster than it plays', () => {
  // 1.3 s per call + 60 ms per phoneme; 0.07 s of listening per phoneme
  const cost = (n) => 1300 + 60 * n;
  const canExtend = (last) => last < 9;
  const at = (n) => ({ start: 0, canExtend, cost: (l) => cost(n * (l + 1)), listen: (l) => 0.07 * n * (l + 1) });
  // 100-phoneme sentences: 1 -> 7 s / 7.3 s (0.96); 2 -> 14 s / 13.3 s (1.05): two sentences keep up
  assert.equal(growthLast(at(100)), 1);
  // a slower device (+50%): 1 -> 0.64 ... 10 -> 0.76; none keeps up, so the smallest group within 3% of the
  // best (0.76 * 0.97 = 0.737): 5 sentences
  assert.equal(growthLast({ ...at(100), cost: (l) => 1.5 * cost(100 * (l + 1)) }), 4);
  // a fast device: one sentence is already enough
  assert.equal(growthLast({ ...at(100), cost: (l) => 10 * 100 * (l + 1) }), 0);
  assert.equal(GROWTH, 1);
  // with a budget-limited rule the floor still applies
  const d = doc(Array(8).fill(0), 100);
  const call = planCall({ ...d, start: 0, rule: { maxSentences: 12, maxMs: 0 }, predict: (t) => 1300 + 60 * t, listenPerToken: 0.07 });
  assert.equal(call.last, 1); // 2 sentences + look-ahead: 14.07 s of listening for 13.8 s of work
});

// ---- phase B: deliveries from the director (rule 5) ----

const PLAIN = { key: '' };
const SLOW = { key: 'en speed0.85', quoted: true };
const SPLICED = { key: 'spliced', spliced: true };

test('sentences with different deliveries never share a call', () => {
  const d = doc([0, 0, 0, 0, 0, 0], 50);
  const deliveries = [PLAIN, PLAIN, SLOW, SLOW, PLAIN, PLAIN];
  const plan = (start) => planCall({ ...d, start, rule: FULL, deliveries });
  // the plain pair stops before the slow sentences, and takes no look-ahead from them
  assert.deepEqual([plan(0).first, plan(0).last, plan(0).lookahead, plan(0).row], [0, 1, -1, 101]);
  assert.deepEqual([plan(2).first, plan(2).last, plan(2).lookahead, plan(2).row], [2, 3, -1, 101]);
  assert.deepEqual([plan(4).first, plan(4).last], [4, 5]);
});

test('a styled call looks ahead into the same style, with the row of what is sent (no virtual row)', () => {
  const d = doc([0, 0, 0, 0], 50, 8);
  const deliveries = [SLOW, SLOW, SLOW, SLOW];
  const call = planCall({ ...d, start: 0, rule: { maxSentences: 2, maxMs: Infinity }, deliveries });
  assert.deepEqual([call.first, call.last, call.lookahead], [0, 1, 2]);
  assert.equal(call.tokens, 101 + 1 + 8);
  assert.equal(call.row, call.tokens); // a plain call would use 101 + 1 + 50
});

test('a sentence whose delivery changes inside it is always a call of its own', () => {
  const d = doc([0, 0, 0, 0], 50);
  const deliveries = [PLAIN, SPLICED, PLAIN, PLAIN];
  const before = planCall({ ...d, start: 0, rule: FULL, deliveries });
  assert.deepEqual([before.first, before.last, before.lookahead, before.row], [0, 0, -1, 50]); // no look-ahead into it
  const spliced = planCall({ ...d, start: 1, rule: FULL, deliveries });
  assert.deepEqual([spliced.first, spliced.last, spliced.lookahead, spliced.row, spliced.spliced], [1, 1, -1, 50, true]);
  assert.equal(planCall({ ...d, start: 1, rule: FULL, deliveries, plain: true }).spliced, true);
  const after = planCall({ ...d, start: 2, rule: FULL, deliveries });
  assert.deepEqual([after.first, after.last], [2, 3]);
});

test('short calls of quoted speech get no virtual row; longer ones and narration do', () => {
  const QUOTE = { key: '', quoted: true };
  const one = { maxSentences: 1, maxMs: Infinity };
  const short = doc([0, 0, 0], 30, 8);
  const quoted = planCall({ ...short, start: 0, rule: one, deliveries: [QUOTE, PLAIN, PLAIN] });
  assert.deepEqual([quoted.lookahead, quoted.row], [1, quoted.tokens]);
  const narration = planCall({ ...short, start: 0, rule: one, deliveries: [PLAIN, PLAIN, PLAIN] });
  assert.deepEqual([narration.lookahead, narration.row], [1, 30 + 1 + 30]);
  const long = doc([0, 0, 0], 100, 8);
  const longQuote = planCall({ ...long, start: 0, rule: one, deliveries: [QUOTE, QUOTE, PLAIN] });
  assert.equal(longQuote.row, 100 + 1 + 100);
});

test('without deliveries (or all plain) the plan is exactly as before', () => {
  const d = doc([0, 0, 0, 0, 0, 0, 0]);
  for (const rule of [FULL, { maxSentences: 2, maxMs: Infinity }]) {
    const without = planCall({ ...d, start: 0, rule });
    const plain = planCall({ ...d, start: 0, rule, deliveries: d.sentences.map(() => ({ key: '', spliced: false, quoted: false })) });
    assert.deepEqual(plain, without);
  }
});
