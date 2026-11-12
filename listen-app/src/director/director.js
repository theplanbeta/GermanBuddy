// The "director": reads the text the way an actor reads a script and decides,
// for every sentence, how it is delivered: plainly, or whispered, raised,
// slower, in German or Spanish. Pure string rules, no model; tested in
// tests/director.test.js.
//
// The rules are the research prototype's (research/expressive-kokoro/
// director.mjs), which the owner chose by ear, applied to the app's own
// sentences (so the highlight and the delivery always agree):
//   - Only quoted speech is ever styled. Narration is read plainly, whatever
//     words it contains.
//   - A quote takes its cue from the words that introduce or follow it:
//     "she whispered," -> whisper; "someone shouted" -> raised voice;
//     "deliberately slowing" -> slower; "her voice trembling" -> a little breathy.
//     A quote with no such words continues the slow or whispered delivery of
//     the speaker's previous quote.
//   - "WHAT?!" (capitals ending in ! or ?!) is raised on its own.
//   - Small cues (laughing, sighing, softly, a plain "!") change the voice too
//     little to be worth it and are dropped, so those sentences stay whole and plain.
//   - A quote in German or Spanish is read with German or Spanish sounds;
//     German and Spanish words inside English (names like "Müller") too.
// Each sentence gets a delivery:
//   { parts: [{ text, lang, style, names }], key, spliced, quoted }
//   parts    what the voice says, in order: `text` in spoken form (see
//            text/spoken.js), `lang` 'en' | 'de' | 'es', `style` the performer
//            settings below, `names` true when English text holds German or
//            Spanish words.
//   key      '' for plain English; otherwise names the style and language.
//            Only sentences with the same key may share a model call.
//   spliced  the delivery changes inside the sentence (several parts): the
//            sentence is made on its own, once per style, and cut together.
//   quoted   the sentence is entirely quoted speech.
// With nothing to direct (ordinary prose) every sentence is plain and its
// text is exactly the sentence, so the reading is the same as without the director.
import { detectLanguage, hasForeignWords } from './foreign.js';
import { spokenForms } from '../text/spoken.js';

// ---- cues -> performance (copied from the prototype) --------------------------

const CUES = [
  ['whisper', /\bwhisper|\bmurmur|\bmutter|\bunder (?:her|his|their) breath|\bbreathed\b/i],
  ['shout', /\bshout|\byell|\bscream|\bbellow|\broar|\bcried out|\bcalled out|\bhollered/i],
  ['excited', /\bexclaim|\bcried\b|\bgasp|\bblurted/i],
  ['tremble', /\btrembl|\bshaking\b|\bshaky|\bquaver|\bvoice broke|\bstammer/i],
  ['slow', /\bslow(?:ly|ing)?\b|\bdeliberately\b|\bmeasured\b|\bdrawled/i],
  ['laugh', /\blaugh|\bgiggl|\bchuckl/i],
  ['sigh', /\bsigh/i],
  ['soft', /\bsoft(?:ly)?\b|\bquiet(?:ly)?\b|\bgently\b|\bhushed/i],
];
// Performer settings per cue. whisper / firm: how far the voice's timbre moves
// towards a breathy (or firmer) voice; pitch: how far its intonation moves up;
// speed: the model's speed; gainDb / shelfDb: louder, and brighter above 2 kHz.
// (The prototype's optional tremolo for "trembling" was off in what the owner chose, so it is not here.)
export const PRESETS = {
  whisper: { whisper: 1.1, speed: 0.92 },
  shout: { pitch: 0.55, firm: 0.6, speed: 1.06, gainDb: 4, shelfDb: 3 },
  excited: { pitch: 0.3, firm: 0.3, speed: 1.03, gainDb: 1.5 },
  tremble: { whisper: 0.3 },
  slow: { speed: 0.85 },
  laugh: { pitch: 0.35, speed: 1.04, gainDb: 1 },
  sigh: { whisper: 0.45, speed: 0.94 },
  soft: { whisper: 0.35, gainDb: -1.5 },
};
const MILD = new Set(['laugh', 'sigh', 'soft', 'excited', 'tremble']);
export const MIN_SPEED = 0.85; // slower than this sounded unnatural
export const PLAIN = Object.freeze({ whisper: 0, firm: 0, pitch: 0, speed: 1, gainDb: 0, shelfDb: 0 });

