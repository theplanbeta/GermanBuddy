// Rules for what the Reader prepares next and when a prepared clip is out of date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakedSpeedFor, speedFactor, isFresh, nextToGenerate, readyAhead, prepRatio } from '../src/reader/schedule.js';

const clip = (voice, speed = 1, seconds = 2) => ({ voice, speed, seconds });
const heart = (n) => Array.from({ length: n }, () => clip('af_heart'));

test('a clip is fresh only in the current voice and speed', () => {
  assert.equal(isFresh(clip('af_heart'), 'af_heart', 1), true);
  assert.equal(isFresh(clip('af_heart'), 'bm_george', 1), false);
  assert.equal(isFresh(clip('af_heart', 1.5), 'af_heart', 1), false);
  assert.equal(isFresh(null, 'af_heart', 1), false);
});

test('prepares from the current sentence forward, then wraps round', () => {
  const clips = [null, null, null, null];
  assert.equal(nextToGenerate(clips, 2, 'af_heart', 1), 2);
  clips[2] = clip('af_heart');
  assert.equal(nextToGenerate(clips, 2, 'af_heart', 1), 3);
  clips[3] = clip('af_heart');
  assert.equal(nextToGenerate(clips, 2, 'af_heart', 1), 0);
  clips[0] = clips[1] = clip('af_heart');
  assert.equal(nextToGenerate(clips, 2, 'af_heart', 1), -1);
});

test('after a voice change, starts with the sentence after the one playing', () => {
  const clips = heart(5);
  // sentence 2 is playing in the old voice: it keeps playing and is redone last
  assert.equal(nextToGenerate(clips, 2, 'bm_george', 1, 2), 3);
  clips[3] = clip('bm_george');
  clips[4] = clip('bm_george');
  assert.equal(nextToGenerate(clips, 2, 'bm_george', 1, 2), 0);
  clips[0] = clip('bm_george');
  clips[1] = clip('bm_george');
  assert.equal(nextToGenerate(clips, 2, 'bm_george', 1, 2), 2);
  clips[2] = clip('bm_george');
  assert.equal(nextToGenerate(clips, 2, 'bm_george', 1, 2), -1);
});

test('when nothing is playing, the current sentence is redone first', () => {
  assert.equal(nextToGenerate(heart(4), 1, 'bm_george', 1, -1), 1);
});

test('a missing current sentence comes first even if another is "playing"', () => {
  const clips = heart(3);
  clips[1] = null;
  assert.equal(nextToGenerate(clips, 1, 'af_heart', 1, 1), 1);
});

test('only the latest voice matters after rapid changes', () => {
  const clips = [clip('af_heart'), clip('bm_george'), clip('bf_emma')];
  assert.equal(nextToGenerate(clips, 0, 'bf_emma', 1, 0), 1);
});

test('tempo maps to a few generation speeds; small changes never re-prepare', () => {
  for (const t of [0.5, 0.8, 1, 1.2, 1.4]) assert.equal(bakedSpeedFor(t), 1, `tempo ${t}`);
  for (const t of [1.5, 1.6, 1.75]) assert.equal(bakedSpeedFor(t), 1.5, `tempo ${t}`);
  for (const t of [1.8, 2, 2.5]) assert.equal(bakedSpeedFor(t), 2, `tempo ${t}`);
  assert.equal(speedFactor(1), 1);
  assert.equal(speedFactor(7), 1); // unknown speeds are treated as normal
});

test('the heard tempo is the same whichever speed a clip was made at', () => {
  // playback rate = tempo / factor; listening time = seconds * factor / tempo
  const tempo = 1.6;
  const normal = readyAhead([clip('v', 1, 3.1)], 0, tempo).seconds;
  const fast = readyAhead([clip('v', 1.5, 3.1 / speedFactor(1.5))], 0, tempo).seconds;
  assert.ok(Math.abs(normal - fast) < 1e-9);
});

test('readyAhead counts the run of prepared clips from a sentence', () => {
  const clips = [clip('v', 1, 2), clip('w', 1, 3), null, clip('v', 1, 4)];
  assert.deepEqual(readyAhead(clips, 0, 1), { seconds: 5, toEnd: false });
  assert.deepEqual(readyAhead(clips, 0, 2), { seconds: 2.5, toEnd: false });
  assert.deepEqual(readyAhead(clips, 3, 1), { seconds: 4, toEnd: true });
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
});
