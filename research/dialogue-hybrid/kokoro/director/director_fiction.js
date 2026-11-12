// PROTOTYPE: "fiction director", a modified copy of director.js (see that file's header for
// everything that is unchanged). Pure string rules, no model. Differences, marked FICTION below:
//
//  F1 Attribution with a capital: a short sentence (at most 6 words) right after a quote,
//     "Daniel whispered." / "He laughed." / "Her voice cracked.", gives its cue to that quote
//     when it contains a cue word; the same sentence right BEFORE a quote of the same
//     paragraph gives its cue to that quote too (so a cue between two quotes covers both).
//  F2 Lead-in paragraph: a narration paragraph of at most 8 words ending in — – : or , gives
//     its cue to the first quote of the next paragraph ("Then, softly—" + “Yeah. …”).
//  F3 Voice description: a narration paragraph of at most 12 words starting "The/His/Her/Their
//     voice" with a cue word ("The voice on the other end was barely a whisper.") gives its cue
//     to the cue-less quotes of the paragraph before it; the next paragraph's first quote, if it
//     has no cue of its own, carries a whisper / soft / slow delivery on (the voice goes on).
//  F4 Mild cues (laugh, tremble, soft, sweet, a lone "!", "exclaimed") are kept with LIGHT
//     values (measured, see LIGHT) when the quote is free-standing: in every sentence it
//     touches, it is the whole sentence or is separated from the narration by its own
//     sentence end (“No.” Her voice cracked.). Never otherwise (no splice at a comma).
//     "sigh" stays out: measured too small. "softly / quietly" right next to a speech verb
//     ("very quietly, she said,") counts as a real cue (softsay) and may splice like whisper.
//  F5 Capitals: a quote all in capitals is raised as a whole ("RUN, SARAH! RUN!", "OH,
//     DANIEL!"); a capitals word of 4+ letters closing a quote after … , — raises with "?" too
//     ("Wait… WHAT?"); "OK?" and acronyms after plain words ("NASA, OK?") still do not.
//  F6 A narration paragraph that is only a capitals exclamation of at most 3 words ("BANG!")
//     is raised.
//  F7 The last paragraph of a text of 5 or more paragraphs, when it is entirely quoted speech
//     of at most 8 words without "!", is read 7% slower (calm).
//  F8 pausePlan(): the pause after each paragraph depends on what it is (see PAUSES).
//  F9 Optional voices (prototype C): quoted speech in the speaker's voice (see speakers.js).
import { quoteLanguage, hasForeignWords } from './foreign.js';
import { spokenForms } from '../text/spoken.js';
import { designedPause } from '../flow/assemble.js';
import { speakersOf } from './speakers.js';

// ---- cues -> performance ---------------------------------------------------------

