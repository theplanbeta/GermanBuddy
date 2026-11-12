// The director's decisions (src/director/director.js): who is styled how, and
// that it stays quiet when there is nothing to direct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, plainDelivery, perfFor, styleKey, PLAIN, PRESETS } from '../src/director/director.js';
import { styleShift, styledSpeed, afterEffects } from '../src/director/styles.js';
import { WHISPER, PITCH } from '../src/director/directions.js';
import { splitText, splitOpening } from '../src/text/splitter.js';
import { partToPhonemes } from '../src/engine/phonemes.js';
import { STRESS, PROSE_LONG } from './texts.js';

const sentencesOf = (text) => splitOpening(splitText(text));
// A compact view of a delivery: each part as "lang style: text".
function view(d) {
  return d.parts.map((p) => {
    const style = styleKey(p.style, p.lang);
    return `${style || 'plain'}: ${p.text}`;
  });
}
const SHOUT = 'firm0.6 pitch0.55 speed1.06 gainDb4 shelfDb3';

test('the stress paragraph: every sentence delivered as in the prototype', () => {
  const sentences = sentencesOf(STRESS);
  const d = direct(sentences);
  const expected = [
    ['plain: At precisely 7:43 a.m. on Wednesday,'],
    ['plain: November 12th, Dr. Müller received an unexpected phone call.'],
    // the caps run is raised on its own; "her voice trembling" adds a little breath
    ['plain: Wait…', 'en whisper0.3 pitch0.55 speed1.0918 gainDb4.5 shelfDb3: what?!', 'plain: she exclaimed, her voice trembling.'],
    ['plain: “You\'re telling me that 37.8% of the 2.45 million euro budget has simply… disappeared?”'],
    ['plain: There was a long, uncomfortable silence.'],
    ['plain: Then she whispered, almost to herself,', 'de whisper1.1 speed0.92: Das kann doch nicht wahr sein.'],
    ['plain: Outside, the rain was falling gently on the streets of Zürich, while a French tourist struggled to pronounce Eichhörnchen.'],
    ["plain: Meanwhile, Professor O'Sullivan, a 62-year-old neuroscientist, was explaining the difference between Parkinson's disease, multiple sclerosis,"],
    ['plain: and amyotrophic lateral sclerosis to an audience of 1,250 people.'],
    ['en speed0.85: Consider this,', 'plain: he said, deliberately slowing his speech.'],
    // the same speaker goes on without a new cue: still slow
    ['en speed0.85: A patient receives 0.75 milligrams of medication every six hours.'],
    ['en speed0.85: But what happens if the dosage increases by 15%?'],
    ['plain: Suddenly, someone shouted from the back:', `es ${SHOUT}: ¡Cuidado!`],
    [`de ${SHOUT}: Achtung!`],
    [`en ${SHOUT}: Watch out!`],
    ['plain: A glass shattered.'],
    ['plain: Everyone froze.'],
    ['plain: Three seconds passed.'],
    ['plain: Then five.'],
    // laughing, sighing, chuckling softly and a plain "!" are too small to be worth a change
    ['plain: Finally, a little girl burst into laughter and said, “Relax, everyone!'],
    ['plain: It was just my cat.”'],
    ['plain: The professor sighed, chuckled softly, and replied, “Well… that was unexpected, wasn\'t it?”'],
    ['plain: And somewhere in the distance, a clock struck midnight—once, twice, three times—although nobody could explain why.'],
  ];
  assert.deepEqual(d.map(view), expected);
  // a change inside a sentence is spliced; everything else may share calls by key
  assert.deepEqual(d.map((x, i) => (x.spliced ? i : -1)).filter((i) => i >= 0), [2, 5, 9, 12]);
  assert.equal(d[10].key, d[11].key);
  assert.notEqual(d[13].key, d[14].key); // German and English shouts are separate calls
  assert.deepEqual(d.map((x, i) => (x.quoted ? i : -1)).filter((i) => i >= 0), [3, 10, 11, 13, 14, 20]);
  // German and Spanish names inside English are marked for their own sounds
  assert.deepEqual(d.map((x, i) => (x.parts.some((p) => p.names) ? i : -1)).filter((i) => i >= 0), [1, 6]);
});

test('plain prose: no styling at all, and exactly the written text', () => {
  for (const text of [PROSE_LONG, `${PROSE_LONG}\n\nShe walked slowly home, whispering to the wind. He shouted at nobody.`]) {
    const sentences = sentencesOf(text);
    const d = direct(sentences);
    d.forEach((x, i) => {
      assert.equal(x.key, '', sentences[i].text);
      assert.equal(x.spliced, false);
      assert.deepEqual(x.parts, [{ text: sentences[i].text, lang: 'en', style: PLAIN, names: false }]);
    });
  }
});

