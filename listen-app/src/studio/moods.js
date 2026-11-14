// Which mood the studio voice gives a sentence. Pure string rules, no model;
// tested in tests/moods.test.js.
//
// The studio voice (Chatterbox, see research/colab-studio) acts a line when the
// text starts with a mood in square brackets. The owner chose by ear, on a
// paragraph of one speaker whose mood turns from delight to alarm: happy for
// delight, a sigh for the calm line, fear for alarm, angry for urgent commands,
// a groan for exasperation. Same guiding rule as the director: a missed mood is
// inaudible (the model still reads the line well), a wrong one is jarring. So
// every rule wants a clear sign, and most sentences get no mood.

const GROAN = /^(?:u+gh+|a+rgh+|oh,? great|great\.\.\.|for (?:god's|heaven's) sake)\b/i;
const ALARM = /\b(?:no,? no\b|oh no\b|don['’]t tell me|what was that|who['’]s there|wait a (?:second|minute|sec)|hold on|something(?: is|['’]s) wrong|i['’]m scared|help me)/i;
const UNEASY = /\b(?:weird|strange|creepy|scary|wrong)\b/i;
const COMMAND = /^(?:run|go|grab|get (?:out|down|back|up|in)|move|hurry|stop|look out|watch out|come on|quick|duck|hide)\b/i;
const CALM = /\b(?:breath|breathe|relax|calm|quiet|peaceful|smell|listen)\b/i;
const DELIGHT = /\b(?:incredible|amazing|wow|beautiful|wonderful|gorgeous|unbelievable|can you believe|we did it|we made it|pull(?:ed)? (?:this|it) off)\b/i;

/** '' or one of 'groan' | 'fear' | 'angry' | 'sigh' | 'happy'. */
export function moodFor(text) {
  const t = text.trim().replace(/^["“'‘(]+/, '');
  const shout = /!/.test(t);
  const asks = /\?/.test(t);
  if (GROAN.test(t)) return 'groan';
  if (ALARM.test(t)) return 'fear';
  if (asks && UNEASY.test(t)) return 'fear';
  if (shout && (COMMAND.test(t) || /\bnow!+["”'’)]*$/i.test(t))) return 'angry';
  if (/\.\.\.|…/.test(t) && !shout && !asks && CALM.test(t)) return 'sigh';
  if (DELIGHT.test(t) && (shout || asks)) return 'happy';
  return '';
}

export const MAX_LINE = 400; // the helper takes no longer text

/**
 * What to ask the studio voice for one sentence: { text, expect } (text with
 * its mood in front, expect the bare words for the helper's check), or null
 * when the sentence should stay with the device's own voice (nothing to say,
 * or too long).
 */
export function studioLine(spoken) {
  // A dash inside a sentence is read as a short break.
  const expect = spoken.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(expect) || expect.length > MAX_LINE - 10) return null;
  const mood = moodFor(expect);
  return { text: mood ? `[${mood}] ${expect}` : expect, expect, mood };
}

/** The studio has two voices so far: a woman's and a man's. */
export function studioVoiceFor(voice) {
  return voice?.[1] === 'm' ? 'am_fenrir' : 'af_aoede';
}

/** A short, stable name for one request (the same line in the same voice is made once). */
export function lineId(voice, text) {
  let h = 2166136261;
  for (const c of `${voice}|${text}`) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return `a${(h >>> 0).toString(36)}${text.length.toString(36)}`;
}
