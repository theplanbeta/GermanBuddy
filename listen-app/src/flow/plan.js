// Decides which sentences go into the next model call ("D4" rules from the
// research prototype; pure functions, tested in tests/plan.test.js).
//
// 1. Consecutive sentences of one paragraph share one call, up to 480
//    phonemes and 12 sentences. A call never crosses a paragraph. Long calls
//    are what make the reading flow: the model plans across sentences.
// 2. The "voice row" (which line of the voice file styles the call) is the
//    phoneme count of the call, as kokoro-js does it, except in rule 4.
// 3. Start small, then grow: the first call is one sentence (fast first
//    audio). After that a call is as large as can be prepared before the
//    audio already waiting ahead of the listener runs out, judged from this
//    device's measured preparation speed; never less than one sentence.
//    (A fixed ramp of 1, 2, 4, then full calls is kept for testing.)
//    But never smaller than a group that prepares at least as fast as it
//    plays: every call has a fixed cost (about 1.3 s on a 4-core laptop, mostly
//    the silence the model makes at its start and end), so
//    on a device that only just keeps up, one sentence at a time would fall
//    further and further behind (see `growthLast`).
// Exception, "urgent" calls: while the listener waits for the very first
// sound (after Play or a jump), the sentence is made alone and plainly (no
// look-ahead, own row), exactly as earlier versions did, because that is the
// quickest way to start. It is re-made in full quality later, in the
// background (for the download and for listening again).
// 4. A call that ends inside a paragraph also gets the first two words of the
//    next sentence (thrown away afterwards), so its last sentence ends like a
//    sentence that continues, and the voice row is chosen as if the whole next
//    sentence were there ("virtual row").
//
// Sentences are { text, para, joined? }. `phonemes[i]` is { n, headN } once
// known: n = phoneme count of sentence i, headN = that of its first two words.

export const MAX_PHONEMES = 480;
export const MAX_SENTENCES = 12;
export const TOKEN_LIMIT = 510; // the model reads at most 510 phonemes per call
export const LAST_ROW = 509; // the voice file has rows 0..509
export const RAMP = [1, 2, 4];
const SAFETY = 0.8; // plan to finish with 20% of the waiting audio to spare
// A call should prepare at least as fast as it plays. (Measured in the browser:
// asking for 15% to spare made the first groups so large that the wait before
// them grew to 20 s on a device that only just keeps up; 1.0 kept it under 9 s.)
export const GROWTH = 1.0;

/** The look-ahead text: the first two words of a sentence, without trailing punctuation. */
export function firstWords(text, count = 2) {
  return text.split(/\s+/).slice(0, count).join(' ').replace(/[,.;:!?]$/, '');
}

/** Phoneme count of sentences first..last joined with spaces. */
export function callLength(phonemes, first, last) {
  let n = -1;
  for (let i = first; i <= last; i++) n += phonemes[i].n + 1;
  return n;
}

/**
 * The first sentence to prepare: from `current` forward, then from the start.
 * `playing` is a sentence heard right now from an out-of-date clip: it keeps
 * playing, so it is redone last. Returns -1 when everything is fresh.
 */
export function chooseStart(fresh, current, playing = -1) {
  const n = fresh.length;
  for (let k = 0; k < n; k++) {
    const i = (current + k) % n;
    if (i !== playing && !fresh[i]) return i;
  }
  return playing >= 0 && !fresh[playing] ? playing : -1;
}

/**
 * How many sentences the size rule allows for the next call.
 *   ordinal       how many calls have been made since the text was loaded
 *   budgetSeconds audio ready ahead of the listener before this call is needed
 *   measured      true once this device's preparation speed has been measured
 *   sizing        'adaptive' (default) or 'ramp' (fixed 1, 2, 4, then full)
 * Returns { maxSentences, maxMs } (maxMs = Infinity when time does not matter).
 */
export function sizeRule({ ordinal, budgetSeconds, measured, sizing = 'adaptive' }) {
  if (sizing === 'ramp') return { maxSentences: ordinal < RAMP.length ? RAMP[ordinal] : MAX_SENTENCES, maxMs: Infinity };
  if (!measured || ordinal === 0) return { maxSentences: 1, maxMs: Infinity };
  if (budgetSeconds === Infinity) return { maxSentences: MAX_SENTENCES, maxMs: Infinity };
  return { maxSentences: MAX_SENTENCES, maxMs: Math.max(0, budgetSeconds) * 1000 * SAFETY };
}

/**
 * Plans one call starting at sentence `start`.
 *   fresh[i]      sentence i is already prepared in the current voice and speed
 *   predict(tokens) expected preparation time of a call (ms)
 *   single        a Set of sentences that must be made on their own (an
 *                 earlier group could not be cut apart)
 *   plain         an "urgent" call: this sentence alone, no look-ahead, own row
 *   listenPerToken  measured listening seconds per phoneme (enables the growth floor)
 *   maxPhonemes   cap on the call's length (default 480; smaller on the graphics chip, see reader.js)
 * Returns { first, last, lookahead (sentence index or -1), tokens, row, plain }.
 * `tokens` counts the phonemes actually sent, look-ahead included.
 */
