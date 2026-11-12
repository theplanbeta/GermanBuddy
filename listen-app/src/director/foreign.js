// German and Spanish words and phrases, read with German or Spanish sounds
// instead of English spelling rules ("Müller" as "Mueller" otherwise).
//
// Copied unchanged from the research prototype (research/expressive-kokoro/
// foreign.mjs, whose output the owner approved by ear), plus `foreignWords`
// at the end, which finds such words inside English text.
//
// Small rule-based German and Spanish grapheme-to-phoneme converters that emit only
// symbols present in Kokoro's 115-token vocabulary (no espeak data needed, so it runs
// in a browser). Not a full G2P: good enough for short quoted phrases and names.
// Symbols missing from Kokoro's vocab are mapped: ʏ -> y, ɔʏ -> ɔɪ, x -> χ, ts -> ʦ, pf -> pf.

const DE_UNSTRESSED = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "und", "oder", "aber", "doch", "ist", "sind", "war", "sein", "zu", "im", "in", "an", "am", "auf", "mit", "von", "vom", "zum", "zur", "es", "er", "sie", "wir", "ich", "du", "ihr", "man", "so", "ja", "noch", "schon", "mal", "kann", "bin", "hat"]);
const DE_LEX = {
  // whole-word exceptions (IPA in Kokoro symbols)
  "nicht": "nˈɪçt", "ich": "ɪç", "mich": "mɪç", "dich": "dɪç", "sich": "zɪç", "doch": "dɔχ", "noch": "nɔχ", "das": "das", "was": "vas", "es": "ɛs",
  "kann": "kan", "wahr": "vˈaːɐ", "sein": "zaɪn", "achtung": "ˈaχtʊŋ", "müller": "mˈylɐ", "zürich": "ʦˈyːʁɪç", "eichhörnchen": "ˈaɪçhœʁnçən",
  "der": "dɛɐ", "er": "ɛɐ", "wir": "viːɐ", "mir": "miːɐ", "ihr": "iːɐ", "für": "fyːɐ", "nur": "nuːɐ", "und": "ʊnt", "ist": "ɪst", "bin": "bɪn", "hat": "hat",
  "danke": "dˈaŋkə", "bitte": "bˈɪtə", "ja": "jaː", "nein": "naɪn", "gut": "ɡuːt", "mein": "maɪn", "dein": "daɪn", "gott": "ɡˈɔt", "herr": "hˈɛʁ", "frau": "fʁˈaʊ",
  "mit": "mɪt", "in": "ɪn", "im": "ɪm", "an": "an", "am": "am", "um": "ʊm", "ab": "ap", "ob": "ɔp", "bis": "bɪs", "man": "man", "von": "fɔn", "zum": "ʦʊm", "weg": "vɛk", "dass": "das", "sie": "ziː", "wie": "viː",
};
const V = "aeiouäöüy";
const isV = (c) => c && V.includes(c);

