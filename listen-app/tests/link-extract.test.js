import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { extractArticle, guessLang, headingSentence, parsePage, plainTextArticle, WPM } from '../src/link/extract.js';
import { Readability } from '@mozilla/readability';

const lorem = (n, about = 'the history of local newspapers and their readers') =>
  Array.from({ length: n }, (_, i) => `This is sentence number ${i + 1} of the article, and it talks about ${about}.`).join(' ');
const page = (head, body, lang = 'en') => `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>`;
const X = (html, url = 'https://news.example.com/story') => extractArticle(html, url, { DOMParser });

const NEWS = page(
  '<title>The Big Story | Daily Example</title><meta property="og:site_name" content="Daily Example"><meta name="author" content="Jane Roe">',
  `<nav><ul><li><a href="/">Home</a></li><li><a href="/news">News</a></li><li><a href="/sport">Sport</a></li></ul></nav>
   <div class="cookie-banner">We use cookies. Accept all</div>
   <article><h1>The Big Story</h1><p class="byline">By Jane Roe</p>
   <p>${lorem(4)} It was a 🔥 moment.<sup><a href="#fn1">[1]</a></sup> Another claim follows here.<sup>[citation needed]</sup></p>
   <ul class="share-bar"><li><a href="#">Facebook</a></li><li><a href="#">Twitter</a></li><li><a href="#">Email</a></li></ul>
   <figure><img src="dog.jpg" alt="a dog"><figcaption>A dog on a beach at sunset. Photo: Getty Images</figcaption></figure>
   <p>Advertisement</p>
   <h2>Background</h2><p>${lorem(5)}</p>
   <p>Photo: Reuters</p>
   <p>${lorem(6)} See https://example.com/a/very/long/path?x=1 for details.</p>
   <p>Read more</p>
   <h2>Related stories</h2><ul><li><a href="/a">Mayor resigns</a></li><li><a href="/b">Team wins cup</a></li><li><a href="/c">Weather this week</a></li></ul>
   </article><footer>© 2026 Daily Example. All rights reserved. <a href="/privacy">Privacy</a></footer>`);