const CUES = [
  ['whisper', /\bwhisper|\bmurmur|\bmutter|\bunder (?:her|his|their) breath|\bbreathed\b/i],
  ['shout', /\bshout|\byell|\bscream|\bbellow|\broar|\bcried out|\bcalled out|\bhollered/i],
  ['excited', /\bexclaim|\bcried\b|\bgasp|\bblurted/i],
  ['tremble', /\btrembl|\bshaking\b|\bshaky|\bquaver|\bvoice (?:broke|cracked|cracking|shook)|\bstammer/i], // FICTION: "voice cracked"
  ['slow', /\bslow(?:ly|ing)?\b|\bdeliberately\b|\bmeasured\b|\bdrawled/i],
  ['laugh', /\blaugh|\bgiggl|\bchuckl/i],
  ['sigh', /\bsigh/i],
  ['soft', /\bsoft(?:ly)?\b|\bquiet(?:ly)?\b|\bgently\b|\bhushed/i],
  ['sweet', /\bsweetly\b/i], // FICTION
];
export const PRESETS = {
  whisper: { whisper: 1.1, speed: 0.92 },
  shout: { pitch: 0.55, firm: 0.6, speed: 1.06, gainDb: 4, shelfDb: 3 },
  excited: { pitch: 0.3, firm: 0.3, speed: 1.03, gainDb: 1.5 },
  tremble: { whisper: 0.3 },
  slow: { speed: 0.85 },
  laugh: { pitch: 0.35, speed: 1.04, gainDb: 1 },
  sigh: { whisper: 0.45, speed: 0.94 },
  soft: { whisper: 0.35, gainDb: -1.5 },
  softsay: { whisper: 0.6, gainDb: -3 }, // FICTION F4: "very quietly, she said,"
  calm: { speed: 0.93 }, // FICTION F7
};
// FICTION F4: light styles for mild cues on free-standing quotes. Measured against the plain
// render (8 lines, af_heart): laugh +1.6 st, +0.7 dB, 4% quicker; soft -4.6 dB, HNR -3 dB;
// tremble -2.5 dB, HNR -2.9 dB (breathier and quieter: the model has no tremor); sweet
// +1.5 st, -2.0 dB; excited +1.3 st, +1.6 dB. Today's soft (-2.2 dB) and tremble (-0.6 dB,
// HNR -1.0, the size of render-to-render variation) were too small, so they are stronger here.
export const LIGHT = {
  laugh: { pitch: 0.35, speed: 1.04, gainDb: 1 },
  soft: { whisper: 0.6, gainDb: -3 },
  tremble: { whisper: 0.6, speed: 0.95, gainDb: -1 },
  sweet: { pitch: 0.35, whisper: 0.25, gainDb: -1 },
  excited: { pitch: 0.3, firm: 0.3, speed: 1.03, gainDb: 1.5 },
};
const MILD = new Set(['laugh', 'sigh', 'soft', 'excited', 'tremble', 'sweet']);
export const MIN_SPEED = 0.85;
export const PLAIN = Object.freeze({ whisper: 0, firm: 0, pitch: 0, speed: 1, gainDb: 0, shelfDb: 0 });

/** Performer settings for a set of cues (the strongest of each kind wins; speeds multiply). */
export function perfFor(tags, presets = PRESETS) {
  const p = { ...PLAIN };
  if (tags.includes('shout')) tags = tags.filter((t) => t !== 'whisper' && t !== 'soft' && t !== 'sigh' && t !== 'softsay');
  for (const t of tags) {
    const q = presets[t];
    if (!q) continue;
    p.whisper = Math.max(p.whisper, q.whisper ?? 0);
    p.firm = Math.max(p.firm, q.firm ?? 0);
    p.pitch = Math.max(p.pitch, q.pitch ?? 0);
    p.speed *= q.speed ?? 1;
    p.gainDb += q.gainDb ?? 0;
    p.shelfDb = Math.max(p.shelfDb, q.shelfDb ?? 0);
  }
  if (p.whisper && p.firm) p.firm = 0;
  p.speed = +Math.min(1.15, Math.max(MIN_SPEED, p.speed)).toFixed(4);
  p.gainDb = Math.min(4.5, p.gainDb);
  return p;
}

const cuesIn = (s) => CUES.filter(([, re]) => re.test(s)).map(([t]) => t);

export function styleKey(style, lang = 'en') {
  const fields = Object.keys(PLAIN).filter((k) => style[k] !== PLAIN[k]).map((k) => `${k}${style[k]}`);
  return lang === 'en' && !fields.length ? '' : [lang, ...fields].join(' ');
}

// ---- quotes (unchanged) ----------------------------------------------------------------

