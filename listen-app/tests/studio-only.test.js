// "Studio only": the device's voice is never started or asked, the reader
// waits for each sentence until the studio has made it, and a sentence the
// studio cannot make is passed over (counted) instead of hanging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../src/studio/studio.js';
import { MAX_LINE } from '../src/studio/moods.js';
import { Reader } from '../src/reader/reader.js';
import { createKokoroEngine } from '../src/engine/kokoro-engine.js';
import { splitText } from '../src/text/splitter.js';

const SAMPLES = 240;
function wav(samples = SAMPLES) {
  const b = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(b);
  v.setUint32(0, 0x52494646); v.setUint32(4, 36 + samples * 2, true); v.setUint32(8, 0x57415645);
  v.setUint32(12, 0x666d7420); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461); v.setUint32(40, samples * 2, true);
  return b;
}

// The reader as the studio sees it. Like the real one, it refuses the sentence being heard.
class FakeReader extends EventTarget {
  constructor(texts) {
    super();
    this.state = 'idle';
    this.voice = 'af_heart';
    this.sentences = texts.map((t) => (typeof t === 'string' ? { text: t } : t));
    this.segments = [];
    this.current = 0;
    this.hearsCurrent = false;
    this.epoch = 1;
    this.studioVoice = null;
    this.adopted = [];
  }
  setStudioVoice(v) { this.studioVoice = v; }
  deliveries() { return this.sentences.map((s) => ({ parts: s.parts ?? [{ text: s.text, lang: 'en' }] })); }
  isFresh(i) { return Boolean(this.segments[i]); }
  signature(i) { return `sig${i}`; }
  adopt(index, pcm, { voice, skipped = false }) {
    const active = this.state === 'playing' || this.state === 'paused';
    if (active && this.hearsCurrent && index === this.current) return false;
    this.segments[index] = { clip: { studio: voice, skipped } };
    this.adopted.push({ index, samples: pcm.length, skipped });
    return true;
  }
  get studioSkipped() { return this.segments.filter((s) => s?.clip.skipped).length; }
  go(state) { this.state = state; this.dispatchEvent(new Event('state')); }
}

const json = (status, body) => ({ status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
const audio = () => ({ status: 200, json: async () => ({}), arrayBuffer: async () => wav() });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

// `answer(path, body, reader)`; every call is kept with the reader's state and the number of
// warm-ups sent so far at that moment.
function setup(texts, answer, { only = true } = {}) {
  const calls = [];
  const reader = new FakeReader(texts);
  const studio = new Studio(reader, {
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ call: `${init.method} ${path}`, text: body?.text, state: reader.state, warmUps: studio.warmUps });
      return answer(path, body, reader);
    },
  });
  studio.configure({ on: true, url: 'https://helper.example', key: 'k' });
  studio.setOnly(only);
  return { reader, studio, calls };
}
const lines = (calls) => calls.filter((c) => c.call === 'POST /line').map((c) => c.text);
const ready = (path) => (path === '/start' || path === '/status' ? json(200, { state: 'ready' }) : null);

// The invariant that costs money otherwise: every start is either while someone listens, or a
// warm-up (studio.js, at the top), each warm-up being one start of its own.
function startsOnlyWhileListeningOrWarm(calls) {
  let warmUps = 0;
  for (const c of calls) {
    if (c.call !== 'POST /start' || c.state === 'playing' || c.state === 'waiting') continue;
    assert.ok(c.warmUps > warmUps, `POST /start while ${c.state}, and not a warm-up`);
    warmUps = c.warmUps;
  }
}

