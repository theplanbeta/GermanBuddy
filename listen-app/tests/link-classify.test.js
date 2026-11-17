import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, tidyUrl } from '../src/link/classify.js';

test('classifyUrl: a table of what people paste', () => {
  const table = [
    // input, kind, url (when one is kept)
    ['https://example.com/blog/post', 'page', 'https://example.com/blog/post'],
    ['  https://example.com/a  ', 'page', 'https://example.com/a'],
    ['example.com/article', 'page', 'https://example.com/article'],
    ['www.zeit.de', 'page', 'https://www.zeit.de/'],
    ['<https://example.com/a>', 'page', 'https://example.com/a'],
    ['"https://example.com/a"', 'page', 'https://example.com/a'],
    ['//example.com/a', 'page', 'https://example.com/a'],
    ['http://example.com/a', 'page', 'http://example.com/a'],
    ['https://example.com/a?utm_source=x&utm_medium=y&id=7&fbclid=abc&gclid=def#section', 'page', 'https://example.com/a?id=7'],
    ['https://example.com/a?utm_campaign=only', 'page', 'https://example.com/a'],
    ['https://example.com/paper.pdf', 'pdf'],
    ['https://example.com/files/Report.PDF?dl=1', 'pdf'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://youtu.be/abc', 'video'],
    ['https://m.youtube.com/watch?v=abc', 'video'],
    ['https://vimeo.com/123', 'video'],
    ['https://www.tiktok.com/@a/video/1', 'video'],
    ['https://open.spotify.com/episode/x', 'audio'],
    ['https://podcasts.apple.com/us/podcast/x', 'audio'],
    ['https://soundcloud.com/a/b', 'audio'],
    ['https://example.com/song.mp3', 'media'],
    ['https://example.com/photo.JPG', 'media'],
    ['https://example.com/setup.exe', 'media'],
    ['https://x.com/a/status/1', 'login-wall'],
    ['https://twitter.com/a/status/1', 'login-wall'],
    ['https://www.facebook.com/a/posts/1', 'login-wall'],
    ['https://www.instagram.com/p/1', 'login-wall'],
    ['https://www.linkedin.com/pulse/a', 'login-wall'],
    ['https://docs.google.com/document/d/123/edit', 'gdoc'],
    ['https://drive.google.com/file/d/123/view', 'gdoc'],
    ['not a url', 'invalid'],
    ['', 'invalid'],
    [null, 'invalid'],
    ['ftp://example.com/a', 'invalid'],
    ['javascript:alert(1)', 'invalid'],
    ['file:///etc/passwd', 'invalid'],
    ['mailto:a@example.com', 'invalid'],
    ['https://user:pw@example.com/', 'invalid'],
    ['http://localhost/', 'invalid'],
    ['intranet', 'invalid'],
    ['hello world.com', 'invalid'],
  ];
  for (const [input, kind, url] of table) {
    const r = classifyUrl(input);
    assert.equal(r.kind, kind, String(input));
    assert.equal(r.ok, kind === 'page', String(input));
    if (url) assert.equal(r.url, url, String(input));
    if (!r.ok) assert.ok(r.message && r.message.length > 20, `${input}: a plain message`);
  }
});

test('messages tell the person what to do instead', () => {
  assert.match(classifyUrl('https://example.com/a.pdf').message, /Open PDF/);
  assert.match(classifyUrl('https://docs.google.com/document/d/1/edit').message, /File > Download/);
  assert.match(classifyUrl('https://docs.google.com/document/d/1/edit').message, /paste/);
  assert.match(classifyUrl('https://x.com/a').message, /copy it and paste it here/);
});

test('tidyUrl keeps the address otherwise as it was', () => {
  assert.equal(tidyUrl('https://example.com/a?b=1&c=2').href, 'https://example.com/a?b=1&c=2');
  assert.equal(tidyUrl('https://example.com/a?b=1&utm_source=x&c=2').href, 'https://example.com/a?b=1&c=2');
  assert.equal(tidyUrl('https://Bücher.example/ü').hostname, 'xn--bcher-kva.example');
  assert.equal(tidyUrl('https://example.com/a b'), null);
});
