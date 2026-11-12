// PROTOTYPE C: who speaks each quote paragraph, by pure string rules, and the speakers' gender.
//   1. explicit: a name in the paragraph's narration ("Daniel whispered") or a pronoun
//      ("she said", "His voice trembled", "He laughed.") of a gender only one character has;
//   2. a name called out inside the quote ("Sarah?", "OH, DANIEL!"): the other one speaks;
//   3. a voice description between two quote paragraphs ("The voice on the other end was
//      barely a whisper."): the same speaker goes on (guess);
//   4. otherwise turns alternate (guess).
// Characters: capitalised words that appear at least twice, at least once in narration followed
// by a lower-case word ("Daniel sat", "Sarah burst"). Gender: he/his/him/himself or
// she/her/herself in a narration sentence that names the character, or in the narration of a
// paragraph whose speaker rule 2 found; with two characters and one known, the other is
// given the other gender if the text uses both he and she.
const STOP = new Set(['The', 'A', 'An', 'And', 'But', 'Or', 'So', 'Then', 'Finally', 'He', 'She', 'His', 'Her', 'Him', 'They', 'Their', 'It', 'I', 'We', 'You', 'My', 'Your', 'This', 'That', 'There', 'Here', 'When', 'While', 'After', 'Before', 'Something', 'Someone', 'Nothing', 'What', 'Who', 'Why', 'How', 'Oh', 'Yes', 'No', 'Yeah', 'Well', 'Mr', 'Mrs', 'Ms', 'Dr', 'Suddenly', 'Meanwhile', 'Outside', 'Inside', 'In', 'On', 'At', 'Of', 'For', 'With', 'As', 'If']);
const MALE = /\b(?:he|his|him|himself)\b/i;
const FEMALE = /\b(?:she|her|hers|herself)\b/i;
const PRONOUN = /\b(he|his|him|himself|she|her|hers|herself)\b/i;
const genderOf = (w) => (MALE.test(w) ? 'male' : 'female');
const sentencesIn = (t) => t.split(/(?<=[.!?…])\s+/);
const narrationOf = (p) => p.spans.filter((s) => s.kind === 'narr').map((s) => s.text).join(' ');
const quotesOf = (p) => p.spans.filter((s) => s.kind === 'quote').map((s) => s.text).join(' ');
const isDescription = (p) => p.spans.every((s) => s.kind === 'narr') && /^(?:The|His|Her|Their)\s+voice\b/.test(p.text) && p.text.split(/\s+/).length <= 12;

export function speakersOf(paras) {
  const all = paras.map((p) => p.text).join(' ');
  const narration = paras.map(narrationOf).join(' ');
  const count = (n) => (all.match(new RegExp(`\\b${n}\\b`, 'gi')) || []).length;
  const names = [...new Set([...narration.matchAll(/\b(\p{Lu}\p{Ll}+)\s+\p{Ll}/gu)].map((m) => m[1]))].filter((n) => !STOP.has(n) && count(n) >= 2);
  const mentioned = (t) => names.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(t));
  const gender = {};
  for (const n of names) {
    for (const s of paras.flatMap((p) => p.spans.filter((x) => x.kind === 'narr').flatMap((x) => sentencesIn(x.text)))) if (new RegExp(`\\b${n}\\b`).test(s) && PRONOUN.test(s)) gender[n] ??= genderOf(s.match(PRONOUN)[1]);
  }
  const quoteParas = paras.map((p, k) => ({ p, k })).filter(({ p }) => p.spans.some((s) => s.kind === 'quote'));
  // vocative-only pass for gender evidence (rule 2 + a pronoun in the narration)
  if (names.length === 2) {
    for (const { p } of quoteParas) {
      const called = mentioned(quotesOf(p));
      const pron = narrationOf(p).match(PRONOUN);
      if (called.length === 1 && pron && !mentioned(narrationOf(p)).length) gender[names.find((n) => n !== called[0])] ??= genderOf(pron[1]);
    }
    const known = names.filter((n) => gender[n]);
    if (known.length === 1 && MALE.test(narration) && FEMALE.test(narration)) gender[names.find((n) => !gender[n])] = gender[known[0]] === 'male' ? 'female' : 'male';
  }
  const byGender = (g) => { const c = names.filter((n) => gender[n] === g); return c.length === 1 ? c[0] : null; };
  const other = (n) => (names.length === 2 && n ? names.find((x) => x !== n) : null);
  const result = new Map(); // paragraph index -> { who, how }
  for (const { p, k } of quoteParas) {
    const narr = narrationOf(p);
    const named = mentioned(narr);
    const pron = narr.match(PRONOUN);
    const called = mentioned(quotesOf(p));
    let who = null, how = null;
    if (named.length === 1) [who, how] = [named[0], 'named in narration'];
    else if (pron && byGender(genderOf(pron[1]))) [who, how] = [byGender(genderOf(pron[1])), `pronoun "${pron[1]}"`];
    else if (called.length === 1 && other(called[0])) [who, how] = [other(called[0]), `calls "${called[0]}"`];
    else if (isDescription(paras[k - 1] ?? { spans: [], text: '' }) && result.has(k - 2)) [who, how] = [result.get(k - 2).who, 'same voice after its description (guess)'];
    else {
      const prev = [...result.entries()].filter(([j]) => j < k).at(-1);
      if (prev && other(prev[1].who)) [who, how] = [other(prev[1].who), 'turns alternate (guess)'];
    }
    result.set(k, { who, how });
  }
  // second pass (backwards) for paragraphs still open, e.g. the opening line
  for (const { k } of [...quoteParas].reverse()) {
    if (result.get(k).who) continue;
    const next = [...result.entries()].filter(([j]) => j > k)[0];
    if (!next || !next[1].who) continue;
    if (isDescription(paras[k + 1] ?? { spans: [], text: '' }) && next[0] === k + 2) result.set(k, { who: next[1].who, how: 'same voice as after its description (guess)' });
    else result.set(k, { who: other(next[1].who), how: 'turns alternate, from the next line (guess)' });
  }
  const bySpan = new Map();
  for (const [k, r] of result) for (const s of paras[k].spans) if (s.kind === 'quote') bySpan.set(s, r.who);
  return { names, gender, bySpan, table: [...result.entries()].map(([k, r]) => ({ para: k, text: paras[k].text, ...r, gender: gender[r.who] ?? null })) };
}
