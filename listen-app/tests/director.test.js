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