test('the sentence the reader waits for is asked for first', async () => {
  const { reader, calls } = setup(['One.', 'Two.', 'Three.'], (path) => ready(path) ?? audio());
  reader.go('waiting');
  await settle();
  assert.deepEqual(lines(calls), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(reader.adopted.map((a) => a.index), [0, 1, 2]);
  startsOnlyWhileListeningOrWarm(calls);
});

test('a sentence really being heard is not asked for; one paused before it was heard is', async () => {
  const heard = setup(['One.', 'Two.', 'Three.'], (path) => ready(path) ?? audio());
  heard.reader.current = 1;
  heard.reader.hearsCurrent = true;
  heard.reader.go('playing');
  await settle();
  assert.deepEqual(lines(heard.calls), ['Three.']);

  const paused = setup(['One.', 'Two.', 'Three.'], (path) => ready(path) ?? audio());
  paused.reader.go('waiting'); // Play: the studio starts …
  paused.reader.current = 1;
  paused.reader.state = 'paused'; // … then a pause while waiting: nothing in the player
  await settle();
  assert.deepEqual(lines(paused.calls), ['Two.', 'Three.']);
});

test('without Studio only, nothing changes: the sentence at the position is left to the device while playing', async () => {
  const { reader, calls } = setup(['One.', 'Two.'], (path) => ready(path) ?? audio(), { only: false });
  reader.go('playing'); // (not in the player yet, as in the real reader right after Play)
  await settle();
  assert.deepEqual(lines(calls), ['Two.']);
});

test('a jump re-aims the requests at the new position', async () => {
  const texts = Array.from({ length: 10 }, (_, i) => `Line ${i}.`);
  const { reader, calls } = setup(texts, (path, _body, reader) => {
    if (ready(path)) return ready(path);
    if (lines(calls).length === 1) {
      reader.current = 6; // the listener tapped sentence 7 while the first line was being made
      reader.dispatchEvent(new Event('sentence'));
    }
    return audio();
  });
  reader.go('waiting');
  await settle();
  assert.deepEqual(lines(calls), ['Line 0.', 'Line 6.', 'Line 7.', 'Line 8.', 'Line 9.']);
});

test('a sentence the studio refuses is passed over with its pause, counted, and the rest carry on', async () => {
  const { reader, calls } = setup(['One.', 'Two.', 'Three.'], (path, body) => ready(path) ?? (body.text === 'Two.' ? json(422, { error: 'check failed twice' }) : audio()));
  reader.go('waiting');
  await settle();
  assert.deepEqual(lines(calls), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(reader.adopted, [
    { index: 0, samples: SAMPLES, skipped: false },
    { index: 1, samples: 0, skipped: true },
    { index: 2, samples: SAMPLES, skipped: false },
  ]);
});

test('no answer is never a reason to skip: the reader waits, the status says why, and the line comes through', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const { reader, studio, calls } = setup(['One.', 'Two.'], (path, body) => {
    if (ready(path)) return ready(path);
    if (body.text === 'One.') {
      n++;
      if (n === 1 || n === 3) throw new TypeError('network'); // a tunnel
      if (n === 2) return json(503, { error: 'no answer from the machine' }); // the studio not answering
    }
    return audio();
  });
  reader.go('waiting');
  await settle();
  assert.equal(studio.state, 'ready');
  assert.equal(studio.note, 'The studio cannot be reached.');
  assert.deepEqual(reader.adopted, [], 'nothing passed over meanwhile');
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(8000); await settle(); }
  assert.deepEqual(lines(calls), ['One.', 'One.', 'One.', 'One.', 'Two.']);
  assert.deepEqual(reader.adopted.map(({ index, skipped }) => ({ index, skipped })), [{ index: 0, skipped: false }, { index: 1, skipped: false }]);
  assert.equal(reader.studioSkipped, 0);
  assert.equal(studio.note, '', 'back to ready once a line came through');
  startsOnlyWhileListeningOrWarm(calls);
});

test('no answer while nobody listens: asked again only after Play, never on its own', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let down = true;
  const { reader, studio, calls } = setup(['One.', 'Two.'], (path, _body, reader) => {
    if (ready(path)) return ready(path);
    if (!down) return audio();
    reader.state = 'paused'; // the listener paused while the line was on its way
    throw new TypeError('network');
  });
  reader.go('waiting');
  for (let i = 0; i < 20; i++) { await settle(); t.mock.timers.tick(8000); }
  reader.dispatchEvent(new Event('generated')); // other changes do not ask again either
  await settle();
  assert.deepEqual(lines(calls), ['One.']);
  assert.deepEqual(reader.adopted, []);
  reader.go('playing'); // Play
  await settle();
  assert.deepEqual(lines(calls), ['One.', 'One.']);
  down = false;
  reader.go('waiting'); // (the reader waits on it; paused again by the failed answer above)
  await settle();
  assert.deepEqual(lines(calls), ['One.', 'One.', 'One.', 'Two.']);
  assert.equal(studio.note, '');
  assert.equal(calls.filter((c) => c.call === 'POST /start').length, 1);
  startsOnlyWhileListeningOrWarm(calls);
});

