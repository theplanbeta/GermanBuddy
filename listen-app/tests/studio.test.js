// The studio voice must keep going when a request is lost and nobody is
// listening any more (a short text ends long before the studio is ready).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../src/studio/studio.js';

function wav(samples = 240) {
  const b = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(b);
  v.setUint32(0, 0x52494646); v.setUint32(4, 36 + samples * 2, true); v.setUint32(8, 0x57415645);
  v.setUint32(12, 0x666d7420); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461); v.setUint32(40, samples * 2, true);
  return b;
}

class FakeReader extends EventTarget {
  constructor(texts) {
    super();
    this.state = 'idle';
    this.voice = 'af_heart';
    this.sentences = texts.map((text) => ({ text }));
    this.segments = [];
    this.current = 0;
    this.epoch = 1;
    this.studioVoice = null;
    this.adopted = [];
  }
  setStudioVoice(v) { this.studioVoice = v; }
  deliveries() { return this.sentences.map((s) => ({ parts: [{ text: s.text, lang: 'en' }] })); }
  isFresh(i) { return Boolean(this.segments[i]); }
  signature(i) { return `sig${i}`; }
  adopt(index, pcm, { voice }) { this.segments[index] = { clip: { studio: voice } }; this.adopted.push(index); return true; }
  go(state) { this.state = state; this.dispatchEvent(new Event('state')); }
}

const json = (status, body) => ({ status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
const audio = () => ({ status: 200, json: async () => ({}), arrayBuffer: async () => wav() });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

function setup(texts, answer) {
  const calls = [];
  const reader = new FakeReader(texts);
  const studio = new Studio(reader, {
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(`${init.method} ${path}`);
      return answer(path, calls, reader);
    },
  });
  studio.configure({ on: true, url: 'https://helper.example', key: 'k' });
  return { reader, studio, calls };
}

test('a line the studio did not answer is asked for again, also after the text has ended', async () => {
  let lines = 0;
  const { reader, studio, calls } = setup(['One.', 'Two.'], (path, _calls, reader) => {
    if (path === '/start' || path === '/status') return json(200, { state: 'ready' });
    lines++;
    if (lines === 1) { reader.state = 'idle'; return json(503, { error: 'no answer from the machine' }); } // the text ended meanwhile
    return audio();
  });
  reader.go('playing');
  await settle();
  assert.deepEqual(calls, ['POST /start', 'POST /line', 'GET /status', 'POST /line', 'POST /line']);
  assert.deepEqual(reader.adopted, [0, 1]);
  assert.equal(studio.state, 'ready');
  assert.equal(calls.filter((c) => c === 'POST /start').length, 1, 'the studio is never started while nobody listens');
});

test('a stopped studio is not started again while nobody listens', async () => {
  // Two sentences: the one being heard is never asked for.
  const { reader, studio, calls } = setup(['One.', 'Two.'], (path, _calls, reader) => {
    if (path === '/start') return json(200, { state: 'ready' });
    if (path === '/status') return json(200, { state: 'idle', error: null });
    reader.state = 'idle';
    return json(503, { error: 'not ready (idle)' });
  });
  reader.go('playing');
  await settle();
  assert.deepEqual(calls, ['POST /start', 'POST /line', 'GET /status']);
  assert.equal(studio.state, 'idle');
});

test('a line lost on the way is asked for again later without a listener, twice at most', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reader, calls } = setup(['One.', 'Two.'], (path, _calls, reader) => {
    if (path === '/start') return json(200, { state: 'ready' });
    reader.state = 'idle';
    throw new TypeError('network');
  });
  reader.go('playing');
  for (let i = 0; i < 8; i++) { await settle(); t.mock.timers.tick(8000); }
  await settle();
  assert.equal(calls.filter((c) => c === 'POST /line').length, 4); // two sentences, two tries each
  assert.equal(calls.filter((c) => c === 'POST /start').length, 1);
});

test('while the studio starts, a lost question is asked again although the text has ended', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const { reader, studio, calls } = setup(['One.'], (path, _calls, reader) => {
    if (path === '/start') { reader.state = 'idle'; return json(200, { state: 'starting' }); }
    if (path === '/status') {
      n++;
      if (n === 1) throw new TypeError('network');
      return json(200, { state: 'ready' });
    }
    return audio();
  });
  reader.go('playing');
  await settle();
  t.mock.timers.tick(3000); // first question: lost
  await settle();
  assert.equal(studio.state, 'error');
  t.mock.timers.tick(8000); // asked again: ready
  await settle();
  assert.deepEqual(calls, ['POST /start', 'GET /status', 'GET /status', 'POST /line']);
  assert.deepEqual(reader.adopted, [0]);
});

test('coming back into view asks how things stand, and never starts the studio', async () => {
  const { reader, studio, calls } = setup(['One.'], (path) => {
    if (path === '/start') throw new TypeError('network');
    if (path === '/status') return json(200, { state: 'ready' });
    return audio();
  });
  studio.wake();
  await settle();
  assert.deepEqual(calls, [], 'nothing before the first Play');
  reader.go('playing');
  await settle();
  reader.state = 'idle';
  assert.equal(studio.state, 'error');
  studio.wake();
  await settle();
  assert.deepEqual(calls, ['POST /start', 'GET /status', 'POST /line']);
  assert.deepEqual(reader.adopted, [0]);
});
