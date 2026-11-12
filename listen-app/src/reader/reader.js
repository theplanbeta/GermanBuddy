// The Reader turns a list of sentences into continuous speech.
//
// - It asks the voice engine for one model call at a time. A call covers
//   several neighbouring sentences of a paragraph (see flow/plan.js for the
//   rules), which makes the reading flow like one connected thought. The
//   result is one "clip" with the exact start of every sentence in it
//   (flow/assemble.js).
// - Work starts with the sentence being listened to and goes forward, so
//   playback can start as soon as the first (small) call is ready. It keeps
//   going until the whole document is done, which makes the download possible.
// - Clips are played through one <audio> element. The browser changes tempo
//   there without changing pitch, so the tempo slider is instant. Which
//   sentence is being heard is worked out from the playback position, many
//   times a second, for the highlight.
// - Each clip remembers the voice and speed it was made with. Changing the
//   voice (or a big tempo change, see schedule.js) never stops the sound:
//   what is already prepared keeps playing, the text from the next sentence
//   on is re-made in small calls first, and at the first sentence boundary
//   where the new voice is ready the player switches clips.
//
// Any "source" (pasted text today; files, photos, web pages later) just calls
// reader.load(sentences).
//
// Events (listen with reader.addEventListener):
//   'state'      reader.state is now 'idle' | 'waiting' | 'playing' | 'paused'
//   'sentence'   reader.current changed
//   'generated'  preparation progressed (reader.readyCount, reader.prepRatio)
//   'time'       playback position moved (reader.position, 0..1)
//   'slow'       playback ran dry and this device prepares more slowly than it plays
//   'error'      event.detail = { error, fatal }
import { toInt16, wavBlob, silentWav } from './audio.js';
import { bakedSpeedFor, speedFactor, prepRatio, predictMs, listenPerToken } from './schedule.js';
import { chooseStart, planCall, sizeRule, freshAhead, takeoverStart, firstWords, callLength, MAX_SENTENCES } from '../flow/plan.js';
import { assembleCall, plainClip, designedPause, sentenceAt } from '../flow/assemble.js';

const SPEED_SETTLE_MS = 1000; // wait for the tempo slider to rest before re-preparing at a new speed
// On the graphics chip (WebGPU) one model call occupies the chip until it is
// done, and the phone's own animations (for example the app switcher) stutter
// meanwhile. So calls there are kept shorter: about 180 phonemes is 2 or 3
// sentences, roughly 12 s of speech, about 7 s of work at 1.6x real time.
// While the page is hidden, and for a few seconds after it comes back, calls
// are shorter still. The look-ahead keeps the joins between calls natural.
export const GPU_CAP = 180;
const GPU_CAP_HIDDEN = 100;
const GPU_REST_MS = 100; // a short break between calls on the graphics chip
const VISIBLE_SETTLE_MS = 5000;
const REFILL_SECONDS = 5; // after running dry mid-reading, gather this much before carrying on
const RATE = 24000;

