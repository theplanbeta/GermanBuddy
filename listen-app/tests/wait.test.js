// The waiting ring's movement and the rule for repeated taps on Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, CAP, advance, isRepeatTap, REPEAT_TAP_MS } from '../src/ui/wait.js';
import { expectedCallMs, predictMs } from '../src/reader/schedule.js';

// Runs the ring through a wait: `remaining(t)` is the estimate at time t (ms).
function run({ total, frame = 16, remaining, scale }) {
  const seen = [START];
  let p = START;
  for (let t = frame; t <= total; t += frame) {
    p = advance(p, frame, remaining(t), scale ?? total);
    seen.push(p);
  }
  return seen;
}

test('fills at a steady pace and is 90% full at the expected moment', () => {
  const expected = 4000;
  const seen = run({ total: expected, remaining: (t) => expected - t + 16 });
  assert.ok(Math.abs(seen.at(-1) - CAP) < 1e-9, `ends at ${seen.at(-1)}`);
  const half = seen[Math.round(seen.length / 2)];
  assert.ok(Math.abs(half - (START + CAP) / 2) < 0.01, `half way: ${half}`);
});

test('the same total time gives the same fill, whatever the frame rate', () => {
  const remaining = (t) => Math.max(0, 3000 - t);
  const fast = run({ total: 6000, frame: 8, remaining, scale: 3000 }).at(-1);
  const slow = run({ total: 6000, frame: 50, remaining, scale: 3000 }).at(-1);
  const once = advance(START, 6000, 3000, 3000); // a hidden tab: one big step
  assert.ok(Math.abs(fast - slow) < 0.002, `${fast} vs ${slow}`);
  assert.ok(Math.abs(fast - once) < 0.002, `${fast} vs ${once}`);
});

test('never moves backwards, even when the estimate grows', () => {
  // A second call turns out to be needed after 1 s: the estimate jumps up.
  const remaining = (t) => (t < 1000 ? 2000 - t : 6000 - t);
  const seen = run({ total: 7000, remaining, scale: 6000 });
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1], `step ${k}: ${seen[k - 1]} -> ${seen[k]}`);
  // … and keeps moving meanwhile, rather than sitting still
  const at = (ms) => seen[Math.round(ms / 16)];
  assert.ok(at(3000) - at(2100) > 0.05);
});

test('when the estimate is overrun it keeps creeping but never reaches full', () => {
  const expected = 4000;
  const remaining = (t) => Math.max(0, expected - t);
  const seen = run({ total: 60_000, remaining, scale: expected });
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1]);
  assert.ok(seen.at(-1) < 1, 'never full');
  const at = (ms) => seen[Math.round(ms / 16)];
  // Twice the expected wait: still well short of full.
  assert.ok(at(8000) < 0.96, `at 2x: ${at(8000)}`);
  // Long overdue (6 times the estimate), it still moves: over 1 degree in 5 s.
  assert.ok(at(30_000) - at(25_000) > 0.003, `${at(25_000)} -> ${at(30_000)}`);
  assert.ok(at(60_000) > at(55_000));
});

test('an estimate of "ready now" from the start creeps rather than jumping to full', () => {
  const p = advance(START, 16, 0, 1000);
  assert.ok(p > START && p < 0.2, `${p}`);
});

test('no time passing changes nothing', () => {
  assert.equal(advance(0.3, 0, 1000, 1000), 0.3);
  assert.equal(advance(0.3, -5, 1000, 1000), 0.3);
});

test('a burst of quick taps counts as one tap; a later tap counts again', () => {
  // Six taps in 1.5 s: only the first is acted on, so the app keeps playing.
  let last = -Infinity;
  let playing = false;
  for (const t of [0, 300, 600, 900, 1200, 1500]) {
    if (!isRepeatTap(t, last)) playing = !playing;
    last = t;
  }
  assert.equal(playing, true);
  // A deliberate tap after a short break pauses (cancels the wait).
  assert.equal(isRepeatTap(1500 + REPEAT_TAP_MS, 1500), false);
  assert.equal(isRepeatTap(1500 + REPEAT_TAP_MS - 1, 1500), true);
  assert.equal(isRepeatTap(0, -Infinity), false); // the very first tap
});

test('a call\'s expected time: measured here, else from an earlier visit, else a cautious guess', () => {
  const here = [{ tokens: 80, ms: 2000 }];
  const before = [{ tokens: 80, ms: 6000 }];
  assert.equal(expectedCallMs(here, 80, before), predictMs(here, 80));
  assert.equal(expectedCallMs([], 80, before), predictMs(before, 80));
  const guess = expectedCallMs([], 80);
  assert.ok(guess >= 3900 && guess <= 6000, `${guess}`); // first call measured 3.9 s on a 4-core laptop
  assert.ok(expectedCallMs([], 160) > guess);
});
