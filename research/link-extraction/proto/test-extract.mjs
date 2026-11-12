import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractForListening, classifyUrl, guessLang, renderSpeech, speechText, WPM } from './hearshot-extract.mjs';
console.error = () => {};
const root = path.resolve('..');
const aeb = (prefix) => { const g = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); const k = Object.keys(g).find(x => x.startsWith(prefix)); return { url: g[k].url, html: zlib.gunzipSync(fs.readFileSync(`${root}/corpora/article-extraction-benchmark/html/${k}.html.gz`)).toString('utf8') }; };
const rdb = (d) => fs.readFileSync(`${root}/corpora/readability/test/test-pages/${d}/source.html`, 'utf8');
const lorem = (n) => Array.from({ length: n }, (_, i) => 'This is sentence number ' + i + ' of the article and it talks about the history of local newspapers and their readers.').join(' ');
const FIX = `<!doctype html><html lang="en"><head><title>The Big Story | Daily Example</title><meta property="og:site_name" content="Daily Example"><meta name="author" content="Jane Roe"><meta property="article:published_time" content="2026-03-02T10:00:00Z"></head><body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/news">News</a></li><li><a href="/sports">Sports</a></li></ul></nav>
<div class="cookie-banner">We use cookies. Accept all</div>
<article><h1>The Big Story</h1><p class="byline">By Jane Roe</p>
<p>${lorem(4)} It was a 🔥 moment.<sup><a href="#fn1">[1]</a></sup> Another claim follows here.<sup>[citation needed]</sup></p>
<figure><img src="a.jpg" alt="a dog"><figcaption>A dog on a beach. Photo: Getty Images</figcaption></figure>
<h2>Background</h2><p>${lorem(5)}</p>
<blockquote><p>We were not ready for this, said the mayor at the press conference on Tuesday afternoon.</p></blockquote>
<pre><code>npm install hearshot --save</code></pre>
<table><tr><th>Year</th><th>Sales</th></tr><tr><td>2020</td><td>10</td></tr></table>
<p>${lorem(6)} See https://example.com/a/very/long/path?x=1 for details.</p>
<ul><li>First point is that readers matter a great deal to every newsroom.</li><li>Second point is that costs keep rising for everyone concerned.</li></ul>
<h2>Read more</h2><ul><li><a href="/a">Mayor resigns</a></li><li><a href="/b">Team wins cup</a></li><li><a href="/c">Weather this week</a></li></ul>
<h2>References</h2><ol class="references"><li>Smith, J. (2020). A book. Publisher.</li><li>Doe, A. (2021). Another book. Publisher.</li></ol>
</article><footer>© 2026 Daily Example. All rights reserved. <a href="/privacy">Privacy</a></footer></body></html>`;

