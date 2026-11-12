// Extra precision checks for the prototype fiction rules (F1-F8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, styleKey, pausePlan } from '../src/director/director_fiction.js';
import { splitText } from '../src/text/splitter.js';
const view = (t) => direct(splitText(t)).map((d) => d.parts.map((p) => `${styleKey(p.style, p.lang) || 'plain'}: ${p.text}`));
const plain = (t) => direct(splitText(t)).forEach((d, i) => assert.equal(d.key, '', `${t} -> ${JSON.stringify(view(t)[i])}`));
test('ordinary prose and reporting stay plain', () => {
  for (const t of [
    '“The results are clear.” He said the study was flawed.',
    '“We will see,” the minister said. Then she left the room.',
    'The report was published on Monday. “It is a scandal,” said one reader.',
    'He read the letter. “Dear Sir,” it began.',
    'Introduction\n\nThe first chapter explains the method.',
    'The voice assistant market grew quickly.\n\n“Nobody expected it,” an analyst said.',
    '“I work at NASA, OK?”', '“OK?” he asked.', 'The FBI and the CIA declined to comment.', 'He shouted at the dog all morning. “Fine.”',
    'Smith nodded. “Agreed.”', 'For example:\n\n“The sky is blue.”',
    '“Relax, everyone!” she laughed, and the room relaxed.',
  ]) plain(t);
});
test('fiction cues', () => {
  assert.match(view('He laughed. “Oh, come on!”')[1][0], /pitch0.35/);
  assert.match(view('“No.” Her voice cracked. “I\'m serious.”')[1][0], /whisper0.6/);
  assert.match(view('“Sarah…” Daniel whispered. “Don\'t move.”')[2][0], /whisper1.1/);
  assert.match(view('“We were shocked,” she said quietly.')[0][0], /whisper0.6 gainDb-3/);
  assert.match(view('“RUN, SARAH! RUN!”')[0][0], /pitch0.55.*: run, sarah!/);
  assert.match(view('“Wait… WHAT?”')[0][1], /pitch0.55.*: what\?/);
  assert.match(view('BANG!')[0][0], /pitch0.55/);
  assert.match(view('“Hello?”\n\nThe voice on the line was barely a whisper.')[0][0], /whisper1.1/);
  assert.match(view('Then, softly—\n\n“Yes.”')[1][0], /whisper0.6/);
});
test('pauses', () => {
  const p = pausePlan(splitText('“Hi.”\n\n“Hello.”\n\nSilence.\n\nAnd then—\n\nBANG!\n\nThe end came.'));
  assert.deepEqual(p.map((x) => +x.toFixed(2)), [0.5, 1.0, 1.6, 1.25, 1.2, 0.85]);
  // prose: paragraphs keep today's 0.85
  const q = pausePlan(splitText('First paragraph here is long enough.\n\nSecond paragraph is also here.'));
  assert.equal(q[0], 0.85);
});