test('news article: nav, ads, share bar, caption and credits are not read', async () => {
  const r = await X(NEWS);
  assert.equal(r.ok, true);
  assert.equal(r.title, 'The Big Story');
  assert.equal(r.byline, 'Jane Roe');
  assert.equal(r.site, 'Daily Example');
  assert.equal(r.language, 'en');
  assert.ok(r.text.startsWith('The Big Story.\n\nBy Jane Roe.\n\n'), r.text.slice(0, 80));
  assert.equal((r.text.match(/The Big Story/g) || []).length, 1, 'the title is said once');
  assert.match(r.text, /\n\nBackground\.\n\n/, 'headings are blocks of their own, ended with a full stop');
  for (const gone of [/Home/, /Sport/, /cookies/, /Facebook|Twitter|Email/, /dog on a beach/, /Getty|Reuters/, /Advertisement/, /Read more/, /Mayor resigns|Team wins cup/, /All rights reserved/, /\[1\]|citation needed/, /🔥/, /https?:\/\//]) {
    assert.doesNotMatch(r.text, gone, String(gone));
  }
  assert.match(r.text, /See link for details\./);
  assert.ok(r.words > 150 && r.words < 400, `words ${r.words}`);
  assert.equal(r.minutes, Math.max(1, Math.round(r.words / WPM)));
  assert.deepEqual(r.warnings, []);
});

test('blog post: code is skipped with a short note, footnote markers and footnotes go', async () => {
  const html = page('<title>How we sped up the build - Tiny Blog</title>',
    `<main><article><h1>How we sped up the build</h1>
     <p>${lorem(4, 'build times')}<sup class="footnote-ref"><a href="#fn1" id="r1">1</a></sup></p>
     <pre><code>npm install --save-dev fast-thing
npm run build</code></pre>
     <pre><code>console.log("second block")</code></pre>
     <h2>What changed</h2><p>${lorem(5, 'caching')}<sup><a href="#fn2">2</a></sup> The cache now lives in memory.</p>
     <p>Use x<sup>2</sup> when it squares.</p>
     <section class="footnotes"><ol><li id="fn1">The first footnote text that should not be heard.</li><li id="fn2">The second footnote text.</li></ol></section>
     </article></main>`);
  const r = await X(html, 'https://tiny.example.org/posts/build');
  assert.equal(r.ok, true);
  assert.equal(r.title, 'How we sped up the build');
  assert.equal((r.text.match(/Code example skipped\./g) || []).length, 1, 'one note for two code blocks in a row');
  assert.doesNotMatch(r.text, /npm install|console\.log/);
  assert.doesNotMatch(r.text, /footnote text/);
  assert.doesNotMatch(r.text, /build times\.1|caching\.2/, 'markers dropped');
  assert.match(r.text, /x\^2/, 'a real exponent stays');
  assert.equal(r.byline, '');
});

test('a German article: language de, no warning about the voice', async () => {
  const de = Array.from({ length: 12 }, (_, i) => `Die Stadt hat im Jahr ${2000 + i} beschlossen, dass die Bibliothek nicht mehr geschlossen wird, und auch die Schulen sind davon betroffen, wie es heißt.`).join(' ');
  const html = page('<title>Die Bibliothek bleibt offen – Tageblatt</title><meta property="og:site_name" content="Tageblatt">',
    `<article><h1>Die Bibliothek bleibt offen</h1><p>${de}</p><p>Anzeige</p><p>${de}</p></article>`, 'de');
  const r = await X(html, 'https://www.tageblatt.example.de/lokal/bibliothek');
  assert.equal(r.ok, true);
  assert.equal(r.language, 'de');
  assert.equal(r.title, 'Die Bibliothek bleibt offen');
  assert.deepEqual(r.warnings, []);
  assert.doesNotMatch(r.text, /Anzeige/);
});

test('a French article: warned that the voices will mispronounce it', async () => {
  const fr = Array.from({ length: 10 }, () => 'Le gouvernement a annoncé que la réforme sera présentée dans les prochains jours et que les syndicats sont invités à une réunion avec le ministre.').join(' ');
  const r = await X(page('<title>La réforme</title>', `<article><h1>La réforme</h1><p>${fr}</p><p>${fr}</p></article>`, 'fr'), 'https://journal.example.fr/a');
  assert.equal(r.language, 'fr');
  assert.ok(r.warnings.some((w) => /French/.test(w) && /mispronounce/.test(w)), JSON.stringify(r.warnings));
});

test('a page built by scripts: little text and a warning, or a plain failure; never a crash', async () => {
  const html = page('<title>App</title>', '<div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script>render()</script>');
  const r = await X(html, 'https://spa.example.com/');
  assert.equal(r.ok, false, 'Readability finds no article in an empty app shell');
  assert.match(r.message, /built by scripts/); assert.match(r.message, /paste it here/);
  // a shell with a little visible text is read, with the warning
  const thin = await X(page('<title>App</title>', `<div id="root"><article><p>${lorem(2)}</p></article></div><script>render()</script>`), 'https://spa.example.com/');
  if (thin.ok) assert.ok(thin.warnings.some((w) => /little text/.test(w) && /built by scripts/.test(w) && /paste/.test(w)), JSON.stringify(thin));
  else assert.match(thin.message, /paste it here/);
});

test('a short teaser (a paywall) is read but warned about', async () => {
  const html = page('<title>Exclusive</title>', `<article><h1>Exclusive</h1><p>${lorem(3)}</p><p>Subscribe to keep reading.</p></article>`);
  const r = await X(html, 'https://paper.example.com/x');
  assert.equal(r.ok, true);
  assert.ok(r.words < 120);
  assert.ok(r.warnings.some((w) => /paywall/.test(w)));
});

test('relative links resolve against the page address (<base> set)', async () => {
  const html = page('<title>Links</title>', `<article><h1>Links</h1><p>${lorem(5)} <a href="/about">About us</a> and <a href="../other.html">another page</a>.</p><img src="pic.jpg"></article>`);
  const doc = parsePage(html, 'https://site.example.com/dir/page.html', DOMParser);
  assert.equal(doc.baseURI, 'https://site.example.com/dir/page.html');
  const art = new Readability(doc, { keepClasses: true }).parse();
  assert.match(art.content, /href="https:\/\/site\.example\.com\/about"/);
  assert.match(art.content, /href="https:\/\/site\.example\.com\/other\.html"/);
  assert.match(art.content, /src="https:\/\/site\.example\.com\/dir\/pic\.jpg"/);
  const r = await X(html, 'https://site.example.com/dir/page.html');
  assert.match(r.text, /About us and another page\./, 'link text is read as words, not addresses');
  // a page with its own relative <base>: resolved against the page address
  const own = parsePage('<html><head><base href="/root/"></head><body></body></html>', 'https://site.example.com/dir/page.html', DOMParser);
  assert.equal(own.baseURI, 'https://site.example.com/root/');
});

test('a page where Readability finds nothing, and pages that are not HTML at all', async () => {
  for (const html of ['', '<html><head><title>x</title></head><body></body></html>', '<html><body><img src="a.png"></body></html>', 'just bytes \u0000\u0001']) {
    const r = await X(html);
    assert.equal(r.ok, false, JSON.stringify(html)); assert.match(r.message, /paste it here/);
  }
  const broken = await extractArticle('<p>x</p>', 'https://a.example/', { DOMParser: class { parseFromString() { throw new Error('boom'); } } });
  assert.equal(broken.ok, false);
});

test('a heading ends a sentence, so it is not run into the next one when spoken', async () => {
  assert.equal(headingSentence('Background'), 'Background.');
  assert.equal(headingSentence('Why now?'), 'Why now?');
  assert.equal(headingSentence('It works!'), 'It works!');
  assert.equal(headingSentence('The plan, in short:'), 'The plan, in short.');
  assert.equal(headingSentence('“Never again.”'), '“Never again.”');
  assert.equal(headingSentence('Chapter 1 –'), 'Chapter 1.');
  const html = page('<title>Two parts</title>',
    `<article><h1>Two parts</h1><h2>What changed</h2><p>${lorem(5)}</p><h2>Is it over?</h2><p>${lorem(5, 'the ending')}</p><h3>Next steps:</h3><p>${lorem(3, 'the future')}</p></article>`);
  const r = await X(html);
  assert.match(r.text, /\n\nWhat changed\.\n\nThis is sentence number 1/);
  assert.match(r.text, /\n\nIs it over\?\n\nThis is sentence/);
  assert.match(r.text, /\n\nNext steps\.\n\nThis is sentence/);
});

test('guessLang', () => {
  assert.equal(guessLang('The committee said that it would review the proposal and that they had not yet decided which of the options would be taken forward this year.').lang, 'en');
  assert.equal(guessLang('Die Bundesregierung hat beschlossen, dass die elektronische Patientenakte nicht mehr verschoben wird und auch die Ärzte sind davon betroffen, wie es heißt.').lang, 'de');
  assert.equal(guessLang('El gobierno ha anunciado que la reforma se presentará en los próximos días y que los sindicatos están invitados a una reunión con el ministro.').lang, 'es');
  assert.equal(guessLang('too short').lang, 'und');
});

test('plain-text pages keep their paragraphs', () => {
  const r = plainTextArticle(`First paragraph ${lorem(2)}\r\n\r\nSecond paragraph ${lorem(2)}`, 'https://plain.example.com/a.txt');
  assert.equal(r.ok, true); assert.equal(r.text.split('\n\n').length, 2); assert.equal(r.site, 'plain.example.com');
});
