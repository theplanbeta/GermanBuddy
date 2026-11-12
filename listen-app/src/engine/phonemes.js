// Text -> phonemes (the sound symbols the Kokoro model reads).
//
// kokoro-js does this internally but does not export it, and the app needs
// the phonemes itself: to count them (which decides how sentences are grouped
// and which "voice row" is used) and to put several sentences into one model
// call. This is a readable copy of kokoro-js 1.2.1's own normaliser and
// phonemiser (same rules, same order), using the same `phonemizer` package
// (eSpeak NG compiled to WebAssembly; its data is built into the package, so
// nothing is downloaded).
import { phonemize } from 'phonemizer';

// "1990" -> "19 90", "7:43" -> "7 43", "3:00" -> "3 o'clock"
function splitNum(s) {
  if (s.includes('.')) return s;
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number);
    return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const year = parseInt(s.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return s;
  const left = s.slice(0, 2);
  const right = parseInt(s.slice(2, 4), 10);
  const plural = s.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${plural}`;
    if (right < 10) return `${left} oh ${right}${plural}`;
  }
  return `${left} ${right}${plural}`;
}

// "$4.50" -> "4 dollars and 50 cents"
function money(s) {
  const unit = s[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(s.slice(1)))) return `${s.slice(1)} ${unit}s`;
  if (!s.includes('.')) return `${s.slice(1)} ${unit}${s.slice(1) === '1' ? '' : 's'}`;
  const [whole, frac] = s.slice(1).split('.');
  const cents = parseInt(frac.padEnd(2, '0'), 10);
  const small = s[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${small}`;
}

// "3.14" -> "3 point 1 4"
function pointNum(s) {
  const [a, b] = s.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

/** kokoro-js's text clean-up (titles, numbers, money, quotes), unchanged. */
export function normalize(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"')
    .replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ')
    .replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ').replace(/  +/, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

// Punctuation is passed through to the model as it is; only the words between
// punctuation are turned into phonemes.
const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RUN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

/**
 * kokoro-js's phonemiser. `lang` is the first letter of the voice name:
 * 'a' = American English, 'b' = British English.
 */
export async function textToPhonemes(text, lang = 'a') {
  text = normalize(text);
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(PUNCTUATION_RUN)) {
    if (last < m.index) parts.push({ punctuation: false, text: text.slice(last, m.index) });
    if (m[0].length) parts.push({ punctuation: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ punctuation: false, text: text.slice(last) });
  const language = lang === 'a' ? 'en-us' : 'en';
  const spoken = await Promise.all(parts.map(async (p) => (p.punctuation ? p.text : (await phonemize(p.text, language)).join(' '))));
  let s = spoken
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang === 'a') s = s.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return s.trim();
}

/**
 * Removes symbols the model's tokenizer would silently drop (for example the
 * syllable mark "̩"), so that every remaining character is exactly one token.
 * Only then do the model's per-token timings line up with the text.
 */
export function keepKnown(phonemes, vocabulary) {
  return [...phonemes].filter((ch) => vocabulary.has(ch)).join('');
}

/** The first two words of a sentence, without trailing punctuation (the "look-ahead"). */
export function firstWords(text, count = 2) {
  return text.split(/\s+/).slice(0, count).join(' ').replace(/[,.;:!?]$/, '');
}