export class Reader extends EventTarget {
  constructor(engine, { gpuCap = GPU_CAP } = {}) {
    super();
    this.engine = engine;
    this.gpuCap = gpuCap; // phonemes per call on the graphics chip (adjustable with ?gpucap=N)
    this.shownAt = 0; // when the page last became visible
    this.sentences = [];
    // segments[i] = { clip, k }: sentence i is sentence number k of that clip.
    // A clip is { pcm: Int16Array, offsets, first, last, voice, speed }, where
    // sentence k of the clip runs from offsets[k] to offsets[k + 1] (samples,
    // including the pause after it).
    this.segments = [];
    this.current = 0;
    this.state = 'idle';
    this.voice = 'af_heart';
    this.tempo = 1;
    this.speed = 1; // the speed new clips are made at (follows the tempo, see schedule.js)
    this.sizing = 'adaptive'; // or 'ramp' (fixed 1, 2, 4, full calls; for tests)
    this.failedCount = 0;
    this.stats = []; // per model call: { tokens, ms, seconds, speed }
    this.calls = []; // per model call, for tests and curiosity: what was planned and how it went
    this.phonemes = new Map(); // 'a' | 'b' -> per sentence { ph, head, n, headN }
    this.single = new Set(); // sentences that must be made on their own (a group could not be cut apart)
    this.ordinal = 0; // model calls since the text was loaded
    this.epoch = 0; // bumps when new text is loaded
    this.busy = false;
    this.halted = false; // the engine could not load; wait for retry()
    this.loaded = null; // the clip in the <audio> element
    this.refilling = false; // ran dry mid-reading: wait for a little lead before carrying on
    this.starting = false; // the listener pressed Play (or jumped) and waits for the first sound
    this.slowNoticed = false;
    this.speedTimer = null;
    this.frame = null;
    this.url = null;
    this.unlocked = false;
    this.silentUrl = null;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.#clipEnded());
    // Backup for when animation frames stop (background tab, locked screen).
    this.audio.addEventListener('timeupdate', () => this.#tick());
    // On phones a hidden page is frozen after a while unless sound is playing.
    // When it comes back, carry on preparing (and playing, if it was).
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        this.shownAt = performance.now();
        this.#pump();
        if (this.state === 'waiting' && this.segments[this.current]) this.#startAt(this.current);
      });
    }
  }

  // ---- loading -----------------------------------------------------------

  load(sentences) {
    this.stop();
    this.sentences = sentences;
    this.epoch++;
    this.segments = new Array(sentences.length).fill(null);
    this.phonemes.clear();
    this.single.clear();
    this.calls = [];
    this.ordinal = 0;
    this.failedCount = 0;
    this.slowNoticed = false;
    this.#emit('generated');
    this.#emit('sentence');
    this.#pump();
  }

  setVoice(voice) {
    if (voice === this.voice) return;
    this.voice = voice;
    this.engine.prefetchVoice?.(voice); // start fetching its data file right away
    this.#emit('generated'); // "prepared" counts only clips in the new voice
    this.#pump();
  }

  setTempo(tempo) {
    this.tempo = tempo;
    this.#applyRate();
    // Re-preparing at a different speed costs work, so only do it once the
    // slider has come to rest, and only when the speed step really changes.
    clearTimeout(this.speedTimer);
    const settle = () => {
      const speed = bakedSpeedFor(this.tempo);
      if (speed === this.speed) return;
      this.speed = speed;
      this.#emit('generated');
      this.#pump();
    };
    if (this.segments.some(Boolean)) this.speedTimer = setTimeout(settle, SPEED_SETTLE_MS);
    else settle(); // nothing prepared yet: nothing to throw away
  }

  retry() {
    this.halted = false;
    this.#pump();
  }

  // ---- transport ---------------------------------------------------------

  /** Call directly from a click/tap: phones only allow sound started by a tap. */
  play() {
    if (!this.sentences.length) return;
    this.#unlock();
    if (this.state === 'playing' || this.state === 'waiting') return;
    this.refilling = false;
    this.starting = true;
    if (this.state === 'paused' && this.#holdsCurrent() && !this.audio.ended) {
      this.#setState('playing');
      this.audio.play().catch((e) => this.#playFailed(e));
    } else {
      this.#startAt(this.current);
    }
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'waiting') return;
    this.audio.pause();
    this.#setState('paused');
  }

  toggle() {
    if (this.state === 'playing' || this.state === 'waiting') this.pause();
    else this.play();
  }

  stop() {
    this.audio.pause();
    this.loaded = null;
    this.current = 0;
    this.refilling = false;
    this.#setState('idle');
    this.#emit('sentence');
    this.#emit('time');
  }

  next() {
    if (this.current < this.sentences.length - 1) this.jumpTo(this.current + 1);
  }

  previous() {
    if (this.current > 0) this.jumpTo(this.current - 1);
  }

  /** Moves to a sentence. Keeps playing if playing; `play: true` always plays. */
  jumpTo(index, { play = false } = {}) {
    if (!this.sentences.length) return;
    this.current = Math.max(0, Math.min(index, this.sentences.length - 1));
    this.refilling = false;
    this.#emit('sentence');
    if (play) this.#unlock();
    if (play || this.state === 'playing' || this.state === 'waiting') {
      this.starting = true;
      this.#startAt(this.current);
    }
    else {
      this.audio.pause();
      this.loaded = null;
      this.#emit('time');
      this.#pump();
    }
  }

  // ---- results -----------------------------------------------------------

  /** True when sentence i is prepared in the current voice and speed. */
  isFresh(i) {
    const clip = this.segments[i]?.clip;
    return Boolean(clip) && clip.voice === this.voice && clip.speed === this.speed;
  }

  /** True when sentence i is prepared in full quality (not a quick "urgent" version) in the current voice and speed. */
  isFinal(i) {
    return this.isFresh(i) && !this.segments[i].clip.plain;
  }

  /** How many sentences are prepared in full quality in the current voice and speed. */
  get readyCount() {
    let n = 0;
    for (let i = 0; i < this.sentences.length; i++) if (this.isFinal(i)) n++;
    return n;
  }

  /** True when every sentence is prepared in the current voice and speed. */
  get complete() {
    return this.sentences.length > 0 && this.readyCount === this.sentences.length;
  }

  /** True while the old voice is still heard after a voice change. */
  get switching() {
    return this.state !== 'idle' && this.loaded !== null && this.loaded.voice !== this.voice;
  }

  /** Preparation speed compared with playback (above 1 keeps ahead), or null. */
  get prepRatio() {
    return prepRatio(this.stats, this.tempo);
  }

  /** Playback position through the whole document, 0..1. */
  get position() {
    const n = this.sentences.length;
    if (!n) return 0;
    let within = 0;
    if (this.#holdsCurrent()) {
      const { start, end } = this.#span(this.loaded, this.current);
      within = Math.min(1, Math.max(0, (this.audio.currentTime * RATE - start) / (end - start)));
    }
    return (this.current + within) / n;
  }

  /** The whole reading as one WAV file (one voice, one speed), or null if not finished. */
  toWav() {
    if (!this.complete) return null;
    const parts = this.segments.map(({ clip, k }) => clip.pcm.subarray(clip.offsets[k], clip.offsets[k + 1]));
    return wavBlob(parts, RATE);
  }

  // ---- playback internals --------------------------------------------------

  // Where sentence i lies inside a clip (samples).
  #span(clip, i) {
    const k = i - clip.first;
    return { start: clip.offsets[k], end: clip.offsets[k + 1] };
  }

  #holdsCurrent() {
    const clip = this.loaded;
    return Boolean(clip) && this.current >= clip.first && this.current <= clip.last;
  }

  // Seconds of listening a prepared sentence gives at the current tempo.
  #seconds(i) {
    const seg = this.segments[i];
    if (!seg) return null;
    const { start, end } = this.#span(seg.clip, i);
    return ((end - start) / RATE) * speedFactor(seg.clip.speed) / this.tempo;
  }

  #startAt(index) {
    this.current = index;
    const seg = this.segments[index];
    if (!seg) {
      // Silence the previous sentence, but let the "unlock" sound finish.
      if (this.audio.src !== this.silentUrl) this.audio.pause();
      this.loaded = null;
      this.#setState('waiting');
      this.#pump();
      return;
    }
    const a = this.audio;
    if (this.loaded !== seg.clip) {
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(wavBlob([seg.clip.pcm], RATE));
      a.src = this.url;
      a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = true;
      this.loaded = seg.clip;
    }
    a.currentTime = this.#span(seg.clip, index).start / RATE;
    this.#applyRate();
    this.#setState('playing');
    a.play().catch((e) => this.#playFailed(e));
    this.starting = false;
    this.#emit('time');
    this.#pump();
  }

  // Follows the playback position: moves the highlight, and switches to a
  // newer clip (new voice or speed) at the first sentence boundary where one
  // is ready.
  #tick() {
    const clip = this.loaded;
    if (!clip || (this.state !== 'playing' && this.state !== 'paused')) return;
    const index = clip.first + sentenceAt(clip.offsets, this.audio.currentTime * RATE);
    if (index !== this.current && this.state === 'playing') {
      this.current = index;
      this.#emit('sentence');
      if (this.segments[index] && this.segments[index].clip !== clip) {
        this.#startAt(index);
        return;
      }
    }
    this.#emit('time');
  }

  #loop = () => {
    this.frame = null;
    if (this.state !== 'playing') return;
    this.#tick();
    this.frame = requestAnimationFrame(this.#loop);
  };

  #clipEnded() {
    if (this.state !== 'playing' || !this.loaded) return;
    const next = this.loaded.last + 1;
    if (next < this.sentences.length) {
      this.current = next;
      this.#emit('sentence');
      if (!this.segments[next]) this.#ranDry();
      this.#startAt(next);
    } else {
      this.stop(); // finished: back to the start, ready to play again
    }
  }

  // A clip made at a faster speed is played correspondingly slower, so the
  // listener always hears the chosen tempo.
  #applyRate() {
    const rate = this.tempo / speedFactor(this.loaded ? this.loaded.speed : 1);
    this.audio.defaultPlaybackRate = rate; // survives changing the clip
    this.audio.playbackRate = rate;
  }

  #playFailed(error) {
    if (error?.name === 'AbortError') return; // a newer clip replaced this one
    this.#setState('paused');
    if (error?.name !== 'NotAllowedError') this.#emit('error', { error, fatal: false });
  }

  // Playback caught up with preparation. If this device is simply slower than
  // playback, it would now stop at every call; instead wait until a few
  // seconds are ready before carrying on, and tell the listener once.
  #ranDry() {
    const ratio = this.prepRatio;
    if (ratio === null || ratio >= 1) return; // a one-off hiccup: carry on as soon as possible
    this.refilling = true;
    if (!this.slowNoticed) {
      this.slowNoticed = true;
      this.#emit('slow');
    }
  }

  // Seconds ready to play without a gap from the current sentence (any voice),
  // and whether that reaches the end.
  #readyAhead() {
    let seconds = 0;
    let i = this.current;
    for (; i < this.sentences.length && this.segments[i]; i++) seconds += this.#seconds(i);
    return { seconds, toEnd: i === this.sentences.length };
  }

  #unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.silentUrl = URL.createObjectURL(silentWav());
    this.audio.src = this.silentUrl;
    this.audio.play().catch(() => {});
  }

  // ---- preparation ---------------------------------------------------------

  /** The sentence heard right now from an out-of-date clip (it keeps playing), or -1. */
  #heardStale() {
    const active = this.state === 'playing' || this.state === 'paused';
    return active && this.#holdsCurrent() && !this.isFresh(this.current) ? this.current : -1;
  }

  // Makes sure the phonemes of `count` sentences from `start` on are known
  // (a call may use up to 12 sentences plus the one after it).
  async #ensurePhonemes(lang, start, count = MAX_SENTENCES + 2) {
    if (!this.phonemes.has(lang)) this.phonemes.set(lang, new Array(this.sentences.length).fill(null));
    const known = this.phonemes.get(lang);
    const wanted = [];
    for (let i = start; i < Math.min(this.sentences.length, start + count); i++) if (!known[i]) wanted.push(i);
    if (!wanted.length) return;
    const texts = wanted.map((i) => this.sentences[i].text);
    const heads = wanted.map((i) => firstWords(this.sentences[i].text));
    let out;
    try {
      out = await this.engine.phonemize([...texts, ...heads], lang);
    } catch (error) {
      if (error.phase !== 'generate') throw error;
      out = []; // unreadable: these sentences are skipped with a short silence
    }
    wanted.forEach((i, j) => {
      const ph = out[j] ?? '';
      const head = out[j + wanted.length] ?? '';
      known[i] = { ph, head, n: [...ph].length, headN: [...head].length };
    });
  }

  // Longest call allowed now (phonemes): shorter on the graphics chip, and
  // shorter still while the page is hidden or has only just come back.
  #maxPhonemes() {
    if (this.engine.device !== 'webgpu') return Infinity;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const justBack = performance.now() - this.shownAt < VISIBLE_SETTLE_MS;
    return hidden || justBack ? Math.min(this.gpuCap, GPU_CAP_HIDDEN) : this.gpuCap;
  }

  async #pump() {
    if (this.busy || this.halted || !this.sentences.length) return;
    this.busy = true;
    let again = false;
    try {
      again = await this.#prepareNext();
    } catch (error) {
      again = this.#failed(error);
    }
    this.busy = false;
    // On the graphics chip, leave it free for a moment between calls.
    if (again && this.engine.device === 'webgpu') setTimeout(() => this.#pump(), GPU_REST_MS);
    else if (again) this.#pump();
  }

  // Plans and makes one call. Returns true when there may be more to do.
  async #prepareNext() {
    const { epoch, voice, speed, sentences } = this;
    const n = sentences.length;
    let fresh = sentences.map((_, i) => this.isFresh(i));
    const stale = this.#heardStale();
    let start = chooseStart(fresh, this.current, stale);
    // Everything playable: re-make sentences that were made quickly ("urgent") in full quality.
    let upgrade = false;
    if (start < 0) {
      fresh = sentences.map((_, i) => this.isFinal(i));
      start = chooseStart(fresh, this.current);
      upgrade = true;
    }
    if (start < 0) return false;
    const lang = voice[0] === 'b' ? 'b' : 'a';
    // Only this sentence and the next are needed for a one-sentence call, and
    // only this one for an urgent call (phonemes for 28 texts take about half
    // a second, which would delay the first audio).
    const nothingYet = start === this.current && !this.segments[start] && !upgrade;
    await this.#ensurePhonemes(lang, start, nothingYet ? 1 : 2);
    if (epoch !== this.epoch || voice !== this.voice || speed !== this.speed) return true; // changed meanwhile: plan again
    // The listener is waiting for the first sound: make this sentence quickly and plainly.
    const urgent = nothingYet && this.starting && this.state === 'waiting';
    if (!urgent) {
      await this.#ensurePhonemes(lang, start, 2); // the next sentence: look-ahead and voice row
      if (epoch !== this.epoch || voice !== this.voice || speed !== this.speed) return true;
    }
    const phonemes = this.phonemes.get(lang);
    const measured = this.stats.length > 0;
    const predict = (tokens) => predictMs(this.stats, tokens) ?? 0;
    const seconds = sentences.map((_, i) => this.#seconds(i));

    // After a voice or speed change, while the old audio plays on: take over
    // at the first sentence the new audio can be ready for in time.
    const old = this.loaded;
    if (this.state === 'playing' && old && (old.voice !== voice || old.speed !== speed) && this.#holdsCurrent() && start > this.current && measured) {
      const alone = (k) => {
        if (!phonemes[k]?.n) return Infinity;
        return predict(planCall({ sentences, phonemes, fresh, start: k, rule: { maxSentences: 1, maxMs: Infinity }, single: this.single }).tokens);
      };
      await this.#ensurePhonemes(lang, start);
      if (epoch !== this.epoch || voice !== this.voice || speed !== this.speed) return true;
      const { end } = this.#span(old, this.current);
      const remaining = Math.max(0, ((end / RATE - this.audio.currentTime) * speedFactor(old.speed)) / this.tempo);
      // (only sentences whose phonemes are known count: up to 13 past `start`)
      start = takeoverStart({ start, current: this.current, remaining, seconds, predictMs: alone, fresh });
      await this.#ensurePhonemes(lang, start, 2);
      if (epoch !== this.epoch || voice !== this.voice || speed !== this.speed) return true;
    }

    // How large this call may be (see flow/plan.js).
    let elapsed = 0;
    if (this.#holdsCurrent() && fresh[this.current]) {
      const { start: s } = this.#span(this.loaded, this.current);
      elapsed = ((this.audio.currentTime - s / RATE) * speedFactor(this.loaded.speed)) / this.tempo;
    }
    const budgetSeconds = upgrade ? Infinity : freshAhead({ fresh, seconds, current: this.current, elapsed, start });
    const rule = sizeRule({ ordinal: this.ordinal, budgetSeconds, measured, sizing: this.sizing });
    if (!urgent && rule.maxSentences > 1) {
      await this.#ensurePhonemes(lang, start); // the call may grow: know its neighbours
      if (epoch !== this.epoch || voice !== this.voice || speed !== this.speed) return true;
    }
    // The growth floor (see flow/plan.js) only when nothing at all is playable
    // there yet; while old-voice audio can fill in, small calls take over sooner.
    const growth = this.segments[start] ? 0 : listenPerToken(this.stats) / this.tempo;
    const options = { sentences, phonemes, fresh, start, rule, predict, single: this.single, listenPerToken: growth, maxPhonemes: this.#maxPhonemes() };
    let call = planCall({ ...options, plain: urgent });
    // Early in a reading, if the full-quality call cannot be ready before the
    // listener needs it, a wait is coming anyway: keep it short with a plain call.
    const listening = this.state === 'playing' || this.state === 'waiting';
    if (!call.plain && !upgrade && listening && this.ordinal < 2 && measured && predict(call.tokens) > budgetSeconds * 1000) {
      call = planCall({ ...options, plain: true });
    }

    const indices = [];
    for (let i = call.first; i <= call.last; i++) indices.push(i);
    if (indices.some((i) => !phonemes[i].n)) return this.#giveUp(indices, new Error('Nothing to read in this sentence.'));
    const members = indices.map((i) => phonemes[i].ph);
    if (call.lookahead >= 0) members.push(phonemes[call.lookahead].head);
    const text = indices.map((i) => sentences[i].text).join(' ');

    let result;
    try {
      result = await this.engine.render({ phonemes: members.join(' '), voice, speed, row: call.row, text });
    } catch (error) {
      if (error.phase !== 'generate') throw error;
      // A group failed: make its sentences one by one; a lone sentence is skipped.
      if (indices.length > 1 || call.lookahead >= 0) {
        for (const i of indices) this.single.add(i);
        return true;
      }
      return this.#giveUp(indices, error);
    }
    if (epoch !== this.epoch) return true; // new text was loaded meanwhile
    this.ordinal++;

    const endsParagraph = (i) => i === n - 1 || sentences[i + 1].para !== sentences[i].para;
    // Pauses are shortened for faster clips so they sound right when played slower.
    const pauses = indices.map((i) => designedPause(sentences[i], endsParagraph(i)) / speedFactor(speed));
    const joinedInside = indices.map((i) => i < call.last && Boolean(sentences[i].joined));
    const built = call.plain ? plainClip(result.samples, pauses[0], call.first + 1) : assembleCall({
      audio: result.samples,
      durations: result.durations,
      members,
      lookahead: call.lookahead >= 0,
      pauses,
      joinedInside,
      fadeIn: call.first === 0 ? 0.008 : 0.002,
      seed: call.first + 1,
    });
    this.calls.push({ ...call, voice, speed, ms: result.ms, method: built?.method ?? 'failed' });
    if (!built) {
      // The sentences could not be told apart: make them one by one instead.
      for (const i of indices) this.single.add(i);
      return true;
    }
    const clip = { pcm: toInt16(built.samples), offsets: built.offsets, first: call.first, last: call.last, voice, speed, plain: Boolean(call.plain) };
    const kept = callLength(phonemes, call.first, call.last);
    this.stats.push({ tokens: result.tokens, kept, ms: result.ms, seconds: built.samples.length / RATE, speed });
    this.#store(clip);
    return true;
  }

  // Files a finished clip. A clip in a voice or speed that was changed
  // meanwhile only fills gaps (it is playable until its replacement is ready);
  // otherwise it replaces what was there.
  #store(clip) {
    const current = clip.voice === this.voice && clip.speed === this.speed;
    for (let i = clip.first; i <= clip.last; i++) {
      if (current || !this.segments[i]) this.segments[i] = { clip, k: i - clip.first };
    }
    this.#emit('generated');
    if (this.state === 'waiting' && this.segments[this.current]) {
      const ahead = this.#readyAhead();
      if (!this.refilling || ahead.toEnd || ahead.seconds >= REFILL_SECONDS) {
        this.refilling = false;
        this.#startAt(this.current);
      }
    }
  }

  // One sentence could not be read: leave a short silence and carry on.
  #giveUp(indices, error) {
    for (const i of indices) {
      const pcm = new Int16Array(Math.round(0.3 * RATE));
      this.#store({ pcm, offsets: [0, pcm.length], first: i, last: i, voice: this.voice, speed: this.speed });
      this.failedCount++;
      this.#emit('error', { error, fatal: false, index: i });
    }
    return true;
  }

  #failed(error) {
    if (error?.phase === 'cancelled') return true; // engine restarted: ask again
    // The model itself is unavailable; nothing else will work until it loads.
    this.halted = true;
    if (this.state === 'waiting') this.#setState('paused');
    this.#emit('error', { error, fatal: true });
    return false;
  }

  #setState(state) {
    if (state === this.state) return;
    this.state = state;
    if (state === 'playing' && !this.frame && typeof requestAnimationFrame === 'function') {
      this.frame = requestAnimationFrame(this.#loop);
    }
    this.#emit('state');
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
