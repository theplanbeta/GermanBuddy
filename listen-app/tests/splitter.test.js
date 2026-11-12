// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText, splitSentences, splitLong, toParagraphs, splitOpening, MAX_LENGTH } from '../src/text/splitter.js';

const texts = (input) => splitText(input).map((s) => s.text);

test('splits simple sentences', () => {
  assert.deepEqual(texts('Hello there. How are you? I am fine!'), [
    'Hello there.',
    'How are you?',
    'I am fine!',
  ]);
});

test('keeps titles and common abbreviations together', () => {
  assert.deepEqual(texts('Mr. Smith met Dr. Jones at St. Paul. They talked.'), [
    'Mr. Smith met Dr. Jones at St. Paul.',
    'They talked.',
  ]);
  assert.deepEqual(texts('Bring fruit, e.g. Apples or pears. Also i.e. Bread.'), [
    'Bring fruit, e.g. Apples or pears.',
    'Also i.e. Bread.',
  ]);
  assert.deepEqual(texts('See Fig. 3 and No. 7 on Jan. 5. Done.'), ['See Fig. 3 and No. 7 on Jan. 5.', 'Done.']);
});

test('does not split dotted acronyms or initials', () => {
  assert.deepEqual(texts('The U.S. Army arrived at 9 a.m. Monday. J. R. R. Tolkien wrote it.'), [
    'The U.S. Army arrived at 9 a.m. Monday.',
    'J. R. R. Tolkien wrote it.',
  ]);
});

test('does not split decimals, prices or versions', () => {
  assert.deepEqual(texts('Pi is 3.14159 and it cost $4.50 today. Version 2.1.3 is out.'), [
    'Pi is 3.14159 and it cost $4.50 today.',
    'Version 2.1.3 is out.',
  ]);
});

test('handles quotes and attribution', () => {
  assert.deepEqual(texts('"Stop!" she said. "Why?" He asked. ‘Fine.’ Then silence.'), [
    '"Stop!" she said.',
    '"Why?"',
    'He asked.',
    '‘Fine.’',
    'Then silence.',
  ]);
});

test('does not split before a lowercase word', () => {
  assert.deepEqual(texts('Wait... what happened? nothing much. Okay.'), ['Wait... what happened? nothing much.', 'Okay.']);
});

test('splits after etc. when a new sentence starts', () => {
  assert.deepEqual(texts('Pens, paper, etc. We need them.'), ['Pens, paper, etc.', 'We need them.']);
});

test('numbers paragraphs and treats blank lines as paragraph breaks', () => {
  const result = splitText('First one. Second one.\n\nNew paragraph here.\r\n\r\n\r\nThird.');
  assert.deepEqual(result, [
    { text: 'First one.', para: 0 },
    { text: 'Second one.', para: 0 },
    { text: 'New paragraph here.', para: 1 },
    { text: 'Third.', para: 2 },
  ]);
});

test('joins wrapped lines but keeps headings and list items apart', () => {
  assert.deepEqual(toParagraphs('This is a long line of prose that was wrapped by an email program at\nseventy characters or so and continues here.'), [
    'This is a long line of prose that was wrapped by an email program at seventy characters or so and continues here.',
  ]);
  assert.deepEqual(toParagraphs('Chapter One\nIt was a dark night.'), ['Chapter One', 'It was a dark night.']);
  assert.deepEqual(toParagraphs('Shopping:\n- milk\n- eggs\n• bread'), ['Shopping:', 'milk', 'eggs', 'bread']);
  assert.deepEqual(toParagraphs('an infor-\nmation leak'), ['an information leak']);
});

test('skips pieces with no words', () => {
  assert.deepEqual(texts('One.\n\n***\n\nTwo.'), ['One.', 'Two.']);
  assert.deepEqual(splitText('   \n\n  '), []);
  assert.equal(splitText('One.\n\n***\n\nTwo.')[1].para, 1);
});

test('breaks very long sentences at clause boundaries under the limit', () => {
  const clause = 'the quick brown fox jumps over the lazy dog';
  const long = Array.from({ length: 12 }, () => clause).join(', ') + '.';
  const pieces = splitLong(long);
  assert.ok(pieces.length > 1);
  for (const p of pieces) assert.ok(p.length <= MAX_LENGTH, `too long: ${p.length}`);
  assert.equal(pieces.join(' '), long, 'no text lost');
  for (const p of pieces.slice(0, -1)) assert.ok(p.endsWith(','), `should break after a comma: "${p}"`);
});

test('prefers semicolons over commas when breaking', () => {
  const a = 'word '.repeat(15).trim(); // 74 characters
  const s = `${a}, ${a}; ${a}, ${a}`;
  const [first] = splitLong(s, 200);
  assert.ok(first.endsWith(';'), first);
});

test('hard-cuts a single giant word', () => {
  const pieces = splitLong('x'.repeat(450), 200);
  assert.deepEqual(pieces.map((p) => p.length), [200, 200, 50]);
});

test('every word survives splitting of a long document', () => {
  const doc = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} talks about Mr. Brown and the U.S. economy, which grew 2.5% in Q${i % 4}.`).join(' ');
  const pieces = splitText(doc);
  assert.ok(pieces.length >= 300);
  assert.equal(pieces.map((p) => p.text).join(' '), doc);
});

test('splitSentences on text with no end punctuation', () => {
  assert.deepEqual(splitSentences('just some words'), ['just some words']);
});

test('splitOpening splits a long first sentence at an early comma', () => {
  const pieces = splitOpening(splitText('Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little. Then more.'));
  assert.deepEqual(pieces.map((p) => p.text), [
    'Some years ago, never mind how long precisely,',
    'having little or no money in my purse, I thought I would sail about a little.',
    'Then more.',
  ]);
  assert.equal(pieces[0].joined, true);
  assert.equal(pieces[1].joined, undefined);
  assert.equal(pieces[0].para, pieces[1].para);
});

test('splitOpening leaves short or unsplittable openings alone', () => {
  const short = splitText('Mr. Brown arrived at 9 a.m. on Monday. He sat down.');
  assert.deepEqual(splitOpening(short), short);
  const noComma = splitText('The quick brown fox jumps over the lazy dog and then runs far away into the woods.');
  assert.deepEqual(splitOpening(noComma), noComma);
  // the remainder must not be tiny either
  const lateComma = splitText('The quick brown fox jumps over the lazy dog and then runs away, quickly.');
  assert.deepEqual(splitOpening(lateComma), lateComma);
  assert.deepEqual(splitOpening([]), []);
});

test('splitOpening only touches the first piece', () => {
  const pieces = splitText('Short one. Some years ago, never mind how long precisely, having little or no money, I sailed.');
  assert.deepEqual(splitOpening(pieces), pieces);
});

test('a trailing-off "…" inside quoted speech does not end the sentence', () => {
  assert.deepEqual(texts('“Wait… WHAT?!” she exclaimed. He left.'), ['“Wait… WHAT?!” she exclaimed.', 'He left.']);
  assert.deepEqual(texts('"Well... Maybe," he said. Done.'), ['"Well... Maybe," he said.', 'Done.']);
  // in narration it still does
  assert.deepEqual(texts('She waited… Nothing came.'), ['She waited…', 'Nothing came.']);
  // an unclosed quote mark does not swallow the rest
  assert.deepEqual(texts('“She waited… Nothing came.'), ['“She waited…', 'Nothing came.']);
});
