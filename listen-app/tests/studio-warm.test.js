// The warm-up: the studio is started before anyone listens, so its 2 to 5 minutes pass while a
// text is pasted, but only in the few cases studio.js names at the top, at most once in half an
// hour, never after a refusal, and never again by itself when it got no answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../src/studio/studio.js';

const MIN = 60_000;
const LINK = { on: true, url: 'https://helper.example', key: 'k' };

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

// A studio with its own clock (`clock.t`, ms). Every call is kept with the reader's state and
// the number of warm-ups sent so far at that moment.
function setup(answer, texts = ['One.', 'Two.']) {
  const clock = { t: 1_000 * MIN };
  const calls = [];
  const reader = new FakeReader(texts);
  const studio = new Studio(reader, {
    now: () => clock.t,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ call: `${init.method} ${path}`, state: reader.state, warmUps: studio.warmUps });
      return answer(path, reader);
    },
  });
  return { reader, studio, calls, clock };
}
const names = (calls) => calls.map((c) => c.call);
const starts = (calls) => calls.filter((c) => c.call === 'POST /start').length;

// The rule that costs money otherwise: every start is either while someone listens, or a warm-up.
function startsOnlyWhileListeningOrWarm(calls) {
  let warmUps = 0;
  for (const c of calls) {
    if (c.call !== 'POST /start' || c.state === 'playing' || c.state === 'waiting') continue;
    assert.ok(c.warmUps > warmUps, `POST /start while ${c.state}, and not a warm-up`);
    warmUps = c.warmUps;
  }
}

test('the page opening warms the studio up when it is on and has a link, and it gets ready as usual', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let up = false;
  const { reader, studio, calls } = setup((path) => {
    if (path === '/start') return json(200, { state: 'starting' });
    if (path === '/status') return json(200, { state: up ? 'ready' : 'starting' });
    return audio();
  });
  studio.configure({ ...LINK, warm: true });
  await settle();
  assert.equal(studio.state, 'starting');
  assert.equal(studio.warmUps, 1);
  up = true;
  t.mock.timers.tick(3000);
  await settle();
  // Ready: the sentences of a text already there are prepared ahead, as after a Play.
  assert.deepEqual(names(calls), ['POST /start', 'GET /status', 'POST /line', 'POST /line']);
  assert.deepEqual(reader.adopted, [0, 1]);
  reader.go('playing'); // Play: nothing more to start
  await settle();
  assert.equal(starts(calls), 1);
  startsOnlyWhileListeningOrWarm(calls);
});

test('no warm-up when the studio is off, has no link or no key, or the page did not ask for one', async () => {
  const { studio, calls } = setup(() => json(200, { state: 'ready' }));
  studio.configure({ ...LINK, on: false, warm: true });
  studio.configure({ on: true, url: '', key: '', warm: true });
  studio.configure({ ...LINK, key: '', warm: true }); // an address without its key
  studio.configure(LINK); // (not opening, not switching on: as before, nothing)
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(studio.warmUps, 0);
});

test('at most one warm-up in half an hour: opening, switching on and a new link share the clock', async () => {
  const { studio, calls, clock } = setup((path) => (path === '/line' ? audio() : json(200, { state: 'ready' })), []);
  studio.configure({ ...LINK, warm: true }); // the page opens
  await settle();
  clock.t += 10 * MIN;
  studio.configure({ ...LINK, on: false, warm: true }); // switched off …
  studio.configure({ ...LINK, warm: true }); // … and on again
  await settle();
  clock.t += 10 * MIN;
  studio.configure({ ...LINK, key: 'k2', warm: true }); // a new link
  await settle();
  assert.equal(starts(calls), 1);
  assert.ok(calls.slice(1).every((c) => c.call === 'GET /status'), 'in between it only asks how the studio stands');
  clock.t += 11 * MIN; // 31 minutes after the first
  studio.configure({ ...LINK, key: 'k2', warm: true });
  await settle();
  assert.equal(starts(calls), 2);
  assert.equal(studio.warmUps, 2);
  startsOnlyWhileListeningOrWarm(calls);
});

test('no warm-up after the key was refused, the daily limit, or a start that failed; Play still tries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const refusals = {
    key: (path) => (path === '/start' ? json(401, { error: 'key missing or wrong' }) : json(401, {})),
    limit: (path) => (path === '/start' ? json(429, { error: 'daily limit reached' }) : json(200, { state: 'idle', error: 'daily limit reached' })),
    failed: (path) => (path === '/start' ? json(200, { state: 'starting' }) : json(200, { state: 'idle', error: 'start failed: new: no GPU' })),
  };
  for (const [why, answer] of Object.entries(refusals)) {
    const { reader, studio, calls, clock } = setup(answer);
    studio.configure({ ...LINK, warm: true }); // the page opens: one warm-up
    await settle();
    t.mock.timers.tick(3000); // ("failed": the helper then says the start failed)
    await settle();
    assert.equal(studio.state, 'error', why);
    clock.t += 31 * MIN;
    studio.configure({ ...LINK, warm: true }); // switched on again, after the half hour
    studio.wake(45 * MIN); // and back in view after a long while
    await settle();
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(starts(calls), 1, `${why}: not warmed up again`);
    reader.go('playing'); // Play may still try, as before
    await settle();
    assert.equal(starts(calls), 2, `${why}: Play tries again`);
    startsOnlyWhileListeningOrWarm(calls);
  }
});

