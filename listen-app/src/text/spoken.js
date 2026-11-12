// Spoken forms: rewrites the bits of written text that the voice would read
// wrongly (money, times, dates, some abbreviations and units) into the words
// a person would say. Only what is sent to the voice changes; the text on the
// screen stays exactly as written.
//
// kokoro-js already reads many things well (checked one by one): "$4.50",
// "£12", "37.8%", "1,250", "7:43", "12th", "1990s", "62-year-old", "Dr." before
// a name. Those are left to it. What it gets wrong, and is fixed here:
//   "€2.5 million"   -> "euros two point five million"   (now "2.5 million euros")
//   "a $5 bill"      -> "a 5 dollars bill"               (now "a 5 dollar bill")
//   "19:30", "07:15" -> "nineteen : thirty"              (now "19 30", "7 15")
//   "2:30pm", "Nov. 12", "1 March", "2026-11-12", "St. Paul", "No. 5", "5 km", "1/2", "1914–1918"
// Pure string code, no model: runs in the page and in tests.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAY_ABBR = { mon: 'Monday', tue: 'Tuesday', tues: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const MONTH = `(?:${MONTHS.join('|')})`;

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd" (the voice reads these as ordinals). */
export function ordinal(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

// ---- money ------------------------------------------------------------------

// unit, plural, small unit, its plural (null: no small unit is spoken)
const CURRENCY = {
  '€': ['euro', 'euros', 'cent', 'cents'],
  $: ['dollar', 'dollars', 'cent', 'cents'],
  '£': ['pound', 'pounds', 'penny', 'pence'],
  '¥': ['yen', 'yen', null, null],
  '₹': ['rupee', 'rupees', null, null],
};
const CODES = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', INR: '₹' };
const SCALES = { hundred: 'hundred', thousand: 'thousand', million: 'million', billion: 'billion', trillion: 'trillion', k: 'thousand', m: 'million', mn: 'million', bn: 'billion', b: 'billion', tn: 'trillion' };
// Words after an amount that are not the thing it measures ("€5 in cash", "$5 more").
const NOT_NOUNS = new Set(['of', 'in', 'and', 'or', 'was', 'is', 'were', 'are', 'to', 'for', 'from', 'on', 'at', 'by', 'with', 'a', 'an', 'the', 'per', 'each', 'that', 'which', 'but', 'more', 'less', 'extra', 'off', 'back', 'up', 'down', 'too', 'so', 'than', 'as', 'if', 'into', 'over', 'under', 'now', 'then', 'only', 'just', 'total', 'altogether', 'apiece', 'worth', 'a', 'will', 'would', 'can', 'could', 'has', 'had', 'have', 'be', 'been', 'not']);
// "a €5 note", "the €2.45 million budget": the amount describes a noun, so the unit stays singular.
const DETERMINER = /\b(?:a|an|the|this|that|its|his|her|their|our|my|your|one|whole|entire)\s+$/i;

// "1,250,000.50" or "2.45" (a comma only between groups of three, so "$5, then" is not an amount)
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const SCALE_WORD = String.raw`(?:\s(hundred|thousand|million|billion|trillion)\b|(k|mn|bn|tn|m|b)\b)`;

function moneyWords(symbol, amount, scale, before, after) {
  const [one, many, small, smalls] = CURRENCY[symbol];
  const next = (after.match(/^\s+([\p{L}]+)/u) || [])[1] || '';
  const describes = DETERMINER.test(before) && /^\p{Ll}/u.test(next) && !NOT_NOUNS.has(next.toLowerCase());
  if (scale) return `${amount} ${SCALES[scale.toLowerCase()]} ${describes ? one : many}`;
  const [whole, fraction] = amount.split('.');
  const unit = (n) => (describes || n === '1' ? one : many);
  if (fraction === undefined || !small || fraction.length !== 2) return `${amount} ${fraction === undefined ? unit(whole) : many}`;
  const cents = parseInt(fraction, 10);
  const smallUnit = cents === 1 ? small : smalls;
  if (whole === '0') return `${cents} ${smallUnit}`;
  if (cents === 0) return `${whole} ${unit(whole)}`;
  return `${whole} ${unit(whole)} and ${cents} ${smallUnit}`;
}

function money(text) {
  const symbolFirst = new RegExp(String.raw`(?<![\p{L}\d])([€$£¥₹])\s?${AMOUNT}${SCALE_WORD}?`, 'gu');
  const codeFirst = new RegExp(String.raw`\b(EUR|USD|GBP|JPY|INR)\s?${AMOUNT}${SCALE_WORD}?`, 'g');
  const amountFirst = new RegExp(String.raw`(?<![\d.,])${AMOUNT}${SCALE_WORD}?\s?(?:([€£¥₹])|(EUR|USD|GBP|JPY|INR)\b)`, 'gu');
  const replace = (pattern, pick) =>
    (text = text.replace(pattern, (...m) => {
      const all = m.at(-1);
      const offset = m.at(-2);
      const { symbol, amount, scale } = pick(m);
      return moneyWords(symbol, amount, scale, all.slice(0, offset), all.slice(offset + m[0].length));
    }));
  replace(symbolFirst, (m) => ({ symbol: m[1], amount: m[2], scale: m[3] || m[4] }));
  replace(codeFirst, (m) => ({ symbol: CODES[m[1]], amount: m[2], scale: m[3] || m[4] }));
  replace(amountFirst, (m) => ({ symbol: m[4] || CODES[m[5]], amount: m[1], scale: m[2] || m[3] }));
  return text;
}

// ---- times ------------------------------------------------------------------

const AM_PM = String.raw`(am|pm|a\.m\.|p\.m\.)`;

function times(text) {
  return text
    // "2:30pm" -> "2:30 pm"; "7am" -> "7 am"
    .replace(new RegExp(String.raw`(\d)${AM_PM}(?![\p{L}])`, 'giu'), '$1 $2')
    // "7.43 am" (British) -> "7:43 am"
    .replace(new RegExp(String.raw`\b(\d{1,2})\.([0-5]\d)(?=\s?${AM_PM})`, 'gi'), '$1:$2')
    // 24-hour times and leading zeros, which kokoro-js does not know: "19:30" -> "19 30", "07:05" -> "7 oh 5"
    .replace(/(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (m, h, mm) => {
      const hour = parseInt(h, 10);
      const minute = parseInt(mm, 10);
      if (hour >= 1 && hour <= 12 && h[0] !== '0') return m; // kokoro-js reads these well
      const hh = hour === 0 ? 'zero' : String(hour);
      if (minute === 0) return `${hh} hundred`;
      return minute < 10 ? `${hh} oh ${minute}` : `${hh} ${minute}`;
    });
}

// ---- dates ------------------------------------------------------------------

function dates(text, { british = false } = {}) {
  return text
    // "2026-11-12" -> "November 12th, 2026"
    .replace(/\b(\d{4})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g, (_, y, m, d) => `${MONTHS[m - 1]} ${ordinal(+d)}, ${y}`)
    // "12/11/2026": day first unless that cannot be; ambiguous dates follow the voice's accent
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, a, b, y) => {
      a = +a;
      b = +b;
      const dayFirst = a > 12 ? true : b > 12 ? false : british;
      const [day, month] = dayFirst ? [a, b] : [b, a];
      if (month < 1 || month > 12 || day < 1 || day > 31) return m;
      return dayFirst ? `the ${ordinal(day)} of ${MONTHS[month - 1]} ${y}` : `${MONTHS[month - 1]} ${ordinal(day)}, ${y}`;
    })
    // "Wed., Nov. 12" -> "Wednesday, November 12"
    .replace(/\b(Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun)\.(?=,|\s+(?:\d|[A-Z][a-z]+\.?\s+\d))/g, (_, w) => WEEKDAY_ABBR[w.toLowerCase()])
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.(?=\s+\d)/g, (_, m) => MONTHS[MONTH_ABBR[m.toLowerCase()]])
    // "1 March" -> "the 1st of March" ("the" is not doubled)
    .replace(new RegExp(String.raw`(\bthe\s+)?\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+(${MONTH})\b`, 'g'), (_, the, d, month) => `${the ? the : 'the '}${ordinal(+d)} of ${month}`)
    // "March 3" -> "March 3rd" (not "March 2024", not "March 3rd", not "May 5:30")
    .replace(new RegExp(String.raw`\b(${MONTH})\s+([1-9]|[12]\d|3[01])(?![\d:.,]\d|\d|st|nd|rd|th)`, 'g'), (_, month, d) => `${month} ${ordinal(+d)}`);
}