test('classifyUrl: declines gracefully / routes', () => {
  assert.equal(classifyUrl('https://www.youtube.com/watch?v=abc').ok, false); assert.equal(classifyUrl('https://youtu.be/abc').kind, 'video');
  assert.equal(classifyUrl('https://open.spotify.com/episode/x').kind, 'audio'); assert.equal(classifyUrl('ftp://x.com/a').ok, false); assert.equal(classifyUrl('not a url').kind, 'invalid');
  assert.equal(classifyUrl('https://example.com/paper.pdf').route, 'pdf-pipeline'); assert.equal(classifyUrl('https://docs.google.com/document/d/123/edit').route, 'gdoc-export');
  assert.equal(classifyUrl('https://x.com/a/status/1').kind, 'login-wall'); assert.equal(classifyUrl('https://example.com/blog/post').kind, 'page');
});
test('guessLang separates English from German/French/Spanish', () => {
  assert.equal(guessLang('The committee said that it would review the proposal and that they had not yet decided which of the options would be taken forward this year.').lang, 'en');
  assert.equal(guessLang('Die Bundesregierung hat beschlossen, dass die elektronische Patientenakte nicht mehr verschoben wird und auch die Ärzte sind davon betroffen, wie es heißt.').lang, 'de');
  assert.equal(guessLang('Le gouvernement a annoncé que la réforme sera présentée dans les prochains jours et que les syndicats sont invités à une réunion avec le ministre.').lang, 'fr');
  assert.equal(guessLang('El gobierno ha anunciado que la reforma se presentará en los próximos días y que los sindicatos están invitados a una reunión con el ministro.').lang, 'es');
});
test('synthetic article: block types, cleaning and announcements', async () => {
  const r = await extractForListening(FIX, 'https://daily.example.com/story'); assert.equal(r.ok, true);
  const by = (t) => r.blocks.filter(b => b.type === t); const spoken = r.blocks.filter(b => !b.skip).map(b => b.text).join('\n');
  assert.ok(by('heading').some(b => b.text === 'Background')); assert.ok(by('quote').length >= 1, 'quote block kept'); assert.ok(by('code').every(b => b.skip), 'code skipped by default'); assert.ok(by('table').every(b => b.skip), 'table skipped by default');
  assert.ok(by('caption').every(b => b.skip), 'caption skipped by default');
  assert.ok(!/\[1\]|citation needed/.test(spoken), 'citation markers removed'); assert.ok(!/🔥/.test(spoken), 'emoji removed'); assert.ok(!/https?:\/\//.test(spoken), 'raw URLs not read'); assert.match(spoken, /see link for details/i);
  assert.ok(!/Mayor resigns|Team wins cup/.test(spoken), 'related link list not read'); assert.ok(!/Smith, J\./.test(spoken), 'reference list not read'); assert.ok(!/cookies|All rights reserved/i.test(spoken));
  assert.equal(r.meta.title, 'The Big Story'); assert.match(r.meta.announce, /The Big Story\./); assert.match(r.meta.announce, /Jane Roe/); assert.match(r.meta.announce, /March 2, 2026/);
  const sp = renderSpeech(r); assert.ok(sp.some(s => s.kind === 'quote-start') && sp.some(s => s.kind === 'quote-end')); assert.ok(sp.some(s => s.text === 'Code example skipped.') && sp.some(s => s.text === 'Table skipped.'));
});
test('toggles turn block types back on', async () => {
  const r = await extractForListening(FIX, 'https://daily.example.com/story', { toggles: { code: true, caption: true, table: true } });
  assert.ok(r.blocks.filter(b => b.type === 'code').every(b => !b.skip)); assert.ok(r.blocks.filter(b => b.type === 'caption').every(b => !b.skip));
});
test('listening time uses ~165 wpm', async () => {
  const html = `<html lang="en"><body><article><h1>T</h1>${Array.from({ length: 40 }, (_, i) => '<p>Paragraph ' + i + '. ' + lorem(3) + '</p>').join('')}</article></body></html>`; const r = await extractForListening(html, 'https://a.example.com/x');
  assert.ok(Math.abs(r.meta.listenMinutes - Math.round(r.meta.words / WPM)) <= 1); assert.ok(r.meta.words > 1000);
});
test('too little text -> warning, not a crash', async () => {
  const r = await extractForListening('<html><body><div id="root"></div><script>render()</script></body></html>', 'https://spa.example.com/'); 
  assert.ok(r.ok === false || r.warnings.some(w => /little text|JavaScript/.test(w)));
});
test('PDF and video URLs are routed/declined before any extraction', async () => {
  assert.equal((await extractForListening('', 'https://a.com/x.pdf')).route, 'pdf-pipeline'); assert.equal((await extractForListening('', 'https://youtube.com/watch?v=1')).ok, false);
});
test('real page: Wikipedia -> no [n] markers, no table of contents, headings kept', async () => {
  const r = await extractForListening(rdb('wikipedia'), 'https://en.wikipedia.org/wiki/Mozilla'); const spoken = r.blocks.filter(b => !b.skip);
  assert.ok(!spoken.some(b => /\[\d+\]|\[edit\]|citation needed/.test(b.text))); assert.ok(!spoken.some(b => b.type === 'heading' && /^Contents$/i.test(b.text))); assert.ok(spoken.some(b => b.type === 'heading' && b.text === 'History')); assert.ok(r.meta.words > 2500 && r.meta.words < 3600, 'words=' + r.meta.words);
  assert.ok(!spoken.some(b => /^(References|External links|See also)$/.test(b.text)), 'end matter headings dropped');
});
test('real page: V8 docs blog -> code blocks skipped with spoken note', async () => {
  const r = await extractForListening(rdb('v8-blog'), 'https://v8.dev/blog/emscripten-standalone-wasm'); assert.ok(r.blocks.filter(b => b.type === 'code').length >= 5); assert.ok(speechText(renderSpeech(r)).includes('Code example skipped.'));
});
test('real page: LA Times -> pull quote not repeated, site suffix not in title', async () => {
  const p = aeb('8634d1211c3f'); const r = await extractForListening(p.html, p.url); assert.ok(!/Los Angeles Times$/.test(r.meta.title.replace(/\.$/, ''))); const spoken = r.blocks.filter(b => !b.skip).map(b => b.text).join('\n');
  assert.equal((spoken.match(/hasn’t been a single year of revenue gain/g) || []).length, 1, 'pull quote spoken only once');
});
test('real page: German blog -> language warning', async () => {
  const p = aeb('57b4dafd'); const r = await extractForListening(p.html, p.url); assert.equal(r.meta.lang, 'de'); assert.ok(r.warnings.some(w => /DE|German|language/i.test(w)), JSON.stringify(r.warnings));
});
test('real page: GiveWell blog -> no "(More)" link cues', async () => {
  const p = aeb('ad9e9e596f21'); const r = await extractForListening(p.html, p.url); assert.ok(!r.blocks.filter(b => !b.skip).some(b => /\(More\)/.test(b.text)));
});