test('a new link after a refusal may warm up again (the refusal was about the old link)', async () => {
  const { studio, calls, clock } = setup((path) => (path === '/start' ? json(401, {}) : json(401, {})));
  studio.configure({ ...LINK, warm: true });
  await settle();
  clock.t += 31 * MIN;
  studio.configure({ ...LINK, key: 'k2', warm: true });
  await settle();
  assert.equal(starts(calls), 2);
  startsOnlyWhileListeningOrWarm(calls);
});

test('a warm-up that gets no answer is not tried again by itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const troubles = {
    network: () => { throw new TypeError('network'); },
    'not 200': () => ({ status: 502, json: async () => { throw new SyntaxError('html'); } }),
    busy: () => json(429, { error: 'too many requests' }),
  };
  for (const [why, trouble] of Object.entries(troubles)) {
    const { reader, studio, calls } = setup((path) => (path === '/start' ? trouble() : json(200, { state: 'idle', error: null })));
    studio.configure({ ...LINK, warm: true });
    for (let i = 0; i < 30; i++) { await settle(); t.mock.timers.tick(8000); } // four minutes
    await settle();
    assert.deepEqual(names(calls), ['POST /start'], why);
    assert.equal(studio.state, 'error', why);
    reader.go('playing'); // Play does try again
    await settle();
    assert.equal(starts(calls), 2, why);
    startsOnlyWhileListeningOrWarm(calls);
  }
});

test('back in view after half an hour or more: asks once, and warms up only if the studio stopped without trouble', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let helper = { state: 'idle', error: null };
  const { studio, calls, clock } = setup((path) => {
    if (path === '/start') { helper = { state: 'starting', error: null }; return json(200, helper); }
    if (path === '/status') return json(200, helper);
    return audio();
  }, []);
  studio.configure(LINK); // (opened earlier, with no warm-up since)
  studio.wake(29 * MIN); // away a little less than half an hour: nothing
  await settle();
  assert.deepEqual(calls, []);
  studio.wake(30 * MIN); // half an hour: it asks, sees the studio stopped, and warms it up
  await settle();
  assert.deepEqual(names(calls), ['GET /status', 'POST /start']);
  assert.equal(studio.state, 'starting');

  helper = { state: 'idle', error: null }; // stopped again meanwhile
  clock.t += 10 * MIN;
  studio.wake(40 * MIN); // away long, but the last warm-up was only 10 minutes ago
  await settle();
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(starts(calls), 1, 'not twice in half an hour');
  startsOnlyWhileListeningOrWarm(calls);
});

test('back in view after a long while: no warm-up when the studio failed to start, or is still running', async () => {
  const failed = setup((path) => json(200, path === '/status' ? { state: 'idle', error: 'cell not ready after 420 s' } : { state: 'starting' }));
  failed.studio.configure(LINK);
  failed.studio.wake(45 * MIN);
  await settle();
  assert.deepEqual(names(failed.calls), ['GET /status']);
  assert.equal(failed.studio.state, 'error');
  failed.clock.t += 60 * MIN;
  failed.studio.wake(60 * MIN); // the last answer was that failed start: not even asked
  await settle();
  assert.deepEqual(names(failed.calls), ['GET /status']);

  const running = setup((path) => (path === '/line' ? audio() : json(200, { state: 'ready' })));
  running.studio.configure(LINK);
  running.studio.wake(45 * MIN);
  await settle();
  assert.deepEqual(names(running.calls), ['GET /status', 'POST /line', 'POST /line']);
  assert.equal(running.studio.warmUps, 0);
});

test('a question before a warm-up that gets no answer is not asked again by itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { studio, calls } = setup(() => { throw new TypeError('network'); });
  studio.configure(LINK);
  studio.wake(45 * MIN);
  for (let i = 0; i < 30; i++) { await settle(); t.mock.timers.tick(8000); }
  assert.deepEqual(names(calls), ['GET /status']);
});

test('the page measures how long it was hidden', async () => {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.document = page;
  try {
    let helper = { state: 'idle', error: null };
    const { studio, calls, clock } = setup((path) => {
      if (path === '/start') helper = { state: 'ready', error: null };
      return path === '/line' ? audio() : json(200, helper);
    }, []);
    studio.configure(LINK);
    const away = (ms) => {
      page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
      clock.t += ms;
      page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    };
    away(5 * MIN);
    await settle();
    assert.deepEqual(calls, []);
    away(35 * MIN);
    await settle();
    assert.deepEqual(names(calls), ['GET /status', 'POST /start']);
    assert.equal(studio.state, 'ready');
  } finally {
    delete globalThis.document;
  }
});

test('Play while a warm-up is under way starts nothing more', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let up = false;
  const { reader, studio, calls } = setup((path) => {
    if (path === '/start') return json(200, { state: 'starting' });
    if (path === '/status') return json(200, { state: up ? 'ready' : 'starting' });
    return audio();
  });
  studio.configure({ ...LINK, warm: true });
  studio.setOnly(true);
  await settle();
  reader.go('waiting'); // Play while it starts
  await settle();
  up = true;
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(starts(calls), 1);
  assert.deepEqual(reader.adopted, [0, 1]);
  startsOnlyWhileListeningOrWarm(calls);
});
