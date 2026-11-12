// Spoken forms (src/text/spoken.js): what the voice is given to say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenForms, ordinal } from '../src/text/spoken.js';
import { splitText } from '../src/text/splitter.js';
import { STRESS, PROSE_LONG } from './texts.js';

const cases = (pairs, options) => {
  for (const [input, expected] of pairs) assert.equal(spokenForms(input, options), expected, input);
};

test('money: the amount, then the unit, singular where it describes a thing', () => {
  cases([
    ['€2.5 million', '2.5 million euros'],
    ['of the €2.45 million budget', 'of the 2.45 million euro budget'],
    ['a €5 note', 'a 5 euro note'],
    ['costs €5, then', 'costs 5 euros, then'],
    ['€1', '1 euro'],
    ['€0.50', '50 cents'],
    ['€2.45', '2 euros and 45 cents'],
    ['€2,500,000', '2,500,000 euros'],
    ['20€ or 20 EUR or EUR 20', '20 euros or 20 euros or 20 euros'],
    ['€5m and £1.5bn', '5 million euros and 1.5 billion pounds'],
    ['a $5 bill', 'a 5 dollar bill'],
    ['spent $5 more', 'spent 5 dollars more'],
    ['$4.50', '4 dollars and 50 cents'],
    ['$2.5 million', '2.5 million dollars'],
    ['£1.01', '1 pound and 1 penny'],
    ['¥300', '300 yen'],
  ]);
});

test('times: 24-hour clock and glued am/pm (kokoro-js already reads 7:43 a.m.)', () => {
  cases([
    ['at 7:43 a.m. on', 'at 7:43 a.m. on'],
    ['10:05', '10:05'],
    ['19:30', '19 30'],
    ['18:00', '18 hundred'],
    ['07:05', '7 oh 5'],
    ['2:30pm', '2:30 pm'],
    ['at 7am', 'at 7 am'],
    ['7.43 am', '7:43 am'],
  ]);
});

test('dates, ordinals and ranges', () => {
  cases([
    ['November 12th', 'November 12th'],
    ['on 1 March 2024', 'on the 1st of March 2024'],
    ['the 3 May', 'the 3rd of May'],
    ['March 3, 2024', 'March 3rd, 2024'],
    ['May 2024', 'May 2024'],
    ['2026-11-12', 'November 12th, 2026'],
    ['Wed., Nov. 12', 'Wednesday, November 12th'],
    ['25/12/2025', 'the 25th of December 2025'],
    ['1914–1918', '1914 to 1918'],
    ['20th-century', '20th century'],
  ]);
  // an ambiguous date follows the accent of the voice
  assert.equal(spokenForms('03/04/2025'), 'March 4th, 2025');
  assert.equal(spokenForms('03/04/2025', { british: true }), 'the 3rd of April 2025');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
});

test('abbreviations, units and fractions', () => {
  cases([
    ['No. 5 and #1', 'number 5 and number 1'],
    ['St. Paul', 'Saint Paul'],
    ['Prof. Smith', 'Professor Smith'],
    ['Mt. Everest', 'Mount Everest'],
    ['Fig. 3, p. 12, pp. 12-14', 'Figure 3, page 12, pages 12-14'],
    ['a vs. b', 'a versus b'],
    ['approx. 5', 'approximately 5'],
    ['c. 1900', 'circa 1900'],
    ['John Smith Jr. said', 'John Smith Junior said'],
    ['John Smith Jr.', 'John Smith Junior.'],
    ['5 km at 100 km/h', '5 kilometers at 100 kilometers per hour'],
    ['1 km', '1 kilometer'],
    ['20°C', '20 degrees Celsius'],
    ['1/2 cup', 'a half cup'],
    ['1 1/2 cups', '1 and a half cups'],
    ['3/4', '3 quarters'],
    ['½', 'a half'],
    ['24/7 and 50/50', '24 7 and 50 50'],
    ['3x faster', '3 times faster'],
  ]);
});

test('left alone: what kokoro-js already reads well, and ordinary words', () => {
  cases([
    ['37.8%', '37.8%'],
    ['1,250 people', '1,250 people'],
    ['a 62-year-old', 'a 62-year-old'],
    ['Dr. Müller', 'Dr. Müller'],
    ['in the 1990s', 'in the 1990s'],
    ['I said no. Then I left.', 'I said no. Then I left.'],
    ['The answer is No.', 'The answer is No.'],
    ['May I come in?', 'May I come in?'],
  ]);
  for (const s of splitText(PROSE_LONG)) assert.equal(spokenForms(s.text), s.text);
});

test('precision: money letters, clauses after an amount, dates that are not dates, streets', () => {
  cases([
    ['$5M in funding', '5 million dollars in funding'],
    ['$5K', '5 thousand dollars'],
    ['$2B', '2 billion dollars'],
    ['€3BN', '3 billion euros'],
    ['$5m', '5 million dollars'],
    ['€3bn', '3 billion euros'],
    ['the $5 he owed', 'the 5 dollars he owed'],
    ['the $2 million he raised', 'the 2 million dollars he raised'],
    ['the $5 million raised last year', 'the 5 million dollars raised last year'],
    ['the $5 they paid', 'the 5 dollars they paid'],
    ['a $5 bill', 'a 5 dollar bill'],
    ['the €2.45 million budget', 'the 2.45 million euro budget'],
    ['In May 20 people died', 'In May 20 people died'],
    ['May 5 percent', 'May 5 percent'],
    ['on March 3.', 'on March 3rd.'],
    ['by March 3, 2024', 'by March 3rd, 2024'],
    ['until March 3)', 'until March 3rd)'],
    ['March 3', 'March 3rd'],
    ['123 Main St. The house', '123 Main Street. The house'],
    ['I live at 123 Main St.', 'I live at 123 Main Street.'],
    ['10 Downing St., London', '10 Downing Street, London'],
    ['St. Paul', 'Saint Paul'],
    ['Mont St. Michel', 'Mont Saint Michel'],
    ['they coöperate in zoölogy', 'they cooperate in zoology'],
  ]);
});

test('the stress paragraph: only the money changes', () => {
  const changed = splitText(STRESS).filter((s) => spokenForms(s.text) !== s.text);
  assert.deepEqual(changed.map((s) => spokenForms(s.text)), ['“You\'re telling me that 37.8% of the 2.45 million euro budget has simply… disappeared?”']);
});
