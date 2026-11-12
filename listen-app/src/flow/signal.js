// Small signal-processing helpers for the model's audio (24 kHz mono floats).
// Ported from the research prototype (research/expressive-kokoro: group.mjs,
// dsp.mjs, ablate.mjs) with the same thresholds, so the app sounds the same.
export const RATE = 24000;

/**
 * Silent stretches inside the speech: 10 ms frames quieter than the loudest
 * frame minus `dropDb`, lasting at least `minLen` seconds. Also returns where
 * the speech starts (onset) and ends (offset), in seconds.
 */
export function findGaps(x, { dropDb = 40, minLen = 0.07, frame = 0.01 } = {}) {
  const h = Math.round(frame * RATE);
  const n = Math.floor(x.length / h);
  const db = new Float32Array(n);
  let peak = -200;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * h; k < (i + 1) * h; k++) s += x[k] * x[k];
    db[i] = 10 * Math.log10(s / h + 1e-12);
    peak = Math.max(peak, db[i]);
  }
  const threshold = peak - dropDb;
  let first = 0;
  while (first < n && db[first] < threshold) first++;
  let last = n - 1;
  while (last > first && db[last] < threshold) last--;
  const gaps = [];
  for (let i = first; i <= last; ) {
    if (db[i] < threshold) {
      let j = i;
      while (j <= last && db[j] < threshold) j++;
      if ((j - i) * frame >= minLen) gaps.push({ s: i * frame, e: j * frame, len: (j - i) * frame });
      i = j;
    } else i++;
  }
  return { gaps, onset: first * frame, offset: (last + 1) * frame };
}

/**
 * Fallback when the model gave no usable timings: picks one silent gap per
 * expected sentence boundary. `fractions` are the boundaries' expected
 * positions as a share of the phoneme string (0..1). Returns null when the
 * match is not trustworthy. (Ordered matching by dynamic programming; a gap
 * must lie within 12% of the expected place and last at least 0.1 s.)
 */
export function matchBoundaries(found, fractions, { tol = 0.12, minSentence = 0.1 } = {}) {
  const { gaps, onset, offset } = found;
  const span = offset - onset;
  const K = fractions.length;
  const G = gaps.length;
  if (!K) return [];
  if (G < K) return null;
  const expected = fractions.map((f) => onset + f * span);
  const cost = (k, g) => Math.abs((gaps[g].s + gaps[g].e) / 2 - expected[k]) / span - 0.15 * Math.min(gaps[g].len, 0.4);
  const D = Array.from({ length: K + 1 }, () => new Float64Array(G + 1).fill(1e9));
  const B = Array.from({ length: K + 1 }, () => new Int32Array(G + 1));
  for (let g = 0; g <= G; g++) D[0][g] = 0;
  for (let k = 1; k <= K; k++) {
    for (let g = k; g <= G; g++) {
      const use = D[k - 1][g - 1] + cost(k - 1, g - 1);
      const skip = D[k][g - 1];
      if (use <= skip) {
        D[k][g] = use;
        B[k][g] = 1;
      } else {
        D[k][g] = skip;
      }
    }
  }
  const pick = new Array(K);
  for (let k = K, g = G; k > 0; g--) {
    if (B[k][g]) {
      pick[k - 1] = g - 1;
      k--;
    }
  }
  const chosen = pick.map((g) => gaps[g]);
  for (let k = 0; k < K; k++) {
    const mid = (chosen[k].s + chosen[k].e) / 2;
    if (Math.abs(mid - expected[k]) / span > tol || chosen[k].len < minSentence) return null;
  }
  return chosen;
}

/** Leading and trailing silence of a piece, in seconds (frames below its peak minus 40 dB). */
export function silentEdges(x) {
  const f = findGaps(x, { minLen: 0 });
  return { lead: f.onset, trail: x.length / RATE - f.offset };
}

/** Shortens the silence at the start and end of a piece to at most `keepLead` / `keepTrail` seconds. */
export function shrinkEdges(x, keepLead, keepTrail) {
  const { lead, trail } = silentEdges(x);
  const a = Math.max(0, Math.round((lead - keepLead) * RATE));
  const b = x.length - Math.max(0, Math.round((trail - keepTrail) * RATE));
  return x.slice(a, Math.max(a, b));
}

/** Smooth (raised-cosine) fade in and out, in place, so pieces never click. */
export function cosFade(y, fadeIn, fadeOut) {
  const fi = Math.min(Math.round(fadeIn * RATE), y.length >> 1);
  const fo = Math.min(Math.round(fadeOut * RATE), y.length >> 1);
  for (let i = 0; i < fi; i++) y[i] *= Math.sin((Math.PI / 2) * (i / fi)) ** 2;
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= Math.sin((Math.PI / 2) * (i / fo)) ** 2;
  return y;
}

/**
 * Very quiet "room tone" for pauses: softly filtered noise at -72 dB, like the
 * model's own silences, so pauses never sound like a dead line.
 * `random` keeps its own state, so each reading is repeatable.
 */
export function roomTone(seconds, random = makeRandom()) {
  const n = Math.max(0, Math.round(seconds * RATE));
  const y = new Float32Array(n);
  const g = 10 ** (-72 / 20) * 3.2; // the filter below loses about 10 dB
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.33 * (random() - lp);
    y[i] = lp * g;
  }
  return y;
}

/** A small repeatable random number generator (-1..1), as in the prototype. */
export function makeRandom(seed = 12345) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

/**
 * High-shelf filter: `db` louder above about `fc` Hz. A flatter spectral
 * tilt sounds like more vocal effort (a raised voice). Standard (RBJ) biquad.
 */
export function highShelf(x, fc = 2000, db = 3) {
  const A = 10 ** (db / 40);
  const w = (2 * Math.PI * fc) / RATE;
  const cs = Math.cos(w);
  const sq = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.sqrt(2);
  const b0 = A * (A + 1 + (A - 1) * cs + sq);
  const b1 = -2 * A * (A - 1 + (A + 1) * cs);
  const b2 = A * (A + 1 + (A - 1) * cs - sq);
  const a0 = A + 1 - (A - 1) * cs + sq;
  const a1 = 2 * (A - 1 - (A + 1) * cs);
  const a2 = A + 1 - (A - 1) * cs - sq;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/**
 * `db` louder, ramped in over `ramp` seconds (no loudness step at the first
 * syllable), with a soft limiter so peaks never clip.
 */
export function gainRamp(x, db, ramp = 0.08) {
  const g = 10 ** (db / 20);
  const r = Math.round(ramp * RATE);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = limit(x[i] * (i < r ? 1 + (g - 1) * (i / r) : g), 0.7);
  return y;
}

/** Gentle safety limiter: only samples louder than 0.9 are touched (Kokoro sometimes peaks at 1). */
export function limit(v, knee = 0.9) {
  const a = Math.abs(v);
  if (a <= knee) return v;
  return Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
}