/** German word -> phonemes (lower-case input). */
export function germanWord(w) {
  const lw = w.toLowerCase();
  if (DE_LEX[lw]) return DE_LEX[lw];
  let s = lw.replace(/ß/g, "s").replace(/ph/g, "f").replace(/th/g, "t");
  let out = "";
  let firstVowelPos = -1;
  const PREFIX = /^(be|ge|ver|zer|er|ent|emp)(?=[^aeiouäöü]*[aeiouäöü])/;
  const pre = s.match(PREFIX);
  if (pre && s.length > pre[0].length + 2) {
    const head = germanWord(pre[0] === "er" ? "ɛɐ" : pre[0]).replace(/ˈ/g, "");
    return (pre[0] === "er" ? "ɛɐ" : head) + germanWord(s.slice(pre[0].length));
  }
  for (let i = 0; i < s.length; ) {
    const r = s.slice(i);
    const prev = s[i - 1];
    const take = (n, p) => { out += p; i += n; };
    const start = i === 0;
    // vowels / diphthongs
    if (/^(ei|ai|ey|ay)/.test(r)) { if (firstVowelPos < 0) firstVowelPos = out.length; take(2, "aɪ"); continue; }
    if (/^(eu|äu)/.test(r)) { if (firstVowelPos < 0) firstVowelPos = out.length; take(2, "ɔɪ"); continue; }
    if (/^au/.test(r)) { if (firstVowelPos < 0) firstVowelPos = out.length; take(2, "aʊ"); continue; }
    if (/^ie/.test(r)) { if (firstVowelPos < 0) firstVowelPos = out.length; take(2, "iː"); continue; }
    if (isV(r[0])) {
      if (firstVowelPos < 0) firstVowelPos = out.length;
      const c = r[0];
      const doubled = r[1] === c;
      const lengthH = r[1] === "h" && !isV(r[2]) ? true : r[1] === "h" && isV(r[2]) ? true : false;
      // consonants after the vowel decide length: 2+ consonants (or ck/tz/sch/ch/ng) -> short
      const after = r.slice(doubled ? 2 : lengthH ? 2 : 1);
      const cons = after.match(/^[^aeiouäöüy]*/)[0];
      const finalE = c === "e" && after === "" && s.length > 2; // final -e
      const unstressedE = c === "e" && i > 0 && firstVowelPos !== out.length; // later -e- (schwa-ish)
      let long = doubled || lengthH || (cons.length <= 1 && !/^(ck|tz|ch|sch|ng|ss)/.test(after) && after !== "" ) || (after === "" && c !== "e");
      if (/^(ch|sch|ck|ng|nk|tz|ss|ff|ll|mm|nn|pp|rr|tt|st)/.test(after)) long = false;
      if (doubled || lengthH) long = true;
      let p;
      if (c === "a") p = long ? "aː" : "a";
      else if (c === "e") p = finalE ? "ə" : (unstressedE && !doubled && !lengthH && /^(n|l|m|r|s|t|ns|nd|nt|st)?$/.test(after)) ? "ə" : long ? "eː" : "ɛ";
      else if (c === "i") p = long ? "iː" : "ɪ";
      else if (c === "o") p = long ? "oː" : "ɔ";
      else if (c === "u") p = long ? "uː" : "ʊ";
      else if (c === "ä") p = long ? "ɛː" : "ɛ";
      else if (c === "ö") p = long ? "øː" : "œ";
      else if (c === "ü" || c === "y") p = long ? "yː" : "y";
      // -er at word end -> ɐ
      if (c === "e" && after === "r" ) { take(2, "ɐ"); continue; }
      take(doubled ? 2 : lengthH ? 2 : 1, p);
      continue;
    }
    // consonants
    if (/^tsch/.test(r)) { take(4, "ʧ"); continue; }
    if (/^sch/.test(r)) { take(3, "ʃ"); continue; }
    if (/^chs/.test(r)) { take(3, "ks"); continue; }
    if (/^ch/.test(r)) { take(2, /[aouʊɔ]$/.test(out.replace(/ː$/, "")) || /aʊ$/.test(out) ? "χ" : "ç"); continue; }
    if (/^ig$/.test(r)) { take(2, "ɪç"); continue; }
    if (/^ck/.test(r)) { take(2, "k"); continue; }
    if (/^ng/.test(r)) { take(2, "ŋ"); continue; }
    if (/^nk/.test(r)) { take(2, "ŋk"); continue; }
    if (/^(tz|ts|z)/.test(r)) { take(r[0] === "z" ? 1 : 2, "ʦ"); continue; }
    if (/^pf/.test(r)) { take(2, "pf"); continue; }
    if (/^qu/.test(r)) { take(2, "kv"); continue; }
    if (start && /^s[pt]/.test(r)) { take(2, "ʃ" + r[1]); continue; }
    if (/^ss/.test(r)) { take(2, "s"); continue; }
    if (r[0] === "s") { take(1, isV(r[1]) && (start || isV(prev) || /[lnmr]/.test(prev)) ? "z" : "s"); continue; }
    if (r[0] === "w") { take(1, "v"); continue; }
    if (r[0] === "v") { take(1, "f"); continue; }
    if (r[0] === "j") { take(1, "j"); continue; }
    if (r[0] === "h") { take(1, isV(r[1]) && (start || !isV(prev)) ? "h" : ""); continue; }
    if (r[0] === "r") { take(r[1] === "r" ? 2 : 1, isV(r[1]) || start || r[1] === "r" ? "ʁ" : "ɐ"); continue; }
    if (r[0] === "c") { take(1, "k"); continue; }
    if (r[0] === "g" && r.length === 1) { take(1, "k"); continue; }
    if (r[0] === "b" && r.length === 1) { take(1, "p"); continue; }
    if (r[0] === "d" && r.length === 1) { take(1, "t"); continue; }
    if (r[0] === "g") { take(1, "ɡ"); continue; }
    if (r[0] === "x") { take(1, "ks"); continue; }
    if (r[1] === r[0]) { take(2, r[0]); continue; } // double consonant
    take(1, r[0]);
  }
  if (DE_UNSTRESSED.has(lw) || firstVowelPos < 0) return out;
  // primary stress on the first syllable after an unstressed prefix
  let pos = firstVowelPos;
  if (pre) { const m = out.slice(pre[0].length).search(/[aeiouɛɪɔʊœøyə]/); if (m >= 0) pos = pre[0].length + m; }
  // espeak / Kokoro convention: the stress mark goes right before the stressed vowel
  return out.slice(0, pos) + "ˈ" + out.slice(pos);
}