export function planCall({ sentences, phonemes, fresh, start, rule, predict = () => 0, single = new Set(), plain = false, listenPerToken = 0, maxPhonemes = MAX_PHONEMES }) {
  if (plain) {
    const n = phonemes[start].n;
    return { first: start, last: start, lookahead: -1, tokens: n, row: Math.min(LAST_ROW, n), plain: true };
  }
  const sameParagraph = (i) => i < sentences.length && sentences[i].para === sentences[i - 1].para;
  const withLookahead = (last) => {
    const next = last + 1;
    const n = callLength(phonemes, start, last);
    if (single.has(start) || !sameParagraph(next) || !phonemes[next]?.headN) return { n, look: -1, tokens: n };
    const tokens = n + 1 + phonemes[next].headN;
    return tokens <= TOKEN_LIMIT ? { n, look: next, tokens } : { n, look: -1, tokens: n };
  };
  const fits = (last) => {
    const n = callLength(phonemes, start, last);
    return last - start + 1 <= MAX_SENTENCES && n <= Math.min(maxPhonemes, MAX_PHONEMES);
  };
  const canExtend = (last) => {
    const next = last + 1;
    return sameParagraph(next) && phonemes[next]?.n > 0 && !fresh[next] && !single.has(next) && !single.has(start) && fits(next);
  };
  let last = start;
  // Grow while the size rule allows it.
  while (canExtend(last) && last + 1 - start + 1 <= rule.maxSentences && predict(withLookahead(last + 1).tokens) <= rule.maxMs) last++;
  // ... but at least as large as the growth floor.
  if (listenPerToken > 0 && rule.maxMs !== Infinity) {
    last = Math.max(last, growthLast({ start, canExtend, cost: (l) => predict(withLookahead(l).tokens), listen: (l) => callLength(phonemes, start, l) * listenPerToken }));
  }
  // Do not stop between two pieces of one sentence when it still fits (only the
  // very smallest calls, such as the first one, may split there).
  while (rule.maxSentences > 1 && sentences[last].joined && canExtend(last)) last++;
  const { n, look, tokens } = withLookahead(last);
  const row = Math.min(LAST_ROW, look >= 0 ? n + 1 + phonemes[look].n : n);
  return { first: start, last, lookahead: look, tokens, row };
}

/**
 * The growth floor: the smallest group from `start` (extending while
 * `canExtend(last)`) whose listening time is at least GROWTH times its
 * expected preparation time, or, if none gets there (a slow device), the
 * smallest group that comes within 3% of the most efficient one (larger
 * groups waste less time on the per-call cost, but make longer waits).
 *   cost(last)    expected preparation time (ms) of the call start..last
 *   listen(last)  its listening time (s)
 */
export function growthLast({ start, canExtend, cost, listen }) {
  const ratios = [];
  for (let last = start; ; last++) {
    const ratio = listen(last) / (cost(last) / 1000);
    if (ratio >= GROWTH) return last;
    ratios.push(ratio);
    if (!canExtend(last)) break;
  }
  // None gets there: the smallest group within 3% of the best one.
  const best = Math.max(...ratios);
  return start + ratios.findIndex((r) => r >= 0.97 * best);
}

/**
 * Seconds of fresh audio the listener will hear before reaching sentence
 * `start`: the rest of the current sentence (if fresh) plus the fresh
 * sentences between. `seconds[i]` is the listening time of sentence i's
 * prepared audio (null when not prepared), `elapsed` how far into the current
 * sentence the listener is. Out-of-date audio does not count: after a voice
 * change the new voice should take over as soon as possible.
 */
export function freshAhead({ fresh, seconds, current, elapsed = 0, start }) {
  if (start < current) return Infinity; // preparing earlier text after the end was reached: no hurry
  let total = 0;
  for (let i = current; i < start; i++) if (fresh[i]) total += seconds[i];
  if (fresh[current] && start > current) total -= Math.min(elapsed, seconds[current]);
  return Math.max(0, total);
}

/**
 * While the listener hears audio in an old voice (or speed), the new voice
 * takes over at a sentence boundary. Work on a sentence the listener will
 * already have passed is wasted, so start at the first sentence (from
 * `start` on) that can be ready, made alone, before the listener gets there.
 *   remaining     seconds until the sentence being heard ends
 *   seconds[i]    listening time of the audio already there for sentence i (null = none)
 *   predictMs(i)  expected preparation time of sentence i made alone
 *   fresh[i]      sentence i is already made in the new voice (never redone)
 * When none fits (a slow device), the one that comes closest, so that the
 * new voice arrives late rather than never (chasing the listener forever).
 */
export function takeoverStart({ start, current, remaining, seconds, predictMs, fresh = [] }) {
  let ahead = remaining; // seconds until the listener reaches sentence k
  let best = start;
  let bestSlack = -Infinity;
  for (let k = current + 1; k < seconds.length; k++) {
    if (k >= start && !fresh[k]) {
      const slack = ahead * 1000 - predictMs(k);
      if (slack >= 0) return k;
      if (slack > bestSlack) [best, bestSlack] = [k, slack];
    }
    if (seconds[k] == null) break; // nothing to play there: the listener waits anyway
    ahead += seconds[k];
  }
  return best;
}