test('cues come from the words around a quote', () => {
  const one = (text) => view(direct(sentencesOf(text))[0]);
  assert.deepEqual(one('“Come here,” she whispered.'), ['en whisper1.1 speed0.92: Come here,', 'plain: she whispered.']);
  assert.deepEqual(one('He yelled: “Get out!”'), ['plain: He yelled:', `en ${SHOUT}: Get out!`]);
  assert.deepEqual(one('She murmured, “Not now.”'), ['plain: She murmured,', 'en whisper1.1 speed0.92: Not now.']);
  // narration alone is never styled, whatever it says
  assert.deepEqual(one('She whispered something nobody heard.'), ['plain: She whispered something nobody heard.']);
  // a quote with no cue is plain
  assert.deepEqual(one('“Good morning,” said the clerk.'), ['plain: “Good morning,” said the clerk.']);
  // a quote entirely in capitals with ! is raised (an addition to the prototype, which only lowered its case)
  // (like "what?!" above: raised plus the "!" excitement)
  assert.deepEqual(one('“STOP!” he said.'), ['en firm0.6 pitch0.55 speed1.0918 gainDb4.5 shelfDb3: stop!', 'plain: he said.']);
});

test('a whispered quote continues whispered until the speaker gets a new cue', () => {
  const d = direct(sentencesOf('“Listen,” she breathed. “They are coming.” He nodded. “Run,” he said.'));
  assert.equal(d[0].parts[0].style.whisper, 1.1);
  assert.equal(d[1].parts[0].style.whisper, 1.1); // no attribution: same speaker, same delivery
  assert.equal(d[3].key, ''); // "he said": a plain cue-less attribution ends it
});

test('switch off: plain narration, spoken forms only', () => {
  const sentences = sentencesOf(STRESS);
  const off = sentences.map((s) => plainDelivery(s));
  assert.ok(off.every((d) => d.key === '' && !d.spliced && d.parts.length === 1 && d.parts[0].lang === 'en' && !d.parts[0].names));
  assert.equal(off[3].parts[0].text, '“You\'re telling me that 37.8% of the 2.45 million euro budget has simply… disappeared?”');
});

test('performer settings: shouting beats whispering, speed never below 0.85, gain capped', () => {
  assert.equal(perfFor(['shout', 'whisper']).whisper, 0);
  assert.equal(perfFor(['slow', 'whisper']).speed, 0.85); // 0.85 * 0.92 would be slower
  assert.equal(perfFor(['shout', 'excited']).gainDb, 4.5);
  assert.deepEqual(perfFor([]), PLAIN);
  assert.equal(perfFor(['whisper']).firm, 0);
  assert.equal(PRESETS.slow.speed, 0.85);
});

test('style offsets: whisper on the timbre half, pitch on the intonation half, none for plain', () => {
  assert.equal(styleShift(PLAIN, 100), null);
  const w = styleShift(perfFor(['whisper']), 100);
  assert.equal(w[5], 1.1 * WHISPER[5]);
  assert.ok(w[200] === 0);
  const shout = styleShift(perfFor(['shout']), 100);
  assert.equal(shout[5], -0.6 * WHISPER[5]); // firmer = the opposite of breathy
  assert.equal(shout[130], 0.55 * PITCH[2]);
  // on very short calls the direction is reduced (measured in the prototype)
  assert.ok(Math.abs(styleShift(perfFor(['whisper']), 10)[5] - 0.7 * 1.1 * WHISPER[5]) < 1e-12);
  assert.equal(styledSpeed(PLAIN, 1.5), 1.5);
  assert.equal(styledSpeed(perfFor(['slow']), 1), 0.85);
  const x = new Float32Array([0.1, -0.1]);
  assert.equal(afterEffects(x, PLAIN), x); // plain audio is not touched
});

test('German and Spanish: sound symbols for names inside English and for whole phrases', async () => {
  const d = direct(sentencesOf(STRESS));
  const name = await partToPhonemes(d[1].parts[0], 'a');
  assert.match(name, /dˈɑːktɚ mˈylɐ/); // "Doctor Müller", with German ü and no pause after "Doctor"
  const city = await partToPhonemes(d[6].parts[0], 'a');
  assert.match(city, /ʦˈyːʁɪç/);
  assert.match(city, /ˈaɪçhœʁnçən\./);
  assert.equal(await partToPhonemes(d[5].parts[1], 'a'), 'das kan dɔχ nˈɪçt vˈaːɐ zaɪn.');
  assert.equal(await partToPhonemes(d[12].parts[1], 'a'), 'kwiðˈaðo!');
  assert.equal(await partToPhonemes(d[13].parts[0], 'a'), 'ˈaχtʊŋ!');
  // English text without such words is read exactly as before
  const plain = { text: PROSE_LONG.split('. ')[0] + '.', lang: 'en', names: true };
  assert.equal(await partToPhonemes(plain, 'a'), await partToPhonemes({ ...plain, names: false }, 'a'));
});

// ---- precision: a missed cue is inaudible, a wrong one is jarring ----