const ES_UNSTRESSED = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "y", "o", "que", "en", "a", "por", "con", "se", "me", "te", "lo", "le", "mi", "tu", "su"]);
/** Spanish word -> phonemes (Castilian-neutral, seseo). */
export function spanishWord(w) {
  const lw = w.toLowerCase();
  const s = lw;
  let out = "";
  const nucleus = [];
  for (let i = 0; i < s.length; ) {
    const r = s.slice(i), prev = s[i - 1];
    const take = (n, p) => { out += p; i += n; };
    const vowelBefore = i > 0 && /[aeiouáéíóú]/.test(prev);
    if (/^(ui|uy)/.test(r) && i > 0 && !/[qg]/.test(prev)) { nucleus.push({ at: out.length, acc: false }); take(2, "wi"); continue; }
    if (/^u[aeoáéó]/.test(r) && !/[qg]/.test(prev)) { take(1, "w"); continue; }
    if (/^i[aeouáéóú]/.test(r) && i > 0) { take(1, "j"); continue; }
    if (/[aeiouáéíóú]/.test(r[0])) {
      const acc = /[áéíóú]/.test(r[0]);
      nucleus.push({ at: out.length, acc });
      take(1, { á: "a", é: "e", í: "i", ó: "o", ú: "u" }[r[0]] || r[0]);
      continue;
    }
    if (/^ch/.test(r)) { take(2, "ʧ"); continue; }
    if (/^ll/.test(r)) { take(2, "ʝ"); continue; }
    if (/^rr/.test(r)) { take(2, "r"); continue; }
    if (/^qu/.test(r)) { take(2, "k"); continue; }
    if (/^gu[ei]/.test(r)) { take(2, vowelBefore ? "ɣ" : "ɡ"); continue; }
    if (/^c[ei]/.test(r)) { take(1, "s"); continue; }
    if (/^g[ei]/.test(r) || r[0] === "j") { take(1, "χ"); continue; }
    if (r[0] === "ñ") { take(1, "ɲ"); continue; }
    if (r[0] === "h") { take(1, ""); continue; }
    if (r[0] === "v" || r[0] === "b") { take(1, vowelBefore ? "β" : "b"); continue; }
    if (r[0] === "d") { take(1, vowelBefore ? "ð" : "d"); continue; }
    if (r[0] === "g") { take(1, vowelBefore ? "ɣ" : "ɡ"); continue; }
    if (r[0] === "r") { take(1, i === 0 ? "r" : "ɾ"); continue; }
    if (r[0] === "z") { take(1, "s"); continue; }
    if (r[0] === "c") { take(1, "k"); continue; }
    if (r[0] === "y") { take(1, i === s.length - 1 ? "i" : "ʝ"); continue; }
    take(1, r[0]);
  }
  if (ES_UNSTRESSED.has(lw) || !nucleus.length) return out;
  let n = nucleus.findIndex((x) => x.acc);
  if (n < 0) n = /[aeiouns]$/.test(lw) ? Math.max(0, nucleus.length - 2) : nucleus.length - 1;
  const k = nucleus[n].at;
  return out.slice(0, k) + "ˈ" + out.slice(k);
}

