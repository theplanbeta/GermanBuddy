// Cutting one model call into sentences, with designed pauses (src/flow/assemble.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenStarts, assembleCall, designedPause, sentenceAt, KEEP, PARAGRAPH_PAUSE, CLAUSE_PAUSE } from '../src/flow/assemble.js';
import { silentEdges, findGaps } from '../src/flow/signal.js';

const RATE = 24000;
const FRAME = 600;

// Fake model output: every phoneme token is a short tone, every space or
// punctuation token is silence. `members` are joined with spaces between a
// leading and a trailing pad token, as the model sees them. Returns the audio
// and the durations (in frames of 600 samples) the model would report.
function fakeCall(members, { pad = 10, voiced = 3, quiet = 6 } = {}) {
  const tokens = ['$', ...[...members.join(' ')], '$'];
  const durations = tokens.map((t, i) => (i === 0 || i === tokens.length - 1 ? pad : /[ .,!?]/.test(t) ? quiet : voiced));
  const total = durations.reduce((a, b) => a + b, 0) * FRAME;
  const audio = new Float32Array(total);
  let o = 0;
  tokens.forEach((t, i) => {
    const len = durations[i] * FRAME;
    if (i > 0 && i < tokens.length - 1 && !/[ .,!?]/.test(t)) for (let k = 0; k < len; k++) audio[o + k] = 0.3 * Math.sin((2 * Math.PI * 220 * k) / RATE);
    o += len;
  });
  // the model reports slightly unrounded durations
  return { audio, durations: Float32Array.from(durations, (d, i) => d + (i % 3 === 0 ? 0.3 : -0.2)) };
}

// Silence between the speech of sentence k and k + 1 in an assembled clip.
function silenceBetween(samples, offsets, k) {
  const a = samples.subarray(offsets[k], offsets[k + 1]);
  const b = samples.subarray(offsets[k + 1], offsets[k + 2]);
  return silentEdges(a).trail + silentEdges(b).lead;
}

test('token timings: 600 samples per rounded duration, first sample of every token', () => {
  assert.deepEqual(tokenStarts([1.2, 2.6, 0.2], 600 * 5), [0, 600, 2400, 3000]);
  assert.equal(tokenStarts([2, 2], 600 * 9), null); // does not fit the audio
  assert.equal(tokenStarts(null, 1000), null);
});

test('cuts sentences at the token boundaries and sets the designed pauses', () => {
  const members = ['abc.', 'defg.', 'hi.'];
  const { audio, durations } = fakeCall(members);
  const pauses = [0.4, 0.55, 0.85];
  const out = assembleCall({ audio, durations, members, lookahead: false, pauses });
  assert.equal(out.method, 'timings');
  assert.equal(out.offsets.length, 4);
  assert.equal(out.offsets.at(-1), out.samples.length);
  for (let k = 0; k < 2; k++) assert.ok(Math.abs(silenceBetween(out.samples, out.offsets, k) - pauses[k]) < 0.011, `pause ${k}`);
  // each sentence keeps at most 40 ms of the model's own silence before its speech
  for (let k = 0; k < 3; k++) assert.ok(silentEdges(out.samples.subarray(out.offsets[k], out.offsets[k + 1])).lead <= KEEP + 0.011);
  // the speech of every sentence is there: 4, 5 and 3 tones of 3 frames
  const speech = (k) => {
    const seg = out.samples.subarray(out.offsets[k], out.offsets[k + 1]);
    const { lead, trail } = silentEdges(seg);
    return seg.length / RATE - lead - trail;
  };
  assert.ok(Math.abs(speech(0) - (3 * 3 * FRAME) / RATE) < 0.011);
  assert.ok(Math.abs(speech(1) - (4 * 3 * FRAME) / RATE) < 0.011);
});

test('the look-ahead words are cut off and thrown away', () => {
  const members = ['abc.', 'defg.', 'xy'];
  const { audio, durations } = fakeCall(members);
  const out = assembleCall({ audio, durations, members, lookahead: true, pauses: [0.4, 0.5] });
  assert.equal(out.offsets.length, 3); // two sentences
  // nothing after the second sentence but its pause
  const last = out.samples.subarray(out.offsets[1], out.offsets[2]);
  assert.equal(findGaps(last, { minLen: 0.03 }).gaps.length, 0);
  const { trail } = silentEdges(last);
  assert.ok(Math.abs(trail + KEEP - 0.5) < 0.011); // + the next call's 40 ms lead = the designed pause
});

test('falls back to the quiet stretches when there are no timings', () => {
  const members = ['abcdefgh.', 'ijklmnop.'];
  const { audio } = fakeCall(members, { quiet: 12 });
  const out = assembleCall({ audio, durations: null, members, lookahead: false, pauses: [0.4, 0.85] });
  assert.equal(out.method, 'energy');
  assert.ok(Math.abs(silenceBetween(out.samples, out.offsets, 0) - 0.4) < 0.011);
});

test('gives up (null) when the sentences cannot be told apart', () => {
  const tone = new Float32Array(RATE * 2).map((_, k) => 0.3 * Math.sin(k / 5));
  assert.equal(assembleCall({ audio: tone, durations: null, members: ['abc.', 'def.'], lookahead: false, pauses: [0.4, 0.4] }), null);
});

test('inside one split sentence the model’s own pause is kept untouched', () => {
  const members = ['abc,', 'defg.'];
  const { audio, durations } = fakeCall(members, { quiet: 8 });
  const out = assembleCall({ audio, durations, members, lookahead: false, pauses: [CLAUSE_PAUSE, 0.85], joinedInside: [true, false] });
  // model's own silence: comma (8 frames) + space (8 frames) = 0.4 s, kept as it is
  assert.ok(Math.abs(silenceBetween(out.samples, out.offsets, 0) - (16 * FRAME) / RATE) < 0.011);
});

test('pause design: longer after longer sentences, varied a little, long after paragraphs', () => {
  assert.equal(designedPause({ text: 'Short one.' }, true), PARAGRAPH_PAUSE);
  assert.equal(designedPause({ text: 'Short one,', joined: true }, false), CLAUSE_PAUSE);
  const short = designedPause({ text: 'Two words.' }, false);
  const long = designedPause({ text: 'This sentence has a good many more words in it than the other one has.' }, false);
  assert.ok(short >= 0.32 * 0.93 && short <= 0.32 * 1.07);
  assert.ok(long > short);
  assert.equal(designedPause({ text: 'Two words.' }, false), short); // repeatable
  const many = designedPause({ text: Array(40).fill('word').join(' ') + '.' }, false);
  assert.ok(many <= 0.55 * 1.07); // capped at 25 words
});

test('which sentence a playback position is in', () => {
  const offsets = [0, 100, 250, 400];
  assert.equal(sentenceAt(offsets, 0), 0);
  assert.equal(sentenceAt(offsets, 99), 0);
  assert.equal(sentenceAt(offsets, 100), 1);
  assert.equal(sentenceAt(offsets, 399), 2);
  assert.equal(sentenceAt(offsets, 9999), 2); // past the end: the last sentence
});
