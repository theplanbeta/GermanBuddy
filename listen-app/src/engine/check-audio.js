// Spots obviously broken model output, so a misbehaving graphics chip can be
// detected and the app can fall back to the standard engine.
//
// Returns '' for audio that looks fine, otherwise a short reason. The limits
// are deliberately loose: ordinary speech is about 0.07 s per letter and has
// a loudness (RMS) around 0.06; the checks only catch output that is far off.

const QUIET = 0.002; // RMS below this is effectively silence
const MAX_SECONDS_PER_CHAR = 0.3; // ~4x slower than any normal reading
const MIN_SECONDS_PER_CHAR = 0.012; // ~5x faster than any normal reading

export function checkAudio(samples, sampleRate, text, speed = 1) {
  if (!samples || samples.length === 0) return 'empty';
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) return 'not a number';
    sum += v * v;
  }
  if (Math.sqrt(sum / samples.length) < QUIET) return 'silent';
  const chars = (String(text).match(/[\p{L}\p{N}]/gu) || []).length;
  const seconds = samples.length / sampleRate;
  if (seconds > (2 + chars * MAX_SECONDS_PER_CHAR) / speed) return 'too long';
  if (chars >= 20 && seconds < (chars * MIN_SECONDS_PER_CHAR) / speed) return 'too short';
  return '';
}
