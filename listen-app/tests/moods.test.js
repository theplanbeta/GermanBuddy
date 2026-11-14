import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodFor, studioLine, studioVoiceFor, lineId } from '../src/studio/moods.js';
import { wavSamples, parseLink } from '../src/studio/studio.js';

test('the paragraph the owner judged by ear gets the moods chosen then', () => {
  assert.equal(moodFor("Honestly, I never thought we'd actually pull this off—can you believe how incredible the view is from up here?!"), 'happy');
  assert.equal(moodFor('Just take a deep breath... smell that crisp mountain air.'), 'sigh');
  assert.equal(moodFor('Wait a second.'), 'fear');
  assert.equal(moodFor('Why is the sky turning that weird shade of green?'), 'fear');
  assert.equal(moodFor("No, no, no, don't tell me that's a storm rolling in!"), 'fear');
  assert.equal(moodFor('Grab your backpack, zip up your jacket, and run for the cabin—now!'), 'angry');
  assert.equal(moodFor('Ugh... seriously, only we could get caught in a monsoon on a "sunny" weekend.'), 'groan');
});

test('ordinary sentences get no mood', () => {
  for (const t of [
    'The committee met on Tuesday to discuss the budget.',
    'She opened the window and looked at the garden.',
    'It was a strange year for the company.',
    'Prices rose by 3% in March!',
    'What time does the train leave?',
    'He said the view was incredible.',
    'Now we turn to the second chapter.',
  ]) assert.equal(moodFor(t), '', t);
});

test('a line carries its mood in front, and the bare words for the check', () => {
  assert.deepEqual(studioLine('Run for the cabin—now!'), { text: '[angry] Run for the cabin, now!', expect: 'Run for the cabin, now!', mood: 'angry' });
  assert.deepEqual(studioLine('The meeting ended at noon.'), { text: 'The meeting ended at noon.', expect: 'The meeting ended at noon.', mood: '' });
  assert.equal(studioLine('…'), null);
  assert.equal(studioLine('word '.repeat(100)), null);
});

test('voices and ids', () => {
  assert.equal(studioVoiceFor('af_heart'), 'af_aoede');
  assert.equal(studioVoiceFor('bm_george'), 'am_fenrir');
  assert.equal(lineId('af_aoede', 'Hello.'), lineId('af_aoede', 'Hello.'));
  assert.notEqual(lineId('af_aoede', 'Hello.'), lineId('am_fenrir', 'Hello.'));
  assert.match(lineId('af_aoede', 'Hello.'), /^[A-Za-z0-9_-]{2,60}$/);
});

test('the studio link is an address with the key after #', () => {
  assert.deepEqual(parseLink(' https://studio.example.net/#abc-DEF_1 '), { url: 'https://studio.example.net', key: 'abc-DEF_1' });
  assert.deepEqual(parseLink('https://studio.example.net'), { url: 'https://studio.example.net', key: '' });
  assert.equal(parseLink('http://studio.example.net/#k'), null);
  assert.equal(parseLink(''), null);
});

test('reads 24 kHz 16-bit mono WAV, refuses anything else', () => {
  const wav = (rate) => {
    const v = new DataView(new ArrayBuffer(44 + 6));
    const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); v.setUint32(4, 42, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, 6, true);
    [100, -200, 300].forEach((x, i) => v.setInt16(44 + 2 * i, x, true));
    return v.buffer;
  };
  assert.deepEqual([...wavSamples(wav(24000))], [100, -200, 300]);
  assert.equal(wavSamples(wav(44100)), null);
  assert.equal(wavSamples(new ArrayBuffer(10)), null);
});
