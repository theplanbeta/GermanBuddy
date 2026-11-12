// Grouped rendering support: find the model's own sentence pauses inside one multi-sentence
// Kokoro output and map them to the expected sentence boundaries. Plain JS, browser-safe.
export const SR = 24000;

/** Silent stretches (frames below peak - dropDb) of at least minLen seconds, inside the speech. */
export function findGaps(x, { dropDb = 40, minLen = 0.07, frame = 0.01 } = {}) {
  const h = Math.round(frame * SR), n = Math.floor(x.length / h);
  const db = new Float32Array(n);
  let peak = -200;
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * h; k < (i + 1) * h; k++) s += x[k] * x[k]; db[i] = 10 * Math.log10(s / h + 1e-12); peak = Math.max(peak, db[i]); }
  const thr = peak - dropDb;
  let first = 0; while (first < n && db[first] < thr) first++;
  let last = n - 1; while (last > first && db[last] < thr) last--;
  const gaps = [];
  for (let i = first; i <= last; ) {
    if (db[i] < thr) { let j = i; while (j <= last && db[j] < thr) j++; if ((j - i) * frame >= minLen) gaps.push({ s: i * frame, e: j * frame, len: (j - i) * frame }); i = j; } else i++;
  }
  return { gaps, onset: first * frame, offset: (last + 1) * frame };
}

/**
 * fractions: expected position of each boundary as a fraction of the phoneme string (0..1).
 * Returns the chosen gap per boundary, or null when the mapping is not trustworthy.
 * Ordered assignment by dynamic programming, minimising |gap midpoint - expected time|, with a
 * bonus for longer gaps (sentence pauses are longer than comma pauses). Rejects when any boundary
 * is further than `tol` (fraction of the speech span) from its gap or a chosen gap is < minSentence.
 */
export function matchBoundaries(found, fractions, { tol = 0.12, minSentence = 0.1 } = {}) {
  const { gaps, onset, offset } = found;
  const span = offset - onset, K = fractions.length, G = gaps.length;
  if (!K) return [];
  if (G < K) return null;
  const exp = fractions.map((f) => onset + f * span);
  const cost = (k, g) => Math.abs((gaps[g].s + gaps[g].e) / 2 - exp[k]) / span - 0.15 * Math.min(gaps[g].len, 0.4);
  const INF = 1e9, D = Array.from({ length: K + 1 }, () => new Float64Array(G + 1).fill(INF)), B = Array.from({ length: K + 1 }, () => new Int32Array(G + 1));
  for (let g = 0; g <= G; g++) D[0][g] = 0;
  for (let k = 1; k <= K; k++) for (let g = k; g <= G; g++) {
    // boundary k uses gap g-1, or gap g-1 unused
    const use = D[k - 1][g - 1] + cost(k - 1, g - 1), skip = D[k][g - 1];
    if (use <= skip) { D[k][g] = use; B[k][g] = 1; } else { D[k][g] = skip; B[k][g] = 0; }
  }
  const pick = new Array(K);
  for (let k = K, g = G; k > 0; g--) { if (B[k][g]) { pick[k - 1] = g - 1; k--; } }
  const chosen = pick.map((g) => gaps[g]);
  for (let k = 0; k < K; k++) {
    const mid = (chosen[k].s + chosen[k].e) / 2;
    if (Math.abs(mid - exp[k]) / span > tol || chosen[k].len < minSentence) return null;
  }
  return chosen;
}

/**
 * Cut points for within-sentence joins: for each expected boundary take the silent gap nearest to
 * the expected time (within tol of the span); if there is none (the model ran the words together,
 * e.g. "Wait… what"), take the quietest 30 ms in that window. Always returns one point per boundary,
 * in increasing order: { t, s, e, len } (len = 0 for a dip cut).
 */
export function cutPoints(x, fractions, { tol = 0.12, frame = 0.01, punct = null } = {}) {
  const found = findGaps(x, { minLen: 0.04 });
  const { gaps, onset, offset } = found, span = offset - onset;
  // Preferred: punctuation-indexed mapping. punct = { total, at: [index of the punctuation pause that
  // ends part k] }. If exactly `total` clear pauses (>= 80 ms) are found, map by order: robust even when
  // the phoneme-count estimate of the position is off (slow/fast renders, long commas).
  if (punct) {
    const clear = gaps.filter((g) => g.len >= 0.08).sort((a, b) => b.len - a.len).slice(0, punct.total).sort((a, b) => a.s - b.s);
    if (clear.length === punct.total && gaps.filter((g) => g.len >= 0.08).length === punct.total)
      return punct.at.map((i) => ({ t: (clear[i].s + clear[i].e) / 2, s: clear[i].s, e: clear[i].e, len: clear[i].len }));
  }
  const h = Math.round(frame * SR), n = Math.floor(x.length / h);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * h; k < (i + 1) * h; k++) s += x[k] * x[k]; db[i] = 10 * Math.log10(s / h + 1e-12); }
  const out = []; let prev = onset;
  const ex = [onset, ...fractions.map((f) => onset + f * span), offset];
  for (const [k, f] of fractions.entries()) {
    const e = ex[k + 1];
    // search window: halfway to the neighbouring expected boundaries, and never more than tol*span
    const lo = Math.max(e - tol * span, (ex[k] + e) / 2), hi = Math.min(e + tol * span, (e + ex[k + 2]) / 2);
    const near = gaps.filter((g) => g.s > prev && (g.s + g.e) / 2 >= lo && (g.s + g.e) / 2 <= hi)
      .sort((a, b) => Math.abs((a.s + a.e) / 2 - e) - 0.5 * a.len - (Math.abs((b.s + b.e) / 2 - e) - 0.5 * b.len));
    if (near.length) { const g = near[0]; out.push({ t: (g.s + g.e) / 2, s: g.s, e: g.e, len: g.len }); prev = g.e; continue; }
    let best = -1, bv = 1e9;
    for (let i = Math.max(Math.ceil(prev / frame) + 1, Math.floor(lo / frame)); i < Math.min(n - 3, Math.ceil(hi / frame)); i++) {
      const v = db[i] + db[i + 1] + db[i + 2];
      if (v < bv) { bv = v; best = i; }
    }
    if (best < 0) return null;
    const t = (best + 1.5) * frame; out.push({ t, s: t, e: t, len: 0 }); prev = t;
  }
  return out;
}