/** Performer settings for a set of cues (the strongest of each kind wins; speeds multiply). */
export function perfFor(tags) {
  const p = { ...PLAIN };
  // shouting beats whispering when both appear
  if (tags.includes('shout')) tags = tags.filter((t) => t !== 'whisper' && t !== 'soft' && t !== 'sigh');
  for (const t of tags) {
    const q = PRESETS[t];
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

/** A short name for a style and language: '' for plain English, e.g. 'de whisper1.1 speed0.92'. */
export function styleKey(style, lang = 'en') {
  const fields = Object.keys(PLAIN).filter((k) => style[k] !== PLAIN[k]).map((k) => `${k}${style[k]}`);
  return lang === 'en' && !fields.length ? '' : [lang, ...fields].join(' ');
}

// ---- quotes -------------------------------------------------------------------

/**
 * A paragraph as alternating narration / quote spans, with their position
 * (quote marks themselves belong to neither). Handles “ ” and straight " pairs.
 */
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
  return out;
}

// Cues for each quote, from the narration right before it (ending in , or :)
// or right after it (starting in lower case: "…,” she whispered.").
function attachCues(spans) {
  let previous = null; // cues of the last quote that had any
  spans.forEach((s, i) => {
    if (s.kind !== 'quote') return;
    const before = spans[i - 1]?.kind === 'narr' && /[,:]\s*$/.test(spans[i - 1].text) ? spans[i - 1].text : '';
    const after = spans[i + 1]?.kind === 'narr' && /^\p{Ll}/u.test(spans[i + 1].text) ? spans[i + 1].text.split(/(?<=[.!?])\s/)[0] : '';
    const attribution = `${before.split(/(?<=[.!?])\s/).pop()} ${after}`;
    let tags = cuesIn(attribution);
    // no attribution: the same speaker goes on, keeping a slow or whispered delivery
    if (!attribution.trim() && previous) tags = previous.filter((t) => ['slow', 'whisper', 'soft'].includes(t));
    s.tags = tags;
    if (tags.length) previous = tags;
  });
}

// ---- one sentence -------------------------------------------------------------

const HAS_WORDS = /[\p{L}\p{N}]/u;
const CAPS_RUN = /^(.*?[…,—-]\s*)((?:\p{Lu}{2,}[\s,]*)+[!?]+)$/u; // "Wait… WHAT?!"
const ALL_CAPS = /^(?:\p{Lu}{2,}[\s,]*)+[!?]+$/u; // "STOP!" (app addition: the prototype only lowered its case)
const lowerCaps = (t) => t.replace(/\b\p{Lu}{2,}\b/gu, (w) => w.toLowerCase());

// The narration and quote pieces of the sentence at [from, to) of the paragraph.
function piecesOf(spans, par, from, to) {
  const pieces = [];
  for (const s of spans) {
    const a = Math.max(from, s.start);
    const b = Math.min(to, s.end);
    if (a >= b) continue;
    const text = par.slice(a, b).trim();
    if (HAS_WORDS.test(text)) pieces.push({ kind: s.kind, text, tags: s.kind === 'quote' ? [...(s.tags || [])] : [] });
  }
  return pieces;
}

// The prototype's rules inside a quote: "?!" is excited, a lone "!" too, and
// a run of capitals ending in ! or ?! is raised on its own.
function quoteUnits(piece) {
  const t = piece.text;
  const tags = [...piece.tags];
  if (/[!?]!|!\?|\?!/.test(t) && !tags.includes('shout')) tags.push('excited');
  else if (/!$/.test(t) && !tags.length) tags.push('excited');
  const caps = t.match(CAPS_RUN);
  if (caps && caps[1].trim()) {
    return [
      { kind: 'quote', text: caps[1].trim(), tags: tags.filter((x) => x !== 'excited') },
      { kind: 'quote', text: caps[2].trim().toLowerCase(), tags: [...new Set([...tags, 'shout'])] },
    ];
  }
  if (ALL_CAPS.test(t)) return [{ kind: 'quote', text: lowerCaps(t), tags: [...new Set([...tags, 'shout'])] }];
  return [{ kind: 'quote', text: caps ? lowerCaps(t) : t, tags }];
}

// Language of a unit; anything with digits stays English (the German and
// Spanish rules cannot read numbers).
const languageOf = (text) => (/\d/.test(text) ? 'en' : detectLanguage(text));

// Neighbouring units that need the same performance become one.
function mergeUnits(units) {
  const merged = [];
  for (const u of units) {
    const last = merged.at(-1);
    const same = (x) => `${x.lang}|${[...new Set(x.tags)].sort().join(',')}`;
    if (last && same(last) === same(u)) {
      last.text = `${last.text} ${u.text}`;
      last.kind = last.kind === u.kind ? u.kind : 'mixed';
      continue;
    }
    merged.push({ ...u });
  }
  return merged;
}

// A delivery from units: one plain English unit keeps the sentence's own text (quote marks included, as before).
function deliveryOf(sentenceText, units, quoted, spoken) {
  const part = (text, lang, style) => {
    const said = spoken(text);
    return { text: said, lang, style, names: lang === 'en' && hasForeignWords(said) };
  };
  if (units.length === 1) {
    const [u] = units;
    const style = perfFor(u.tags);
    const key = styleKey(style, u.lang);
    // A styled sentence is said without its quote marks, as in the prototype.
    return { parts: [part(key ? u.text : sentenceText, u.lang, style)], key, spliced: false, quoted };
  }
  const parts = units.map((u) => part(u.text, u.lang, perfFor(u.tags)));
  return { parts, key: 'spliced', spliced: true, quoted };
}

/** Plain delivery: the sentence as written (in spoken form), plain English. */
export function plainDelivery(sentence, { british = false } = {}) {
  return { parts: [{ text: spokenForms(sentence.text, { british }), lang: 'en', style: PLAIN, names: false }], key: '', spliced: false, quoted: false };
}

/**
 * Deliveries for the app's sentences ({ text, para }), one per sentence.
 * `british`: the voice has a British accent (only for spoken forms of dates).
 */
export function direct(sentences, { british = false } = {}) {
  const spoken = (t) => spokenForms(t, { british });
  const out = [];
  for (let i = 0; i < sentences.length; ) {
    // one paragraph at a time: its sentences joined by single spaces
    let j = i;
    while (j < sentences.length && sentences[j].para === sentences[i].para) j++;
    const group = sentences.slice(i, j);
    const par = group.map((s) => s.text).join(' ');
    const spans = quoteSpans(par);
    attachCues(spans);
    let from = 0;
    for (const s of group) {
      const to = from + s.text.length;
      const pieces = piecesOf(spans, par, from, to);
      from = to + 1;
      const units = pieces.flatMap((p) => (p.kind === 'quote' ? quoteUnits(p) : [p]));
      for (const u of units) {
        if (u.tags.length && u.tags.every((t) => MILD.has(t))) u.tags = [];
        u.lang = languageOf(u.text);
      }
      const merged = mergeUnits(units);
      const quoted = pieces.length > 0 && pieces.every((p) => p.kind === 'quote');
      out.push(merged.length ? deliveryOf(s.text, merged, quoted, spoken) : plainDelivery(s, { british }));
    }
    i = j;
  }
  return out;
}
