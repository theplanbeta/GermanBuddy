// Turns the audio of one model call (several sentences, maybe plus two
// look-ahead words) into a playable clip: each sentence cut out at its exact
// boundary, the look-ahead thrown away, and the pause after each sentence set
// to a designed length.
//
// This follows the research prototype's "D4" rendering (ablate.mjs, variant
// R1_ramp_2w_virtualrow), which the owner chose by ear:
//   - Boundaries come from the model's own per-token timings ("durations").
//     The cut goes in the middle of the silent stretch around the boundary.
//   - Each sentence keeps at most 40 ms of the model's own silence at each
//     end; the rest of the pause is very quiet room tone, so the total
//     silence between two sentences is exactly the designed pause.
import { RATE, findGaps, matchBoundaries, silentEdges, shrinkEdges, cosFade, roomTone, makeRandom, limit } from './signal.js';

export const SAMPLES_PER_FRAME = 600; // one model "duration" unit = 600 samples (25 ms at 24 kHz)
export const KEEP = 0.04; // seconds of the model's own silence kept at each sentence edge
export const PARAGRAPH_PAUSE = 0.85; // seconds of silence after a paragraph
export const CLAUSE_PAUSE = 0.16; // ... where one long sentence was split in two and the parts were made separately

// Repeatable "random" variation of +-7% per sentence, from its text.
function jitter(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 1 + 0.07 * (((h >>> 0) % 2001) / 1000 - 1);
}
const wordCount = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;

/**
 * Designed silence after a sentence, in seconds (at normal speed):
 * 0.85 s after a paragraph; otherwise 0.3 s plus 0.01 s per word (up to 25
 * words), varied by up to 7% so the rhythm is not mechanical.
 * A piece that continues the same sentence gets a short clause pause.
 */
export function designedPause(sentence, endsParagraph) {
  if (endsParagraph) return PARAGRAPH_PAUSE;
  if (sentence.joined) return CLAUSE_PAUSE;
  return +((0.3 + 0.01 * Math.min(wordCount(sentence.text), 25)) * jitter(sentence.text)).toFixed(3);
}

/**
 * Model durations -> the first sample of every token (plus the total length
 * at the end), or null when they do not fit the audio. Durations are rounded
 * and at least 1, as the model itself does before making the audio.
 */
export function tokenStarts(durations, sampleCount) {
  if (!durations || !durations.length) return null;
  const d = Array.from(durations, (v) => Math.max(1, Math.round(v)));
  const total = d.reduce((a, b) => a + b, 0);
  const per = sampleCount / total;
  if (!(Math.abs(per - SAMPLES_PER_FRAME) <= SAMPLES_PER_FRAME * 0.02)) return null;
  const starts = [];
  let acc = 0;
  for (const v of d) {
    starts.push(Math.round(acc * per));
    acc += v;
  }
  starts.push(sampleCount);
  return starts;
}

