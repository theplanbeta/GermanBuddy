// Tiny post-synthesis signal processing (plain JS, browser-safe). 24 kHz mono Float32Array in/out.
export const SR = 24000;

/** Trim leading/trailing silence (below peak - dropDb), keeping `keep` seconds of margin. */
export function trimSilence(x, { dropDb = 45, keep = 0.04, frame = 0.01 } = {}) {
  const h = Math.round(frame * SR);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (!peak) return x;
  const thr = peak * 10 ** (-dropDb / 20);
  const loud = (i) => { let m = 0; for (let k = i; k < Math.min(x.length, i + h); k++) m = Math.max(m, Math.abs(x[k])); return m > thr; };
  let a = 0; while (a < x.length && !loud(a)) a += h;
  let b = x.length - h; while (b > a && !loud(b)) b -= h;
  a = Math.max(0, a - Math.round(keep * SR));
  b = Math.min(x.length, b + h + Math.round(keep * SR));
  const y = x.slice(a, b);
  fade(y, 0.008);
  return y;
}

export function fade(y, sec = 0.004) {
  const f = Math.min(Math.round(sec * SR), y.length >> 1);
  for (let i = 0; i < f; i++) { y[i] *= i / f; y[y.length - 1 - i] *= i / f; }
  return y;
}

/** Gain in dB followed by a soft limiter so peaks never clip. */
export function gain(x, db) {
  const g = 10 ** (db / 20);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = softLimit(x[i] * g);
  return y;
}
function softLimit(v, knee = 0.7) {
  const a = Math.abs(v);
  if (a <= knee) return v;
  return Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
}

/** RBJ high-shelf biquad: +db above ~fc (flatter spectral tilt = sounds like more vocal effort). */
export function highShelf(x, fc = 2000, db = 3) {
  const A = 10 ** (db / 40), w = (2 * Math.PI * fc) / SR, cs = Math.cos(w), sn = Math.sin(w);
  const alpha = (sn / 2) * Math.sqrt(2), sq = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) + (A - 1) * cs + sq), b1 = -2 * A * ((A - 1) + (A + 1) * cs), b2 = A * ((A + 1) + (A - 1) * cs - sq);
  const a0 = (A + 1) - (A - 1) * cs + sq, a1 = 2 * ((A - 1) - (A + 1) * cs), a2 = (A + 1) - (A - 1) * cs - sq;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Amplitude tremolo (voice "trembling"): rate Hz, depth 0..1. Slight random rate drift so it is not a pure LFO. */
export function tremolo(x, rate = 5.5, depth = 0.25) {
  const y = new Float32Array(x.length);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const r = rate * (1 + 0.15 * Math.sin((2 * Math.PI * 0.7 * i) / SR));
    ph += (2 * Math.PI * r) / SR;
    y[i] = x[i] * (1 - depth / 2 + (depth / 2) * Math.sin(ph));
  }
  return y;
}

/** Peak-normalise to a target dBFS only if louder (keeps quiet segments quiet). */
export function rmsDb(x) { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / Math.max(1, x.length) + 1e-12); }

/** Transparent safety limiter: only samples above `knee` are touched. */
export function limit(x, knee = 0.9) { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = softLimit(x[i], knee); return y; }

// ---------------------------------------------------------------- v2 "smooth flow" helpers
/** Gentle trim: keep Kokoro's natural decay down to peak-60 dB, plus a pad, raised-cosine fades. */
// Front edge uses the stricter -45 dB (keeping Kokoro's pre-onset murmur made "Achtung" sound like "Äh, zung"
// to ASR); the tail keeps the natural decay down to -60 dB.
export function softTrim(x, { dropDb = 60, dropDbIn = 45, padIn = 0.03, padOut = 0.08, fadeIn = 0.015, fadeOut = 0.04, frame = 0.005 } = {}) {
  const h = Math.round(frame * SR);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (!peak) return x;
  const thrOut = peak * 10 ** (-dropDb / 20), thrIn = peak * 10 ** (-dropDbIn / 20);
  const loud = (i, thr) => { let m = 0; for (let k = i; k < Math.min(x.length, i + h); k++) m = Math.max(m, Math.abs(x[k])); return m > thr; };
  let a = 0; while (a < x.length && !loud(a, thrIn)) a += h;
  let b = x.length - h; while (b > a && !loud(b, thrOut)) b -= h;
  a = Math.max(0, a - Math.round(padIn * SR));
  b = Math.min(x.length, b + h + Math.round(padOut * SR));
  const y = x.slice(a, b);
  cosFade(y, fadeIn, fadeOut);
  return y;
}
/** Raised-cosine (equal-power-ish) fades in and out. */
export function cosFade(y, fin = 0.015, fout = 0.04) {
  const fi = Math.min(Math.round(fin * SR), y.length >> 1), fo = Math.min(Math.round(fout * SR), y.length >> 1);
  for (let i = 0; i < fi; i++) y[i] *= Math.sin((Math.PI / 2) * (i / fi)) ** 2;
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= Math.sin((Math.PI / 2) * (i / fo)) ** 2;
  return y;
}
/** Very quiet "room tone": low-passed noise at `db` dBFS RMS (Kokoro's own gaps sit at about -70 dBFS). */
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
export function roomTone(sec, db = -72) {
  const n = Math.round(sec * SR), y = new Float32Array(n);
  let lp = 0; const g = 10 ** (db / 20) * 3.2; // 1-pole low-pass at ~1.5 kHz loses ~10 dB of white-noise RMS
  for (let i = 0; i < n; i++) { lp += 0.33 * (rnd() - lp); y[i] = lp * g; }
  return y;
}
/** Gain in dB ramped in over `ramp` seconds (avoids a loudness step at the very first syllable). */
export function gainRamp(x, db, ramp = 0.08) {
  const g = 10 ** (db / 20), r = Math.round(ramp * SR), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { const k = i < r ? 1 + (g - 1) * (i / r) : g; y[i] = softLimitPub(x[i] * k); }
  return y;
}
function softLimitPub(v, knee = 0.7) { const a = Math.abs(v); return a <= knee ? v : Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee))); }
