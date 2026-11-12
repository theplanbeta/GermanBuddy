// The English Kokoro voices, grouped for the voice picker. Within each group
// they are ordered from most to least natural-sounding, following the quality
// grades in the kokoro-js README.
export const DEFAULT_VOICE = 'af_heart';

export const VOICE_GROUPS = [
  {
    label: 'American, female',
    voices: ['af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'af_kore', 'af_sarah', 'af_alloy', 'af_nova', 'af_sky', 'af_jessica', 'af_river'],
  },
  {
    label: 'American, male',
    voices: ['am_fenrir', 'am_michael', 'am_puck', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_santa', 'am_adam'],
  },
  { label: 'British, female', voices: ['bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'] },
  { label: 'British, male', voices: ['bm_fable', 'bm_george', 'bm_lewis', 'bm_daniel'] },
];

export const ALL_VOICES = VOICE_GROUPS.flatMap((g) => g.voices);

/** "af_heart" -> "Heart — American, female" */
export function voiceLabel(id) {
  const group = VOICE_GROUPS.find((g) => g.voices.includes(id));
  const name = id.slice(3);
  return `${name[0].toUpperCase()}${name.slice(1)} — ${group?.label ?? ''}`;
}
