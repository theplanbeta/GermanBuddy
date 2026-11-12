// Small helpers for turning model output into playable, downloadable audio.
// Audio is kept as 16-bit integers: half the memory of the model's floats and
// exactly what goes into a WAV file.

export const SENTENCE_PAUSE = 0.3; // seconds of silence after a sentence
export const PARAGRAPH_PAUSE = 0.75; // ... and after the end of a paragraph
const FADE = 0.004; // 4 ms fade in/out so clips never start or end with a click

/**
 * Model output (floats from -1 to 1) -> 16-bit clip with fades and a trailing pause.
 * @returns {Int16Array}
 */
export function makeClip(samples, sampleRate, pauseSeconds) {
  const fade = Math.min(Math.round(FADE * sampleRate), samples.length >> 1);
  const clip = new Int16Array(samples.length + Math.round(pauseSeconds * sampleRate)); // zeros = silence
  for (let i = 0; i < samples.length; i++) {
    let gain = 1;
    if (i < fade) gain = i / fade;
    else if (i >= samples.length - fade) gain = (samples.length - 1 - i) / fade;
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    clip[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return clip;
}

function wavHeader(sampleCount, sampleRate) {
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset, s) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + sampleCount * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true); // format chunk size
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true); // bytes per second
  header.setUint16(32, 2, true); // bytes per sample
  header.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  header.setUint32(40, sampleCount * 2, true);
  return header.buffer;
}

/** Joins 16-bit clips into one WAV file without copying them into one big array. */
export function wavBlob(clips, sampleRate) {
  const count = clips.reduce((n, c) => n + c.length, 0);
  return new Blob([wavHeader(count, sampleRate), ...clips], { type: 'audio/wav' });
}

/** A tiny silent WAV, played inside a tap so phones allow later playback. */
export function silentWav() {
  return wavBlob([new Int16Array(240)], 24000);
}