test('a 429 with the daily limit says so, and is asked again only every 30 s while listening', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reader, studio, calls } = setup(['One.'], (path) => ready(path) ?? json(429, { error: 'daily limit reached' }));
  reader.go('waiting');
  await settle();
  assert.equal(studio.note, 'The studio has reached its limit for today.');
  t.mock.timers.tick(8000);
  await settle();
  assert.equal(lines(calls).length, 1);
  t.mock.timers.tick(22_000);
  await settle();
  assert.equal(lines(calls).length, 2);
  assert.deepEqual(reader.adopted, []);
});

test('German and Spanish sentences go to the studio too (without Studio only they stay with the device)', async () => {
  const texts = [{ text: 'Das kann doch nicht wahr sein.', parts: [{ text: 'Das kann doch nicht wahr sein.', lang: 'de' }] }, 'Two.'];
  const only = setup(texts, (path) => ready(path) ?? audio());
  only.reader.go('waiting');
  await settle();
  assert.deepEqual(lines(only.calls), ['Das kann doch nicht wahr sein.', 'Two.']);

  const mixed = setup(texts, (path) => ready(path) ?? audio(), { only: false });
  mixed.reader.go('waiting');
  await settle();
  assert.deepEqual(lines(mixed.calls), ['Two.']);
});

test('a sentence too long for one line is asked for in parts and heard as one clip', async () => {
  const long = `${'the river rose slowly over the old stone bank, '.repeat(12)}and nobody noticed.`;
  const { reader, calls } = setup([long, 'Two.'], (path) => ready(path) ?? audio());
  reader.go('waiting');
  await settle();
  const asked = lines(calls);
  const parts = asked.length - 1;
  assert.ok(parts > 1 && asked.every((text) => text.length <= MAX_LINE));
  const gap = Math.round(0.12 * 24000);
  assert.deepEqual(reader.adopted, [
    { index: 0, samples: parts * SAMPLES + (parts - 1) * gap, skipped: false },
    { index: 1, samples: SAMPLES, skipped: false },
  ]);

  // Without Studio only it stays with the device, as before.
  const before = setup([long, 'Two.'], (path) => ready(path) ?? audio(), { only: false });
  before.reader.go('waiting');
  await settle();
  assert.deepEqual(lines(before.calls), ['Two.']);
});

test('one refused part passes the whole long sentence over', async () => {
  const long = `${'the river rose slowly over the old stone bank, '.repeat(12)}and nobody noticed.`;
  let n = 0;
  const { reader } = setup([long], (path) => ready(path) ?? (++n === 2 ? json(422, {}) : audio()));
  reader.go('waiting');
  await settle();
  assert.equal(n, 2, 'the parts after the refused one are not asked for');
  assert.deepEqual(reader.adopted, [{ index: 0, samples: 0, skipped: true }]);
});

test('a sentence with nothing to say is passed over with its pause, not counted as skipped', async () => {
  const { reader, calls } = setup(['* * *', 'Two.'], (path) => ready(path) ?? audio());
  reader.go('waiting');
  await settle();
  assert.deepEqual(lines(calls), ['Two.']);
  assert.deepEqual(reader.adopted[0], { index: 0, samples: 0, skipped: false });
});

test('Studio only starts the studio only while someone listens', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reader, studio, calls } = setup(['One.'], (path, _body, reader) => {
    if (path === '/start') { reader.state = 'paused'; return json(200, { state: 'starting' }); } // paused while it starts
    throw new TypeError('network'); // and then the helper cannot be reached
  });
  studio.setOnly(true);
  studio.wake();
  await settle();
  assert.deepEqual(calls, [], 'nothing before the first Play');
  reader.go('waiting');
  for (let i = 0; i < 60; i++) { await settle(); t.mock.timers.tick(8000); }
  assert.equal(calls.filter((c) => c.call === 'POST /start').length, 1);
  assert.ok(calls.filter((c) => c.call === 'GET /status').length > 10, 'asking how it stands goes on');
  reader.go('waiting'); // Play again
  await settle();
  assert.equal(calls.filter((c) => c.call === 'POST /start').length, 2);
  startsOnlyWhileListeningOrWarm(calls);
});