const END_PUNCTUATION = /[,;:.!?…—"“”]/;

/**
 * Where to cut between the members of a call (seconds), from token timings.
 * `members` are the phoneme strings joined with single spaces in the call.
 * The boundary lies between the end of a member's words (before its closing
 * punctuation) and the start of the next member; the cut goes in the middle
 * of the longest silent stretch touching that window.
 */
export function cutsFromTimings(audio, starts, members) {
  const silent = findGaps(audio, { minLen: 0.03 }).gaps;
  const cuts = [];
  let o = 0;
  for (const m of members.slice(0, -1)) {
    const ch = [...m];
    const L = ch.length;
    let i1 = L;
    while (i1 > 0 && END_PUNCTUATION.test(ch[i1 - 1])) i1--;
    // starts[0] is the model's leading pad token, so character j of this member is token o + j + 1
    const a = starts[o + i1 + 1] / RATE;
    const b = starts[o + L + 2] / RATE;
    const gap = silent.filter((g) => g.e >= a - 0.05 && g.s <= b + 0.05).sort((x, y) => y.len - x.len)[0];
    cuts.push(gap ? (gap.s + gap.e) / 2 : (a + b) / 2);
    o += L + 1;
  }
  return cuts;
}

/** Fallback without timings: find the boundaries from the audio's quiet stretches. */
export function cutsFromEnergy(audio, members) {
  const total = [...members.join(' ')].length;
  let acc = 0;
  const fractions = members.slice(0, -1).map((m) => (acc += [...m].length + 1) / total);
  const chosen = matchBoundaries(findGaps(audio), fractions);
  return chosen ? chosen.map((g) => (g.s + g.e) / 2) : null;
}

/** True when the cut points are in order and leave every piece some sound. */
function sane(cuts, length) {
  let prev = 0;
  for (const c of cuts) {
    if (!(c * RATE > prev + RATE * 0.05) || c * RATE >= length) return false;
    prev = c * RATE;
  }
  return true;
}

/**
 * Builds the clip for one call.
 *   audio      Float32Array from the model
 *   durations  the model's per-token durations (or null)
 *   members    phoneme strings of the call's sentences, then the look-ahead (if any)
 *   lookahead  true when the last member is the look-ahead
 *   pauses     designed pause after each sentence, already adjusted for speed (seconds)
 *   joinedInside  per sentence: true when the next piece continues the same
 *              sentence inside this call (the model's own pause is kept as is)
 *   fadeIn     fade-in length for the first sentence (the prototype uses 8 ms for the very first one)
 * Returns { samples: Float32Array, offsets: [start sample of each sentence..., end], method }
 * or null when the sentences cannot be told apart (then render them one by one).
 */
export function assembleCall({ audio, durations, members, lookahead, pauses, joinedInside = [], fadeIn = 0.002, seed = 12345 }) {
  const count = members.length - (lookahead ? 1 : 0);
  let cuts = [];
  let method = 'single';
  if (members.length > 1) {
    const starts = tokenStarts(durations, audio.length);
    const tokens = [...members.join(' ')].length + 2;
    cuts = starts && starts.length === tokens + 1 ? cutsFromTimings(audio, starts, members) : null;
    method = 'timings';
    if (!cuts || !sane(cuts, audio.length)) {
      cuts = cutsFromEnergy(audio, members);
      method = 'energy';
      if (!cuts || !sane(cuts, audio.length)) return null;
    }
  }
  const bounds = [0, ...cuts.map((c) => Math.round(c * RATE)), audio.length];
  const random = makeRandom(seed);
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (p) => {
    parts.push(p);
    length += p.length;
  };
  for (let k = 0; k < count; k++) {
    let piece = audio.slice(bounds[k], bounds[k + 1]);
    // Inside one sentence that the splitter cut in two, keep the model's own pause untouched.
    const keepLead = k > 0 && joinedInside[k - 1] ? Infinity : KEEP;
    const keepTrail = joinedInside[k] && k < count - 1 ? Infinity : KEEP;
    piece = shrinkEdges(piece, keepLead, keepTrail);
    cosFade(piece, k === 0 ? fadeIn : 0.002, 0.002);
    const { lead, trail } = silentEdges(piece);
    // The very start of a call: make sure exactly KEEP seconds of quiet come
    // before the speech, because the pause before it was planned that way.
    if (k === 0 && lead < KEEP) {
      offsets.push(length);
      push(roomTone(KEEP - lead, random));
    } else offsets.push(length);
    push(piece);
    let gap = 0;
    if (!(joinedInside[k] && k < count - 1)) {
      // Silence after this sentence = its trailing silence + room tone + the next one's leading silence.
      const nextLead = k < count - 1 ? Math.min(KEEP, nextPieceLead(audio, bounds, k + 1, joinedInside)) : KEEP;
      gap = Math.max(0, pauses[k] - trail - nextLead);
    }
    push(roomTone(gap, random));
  }
  offsets.push(length);
  const samples = new Float32Array(length);
  let o = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) samples[o + i] = limit(p[i]);
    o += p.length;
  }
  return { samples, offsets, method };
}

// Leading silence the next piece will have after its edges are shortened.
function nextPieceLead(audio, bounds, k, joinedInside) {
  const piece = shrinkEdges(audio.slice(bounds[k], bounds[k + 1]), KEEP, joinedInside[k] ? Infinity : KEEP);
  return silentEdges(piece).lead;
}

/**
 * Which sentence of a clip a playback position (in samples) falls in:
 * the k with offsets[k] <= sample < offsets[k + 1] (clamped to the clip).
 */
export function sentenceAt(offsets, sample) {
  let k = 0;
  while (k < offsets.length - 2 && sample >= offsets[k + 1]) k++;
  return k;
}
