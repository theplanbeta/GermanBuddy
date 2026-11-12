// Turns the director's performer settings into what the voice model and the
// audio need: an offset to the voice's style vector, a speed, and a louder or
// brighter sound afterwards. As in the research prototype (render.mjs).
//
// The style vector (256 numbers) has two halves: the first shapes the timbre
// (breathy or firm), the second the intonation. The two directions, measured
// across Kokoro's voices and shipped with the app (directions.js, 2 KB), are
// added to whatever voice is chosen, so no other voice files are needed.
import { WHISPER, PITCH } from './directions.js';
import { highShelf, gainRamp } from '../flow/signal.js';
import { MIN_SPEED } from './director.js';

/**
 * Offset for the voice's style row (256 numbers), or null for a plain style.
 * `tokens`: phonemes in the call; on very short calls the fixed direction is
 * too strong (measured in the prototype), so it is reduced there.
 */
export function styleShift(style, tokens) {
  let w = (style.whisper || 0) - (style.firm || 0);
  if (tokens < 15) w *= 0.7;
  const pitch = style.pitch || 0;
  if (!w && !pitch) return null;
  const shift = new Float64Array(256);
  for (let i = 0; i < 128; i++) shift[i] = w * WHISPER[i];
  for (let i = 0; i < 128; i++) shift[128 + i] = pitch * PITCH[i];
  return shift;
}

/** The model speed for a style at the reading's speed step (never slower than 0.85 × the step). */
export function styledSpeed(style, speed) {
  return speed * Math.max(MIN_SPEED, style.speed || 1);
}

/** Louder and brighter where the style asks for it (a raised voice); other audio is returned as it is. */
export function afterEffects(samples, style) {
  let out = samples;
  if (style.shelfDb) out = highShelf(out, 2000, style.shelfDb);
  if (style.gainDb) out = gainRamp(out, style.gainDb);
  return out;
}