// ---- the real reader ----------------------------------------------------------

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.src = '';
    this.ended = false;
  }
  play() { return Promise.resolve(); }
  pause() {}
}

function deviceVoice() {
  const asked = [];
  const never = () => new Promise(() => {}); // the model is never ready here
  return { asked, engine: { device: null, phonemize: () => (asked.push('phonemize'), never()), render: () => (asked.push('render'), never()), prefetchVoice: () => asked.push('prefetch') } };
}

test('the reader in Studio only: the device is never asked, it waits for each sentence, and plays at the tempo', async () => {
  globalThis.Audio = FakeAudio; // (each test file runs on its own)
  const { asked, engine } = deviceVoice();
  const reader = new Reader(engine);
  reader.setStudioOnly(true);
  reader.setVoice('am_adam');
  reader.load(splitText('One. Two. Three.'));
  reader.setStudioVoice('am_fenrir');
  reader.play();
  assert.equal(reader.state, 'waiting');
  const take = (i, pcm = new Int16Array(2400), skipped = false) => reader.adopt(i, pcm, { epoch: reader.epoch, voice: 'am_fenrir', sig: reader.signature(i), skipped });
  assert.equal(take(0), true);
  assert.equal(reader.state, 'playing');
  assert.equal(reader.hearsCurrent, true);
  assert.equal(take(0), false, 'the sentence being heard is never swapped');
  // The sentence ends and the next one is not in yet: wait (no silence, no skipping ahead).
  reader.audio.dispatchEvent(new Event('ended'));
  assert.equal(reader.state, 'waiting');
  assert.equal(reader.current, 1);
  assert.equal(take(1), true);
  assert.equal(reader.state, 'playing');
  assert.equal(take(2, new Int16Array(0), true), true);
  assert.equal(reader.studioSkipped, 1);
  assert.equal(reader.studioCount, 2);
  assert.equal(reader.complete, true);
  assert.equal(reader.toWav(), null, 'no file with a hole in it');
  // Tempo: studio clips are made at normal speed and played at the chosen tempo.
  reader.speed = 1.3; // what a fast tempo bakes into device clips
  reader.setTempo(1.6);
  assert.equal(reader.audio.playbackRate, 1.6);
  assert.equal(reader.mixedSpeeds, false, 'all studio: one speed');
  await settle();
  assert.deepEqual(asked, [], 'the device voice was never asked for anything');

  // Off again: the device voice prepares again, starting with what the studio could not make.
  reader.setStudioOnly(false);
  assert.equal(reader.segments[2], null);
  assert.ok(reader.segments[0] && reader.segments[1], 'the studio sentences stay');
  assert.equal(reader.mixedSpeeds, true, 'as before the mode: studio and device speeds differ');
  await settle();
  assert.ok(asked.includes('phonemize'));
  reader.setVoice('af_heart');
  assert.equal(asked.at(-1), 'prefetch');
  clearTimeout(reader.speedTimer);
});

// ---- the engine ------------------------------------------------------------------

test('the engine starts its worker only when probed or loaded, and release() stops it', async () => {
  const made = [];
  class FakeWorker extends EventTarget {
    constructor() { super(); this.terminated = false; made.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  const engine = createKokoroEngine();
  engine.phonemize(['Hello.'], 'af_heart').catch(() => {}); // waits; starts nothing
  engine.setMode('wasm');
  engine.release();
  assert.equal(made.length, 0, 'nothing started');
  const probe = engine.probe();
  assert.equal(made.length, 1);
  engine.release();
  assert.equal(made[0].terminated, true);
  await assert.rejects(probe, (e) => e.phase === 'cancelled');
  engine.probe().catch(() => {});
  assert.equal(made.length, 2, 'started again');
});
