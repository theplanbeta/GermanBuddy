// Small helpers for turning model output into playable, downloadable audio.
// Audio is kept as 16-bit integers: half the memory of the model's floats and
// exactly what goes into a WAV file.

/** Floats from -1 to 1 -> 16-bit samples. */
export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
  return out;
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

/** Joins 16-bit pieces into one WAV file without copying them into one big array. */
export function wavBlob(pieces, sampleRate) {
  const count = pieces.reduce((n, c) => n + c.length, 0);
  return new Blob([wavHeader(count, sampleRate), ...pieces], { type: 'audio/wav' });
}

/** A tiny silent WAV, played inside a tap so phones allow later playback. */
export function silentWav() {
  return wavBlob([new Int16Array(240)], 24000);
}
