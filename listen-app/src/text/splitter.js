// Splits plain text into short pieces ("sentences") that the voice model can
// read one at a time. Each piece is { text, para }, where `para` is the number
// of the paragraph it belongs to (used for slightly longer pauses and for
// laying the text out on screen).
//
// Guiding rule: when unsure, do NOT split. Joining two sentences only makes one
// piece a little longer; splitting in the wrong place ("Mr. | Smith") makes the
// voice pause and change intonation mid-sentence, which sounds much worse.

// Kokoro reads at most ~510 phoneme tokens per piece and silently cuts off the
// rest. Ordinary English is ~1 phoneme per character, but numbers expand a lot
// ("$1,250,000" -> "one million two hundred fifty thousand dollars"), so keep
// pieces well under that.
export const MAX_LENGTH = 200;

// Words that are followed by a period but almost never end a sentence.
const NO_SPLIT_AFTER = new Set([
  // titles
  'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ft', 'gen', 'col',
  'capt', 'lt', 'sgt', 'rev', 'hon', 'pres', 'gov', 'sen', 'rep', 'fr', 'messrs', 'esq',
  // latin and reference abbreviations
  'e.g', 'i.e', 'eg', 'ie', 'vs', 'v', 'cf', 'viz', 'approx', 'ca', 'al', 'incl', 'resp',
  'dept', 'est', 'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'p', 'ch', 'sec', 'art',
  'ed', 'eds', 'ref', 'tel', 'ext', 'apt',
  // months
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

// "U.S", "a.m", "Ph.D" - letters joined by periods.
const DOTTED_ACRONYM = /^(?:\p{L}{1,2}\.)+\p{L}{1,2}$/u;
const SINGLE_CAPITAL = /^\p{Lu}$/u; // initials such as the "J" in "J. Smith"

// End punctuation, optional closing quotes/brackets, then whitespace.
const SENTENCE_END = /([.!?…]+)(["'”’»)\]]*)\s+/gu;
// What the next sentence may start with.
const SENTENCE_START = /^[\p{Lu}\p{N}"'“‘«(\[]/u;
const HAS_WORDS = /[\p{L}\p{N}]/u;
const BULLET = /^\s*(?:[-*•‣◦·]|\d{1,3}[.)])\s+/u;

/**
 * @param {string} text
 * @param {{ maxLength?: number }} [options]
 * @returns {{ text: string, para: number }[]}
 */
export function splitText(text, { maxLength = MAX_LENGTH } = {}) {
  const out = [];
  let para = 0;
  for (const block of toParagraphs(text)) {
    let added = false;
    for (const sentence of splitSentences(block)) {
      for (const piece of splitLong(sentence, maxLength)) {
        if (!HAS_WORDS.test(piece)) continue; // skip "***", "—" and similar
        out.push({ text: piece, para });
        added = true;
      }
    }
    if (added) para++;
  }
  return out;
}

/** Turns raw text into a list of paragraph strings with single spaces. */
export function toParagraphs(text) {
  const paragraphs = [];
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let current = '';
    for (const line of lines) {
      if (!current) {
        current = stripBullet(line);
      } else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) {
        current = current.slice(0, -1) + line; // re-join a word hyphenated across lines
      } else if (looksLikeSeparateLine(current, line)) {
        paragraphs.push(current); // heading or list item: keep it on its own
        current = stripBullet(line);
      } else {
        current += ' ' + line; // a line that was simply wrapped
      }
    }
    if (current) paragraphs.push(current);
  }
  return paragraphs.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// A single line break means "new item" when the next line is a list item, or
// when the text so far is short, has no closing punctuation and the next line
// starts with a capital (a heading). Otherwise it is wrapped prose.
function looksLikeSeparateLine(previous, next) {
  if (BULLET.test(next)) return true;
  const endsOpen = !/[.!?…:;,"'”’)\]]$/u.test(previous);
  return endsOpen && previous.length < 60 && /^[\p{Lu}\p{N}]/u.test(next);
}

function stripBullet(line) {
  return line.replace(BULLET, '');
}

/** Splits one paragraph into sentences. */
export function splitSentences(paragraph) {
  const sentences = [];
  let start = 0;
  for (const m of paragraph.matchAll(SENTENCE_END)) {
    const end = m.index + m[1].length + m[2].length;
    const next = paragraph.slice(m.index + m[0].length);
    if (!SENTENCE_START.test(next)) continue;
    if (m[1] === '.' && isAbbreviation(paragraph.slice(start, m.index))) continue;
    sentences.push(paragraph.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

function isAbbreviation(textBeforePeriod) {
  const word = textBeforePeriod.split(/\s/).pop().replace(/^["'“‘«(\[]+/u, '');
  return (
    NO_SPLIT_AFTER.has(word.toLowerCase()) ||
    DOTTED_ACRONYM.test(word) ||
    SINGLE_CAPITAL.test(word)
  );
}

/** Breaks an over-long sentence at the most natural point before maxLength. */
export function splitLong(sentence, maxLength = MAX_LENGTH) {
  const pieces = [];
  let rest = sentence.trim();
  while (rest.length > maxLength) {
    const cut = findBreak(rest, maxLength);
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// Preference: after ; : or a dash, then after a comma, then at any space.
// Only consider breaks in the second half of the window so pieces don't get
// too short.
function findBreak(text, maxLength) {
  const window = text.slice(0, maxLength + 1);
  const min = Math.floor(maxLength * 0.4);
  const patterns = [/[;:]\s/g, /\s[—–-]\s/g, /,\s/g, /\s/g];
  for (const pattern of patterns) {
    let best = -1;
    for (const m of window.matchAll(pattern)) {
      const after = m.index + m[0].length - 1; // break just before the space
      if (after >= min && after <= maxLength) best = m.index + m[0].trimEnd().length;
    }
    if (best > 0) return best;
  }
  return maxLength; // one enormous "word": hard cut
}

// The first piece is the one the listener waits for, and preparing it takes
// time in proportion to its length. So a long opening sentence is split at an
// early comma (or ; : —) to let the voice start sooner. The first part gets
// `joined: true`, meaning "the sentence continues": only a short pause follows.
const OPENING_MIN = 20; // characters: shorter first parts sound clipped
const OPENING_LONG = 60; // only split sentences longer than this

/** Splits the very first piece at an early clause boundary, if it is long. */
export function splitOpening(pieces) {
  const first = pieces[0];
  if (!first || first.text.length <= OPENING_LONG) return pieces;
  for (const m of first.text.matchAll(/[,;:](?=\s)|\s[—–](?=\s)/gu)) {
    const cut = m.index + m[0].length;
    const head = first.text.slice(0, cut).trim();
    const tail = first.text.slice(cut).trim();
    if (head.length < OPENING_MIN || head.split(' ').length < 3) continue;
    if (tail.length < OPENING_MIN) break;
    return [{ ...first, text: head, joined: true }, { ...first, text: tail }, ...pieces.slice(1)];
  }
  return pieces;
}
