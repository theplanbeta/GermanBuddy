// The detector for broken voice output (used to fall back from the graphics chip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAudio } from '../src/engine/check-audio.js';

const RATE = 24000;
const TEXT = 'Nobody answered, so he sat down and waited.'; // 34 letters, normally ~3.3 s

function speech(seconds, loudness = 0.1) {
  const s = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < s.length; i++) s[i] = loudness * Math.sin(i / 7) * Math.sin(i / 900);
  return s;
}

test('normal speech passes', () => {
  assert.equal(checkAudio(speech(3.3), RATE, TEXT), '');
  assert.equal(checkAudio(speech(1.8), RATE, TEXT, 2), '');
  assert.equal(checkAudio(speech(0.5), RATE, 'Yes.'), '');
});

test('empty, silent and not-a-number output is broken', () => {
  assert.equal(checkAudio(new Float32Array(0), RATE, TEXT), 'empty');
  assert.equal(checkAudio(null, RATE, TEXT), 'empty');
  assert.equal(checkAudio(new Float32Array(RATE * 3), RATE, TEXT), 'silent');
  assert.equal(checkAudio(speech(3, 0.0005), RATE, TEXT), 'silent');
  const nan = speech(3);
  nan[1000] = NaN;
  assert.equal(checkAudio(nan, RATE, TEXT), 'not a number');
  const inf = speech(3);
  inf[5] = Infinity;
  assert.equal(checkAudio(inf, RATE, TEXT), 'not a number');
});

test('absurd lengths are broken', () => {
  assert.equal(checkAudio(speech(30), RATE, TEXT), 'too long');
  assert.equal(checkAudio(speech(0.2), RATE, TEXT), 'too short');
  // very short texts are never "too short"
  assert.equal(checkAudio(speech(0.2), RATE, 'Hi.'), '');
});
