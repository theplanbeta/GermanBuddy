// The Reader turns a list of sentences into continuous speech.
//
// - It asks the voice engine for one sentence at a time, starting with the one
//   being listened to and working forward, so playback can start as soon as
//   the first sentence is ready. It keeps going until the whole document is
//   done, which is what makes the download possible.
// - It plays each finished sentence through one <audio> element. The browser
//   changes tempo there without changing pitch, so the tempo slider is instant.
//
// Any "source" (pasted text today; files, photos, web pages later) just calls
// reader.load(sentences).
//
// Events (listen with reader.addEventListener):
//   'state'      reader.state is now 'idle' | 'waiting' | 'playing' | 'paused'
//   'sentence'   reader.current changed
//   'generated'  another sentence is ready (reader.readyCount)
//   'time'       playback position moved (reader.position, 0..1)
//   'error'      event.detail = { error, fatal }
import { makeClip, wavBlob, silentWav, SENTENCE_PAUSE, PARAGRAPH_PAUSE } from './audio.js';

export class Reader extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.sentences = [];
    this.clips = []; // Int16Array per sentence, including its trailing pause
    this.current = 0;
    this.state = 'idle';
    this.voice = 'af_heart';
    this.tempo = 1;
    this.readyCount = 0;
    this.failedCount = 0;
    this.sampleRate = 24000;
    this.stats = []; // { index, chars, ms, seconds } per generated sentence (for checking speed)
    this.epoch = 0; // bumps whenever existing clips become useless
    this.busy = false;
    this.halted = false; // the engine could not load; wait for retry()
    this.loadedIndex = -1; // which sentence the <audio> element holds
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
    this.#resetClips();
    this.#emit('sentence');
    this.#pump();
  }

  setVoice(voice) {
    if (voice === this.voice) return;
    this.voice = voice;
    if (!this.sentences.length) return;
    this.#resetClips();
    if (this.state === 'playing' || this.state === 'waiting') this.#startClip(this.current);
    else this.#pump();
  }

  setTempo(tempo) {
    this.tempo = tempo;
    this.audio.defaultPlaybackRate = tempo; // survives changing the clip
    this.audio.playbackRate = tempo;
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
    this.current = 0;
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

  get complete() {
    return this.sentences.length > 0 && this.readyCount === this.sentences.length;
  }

  /** Playback position through the whole document, 0..1. */
  get position() {
    const n = this.sentences.length;
    if (!n) return 0;
    const a = this.audio;
    const within = this.loadedIndex === this.current && a.duration ? a.currentTime / a.duration : 0;
    return (this.current + within) / n;
  }

  /** The whole reading as one WAV file, or null if it is not finished yet. */
  toWav() {
    return this.complete ? wavBlob(this.clips, this.sampleRate) : null;
  }

  // ---- internals ---------------------------------------------------------

  #resetClips() {
    this.epoch++;
    this.clips = new Array(this.sentences.length);
    this.readyCount = 0;
    this.failedCount = 0;
    this.loadedIndex = -1;
    this.#emit('generated');
  }

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
    this.url = URL.createObjectURL(wavBlob([clip], this.sampleRate));
    const a = this.audio;
    a.src = this.url;
    a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = true;
    a.defaultPlaybackRate = a.playbackRate = this.tempo;
    this.loadedIndex = index;
    this.#setState('playing');
    a.play().catch((e) => this.#playFailed(e));
    this.#pump();
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
      this.#startClip(this.current);
    } else {
      this.stop(); // finished: back to the start, ready to play again
    }
  }

  #unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.silentUrl = URL.createObjectURL(silentWav());
    this.audio.src = this.silentUrl;
    this.audio.play().catch(() => {});
  }

  #nextToGenerate() {
    const n = this.sentences.length;
    for (let k = 0; k < n; k++) {
      const i = (this.current + k) % n; // current first, then forward, then wrap round
      if (!this.clips[i]) return i;
    }
    return -1;
  }

  async #pump() {
    if (this.busy || this.halted) return;
    const index = this.#nextToGenerate();
    if (index < 0) return;
    this.busy = true;
    const epoch = this.epoch;
    const sentence = this.sentences[index];
    const isParagraphEnd = sentence.para !== this.sentences[index + 1]?.para;
    const pause = isParagraphEnd ? PARAGRAPH_PAUSE : SENTENCE_PAUSE;
    let result;
    let error;
    try {
      result = await this.engine.generate(sentence.text, this.voice);
    } catch (e) {
      error = e;
    }
    this.busy = false;

    if (epoch !== this.epoch) return this.#pump(); // text or voice changed meanwhile
    if (error && error.phase !== 'generate') {
      // The model itself is unavailable; nothing else will work until it loads.
      this.halted = true;
      if (this.state === 'waiting') this.#setState('paused');
      this.#emit('error', { error, fatal: true });
      return;
    }
    if (error) {
      // One sentence failed: leave a short silence and carry on with the rest.
      this.clips[index] = makeClip(new Float32Array(0), this.sampleRate, pause);
      this.failedCount++;
      this.#emit('error', { error, fatal: false, index });
    } else {
      const { samples, sampleRate, ms } = result;
      this.sampleRate = sampleRate;
      this.clips[index] = makeClip(samples, sampleRate, pause);
      this.stats.push({ index, chars: sentence.text.length, ms, seconds: samples.length / sampleRate });
    }
    this.readyCount++;
    this.#emit('generated');
    if (this.state === 'waiting' && index === this.current) this.#startClip(index);
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
