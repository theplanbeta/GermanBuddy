// Speed rules: tempo -> generation speed, preparation speed measurements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakedSpeedFor, speedFactor, prepRatio, msPerToken } from '../src/reader/schedule.js';

test('tempo maps to a few generation speeds; small changes never re-prepare', () => {
  for (const t of [0.5, 0.8, 1, 1.2, 1.4]) assert.equal(bakedSpeedFor(t), 1, `tempo ${t}`);
  for (const t of [1.5, 1.6, 1.75]) assert.equal(bakedSpeedFor(t), 1.5, `tempo ${t}`);
  for (const t of [1.8, 2, 2.5]) assert.equal(bakedSpeedFor(t), 2, `tempo ${t}`);
  assert.equal(speedFactor(1), 1);
  assert.equal(speedFactor(7), 1); // unknown speeds are treated as normal
});

test('the heard tempo is the same whichever speed a clip was made at', () => {
  // playback rate = tempo / factor, so a clip made 1.55x shorter is played 1.55x slower
  const tempo = 1.6;
  const seconds = 3.1;
  const heardNormal = seconds / (tempo / speedFactor(1));
  const heardFast = seconds / speedFactor(1.5) / (tempo / speedFactor(1.5));
  assert.ok(Math.abs(heardNormal - heardFast) < 1e-9);
});

test('prepRatio compares preparation with playback speed', () => {
  assert.equal(prepRatio([{ seconds: 3, ms: 2000, speed: 1 }], 1), null);
  const stats = [
    { seconds: 3, ms: 2000, speed: 1 },
    { seconds: 3, ms: 2000, speed: 1 },
  ];
  assert.equal(prepRatio(stats, 1), 1.5);
  assert.equal(prepRatio(stats, 2), 0.75); // at double tempo it cannot keep up
  // only the most recent measurements count
  const old = Array.from({ length: 10 }, () => ({ seconds: 1, ms: 10000, speed: 1 }));
  assert.equal(prepRatio([...old, ...Array(8).fill(stats[0])], 1), 1.5);
  // a clip made at speed 1.5 holds 1.55x more listening per second of audio
  assert.ok(Math.abs(prepRatio([{ seconds: 2, ms: 2000, speed: 1.5 }, { seconds: 2, ms: 2000, speed: 1.5 }], 1) - 1.55) < 1e-9);
});

test('msPerToken is the recent preparation time per phoneme', () => {
  assert.equal(msPerToken([]), null);
  assert.equal(msPerToken([{ tokens: 100, ms: 5000 }, { tokens: 300, ms: 11000 }]), 40);
  const old = Array.from({ length: 10 }, () => ({ tokens: 100, ms: 99999 }));
  assert.equal(msPerToken([...old, ...Array(6).fill({ tokens: 50, ms: 1000 })]), 20);
});
