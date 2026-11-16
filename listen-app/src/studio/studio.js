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
// "Studio only" (setOnly): the device's voice is off (it lags on some phones),
// so the reader waits for each sentence until the studio has made it. Then the
// sentence at the listener's position is asked for too (unless it is already
// being heard), German and Spanish sentences go to the studio as well, and a
// sentence too long for one line is asked for in parts, joined into one clip.
// A sentence the studio refuses (422, or audio that cannot be read) is passed
// over with a short pause and counted (reader.studioSkipped), so nothing hangs.
// No answer (no network, the studio busy or stopped) is never the sentence's
// fault: the reader keeps waiting on it, the status line says what is wrong,
// and the line is asked for again every little while, but only while someone
// listens (Play carries on), so nothing runs on in a pocket.
//
// Events: 'change' whenever studio.state or studio.note changed.
//   state: 'off' | 'unset' | 'idle' | 'starting' | 'ready' | 'error'
import { studioLine, studioLines, studioVoiceFor, lineId } from './moods.js';

const GAP = 0.12; // seconds of quiet between the parts of a sentence asked for in parts (a clause break)
const POLL_MS = 3000;
const LINE_TIMEOUT_MS = 90_000;
const AHEAD = 40; // sentences ahead of the listener to ask for, at most
const KEEP = 600; // sentences kept in memory for this visit
const TRIES = 2; // a line that got no answer is asked for once more, then left to the device's voice (not in "Studio only")
const RETRY_MS = 8000; // after trouble on the way (no network, helper busy): wait, then carry on
const MISSES = 40; // unanswered questions in a row to the helper before giving up until the next Play

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

