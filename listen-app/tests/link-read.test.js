import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { readLink } from '../src/link/index.js';

const HELPER = { url: 'https://helper.example', key: 'k' };
const ARTICLE = `<!doctype html><html lang="en"><head><title>Quiet Streets - The Town Post</title><meta name="author" content="Sam Lee"></head><body>
  <article><h1>Quiet Streets</h1>${Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i + 1}. The council met on Tuesday and agreed that the streets in the old town would stay closed to cars for the summer, which the shop owners had asked for since the spring.</p>`).join('')}</article></body></html>`;

function helperFake(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = answer(JSON.parse(init.body).url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

test('end to end: pasted link -> listening text, one request to the helper only', async () => {
  const { fetch, calls } = helperFake((u) => [200, { kind: 'html', type: 'text/html', finalUrl: u.replace('/s', '/story'), status: 200, bytes: ARTICLE.length, redirects: 1, html: ARTICLE }]);
  const r = await readLink('  townpost.example.com/s?utm_source=newsletter  ', { helper: HELPER, fetch, DOMParser });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://helper.example/read');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://townpost.example.com/s' });
  assert.equal(r.url, 'https://townpost.example.com/s'); assert.equal(r.finalUrl, 'https://townpost.example.com/story');
  assert.equal(r.title, 'Quiet Streets'); assert.equal(r.byline, 'Sam Lee'); assert.equal(r.language, 'en');
  assert.ok(r.text.startsWith('Quiet Streets.\n\nBy Sam Lee.\n\nParagraph 1.'), r.text.slice(0, 60));
  assert.ok(r.words > 150); assert.ok(r.minutes >= 1); assert.deepEqual(r.warnings, []);
});

test('declined before any request: video, PDF link, Google Docs, nonsense', async () => {
  const { fetch, calls } = helperFake(() => [500, {}]);
  for (const [input, kind] of [['https://youtu.be/x', 'video'], ['https://a.example.com/x.pdf', 'pdf'], ['https://docs.google.com/document/d/1/edit', 'gdoc'], ['hello', 'invalid']]) {
    const r = await readLink(input, { helper: HELPER, fetch, DOMParser });
    assert.equal(r.ok, false); assert.equal(r.kind, kind); assert.ok(r.message);
  }
  assert.equal(calls.length, 0);
});

test('the helper finds a PDF behind an ordinary link', async () => {
  const { fetch } = helperFake((u) => [200, { kind: 'pdf', finalUrl: u }]);
  const r = await readLink('https://a.example.com/download?id=3', { helper: HELPER, fetch, DOMParser });
  assert.equal(r.ok, false); assert.equal(r.kind, 'pdf'); assert.match(r.message, /Open PDF/);
});

test('helper errors come back as plain messages', async () => {
  const { fetch } = helperFake(() => [422, { error: 'paywall', message: 'The site asks for payment.' }]);
  const r = await readLink('https://paper.example.com/a', { helper: HELPER, fetch, DOMParser });
  assert.equal(r.ok, false); assert.equal(r.kind, 'paywall'); assert.match(r.message, /paste it here/);
});

test('a plain-text page', async () => {
  const text = 'One. ' + 'The river rose slowly through the night and the town watched it from the bridge. '.repeat(20) + '\n\nTwo. The water went down by morning.';
  const { fetch } = helperFake((u) => [200, { kind: 'html', type: 'text/plain', finalUrl: u, status: 200, bytes: text.length, redirects: 0, html: text }]);
  const r = await readLink('https://plain.example.com/notes.txt', { helper: HELPER, fetch, DOMParser });
  assert.equal(r.ok, true); assert.equal(r.text.split('\n\n').length, 2);
});

test('never throws, whatever it is given', async () => {
  const bad = [undefined, null, {}, 42, 'https://a.example.com/'];
  for (const input of bad) {
    const r = await readLink(input, { helper: HELPER, fetch: () => { throw new Error('boom'); }, DOMParser });
    assert.equal(r.ok, false); assert.ok(r.message);
  }
  const r = await readLink('https://a.example.com/', { helper: HELPER, fetch: async () => new Response(JSON.stringify({ kind: 'html', html: '<p>x</p>', finalUrl: 'https://a.example.com/' })), DOMParser: null });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal((await readLink('https://a.example.com/')).kind, 'no_helper');
});
