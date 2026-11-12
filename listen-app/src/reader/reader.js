// The Reader turns a list of sentences into continuous speech.
//
// - It asks the voice engine for one sentence at a time, starting with the one
//   being listened to and working forward, so playback can start as soon as
//   the first sentence is ready. It keeps going until the whole document is
//   done, which is what makes the download possible.
// - It plays each finished sentence through one <audio> element. The browser
//   changes tempo there without changing pitch, so the tempo slider is instant.
// - Each prepared sentence remembers the voice and speed it was made with.
//   Changing the voice (or a big tempo change, see schedule.js) never stops
//   the sound: what is already prepared keeps playing, the sentences after the
//   current one are re-made in the background, and the new voice takes over
//   at the first sentence that is ready in it.
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
import { makeClip, wavBlob, silentWav, SENTENCE_PAUSE, PARAGRAPH_PAUSE, CLAUSE_PAUSE } from './audio.js';
import { bakedSpeedFor, speedFactor, isFresh, nextToGenerate, readyAhead, prepRatio } from './schedule.js';

const SPEED_SETTLE_MS = 1000; // wait for the tempo slider to rest before re-preparing at a new speed
const REFILL_SECONDS = 5; // after running dry mid-reading, gather this much before carrying on

export class Reader extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.sentences = [];
    this.clips = []; // per sentence: { pcm: Int16Array, voice, speed, seconds } or null
    this.current = 0;
    this.state = 'idle';
    this.voice = 'af_heart';
    this.tempo = 1;
    this.speed = 1; // the speed new clips are made at (follows the tempo, see schedule.js)
    this.failedCount = 0;
    this.sampleRate = 24000;
    this.stats = []; // { index, chars, ms, seconds, speed } per generated sentence
    this.epoch = 0; // bumps when new text is loaded
    this.busy = false;
    this.halted = false; // the engine could not load; wait for retry()
    this.loadedIndex = -1; // which sentence the <audio> element holds
    this.heardVoice = null; // the voice of the clip in the <audio> element
    this.refilling = false; // ran dry mid-reading: wait for a little lead before carrying on
    this.slowNoticed = false;
    this.speedTimer = null;
    this.url = null;
    this.unlocked = false;
    this.silentUrl = null;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.#advance());
    this.audio.addEventListener('timeupdate', () => this.#emit('time'));
  }

  // ---- loading -----------------------------------------------------------

  load(sentences) {
    this.stop();
    this.sentences = sentences;
    this.epoch++;
    this.clips = new Array(sentences.length).fill(null);
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
    if (this.clips.some(Boolean)) this.speedTimer = setTimeout(settle, SPEED_SETTLE_MS);
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
    if (this.state === 'paused' && this.loadedIndex === this.current && !this.audio.ended) {
      this.#setState('playing');
      this.audio.play().catch((e) => this.#playFailed(e));
    } else {
      this.#startClip(this.current);
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
    this.loadedIndex = -1;
    this.heardVoice = null;
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
    this.loadedIndex = -1;
    this.refilling = false;
    this.#emit('sentence');
    if (play) this.#unlock();
    if (play || this.state === 'playing' || this.state === 'waiting') this.#startClip(this.current);
    else {
      this.audio.pause();
      this.#emit('time');
      this.#pump();
    }
  }

  // ---- results -----------------------------------------------------------

  /** How many sentences are prepared in the current voice and speed. */
  get readyCount() {
    let n = 0;
    for (const clip of this.clips) if (isFresh(clip, this.voice, this.speed)) n++;
    return n;
  }

  /** True when every sentence is prepared in the current voice and speed. */
  get complete() {
    return this.sentences.length > 0 && this.readyCount === this.sentences.length;
  }

  /** True while the old voice is still heard after a voice change. */
  get switching() {
    return this.state !== 'idle' && this.heardVoice !== null && this.heardVoice !== this.voice;
  }

  /** Preparation speed compared with playback (above 1 keeps ahead), or null. */
  get prepRatio() {
    return prepRatio(this.stats, this.tempo);
  }

  /** Playback position through the whole document, 0..1. */
  get position() {
    const n = this.sentences.length;
    if (!n) return 0;
    const a = this.audio;
    const within = this.loadedIndex === this.current && a.duration ? a.currentTime / a.duration : 0;
    return (this.current + within) / n;
  }

  /** The whole reading as one WAV file (one voice, one speed), or null if not finished. */
  toWav() {
    return this.complete ? wavBlob(this.clips.map((c) => c.pcm), this.sampleRate) : null;
  }

  // ---- internals ---------------------------------------------------------

  #startClip(index) {
    this.current = index;
    const clip = this.clips[index];
    if (!clip) {
      // Silence the previous sentence, but let the "unlock" sound finish.
      if (this.audio.src !== this.silentUrl) this.audio.pause();
      this.#setState('waiting');
      this.#pump();
      return;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(wavBlob([clip.pcm], this.sampleRate));
    const a = this.audio;
    a.src = this.url;
    a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = true;
    this.loadedIndex = index;
    this.heardVoice = clip.voice;
    this.#applyRate();
    this.#setState('playing');
    a.play().catch((e) => this.#playFailed(e));
    this.#pump();
  }

  // A clip made at a faster speed is played correspondingly slower, so the
  // listener always hears the chosen tempo.
  #applyRate() {
    const clip = this.clips[this.loadedIndex];
    const rate = this.tempo / speedFactor(clip ? clip.speed : 1);
    this.audio.defaultPlaybackRate = rate; // survives changing the clip
    this.audio.playbackRate = rate;
  }

  #playFailed(error) {
    if (error?.name === 'AbortError') return; // a newer clip replaced this one
    this.#setState('paused');
    if (error?.name !== 'NotAllowedError') this.#emit('error', { error, fatal: false });
  }

  #advance() {
    if (this.state !== 'playing') return;
    if (this.current < this.sentences.length - 1) {
      this.current++;
      this.#emit('sentence');
      if (!this.clips[this.current]) this.#ranDry();
      this.#startClip(this.current);
    } else {
      this.stop(); // finished: back to the start, ready to play again
    }
  }

  // Playback caught up with preparation. If this device is simply slower than
  // playback, it would now stop at every sentence; instead wait until a few
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

  #unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.silentUrl = URL.createObjectURL(silentWav());
    this.audio.src = this.silentUrl;
    this.audio.play().catch(() => {});
  }

  /** The sentence whose clip is in the player and not finished, or -1. */
  #inPlayer() {
    const active = this.state === 'playing' || this.state === 'paused';
    return active && this.loadedIndex === this.current ? this.current : -1;
  }

  #pauseAfter(index) {
    const sentence = this.sentences[index];
    if (sentence.para !== this.sentences[index + 1]?.para) return PARAGRAPH_PAUSE;
    return sentence.joined ? CLAUSE_PAUSE : SENTENCE_PAUSE;
  }

  async #pump() {
    if (this.busy || this.halted) return;
    const index = nextToGenerate(this.clips, this.current, this.voice, this.speed, this.#inPlayer());
    if (index < 0) return;
    this.busy = true;
    const { epoch, voice, speed } = this;
    const sentence = this.sentences[index];
    let result;
    let error;
    try {
      result = await this.engine.generate(sentence.text, voice, speed);
    } catch (e) {
      error = e;
    }
    this.busy = false;

    if (epoch !== this.epoch) return this.#pump(); // new text was loaded meanwhile
    if (error?.phase === 'cancelled') return this.#pump(); // engine restarted: ask again
    if (error && error.phase !== 'generate') {
      // The model itself is unavailable; nothing else will work until it loads.
      this.halted = true;
      if (this.state === 'waiting') this.#setState('paused');
      this.#emit('error', { error, fatal: true });
      return;
    }
    // Keep the result unless the sentence meanwhile got a clip in the current
    // voice and speed. A result in a voice that was since changed is still
    // worth keeping: it is playable until its replacement is ready.
    if (!isFresh(this.clips[index], this.voice, this.speed)) {
      // Pauses are shortened for faster clips so they sound right when played slower.
      const pause = this.#pauseAfter(index) / speedFactor(speed);
      let samples = new Float32Array(0);
      if (error) {
        // One sentence failed: leave a short silence and carry on with the rest.
        this.failedCount++;
        this.#emit('error', { error, fatal: false, index });
      } else {
        samples = result.samples;
        this.sampleRate = result.sampleRate;
        this.stats.push({ index, chars: sentence.text.length, ms: result.ms, seconds: samples.length / result.sampleRate + pause, speed });
      }
      const pcm = makeClip(samples, this.sampleRate, pause);
      this.clips[index] = { pcm, voice, speed, seconds: pcm.length / this.sampleRate };
    }
    this.#emit('generated');
    if (this.state === 'waiting' && this.clips[this.current]) {
      const ahead = readyAhead(this.clips, this.current, this.tempo);
      if (!this.refilling || ahead.toEnd || ahead.seconds >= REFILL_SECONDS) {
        this.refilling = false;
        this.#startClip(this.current);
      }
    }
    this.#pump();
  }

  #setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.#emit('state');
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