/** Phonemise a whole foreign phrase, keeping Kokoro punctuation tokens. */
export function foreignPhrase(text, lang) {
  const fn = lang === "de" ? germanWord : spanishWord;
  return text
    .replace(/[“”"«»]/g, "")
    .split(/(\s+|[;:,.!?¡¿—…]+)/)
    .map((t) => (/^[\p{L}'-]+$/u.test(t) ? fn(t) : t.replace(/\s+/g, " ")))
    .join("")
    .replace(/¡|¿/g, "")
    .trim();
}

// --- language detection for a segment (rule-based) ---
const DE_HINTS = new Set(["das", "der", "die", "und", "nicht", "doch", "kann", "ist", "sein", "wahr", "ich", "ein", "eine", "mit", "auf", "achtung", "nein", "ja", "bitte", "danke", "wir", "sie", "es", "war", "schon", "noch", "mal", "gut", "aber", "habe", "haben", "keine", "kein", "zeit", "wie", "geht", "dir", "mir", "wo", "morgen", "nach", "heute", "sehr", "hier", "auch", "wieder", "sprechen", "entschuldigung", "guten", "tag", "wetter", "fahren", "bahnhof"]);
const ES_HINTS = new Set(["el", "la", "los", "las", "que", "por", "cuidado", "hola", "gracias", "señor", "señora", "sí", "no", "es", "muy", "pero", "dónde", "qué", "como", "está"]);
export function detectLanguage(text) {
  if (/[¡¿ñ]/.test(text)) return "es";
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return "en";
  const de = words.filter((w) => DE_HINTS.has(w) || /[äöüß]/.test(w)).length;
  const es = words.filter((w) => ES_HINTS.has(w) || /[áéíóú]/.test(w)).length;
  const EN = new Set(["the", "a", "you", "it", "is", "was", "what", "and", "to", "of", "watch", "out", "i", "me", "my", "that", "this"]);
  const en = words.filter((w) => EN.has(w)).length;
  if (de / words.length >= 0.5 && de > en) return "de";
  if (es / words.length >= 0.5 && es > en) return "es";
  return "en";
}

/** Known foreign words inside English text -> Kokoro phonemes. */
export const FOREIGN_WORDS = {
  "müller": "mˈylɐ", "zürich": "ʦˈyːʁɪç", "eichhörnchen": "ˈaɪçhœʁnçən", "achtung": "ˈaχtʊŋ", "cuidado": "kwiðˈaðo",
  "münchen": "mˈynçən", "köln": "kˈœln", "straße": "ʃtʁˈaːsə", "über": "ˈyːbɐ", "schmidt": "ʃmˈɪt", "jürgen": "jˈyʁɡən",
};

// ---- foreign words inside English text (app addition) ----
// A word is read as German when it is in the list above or has ä, ö, ü or ß
// (no English word does), and as Spanish when it has ñ. Accents such as é or
// á are left to the English rules: "café" and "résumé" are English words too.
const LISTED = Object.keys(FOREIGN_WORDS).join("|");
const FOREIGN_WORD = new RegExp(`(?<![\\p{L}'’])(?:${LISTED}|\\p{L}*[äöüßÄÖÜ]\\p{L}*|\\p{L}*[ñÑ]\\p{L}*)(?![\\p{L}'’])`, "giu");

// The language of a word found by FOREIGN_WORD.
const wordLanguage = (word) => (/ñ/iu.test(word) || word.toLowerCase() === "cuidado" ? "es" : "de");

// "coöperate", "zoölogy": an English diaeresis, not a German ö.
const ENGLISH_DIAERESIS = /oö/i;

/** English text cut into pieces: [{ text, lang: null | "de" | "es" }] (null = English). */
export function foreignWords(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(FOREIGN_WORD)) {
    if (ENGLISH_DIAERESIS.test(m[0])) continue; // stays in the English text (spoken forms remove the dots)
    if (m.index > last) out.push({ text: text.slice(last, m.index), lang: null });
    out.push({ text: m[0], lang: wordLanguage(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), lang: null });
  return out;
}

/** True when English text contains a word that should be read as German or Spanish. */
export function hasForeignWords(text) {
  return foreignWords(text).some((p) => p.lang);
}

// ---- the language of a whole quote (app addition, stricter than detectLanguage above) ----
// A missed German or Spanish line is just read in English; an English line
// read as German is jarring. So hint words that are also English words, or
// common in names and titles ("No way", "Die now", "La Bamba"), are "weak":
// they count, but a line needs at least one strong hint.
const DE_WEAK = new Set(["die", "war", "mal", "gut", "tag", "es", "wo", "mir", "mit", "ja", "das", "der", "ein", "sie", "hat", "man", "so", "in", "an", "am"]);
const ES_WEAK = new Set(["no", "es", "el", "la", "los", "las", "como", "a", "me"]);
const EN_HINTS = new Set(["the", "a", "you", "it", "is", "was", "what", "and", "to", "of", "watch", "out", "i", "me", "my", "that", "this"]);

// Counts strong and all hint words of one language.
function hints(words, listed, weak, letters) {
  let strong = 0, all = 0;
  for (const w of words) {
    const isListed = listed.has(w);
    if (!isListed && !letters.test(w)) continue;
    all++;
    if (isListed && !weak.has(w)) strong++; // a word that only qualifies by its letters is weak
  }
  return { strong, all };
}

/**
 * "de", "es" or "en" for a whole quote. Spanish when it has ¡ or ¿;
 * otherwise German (or Spanish) only with at least one strong hint, when
 * hint words are more than half of the words and outnumber the English ones.
 */
export function quoteLanguage(text) {
  if (/[¡¿]/.test(text)) return "es";
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return "en";
  const en = words.filter((w) => EN_HINTS.has(w)).length;
  const decide = ({ strong, all }) => strong >= 1 && all > words.length / 2 && all > en;
  if (decide(hints(words, DE_HINTS, DE_WEAK, /[äöüß]/))) return "de";
  if (decide(hints(words, ES_HINTS, ES_WEAK, /[áéíóúñ]/))) return "es";
  return "en";
}

/** Sound symbols for one foreign word (the list first, then the rules). */
export function foreignWordPhonemes(word, lang) {
  return FOREIGN_WORDS[word.toLowerCase()] ?? (lang === "es" ? spanishWord(word) : germanWord(word));
}
