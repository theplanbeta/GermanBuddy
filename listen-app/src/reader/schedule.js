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
 * Measured preparation time per phoneme sent to the model (ms), from recent
 * calls ({ tokens, ms }), or null before the first call. Used to predict how
 * long a planned call will take.
 */
export function msPerToken(stats, window = 6) {
  const recent = stats.slice(-window);
  const tokens = recent.reduce((n, s) => n + s.tokens, 0);
  return tokens > 0 ? recent.reduce((n, s) => n + s.ms, 0) / tokens : null;
}
