// The ring around the Play button that fills while the listener waits for
// the sound to start (how it moves: ui/wait.js).
//
//   const ring = createWaitRing(svg, { estimate, onPhase })
//   ring.start()            the wait began (call it in the same moment as the tap)
//   ring.stop({ heard })    the wait is over; `heard` = the sound started
//   ring.phase              'off' | 'loading' | 'downloading' | 'preparing' | 'late'
//
// `estimate()` returns { ms, phase }: the time still to wait (null when it
// cannot be told, for example while the voice model starts: the ring then
// circles without filling) and which phase the wait is in.
import { START, advance } from './wait.js';

const LATE_AFTER = 1.5; // "Still preparing…" once the wait has lasted 1.5 x its estimate …
const LATE_MIN_MS = 2000; // … and at least 2 s longer than it

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createWaitRing(svg, { estimate, onPhase = () => {} }) {
  const fill = svg.querySelector('.wait-fill');
  let frame = null;
  let fadeTimer = null;
  let began = 0;
  let last = 0;
  let p = 0;
  let scale = 0; // the whole wait as expected so far (ms)
  let phase = 'off';

  function draw(value) {
    fill.style.strokeDasharray = `${(value * 100).toFixed(2)} 100`;
  }

  function setPhase(next) {
    if (next === phase) return;
    phase = next;
    onPhase(phase);
  }

  function step(now) {
    const { ms, phase: kind } = estimate(now);
    const dt = now - last;
    last = now;
    const elapsed = now - began;
    if (ms === null) {
      if (!svg.classList.contains('is-indeterminate')) svg.classList.add('is-indeterminate');
      fill.style.strokeDasharray = ''; // the style sheet draws the circling arc
      setPhase(kind);
      return;
    }
    if (svg.classList.contains('is-indeterminate')) svg.classList.remove('is-indeterminate');
    if (ms > 0) scale = Math.max(scale, elapsed + ms);
    p = advance(p, dt, ms, scale || elapsed);
    draw(p);
    const late = kind === 'preparing' && elapsed > LATE_AFTER * scale && elapsed > scale + LATE_MIN_MS;
    setPhase(late ? 'late' : kind);
  }

  function loop(now) {
    step(now);
    frame = requestAnimationFrame(loop);
  }

  return {
    get phase() {
      return phase;
    },

    start() {
      if (phase !== 'off') return;
      clearTimeout(fadeTimer);
      began = last = performance.now();
      p = START;
      scale = 0;
      svg.classList.remove('is-indeterminate', 'is-done');
      draw(p);
      svg.classList.add('is-on');
      setPhase('preparing');
      step(began); // shows the right style (filling or circling) at once
      frame = requestAnimationFrame(loop);
    },

    stop({ heard = false } = {}) {
      if (phase === 'off') return;
      cancelAnimationFrame(frame);
      frame = null;
      setPhase('off');
      // The sound started: complete the ring as it fades (unless motion is reduced).
      if (heard && !reducedMotion()) {
        svg.classList.remove('is-indeterminate');
        draw(1);
        svg.classList.add('is-done');
      }
      svg.classList.remove('is-on');
      fadeTimer = setTimeout(() => svg.classList.remove('is-done', 'is-indeterminate'), 300);
    },
  };
}