/** The parts of one sentence as one clip, with a short quiet between them (one part: as it is). */
export function joined(pieces, rate = 24000) {
  if (pieces.length === 1) return pieces[0];
  const gap = Math.round(GAP * rate);
  const out = new Int16Array(pieces.reduce((n, p) => n + p.length, 0) + gap * (pieces.length - 1));
  let at = 0;
  pieces.forEach((p, k) => {
    out.set(p, at);
    at += p.length + (k < pieces.length - 1 ? gap : 0);
  });
  return out;
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
    this.only = false; // "Studio only" (see the top): set by setOnly()
    this.url = '';
    this.key = '';
    this.state = 'off';
    this.note = '';
    this.made = new Map(); // line id -> samples (this visit)
    this.failed = new Set(); // line ids that were refused: not asked again
    this.tries = new Map(); // line id -> times it got no answer
    this.retryTimer = null;
    this.resting = false; // "Studio only": no answer a moment ago; only the retry (or Play) asks again
    this.busy = false;
    this.timer = null;
    this.wanted = false; // the listener pressed Play since the page opened
    this.misses = 0; // questions to the helper in a row that got no answer
    this.pollRun = 0; // only the newest round of questions to the helper carries on
    reader.addEventListener('sentence', () => this.#work());
    reader.addEventListener('generated', () => this.#work());
    reader.addEventListener('state', () => {
      if (reader.state === 'playing' || reader.state === 'waiting') this.listen();
    });
    // A phone stops a page's timers and requests while the screen is off or another app is in
    // front. Back in view: pick up where it stopped.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.wake();
      });
    }
  }

  configure({ on, url, key }) {
    this.on = Boolean(on);
    this.url = url ?? '';
    this.key = key ?? '';
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.resting = false;
    if (!this.on) this.#set('off');
    else if (!this.url || !this.key) this.#set('unset');
    else {
      this.#set('idle');
      // After a Play in this visit: ask how the studio stands. Starting it stays tied to listening.
      if (this.wanted) this.#poll(this.#listening());
    }
    this.#voice();
  }

  /** "Studio only" on or off (the page sets it only while the studio is on and has a link). */
  setOnly(on) {
    this.only = Boolean(on);
    this.resting = false;
    if (this.state === 'ready' && this.note) this.#set('ready'); // a trouble note of the mode goes with it
    this.#work();
  }

  /** The voice in the picker changed: the studio voice follows (a woman's or a man's). */
  voiceChanged() {
    this.#voice();
    this.#work();
  }

  /** Listening began: start the studio if it is not running. */
  listen() {
    this.wanted = true;
    // "Studio only": a line that got no answer while nobody listened is asked for again now.
    if (this.only) this.resting = false;
    if (this.state === 'idle' || this.state === 'error') this.#poll(true);
    else if (this.only && this.state === 'ready') this.#work();
  }

  /**
   * Carries on after a pause (the page was hidden, a request was lost): asks the helper how
   * things stand. It never starts the studio; only Play does that.
   */
  wake() {
    if (!this.on || !this.wanted || this.state === 'off' || this.state === 'unset') return;
    if (this.only && this.#listening()) this.resting = false; // its retry timer may have been held up
    if (this.state === 'ready') this.#work();
    else this.#poll();
  }

  // After no answer to a line: ask again later. Without "Studio only" the line is given up
  // after TRIES (the device's voice has it), so retrying always is fine. In "Studio only" it is
  // never given up, so it is asked again only while someone listens (Play carries on, see
  // listen()), and nothing else asks for it in between.
  #retry(ms) {
    if (!this.only) return this.#later(() => this.#work(), ms, true);
    this.resting = true;
    this.#later(() => {
      this.resting = false;
      this.#work();
    }, ms);
  }

  // "Studio only": what is wrong right now, on the status line (the reader just waits meanwhile).
  #trouble(note) {
    if (this.only && this.state === 'ready') this.#set('ready', note);
  }

  #listening() {
    return this.reader.state === 'playing' || this.reader.state === 'waiting';
  }

  // Trouble that may pass (no network for a moment, the helper busy): try again a little later.
  // Tasks that could start the studio run only while someone listens; `always` is for the ones
  // that cannot (asking how things stand, asking again for a line of a studio that is running).
  #later(task, ms = RETRY_MS, always = false) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.on && (always || this.#listening())) task();
    }, ms);
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
    const run = ++this.pollRun;
    const { url, key } = this;
    try {
      const response = await this.#call(start ? '/start' : '/status', { method: start ? 'POST' : 'GET' });
      if (run !== this.pollRun || url !== this.url || key !== this.key || !this.on) return;
      this.misses = 0;
      if (response.status === 401) return this.#set('error', 'The studio key was not accepted.');
      if (response.status === 429) {
        const limit = (await response.json().catch(() => ({}))).error === 'daily limit reached';
        this.#set('error', limit ? 'The studio has reached its limit for today.' : 'The studio is busy.');
        if (!limit) this.#later(() => this.#poll(true), 30_000);
        return;
      }
      const status = await response.json();
      if (run !== this.pollRun) return; // a newer round of questions took over meanwhile
      if (status.state === 'ready') {
        this.#set('ready');
        this.#voice();
        this.#work();
        return;
      }
      if (status.state === 'idle' && !start) {
        // It stopped (a quiet spell, or it failed to start): start again only when the listener plays.
        this.#set(status.error ? 'error' : 'idle', status.error ? 'The studio could not start.' : '');
        if (!status.error) this.#later(() => this.#poll(true)); // it was just stopping: start it again
        return;
      }
      this.#set('starting');
    } catch {
      if (run !== this.pollRun || url !== this.url || !this.on) return;
      this.#set('error', 'The studio cannot be reached.');
      // Ask again, also when the text has ended meanwhile (the studio may be starting, and
      // nobody else would notice it getting ready). Starting it stays tied to listening.
      if (++this.misses < MISSES) this.#later(() => this.#poll(this.#listening()), RETRY_MS, true);
      else this.#later(() => this.#poll(true));
      return;
    }
    this.timer = setTimeout(() => this.#poll(), POLL_MS);
  }

  // The next sentence worth asking for: from the one being heard on, the first
  // that the studio has not made, refused, or been asked for. A job is
  // { index, voice, sig, lines, ids }: what to ask for (one line, or the parts
  // of a long sentence). In "Studio only" it can also be { index, voice, sig,
  // skipped } without lines: a sentence with nothing to say (skipped false), or
  // one the studio could not make (true); either is passed over with its pause.
  #next() {
    const { reader } = this;
    const voice = reader.studioVoice;
    if (!voice || !reader.sentences.length) return null;
    const deliveries = reader.deliveries();
    // The sentence being heard is never swapped (reader.adopt). In "Studio only" that holds
    // only while it really is in the player: while the reader waits for it, it is needed most.
    const active = (reader.state === 'playing' || reader.state === 'paused') && (!this.only || reader.hearsCurrent);
    const from = reader.current + (active ? 1 : 0);
    for (let i = from; i < Math.min(reader.sentences.length, from + AHEAD); i++) {
      if (reader.segments[i]?.clip.studio === voice && reader.isFresh(i)) continue;
      const parts = deliveries[i].parts;
      const spoken = parts.map((p) => p.text).join(' ');
      if (this.only) {
        // No device voice to fall back on: German and Spanish go too, long sentences in parts.
        const job = { index: i, voice, sig: reader.signature(i) };
        const lines = studioLines(spoken);
        if (!lines) return { ...job, skipped: false };
        const ids = lines.map((line) => lineId(voice, line.text));
        if (ids.some((id) => this.failed.has(id))) return { ...job, skipped: true };
        return { ...job, lines, ids };
      }
      if (parts.some((p) => p.lang !== 'en')) continue; // German and Spanish stay with the device's voice
      const line = studioLine(spoken);
      if (!line) continue;
      const id = lineId(voice, line.text);
      if (this.failed.has(id)) continue;
      return { index: i, voice, sig: reader.signature(i), lines: [line], ids: [id] };
    }
    return null;
  }

  #noAnswer(id) {
    if (this.only) return; // "Studio only": no answer is not the line's fault; it is never given up (#retry)
    const n = (this.tries.get(id) ?? 0) + 1;
    this.tries.set(id, n);
    if (n >= TRIES) this.failed.add(id);
  }

  async #work() {
    if (this.busy || this.state !== 'ready' || this.resting) return;
    const job = this.#next();
    if (!job) return;
    const { reader } = this;
    const { epoch } = reader;
    if (!job.lines) {
      // "Studio only", nothing to ask for: passed over with its pause.
      const taken = reader.adopt(job.index, new Int16Array(0), { epoch, voice: job.voice, sig: job.sig, skipped: job.skipped });
      this.dispatchEvent(new Event('change'));
      if (taken) this.#work(); // (if refused, it is looked at again at the next change, never in a loop)
      return;
    }
    this.busy = true;
    let id = job.ids[0]; // the line being asked for
    try {
      const pieces = [];
      for (let k = 0; k < job.lines.length; k++) {
        id = job.ids[k];
        const line = job.lines[k];
        let pcm = this.made.get(id);
        if (!pcm) {
          const response = await this.#call('/line', { method: 'POST', timeout: LINE_TIMEOUT_MS, body: { id, voice: job.voice, text: line.text, expect: line.expect, kind: 'speech', seed: 1 } });
          if (response.status === 200) pcm = wavSamples(await response.arrayBuffer());
          else if (response.status !== 422) {
            // Not an answer about this line (the studio stopped, the helper is busy, the key
            // changed): the line is asked for again later, a second time at most.
            const limit = response.status === 429 && this.only && (await response.json().catch(() => ({}))).error === 'daily limit reached';
            this.busy = false;
            this.#noAnswer(id);
            if (response.status === 401) this.#set('error', 'The studio key was not accepted.');
            else if (response.status === 503 && this.only) {
              // As below, but a little later, and only while someone listens (Play carries on):
              // the line is never given up here, so a studio that keeps saying "not ready" is
              // not asked again and again without a pause.
              this.#set('idle');
              this.resting = true;
              this.#later(() => {
                this.resting = false;
                this.#poll(true);
              }, RETRY_MS);
            } else if (response.status === 503) {
              // The studio did not answer, or it has stopped. While someone listens: start it
              // again. Otherwise only ask how it stands, and carry on if it is still running.
              this.#set('idle');
              this.#poll(this.#listening());
            } else {
              if (limit) this.#trouble('The studio has reached its limit for today.');
              else this.#trouble(response.status === 429 ? 'The studio is busy.' : 'The studio did not answer.');
              this.#retry(response.status === 429 ? 30_000 : RETRY_MS);
            }
            return;
          }
          if (pcm) {
            this.made.set(id, pcm);
            if (this.made.size > KEEP) this.made.delete(this.made.keys().next().value);
          }
        }
        if (!pcm) {
          this.failed.add(id); // ("Studio only": the next round passes the sentence over)
          break;
        }
        pieces.push(pcm);
      }
      // Too late for this sentence (it is being heard)? Then it stays in memory for a second listen.
      if (pieces.length === job.lines.length) reader.adopt(job.index, joined(pieces), { epoch, voice: job.voice, sig: job.sig });
      this.#trouble(''); // an answer came through: whatever was wrong has passed
    } catch {
      // Lost on the way (no network, or no answer in time): wait a little instead of
      // running through every sentence ahead; the device's own voice reads meanwhile.
      // (Each line is asked for twice at most, so this ends; in "Studio only" it ends when
      // nobody listens, see #retry.)
      this.busy = false;
      this.#noAnswer(id);
      this.#trouble('The studio cannot be reached.');
      this.#retry(RETRY_MS);
      return;
    }
    this.busy = false;
    this.dispatchEvent(new Event('change'));
    this.#work();
  }
}