// ---- abbreviations, units, fractions -----------------------------------------

// Replaces an abbreviation; keeps its full stop when it ended the text (the end of the sentence).
const word = (full) => (m, ...rest) => {
  const all = rest.at(-1);
  const offset = rest.at(-2);
  return offset + m.length >= all.trimEnd().length && m.endsWith('.') ? `${full}.` : full;
};

function abbreviations(text) {
  return text
    .replace(/\b[Nn]o\.(?=\s?\d)/g, 'number')
    .replace(/#(?=\d)/g, 'number ')
    .replace(/\bSt\.(?=\s+\p{Lu})/gu, 'Saint')
    .replace(/\bProf\.(?=\s+\p{Lu})/gu, 'Professor')
    .replace(/\bMt\.(?=\s+\p{Lu})/gu, 'Mount')
    .replace(/\bFig\.(?=\s?\d)/g, 'Figure')
    .replace(/\bpp\.(?=\s?\d)/g, 'pages')
    .replace(/\bp\.(?=\s?\d)/g, 'page')
    .replace(/\bvs\.?(?=\s)/g, 'versus')
    .replace(/\bapprox\.(?=\s)/g, 'approximately')
    .replace(/\b(?:ca|c)\.(?=\s?\d)/g, 'circa')
    .replace(/(?<=\p{Lu}\p{L}+,?\s)Jr\.(?=\s|$)/gu, word('Junior'))
    .replace(/(?<=\p{Lu}\p{L}+,?\s)Sr\.(?=\s|$)/gu, word('Senior'));
}

const UNITS = [
  [/km\/h|kph/, 'kilometer per hour', 'kilometers per hour'],
  [/mph/, 'mile per hour', 'miles per hour'],
  [/km/, 'kilometer', 'kilometers'],
  [/cm/, 'centimeter', 'centimeters'],
  [/mm/, 'millimeter', 'millimeters'],
  [/kg/, 'kilogram', 'kilograms'],
  [/mg/, 'milligram', 'milligrams'],
  [/ml/, 'milliliter', 'milliliters'],
  [/kWh/, 'kilowatt hour', 'kilowatt hours'],
  [/GB/, 'gigabyte', 'gigabytes'],
  [/MB/, 'megabyte', 'megabytes'],
  [/TB/, 'terabyte', 'terabytes'],
  [/°C/, 'degree Celsius', 'degrees Celsius'],
  [/°F/, 'degree Fahrenheit', 'degrees Fahrenheit'],
];

function units(text) {
  for (const [unit, one, many] of UNITS) {
    const pattern = new RegExp(String.raw`(?<![\d.,])${AMOUNT}\s?(?:${unit.source})(?![\p{L}\d])`, 'gu');
    text = text.replace(pattern, (_, n) => `${n} ${n === '1' ? one : many}`);
  }
  return text;
}

const FRACTION = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'], 6: ['sixth', 'sixths'], 8: ['eighth', 'eighths'], 10: ['tenth', 'tenths'] };
const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4' };

function fractions(text) {
  return text
    .replace(/[½⅓⅔¼¾]/g, (c, offset, all) => (/\d/.test(all[offset - 1] ?? '') ? ' ' : '') + VULGAR[c])
    .replace(/\b24\/7\b/g, '24 7')
    .replace(/\b50\/50\b/g, '50 50')
    .replace(/(?<![\d/.])(\d+)\s(?=\d\/\d+(?![\d/]))/g, '$1 and ')
    .replace(/(?<![\d/.])([1-9])\/(\d{1,2})(?![\d/])/g, (m, a, b) => {
      const names = FRACTION[b];
      if (!names || +a >= +b) return m;
      return a === '1' ? `a ${names[0]}` : `${a} ${names[1]}`;
    });
}

/**
 * Text as it should be spoken. `british`: the voice has a British accent
 * (only decides how an ambiguous date such as 03/04/2025 is read).
 */
export function spokenForms(text, { british = false } = {}) {
  let s = dates(text, { british });
  s = money(s);
  s = times(s);
  s = s
    .replace(/(\d)\s?–\s?(?=\d)/g, '$1 to ') // "1914–1918" (kokoro-js only knows the plain hyphen)
    .replace(/(\d(?:st|nd|rd|th))-(?=\p{L})/gu, '$1 '); // "20th-century" -> "20th century"
  s = abbreviations(s);
  s = units(s);
  s = fractions(s);
  s = s.replace(/(?<=\d)x(?=[\s,.;:!?]|$)/g, ' times'); // "3x faster"
  return s;
}