// Every sentence of `text` plain: no style, no language switch, exactly as written (names may still be marked).
function assertPlain(text) {
  const sentences = splitText(text);
  direct(sentences).forEach((d, i) => {
    assert.equal(d.key, '', `${sentences[i].text}: ${view(d)}`);
    assert.equal(d.parts.length, 1, sentences[i].text);
    assert.equal(d.parts[0].lang, 'en', sentences[i].text);
    assert.equal(d.parts[0].text, sentences[i].text);
  });
}

test('narration is never read as German or Spanish as a whole', () => {
  for (const t of ['No way.', 'No problem.', 'No thanks.', 'Los Angeles.', 'El Paso.', 'La La Land.', 'Café.', 'Résumé attached.', 'Beyoncé sang.', 'Pokémon Go.', 'War ended.', 'Die now.', 'Gut feeling.', 'Tag him.', 'War is war.', 'The El Niño pattern will bring rain this year.', 'She ordered a jalapeño pizza and a piñata.', 'Schrödinger and Gödel met Björk in Malmö.']) assertPlain(t);
  // names inside English still get their own sounds
  const d = direct(splitText('Schrödinger and Gödel met Björk in Malmö. The El Niño pattern returned.'));
  assert.ok(d.every((x) => x.parts[0].names));
});

test('the language of quoted speech needs a strong hint', () => {
  const lang = (quote) => direct(splitText(`She said, “${quote}”`))[0].parts.at(-1).lang;
  assert.equal(lang('Das kann doch nicht wahr sein.'), 'de');
  assert.equal(lang('¡Cuidado!'), 'es');
  assert.equal(lang('Achtung!'), 'de');
  assert.equal(lang('Watch out!'), 'en');
  assert.equal(lang('Guten Tag!'), 'de');
  assert.equal(lang('No, gracias.'), 'es');
  for (const q of ['No way,', 'No!', 'Die, die!', 'No problem,', 'La Bamba.', 'Achtung, baby!']) assert.equal(lang(q), 'en', q);
});

test('an English diaeresis is not German: read in English, the dots removed', () => {
  const d = direct(splitText('I love coöperation and zoölogy.'))[0];
  assert.equal(d.parts[0].text, 'I love cooperation and zoology.');
  assert.equal(d.parts[0].names, false);
});

test('titles, terms and scare quotes are not speech: no cue, no style, no language', () => {
  for (const t of [
    'The so-called “experts,” who shouted at the press, left.',
    'The “shock” of the scream echoed.',
    'As the engine roared, “Betsy” pulled away.',
    'The term “inflation” is measured by prices.',
    'The “lean” approach was deliberately slow.',
    'He read “War and Peace” slowly.',
    'She sang “La Bamba” while the crowd roared.',
    'He called it “Project X”. Nobody cared.',
    'The sign said "Exit" and he whispered it.',
  ]) assertPlain(t);
  // a title does not become the "previous speaker" either
  const d = direct(splitText('“Listen,” she whispered. He read “War and Peace”. “They are coming.”'));
  assert.equal(d[2].parts[0].style.whisper, 1.1);
});

test('capitals raise the voice only with "!" and never for a plain "OK"', () => {
  for (const t of ['“OK?”', '“I work at NASA, OK?”', '“Well, OK!” she said.', '“Is that OK?” he asked.']) assertPlain(t);
  const raised = (t) => direct(splitText(t))[0].parts.some((p) => p.style.pitch > 0);
  assert.ok(raised('“Wait… WHAT?!” she exclaimed.'));
  assert.ok(raised('“STOP!” he said.'));
});

test('cues still work where they should', () => {
  const one = (text) => view(direct(splitText(text))[0]);
  assert.deepEqual(one('"Stop," he whispered.'), ['en whisper1.1 speed0.92: Stop,', 'plain: he whispered.']);
  assert.deepEqual(one('"Run!" she yelled.'), [`en ${SHOUT}: Run!`, 'plain: she yelled.']);
  assert.deepEqual(one('She whispered, “Go.”'), ['plain: She whispered,', 'en whisper1.1 speed0.92: Go.']);
  assert.deepEqual(one('"I can\'t," he said slowly, "not today."'), ['en speed0.85: I can\'t,', 'plain: he said slowly,', 'en speed0.85: not today.']);
  assert.deepEqual(one('"Come here," she whispered, "and bring the key."'), ['en whisper1.1 speed0.92: Come here,', 'plain: she whispered,', 'en whisper1.1 speed0.92: and bring the key.']);
  assert.deepEqual(one('“No!” he shouted.'), [`en ${SHOUT}: No!`, 'plain: he shouted.']);
  // a cue far from the quote does not count (before: last 8 words; after: first 6)
  assertPlain('He shouted at the dog all morning and then, much later and very tired, said: “Fine.”');
  assertPlain('“Fine,” he said to the waiter, who later whispered to the cook.');
});