export function quoteSpans(par) {
  const out = [];
  let inQuote = false;
  let from = 0;
  const push = (kind, end) => {
    const raw = par.slice(from, end);
    const text = raw.trim();
    const start = from + raw.length - raw.trimStart().length;
    if (text) out.push({ kind, text, start, end: start + text.length });
  };
  for (let i = 0; i < par.length; i++) {
    const c = par[i];
    if (!inQuote && (c === '“' || (c === '"' && /(^|[\s(—–-])$/.test(par[i - 1] ?? ' ')))) {
      push('narr', i);
      inQuote = true;
      from = i + 1;
    } else if (inQuote && (c === '”' || c === '"')) {
      push('quote', i);
      inQuote = false;
      from = i + 1;
    }
  }
  push(inQuote ? 'quote' : 'narr', par.length);
  const unclosed = inQuote;
  return out.reduce((spans, s, i) => {
    const speech = s.kind === 'quote' && ((unclosed && i === out.length - 1) || SPEECH_END.test(s.text));
    const kind = s.kind === 'quote' && !speech ? 'narr' : s.kind;
    const last = spans.at(-1);
    if (kind === 'narr' && last?.kind === 'narr') {
      last.end = s.end;
      last.text = par.slice(last.start, last.end);
    } else spans.push({ ...s, kind });
    return spans;
  }, []);
}
const SPEECH_END = /[,.!?…—–]$/;

// ---- cues for each quote ------------------------------------------------------------------

const NOT_ATTRIBUTION = /^(?:who|whom|whose|which|that|and|or|but|of|is|are|was|were|has|had)\b/i;
const lastWords = (t, n) => t.split(/\s+/).slice(-n).join(' ');
const firstWords = (t, n) => t.split(/\s+/).slice(0, n).join(' ');
const wordsOf = (t) => t.match(/[\p{L}\p{N}']+/gu) || [];
const lastSentence = (t) => t.split(/(?<=[.!?…])\s/).pop();
const firstSentence = (t) => t.split(/(?<=[.!?…])\s/)[0];

// FICTION F1: "Daniel whispered." / "He laughed." / "Her voice cracked." (with a cue word).
const ATTRIB_STOP = /^(?:The|A|An|Then|And|But|So|Or|This|That|These|Those|It|There|Here|Now|When|While|After|Before|If|As|At|In|On|Of|For|With|No|Yes|Finally|Suddenly|Meanwhile|Outside|Inside)\b/;
const ATTRIB_START = /^(?:(?:He|She|They|I|We)\s+\p{Ll}|(?:His|Her|Their|My)\s+voice\b|\p{Lu}\p{Ll}+\s+\p{Ll}+(?:ed|s)\b)/u;
export function shortAttribution(sentence) {
  return wordsOf(sentence).length <= 6 && !ATTRIB_STOP.test(sentence) && ATTRIB_START.test(sentence) && cuesIn(sentence).length > 0;
}
// FICTION F4: "softly" / "quietly" right next to a speech verb is a real cue.
const SOFT_SAY = /\b(?:soft(?:ly)?|quiet(?:ly)?|gently)\b,?\s+(?!and\b|or\b|then\b|but\b)[a-z]+\s+(?:said|asked|replied|added|answered|whispered)\b|\b(?:said|asked|replied|added|answered)\s+(?:very\s+)?(?:soft(?:ly)?|quiet(?:ly)?|gently)\b/;

// leadIn: cue text of a lead-in paragraph before this one (F2); described: of a voice
// description paragraph after this one (F3); carry: tags carried on from a description before (F3).
function attachCues(spans, { leadIn = '', described = '', carry = null } = {}) {
  let previous = carry; // cues of the last quote that had any
  spans.forEach((s, i) => {
    if (s.kind !== 'quote') return;
    const prev = spans[i - 1];
    const next = spans[i + 1];
    const prevText = prev?.kind === 'narr' ? prev.text : '';
    const nextText = next?.kind === 'narr' ? next.text : '';
    let before = '';
    if (/[,:]\s*$/.test(prevText)) before = lastWords(lastSentence(prevText), 8);
    else if (prevText && shortAttribution(lastSentence(prevText))) before = lastSentence(prevText); // F1
    else if (!prev && leadIn) before = leadIn; // F2
    let after = '';
    if (nextText && /^\p{Ll}/u.test(nextText) && !NOT_ATTRIBUTION.test(nextText)) after = firstWords(firstSentence(nextText), 6);
    else if (nextText && shortAttribution(firstSentence(nextText))) after = firstSentence(nextText); // F1
    let attribution = `${before} ${after}`.trim();
    if (!attribution && described) attribution = described; // F3
    let tags = cuesIn(attribution);
    if (tags.includes('soft') && SOFT_SAY.test(attribution.toLowerCase())) tags = tags.map((t) => (t === 'soft' ? 'softsay' : t));
    if (!attribution && previous) tags = previous.filter((t) => ['slow', 'whisper', 'soft', 'softsay'].includes(t));
    s.tags = tags;
    if (attribution) previous = tags.length ? tags : null;
  });
}

// ---- one sentence ---------------------------------------------------------------------

const HAS_WORDS = /[\p{L}\p{N}]/u;
const CAPS_RUN = /^(.*?[…,—-]\s*)((?:\p{Lu}{2,}[\s,]*)+[!?]+)$/u;
const ALL_CAPS = /^(?:\p{Lu}{2,}[\s,]*)+[!?]+$/u;
const lowerCaps = (t) => t.replace(/\b\p{Lu}{2,}\b/gu, (w) => w.toLowerCase());

function piecesOf(spans, par, from, to) {
  const pieces = [];
  for (const s of spans) {
    const a = Math.max(from, s.start);
    const b = Math.min(to, s.end);
    if (a >= b) continue;
    const text = par.slice(a, b).trim();
    if (HAS_WORDS.test(text)) pieces.push({ kind: s.kind, text, tags: s.kind === 'quote' ? [...(s.tags || [])] : [], span: s });
  }
  return pieces;
}

function quoteUnits(piece) {
  const t = piece.text;
  const tags = [...piece.tags];
  if (/[!?]!|!\?|\?!/.test(t) && !tags.includes('shout')) tags.push('excited');
  else if (/!$/.test(t) && !tags.length) tags.push('excited');
  const base = { kind: 'quote', span: piece.span, speaker: piece.speaker };
  // FICTION F5: all capitals first, so "RUN, SARAH!" is raised as a whole
  if (ALL_CAPS.test(t) && raises(t)) return [{ ...base, text: lowerCaps(t), tags: [...new Set([...tags, 'shout'])] }];
  const caps = t.match(CAPS_RUN);
  if (caps && raises(caps[2], { question: true }) && caps[1].trim()) {
    return [
      { ...base, text: caps[1].trim(), tags: tags.filter((x) => x !== 'excited') },
      { ...base, text: caps[2].trim().toLowerCase(), tags: [...new Set([...tags, 'shout'])] },
    ];
  }
  return [{ ...base, text: t, tags }];
}

// "!" in the closing marks raises; FICTION F5: so does "?" after a capitals word of 4+ letters
// (only in the "Wait… WHAT?" form); never when it is just "OK".
function raises(run, { question = false } = {}) {
  const words = run.match(/\p{Lu}{2,}/gu) || [];
  if (!words.length || words.every((w) => w === 'OK')) return false;
  const closing = run.match(/[!?]+$/)?.[0] ?? '';
  if (/!/.test(closing)) return true;
  return question && /\?/.test(closing) && words.at(-1).length >= 4;
}

const languageOf = (u) => (u.kind !== 'quote' || /\d/.test(u.text) ? 'en' : quoteLanguage(u.text));

function mergeUnits(units) {
  const merged = [];
  for (const u of units) {
    const last = merged.at(-1);
    const same = (x) => `${x.lang}|${x.light ? 'L' : ''}|${x.voice ?? ''}|${[...new Set(x.tags)].sort().join(',')}`;
    if (last && same(last) === same(u)) {
      last.text = `${last.text} ${u.text}`;
      last.kind = last.kind === u.kind ? u.kind : 'mixed';
      continue;
    }
    merged.push({ ...u });
  }
  return merged;
}

function deliveryOf(sentenceText, units, quoted, spoken) {
  const part = (u, style) => {
    const said = spoken(u.text);
    const p = { text: said, lang: u.lang, style, names: u.lang === 'en' && hasForeignWords(said) };
    if (u.voice) p.voice = u.voice; // FICTION F9
    return p;
  };
  const styleOf = (u) => perfFor(u.tags, u.light ? { ...PRESETS, ...LIGHT } : PRESETS);
  const voiceKey = (u) => (u.voice ? `voice:${u.voice}` : '');
  if (units.length === 1) {
    const [u] = units;
    const style = styleOf(u);
    const key = [styleKey(style, u.lang), voiceKey(u)].filter(Boolean).join(' ');
    return { parts: [part(key ? u : { ...u, text: sentenceText }, style)], key, spliced: false, quoted };
  }
  const parts = units.map((u) => part(u, styleOf(u)));
  return { parts, key: 'spliced', spliced: true, quoted };
}

export function plainDelivery(sentence, { british = false } = {}) {
  return { parts: [{ text: spokenForms(sentence.text, { british }), lang: 'en', style: PLAIN, names: false }], key: '', spliced: false, quoted: false };
}

// ---- paragraphs ---------------------------------------------------------------------

function paragraphsOf(sentences) {
  const paras = [];
  for (let i = 0; i < sentences.length; ) {
    let j = i;
    while (j < sentences.length && sentences[j].para === sentences[i].para) j++;
    const group = sentences.slice(i, j);
    const text = group.map((s) => s.text).join(' ');
    paras.push({ first: i, group, text, spans: quoteSpans(text) });
    i = j;
  }
  return paras;
}
const narrationOnly = (p) => p.spans.every((s) => s.kind === 'narr');
const LEAD_IN = (p) => narrationOnly(p) && wordsOf(p.text).length <= 8 && /[—–:,]$/.test(p.text);
const DESCRIPTION = (p) => narrationOnly(p) && wordsOf(p.text).length <= 12 && /^(?:The|His|Her|Their)\s+voice\b/.test(p.text) && cuesIn(p.text).length > 0;
const startsWithQuote = (p) => p.spans[0]?.kind === 'quote';

/**
 * Deliveries for the app's sentences ({ text, para }), one per sentence.
 * `voices` (prototype C): { narrator, male, female } voice names; quotes are read in the
 * voice of their speaker (speakers.js) when the speaker's gender is known.
 */
export function direct(sentences, { british = false, voices = null } = {}) {
  const spoken = (t) => spokenForms(t, { british });
  const paras = paragraphsOf(sentences);
  // cues, with the neighbouring paragraphs (F2, F3)
  paras.forEach((p, k) => {
    const prev = paras[k - 1];
    const next = paras[k + 1];
    const leadIn = prev && LEAD_IN(prev) && startsWithQuote(p) ? prev.text : '';
    const described = next && DESCRIPTION(next) && !narrationOnly(p) ? next.text : '';
    const carry = prev && DESCRIPTION(prev) && paras[k - 2] && !narrationOnly(paras[k - 2]) && startsWithQuote(p)
      ? cuesIn(prev.text).filter((t) => ['slow', 'whisper', 'soft'].includes(t)) : null;
    attachCues(p.spans, { leadIn, described, carry: carry?.length ? carry : null });
  });
  const speakers = voices ? speakersOf(paras) : null;
  const out = [];
  paras.forEach((p, k) => {
    const { spans, group, text: par } = p;
    const last = k === paras.length - 1;
    // F7: a calm closing line
    if (last && paras.length >= 5 && spans.every((s) => s.kind === 'quote') && wordsOf(par).length <= 8 && !/!/.test(par)) {
      for (const s of spans) if (!s.tags.some((t) => ['shout', 'excited'].includes(t))) s.tags = [...s.tags, 'calm'];
    }
    // pieces of every sentence, and whether each quote span is free-standing (F4)
    let from = 0;
    const perSentence = group.map((s) => {
      const to = from + s.text.length;
      const pieces = piecesOf(spans, par, from, to);
      from = to + 1;
      return pieces;
    });
    for (const s of spans) if (s.kind === 'quote') s.free = true;
    for (const pieces of perSentence) {
      pieces.forEach((pc, j) => {
        if (pc.kind !== 'quote') return;
        const before = pieces[j - 1];
        const after = pieces[j + 1];
        const okAfter = !after || (/[.!?…]$/.test(pc.text) && /^\p{Lu}/u.test(after.text));
        const okBefore = !before || (/[.!?…]$/.test(before.text) && /^[\p{Lu}¡¿]/u.test(pc.text));
        if (!okAfter || !okBefore) pc.span.free = false;
      });
    }
    group.forEach((s, j) => {
      const pieces = perSentence[j];
      // F6: "BANG!" on its own
      if (group.length === 1 && narrationOnly(p) && ALL_CAPS.test(par) && raises(par) && wordsOf(par).length <= 3) {
        const u = { kind: 'narr', text: lowerCaps(par), tags: ['shout'], lang: 'en' };
        out.push(deliveryOf(s.text, [u], false, spoken));
        return;
      }
      const units = pieces.flatMap((pc) => (pc.kind === 'quote' ? quoteUnits(pc) : [pc]));
      for (const u of units) {
        // F4: mild cues only on free-standing quotes, and there with the light values
        if (u.kind === 'quote' && u.span?.free && u.tags.some((t) => MILD.has(t))) u.light = true;
        else if (u.tags.length && u.tags.every((t) => MILD.has(t))) u.tags = [];
        u.lang = languageOf(u);
        if (voices && u.kind === 'quote') {
          const who = speakers.bySpan.get(u.span);
          const v = who && voices[speakers.gender[who]];
          if (v && v !== voices.narrator) u.voice = v;
        }
      }
      const merged = mergeUnits(units).map(({ span, ...u }) => u);
      const quoted = pieces.length > 0 && pieces.every((pc) => pc.kind === 'quote');
      out.push(merged.length ? deliveryOf(s.text, merged, quoted, spoken) : plainDelivery(s, { british }));
    });
  });
  return out;
}

/** Who speaks each quote paragraph (prototype C), for the report. */
export function speakerTable(sentences) {
  const paras = paragraphsOf(sentences);
  paras.forEach((p) => attachCues(p.spans));
  return speakersOf(paras);
}

// ---- FICTION F8: pauses ----------------------------------------------------------------
// Seconds of silence after a paragraph (inside a paragraph: designedPause, unchanged):
export const PAUSES = {
  normal: 0.85, // today's paragraph pause
  exchange: 0.5, // between two short dialogue paragraphs (a quick back-and-forth)
  cutOff: 0.55, // after speech broken off with a dash ("You… you actually—")
  leadIn: 1.0, // after a short lead-in ending in a dash or colon, before the line ("Then, softly—")
  beforeBeat: 1.0, // before a one- or two-word narration paragraph
  beat: 1.2, // after a one- or two-word narration paragraph ("BANG!", "Twenty.", "A giggle.")
  cliff: 1.25, // after narration ending in a dash ("And then—")
  silence: 1.6, // after a short narration paragraph about silence ("Silence.", "Then… nothing.", "Ten seconds passed.", "A pause.")
};
const SILENCE_WORDS = /\b(?:silence|pause|nothing|passed|waited|still)\b/i;
const dialogue = (p) => p.spans.some((s) => s.kind === 'quote') && wordsOf(p.spans.filter((s) => s.kind === 'narr').map((s) => s.text).join(' ')).length <= 8;

/** The pause after each sentence (seconds at normal speed), with the paragraph rules above. */
export function pausePlan(sentences) {
  const paras = paragraphsOf(sentences);
  const out = sentences.map((s, i) => designedPause(s, false));
  paras.forEach((p, k) => {
    const next = paras[k + 1];
    const words = wordsOf(p.text).length;
    const long = [];
    let short = null;
    if (narrationOnly(p)) {
      const leadIn = /[—–:]$/.test(p.text) && words <= 8 && next && startsWithQuote(next);
      if (leadIn) long.push(PAUSES.leadIn); // the held breath before the line wins over the rules below
      else if (/[—–]$/.test(p.text)) long.push(PAUSES.cliff);
      else {
        if (words <= 2) long.push(PAUSES.beat);
        if (words <= 4 && (/…/.test(p.text) || SILENCE_WORDS.test(p.text))) long.push(PAUSES.silence);
      }
    } else if (/[—–][”"]?$/.test(p.text)) short = PAUSES.cutOff;
    if (next && narrationOnly(next) && wordsOf(next.text).length <= 2) long.push(PAUSES.beforeBeat);
    if (!short && next && dialogue(p) && dialogue(next) && words <= 25 && wordsOf(next.text).length <= 25 && !long.length) short = PAUSES.exchange;
    out[p.first + p.group.length - 1] = long.length ? Math.max(...long) : short ?? PAUSES.normal;
  });
  return out;
}
