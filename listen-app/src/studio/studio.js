// The studio voice: an acted voice made on the owner's own cloud machine
// instead of on this device (research/colab-studio/REPORT.md).
//
// The page talks to a small "helper" at an address the owner pastes into the
// settings once, together with its key. Both stay in this browser's storage;
// they are never part of the app's code. Nothing is sent anywhere unless the
// Studio switch is on and Play was pressed.
//
// How it fits the reader: the device's own voice (Kokoro) prepares and plays
// as always. When listening starts, the helper is asked to start the studio
// (about two minutes). Once it is ready, the sentences ahead of the listener
// are asked for one at a time, and each one that comes back replaces the
// device's version before it is heard (reader.adopt). A sentence that is late,
// refused or lost simply stays as it was. The helper stops the machine by
// itself after a quiet spell.
//
// Events: 'change' whenever studio.state or studio.note changed.
//   state: 'off' | 'unset' | 'idle' | 'starting' | 'ready' | 'error'
import { studioLine, studioVoiceFor, lineId } from './moods.js';

const POLL_MS = 3000;
const LINE_TIMEOUT_MS = 90_000;
const AHEAD = 40; // sentences ahead of the listener to ask for, at most
const KEEP = 600; // sentences kept in memory for this visit

/** 16-bit mono WAV bytes -> samples, or null when it is something else. */
export function wavSamples(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 44 || v.getUint32(0) !== 0x52494646 || v.getUint32(8) !== 0x57415645) return null;
  let at = 12;
  let ok = false;
  while (at + 8 <= v.byteLength) {
    const id = v.getUint32(at);
    const size = v.getUint32(at + 4, true);
    if (id === 0x666d7420) ok = v.getUint16(at + 8, true) === 1 && v.getUint16(at + 10, true) === 1 && v.getUint32(at + 12, true) === 24000 && v.getUint16(at + 22, true) === 16;
    if (id === 0x64617461) {
      if (!ok) return null;
      const bytes = Math.min(size, v.byteLength - at - 8) & ~1;
      return new Int16Array(buffer.slice(at + 8, at + 8 + bytes));
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

/** "https://host/#key" (one thing to paste) or a bare address -> { url, key }. */
export function parseLink(link) {
  const m = String(link ?? '').trim().match(/^(https:\/\/[^\s#]+?)\/?(?:#(\S+))?$/);
  return m ? { url: m[1], key: m[2] ?? '' } : null;
}

export class Studio extends EventTarget {
  constructor(reader, { fetch: fetchFn = (...a) => fetch(...a) } = {}) {
    super();
    this.reader = reader;
    this.fetch = fetchFn;
    this.on = false;
    this.url = '';
    this.key = '';
    this.state = 'off';
    this.note = '';
    this.made = new Map(); // line id -> samples (this visit)
    this.failed = new Set(); // line ids that were refused: not asked again
    this.busy = false;
    this.timer = null;
    this.wanted = false; // the listener pressed Play since the page opened
    reader.addEventListener('sentence', () => this.#work());
    reader.addEventListener('generated', () => this.#work());
    reader.addEventListener('state', () => {
      if (reader.state === 'playing' || reader.state === 'waiting') this.listen();
    });
  }

  configure({ on, url, key }) {
    this.on = Boolean(on);
    this.url = url ?? '';
    this.key = key ?? '';
    clearTimeout(this.timer);
    if (!this.on) this.#set('off');
    else if (!this.url || !this.key) this.#set('unset');
    else {
      this.#set('idle');
      if (this.wanted) this.#poll(true);
    }
    this.#voice();
  }

  /** The voice in the picker changed: the studio voice follows (a woman's or a man's). */
  voiceChanged() {
    this.#voice();
    this.#work();
  }

  /** Listening began: start the studio if it is not running. */
  listen() {
    this.wanted = true;
    if (this.state === 'idle' || this.state === 'error') this.#poll(true);
  }

  #voice() {
    const usable = this.on && this.state !== 'unset' && this.state !== 'off';
    this.reader.setStudioVoice(usable ? studioVoiceFor(this.reader.voice) : null);
  }

  #set(state, note = '') {
    if (state === this.state && note === this.note) return;
    this.state = state;
    this.note = note;
    this.dispatchEvent(new Event('change'));
  }

  async #call(path, { method = 'GET', body, timeout = 20_000 } = {}) {
    const headers = { Authorization: `Bearer ${this.key}` };
    if (body) headers['Content-Type'] = 'application/json';
    return this.fetch(`${this.url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  }

  // Asks the helper how things stand (and, with `start`, to start the studio), until it is ready.
  async #poll(start = false) {
    clearTimeout(this.timer);
    const { url, key } = this;
    try {
      const response = await this.#call(start ? '/start' : '/status', { method: start ? 'POST' : 'GET' });
      if (url !== this.url || key !== this.key || !this.on) return;
      if (response.status === 401) return this.#set('error', 'The studio key was not accepted.');
      if (response.status === 429) return this.#set('error', 'The studio has reached its limit for today.');
      const status = await response.json();
      if (status.state === 'ready') {
        this.#set('ready');
        this.#voice();
        this.#work();
        return;
      }
      if (status.state === 'idle' && !start) {
        // It stopped (a quiet spell, or it failed to start): start again only when the listener plays.
        this.#set(status.error ? 'error' : 'idle', status.error ? 'The studio could not start.' : '');
        return;
      }
      this.#set('starting');
    } catch {
      if (url !== this.url || !this.on) return;
      this.#set('error', 'The studio cannot be reached.');
      return;
    }
    this.timer = setTimeout(() => this.#poll(), POLL_MS);
  }

  // The next sentence worth asking for: from the one being heard on, the first
  // that the studio has not made, refused, or been asked for.
  #next() {
    const { reader } = this;
    const voice = reader.studioVoice;
    if (!voice || !reader.sentences.length) return null;
    const deliveries = reader.deliveries();
    const active = reader.state === 'playing' || reader.state === 'paused';
    const from = reader.current + (active ? 1 : 0);
    for (let i = from; i < Math.min(reader.sentences.length, from + AHEAD); i++) {
      if (reader.segments[i]?.clip.studio === voice) continue;
      const parts = deliveries[i].parts;
      if (parts.some((p) => p.lang !== 'en')) continue; // German and Spanish stay with the device's voice
      const line = studioLine(parts.map((p) => p.text).join(' '));
      if (!line) continue;
      const id = lineId(voice, line.text);
      if (this.failed.has(id)) continue;
      return { index: i, id, voice, line };
    }
    return null;
  }

  async #work() {
    if (this.busy || this.state !== 'ready') return;
    const job = this.#next();
    if (!job) return;
    this.busy = true;
    const { reader } = this;
    const { epoch } = reader;
    try {
      let pcm = this.made.get(job.id);
      if (!pcm) {
        const response = await this.#call('/line', { method: 'POST', timeout: LINE_TIMEOUT_MS, body: { id: job.id, voice: job.voice, text: job.line.text, expect: job.line.expect, kind: 'speech', seed: 1 } });
        if (response.status === 200) pcm = wavSamples(await response.arrayBuffer());
        else if (response.status === 503) {
          // The studio is not running any more: find out, and start it again at the next Play.
          this.busy = false;
          this.#set('idle');
          if (reader.state === 'playing') this.#poll(true);
          return;
        }
        if (pcm) {
          this.made.set(job.id, pcm);
          if (this.made.size > KEEP) this.made.delete(this.made.keys().next().value);
        }
      }
      if (!pcm) this.failed.add(job.id);
      // Too late for this sentence (it is being heard)? Then it stays in memory for a second listen.
      else reader.adopt(job.index, pcm, { epoch, voice: job.voice });
    } catch {
      this.failed.add(job.id); // lost on the way: the device's own voice reads it
    }
    this.busy = false;
    this.dispatchEvent(new Event('change'));
    this.#work();
  }
}
