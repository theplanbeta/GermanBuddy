// Small, pure rules about speed that the Reader follows. Kept apart from the
// Reader so they can be tested without a browser. (Which sentences go into
// the next model call is decided in flow/plan.js.)
//
// Making the voice speak faster at generation time produces less audio, and
// generation time is proportional to the amount of audio, so a fast tempo
// prepares faster. Kokoro's `speed` is not exact: measured over 15 sentences,
// speed 1.5 made speech 1.55x shorter and speed 2 made it 1.88x shorter.
// `factor` is that measured shortening; playback rate = tempo / factor.
export const SPEED_STEPS = [
  { speed: 1, factor: 1 },
  { speed: 1.5, factor: 1.55 },
  { speed: 2, factor: 1.88 },
];

/** How much shorter speech made at `speed` is than at speed 1. */
export function speedFactor(speed) {
  return SPEED_STEPS.find((s) => s.speed === speed)?.factor ?? 1;
}

/**
 * Which generation speed suits a tempo: the fastest step that does not have
 * to be slowed down by more than 5% when played. Tempos up to about 1.45x
 * use speed 1, so ordinary small tempo changes never cause re-preparation.
 */
export function bakedSpeedFor(tempo) {
  let best = 1;
  for (const step of SPEED_STEPS) if (step.factor <= tempo * 1.05) best = step.speed;
  return best;
}

/**
 * How fast audio is being prepared compared with how fast it is played,
 * from recent model calls ({ seconds, ms, speed }). Above 1 means it keeps
 * ahead. Returns null until there are at least two measurements.
 */
export function prepRatio(stats, tempo, window = 8) {
  const recent = stats.slice(-window);
  if (recent.length < 2) return null;
  const listening = recent.reduce((n, s) => n + (s.seconds * speedFactor(s.speed)) / tempo, 0);
  const working = recent.reduce((n, s) => n + s.ms / 1000, 0);
  return working > 0 ? listening / working : null;
}

/**
 * Predicts how long a model call of `tokens` phonemes will take (ms), from
 * recent calls ({ tokens, ms }). Every call has a fixed cost (measured about
 * 1 s on a 4-core laptop) plus a cost per phoneme, so a straight line is
 * fitted through recent calls when their sizes differ enough; otherwise the
 * plain average per phoneme is used. Returns null before the first call.
 */
export function predictMs(stats, tokens, window = 8) {
  const recent = stats.slice(-window).filter((s) => s.tokens > 0);
  if (!recent.length) return null;
  const n = recent.length;
  const mx = recent.reduce((a, s) => a + s.tokens, 0) / n;
  const my = recent.reduce((a, s) => a + s.ms, 0) / n;
  const sxx = recent.reduce((a, s) => a + (s.tokens - mx) ** 2, 0);
  if (n >= 3 && Math.sqrt(sxx / n) >= 0.25 * mx) {
    const slope = recent.reduce((a, s) => a + (s.tokens - mx) * (s.ms - my), 0) / sxx;
    const fixed = my - slope * mx;
    if (slope > 0 && fixed >= 0) return fixed + slope * tokens;
  }
  return (my / mx) * tokens;
}
