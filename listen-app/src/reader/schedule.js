// Small, pure rules the Reader follows. Kept apart from the Reader so they can
// be tested without a browser.
//
// A "clip" is one prepared sentence: { pcm, voice, speed, seconds }.
//   voice    the voice it was made in
//   speed    the speed it was made at (Kokoro's own `speed` option)
//   seconds  its length as stored, including the pause after it
// A clip is "fresh" when it matches the current voice and speed. Clips that
// are not fresh ("stale") can still be played, so a voice or tempo change
// never causes silence; they are replaced in the background.

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

export function isFresh(clip, voice, speed) {
  return Boolean(clip) && clip.voice === voice && clip.speed === speed;
}

/**
 * Which sentence to prepare next, or -1 when everything is fresh.
 * Works forward from the current sentence, then wraps round to the start.
 * `playing` is the sentence whose clip is in the player right now (or -1):
 * its old clip keeps playing, so redoing it waits until last.
 */
export function nextToGenerate(clips, current, voice, speed, playing = -1) {
  const n = clips.length;
  for (let k = 0; k < n; k++) {
    const i = (current + k) % n;
    if (i === playing && clips[i]) continue;
    if (!isFresh(clips[i], voice, speed)) return i;
  }
  return playing >= 0 && !isFresh(clips[playing], voice, speed) ? playing : -1;
}

/**
 * How many seconds of listening are ready without a gap, starting at `from`
 * (fresh or stale clips both count), and whether that reaches the end.
 */
export function readyAhead(clips, from, tempo) {
  let seconds = 0;
  let i = from;
  for (; i < clips.length && clips[i]; i++) seconds += (clips[i].seconds * speedFactor(clips[i].speed)) / tempo;
  return { seconds, toEnd: i === clips.length };
}

/**
 * How fast sentences are being prepared compared with how fast they are
 * played, from recent generations ({ seconds, ms, speed }). Above 1 means it
 * keeps ahead. Returns null until there are at least two measurements.
 */
export function prepRatio(stats, tempo, window = 8) {
  const recent = stats.slice(-window);
  if (recent.length < 2) return null;
  const listening = recent.reduce((n, s) => n + (s.seconds * speedFactor(s.speed)) / tempo, 0);
  const working = recent.reduce((n, s) => n + s.ms / 1000, 0);
  return working > 0 ? listening / working : null;
}
