// Small, pure rules for the ring around the Play button that fills while the
// listener waits for the sound to start, and for taps on Play during that
// wait. Kept apart from the page so they can be tested without a browser.
//
// How the ring moves: it starts with a small visible piece (so a tap visibly
// "took") and then moves at a steady pace so that it would be 90% full at the
// moment the sound is expected. If the estimate changes (a further model call
// turns out to be needed, or one finishes early), it carries on from where it
// is at the pace the new estimate calls for, so it never moves backwards. If
// the expected moment passes without sound, it keeps creeping towards full,
// ever more slowly, without ever getting there: the ring only completes when
// the sound has actually started.

export const START = 0.04; // shown at once on the tap
export const CAP = 0.9; // reached at the expected moment
const CREEP = 5; // after an overrun, the gap to full halves after about 2 x the expected wait

/**
 * Moves the ring on by `dtMs` milliseconds.
 *   p            how full the ring is now (0..1)
 *   remainingMs  the current estimate of the time still to wait (0 or less: overdue)
 *   scaleMs      the whole wait as expected (sets how slowly an overrun creeps)
 * Returns the new fill: never less than p, always below 1. The result does
 * not depend on how the time is cut into steps (frames), only on the total.
 */
export function advance(p, dtMs, remainingMs, scaleMs) {
  if (!(dtMs > 0)) return p;
  let dt = dtMs;
  if (remainingMs > 0 && p < CAP) {
    if (remainingMs > dt) return CAP - ((CAP - p) * (remainingMs - dt)) / remainingMs;
    p = CAP; // the expected moment is reached within this step
    dt -= remainingMs;
  }
  // Overdue: the gap to full shrinks like 1 / time, so the ring keeps moving.
  const gap = 1 - p;
  const next = 1 - gap / (1 + (gap * CREEP * dt) / Math.max(1000, scaleMs));
  return Math.max(p, Math.min(next, 1 - 1e-6));
}

export const REPEAT_TAP_MS = 450;

/**
 * True when a tap on Play follows the previous tap so quickly that it is
 * part of the same burst of taps (an impatient listener tapping again and
 * again). Such taps are ignored: only the first tap of a burst counts, and a
 * later tap after a short break (`windowMs`) counts again.
 */
export function isRepeatTap(now, previousTap, windowMs = REPEAT_TAP_MS) {
  return now - previousTap < windowMs;
}
