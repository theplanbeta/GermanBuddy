import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage, FETCH_MESSAGES, PRIVACY_NOTE } from '../src/link/fetch-page.js';

const HELPER = { url: 'https://helper.example/', key: 'k' };
const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('sends one POST to /read with the key, the address in the body', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return reply(200, { kind: 'html', type: 'text/html', finalUrl: 'https://example.com/b', status: 200, bytes: 9, redirects: 1, html: '<p>hi</p>' })(); };
  const r = await fetchPage({ url: 'https://example.com/a', helper: HELPER, fetch });
  assert.deepEqual(r, { ok: true, kind: 'html', type: 'text/html', finalUrl: 'https://example.com/b', html: '<p>hi</p>', bytes: 9, redirects: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://helper.example/read');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://example.com/a' });
  assert.ok(!calls[0].url.includes('example.com/a'), 'the address is never in the helper URL');
  assert.ok(calls[0].init.signal, 'a time limit');
  assert.equal(calls[0].init.credentials, 'omit');
});

test('a PDF comes back as kind pdf', async () => {
  const r = await fetchPage({ url: 'https://example.com/x', helper: HELPER, fetch: reply(200, { kind: 'pdf', finalUrl: 'https://example.com/x.pdf' }) });
  assert.deepEqual(r, { ok: true, kind: 'pdf', finalUrl: 'https://example.com/x.pdf' });
});

test('every helper error code has its own plain message', async () => {
  const codes = { bad_url: 400, blocked_address: 400, too_many_redirects: 422, too_large: 422, unsupported_type: 422, blocked_by_site: 422, paywall: 422,
    not_found: 422, site_rate_limited: 502, site_error: 502, unreachable: 502, bad_certificate: 502, timeout: 504, busy: 429, read_limit: 429, daily_limit: 429, bad_request: 400 };
  const seen = new Set();
  for (const [code, status] of Object.entries(codes)) {
    const r = await fetchPage({ url: 'https://example.com/', helper: HELPER, fetch: reply(status, { error: code, message: 'helper words' }) });
    assert.equal(r.ok, false, code); assert.equal(r.code, code); assert.equal(r.message, FETCH_MESSAGES[code], code);
    assert.ok(!seen.has(r.message), `${code}: not the same words as another code`); seen.add(r.message);
  }
  for (const code of ['paywall', 'blocked_by_site', 'too_large', 'timeout', 'site_error']) assert.match(FETCH_MESSAGES[code], /select the text, copy it and paste it here/i, code);
});

test('trouble on the way to the helper', async () => {
  const msg = async (fetch, helper = HELPER, extra = {}) => (await fetchPage({ url: 'https://example.com/', helper, fetch, ...extra }));
  assert.equal((await msg(reply(401, { error: 'key missing or wrong' }))).code, 'key');
  assert.equal((await msg(reply(429, { error: 'too many requests' }))).code, 'helper_busy');
  assert.equal((await msg(reply(404, { error: 'unknown' }))).code, 'helper_old');
  assert.equal((await msg(reply(200, 'not json'))).code, 'bad_answer');
  assert.equal((await msg(reply(200, { kind: 'html' }))).code, 'bad_answer');
  assert.equal((await msg(reply(502, '<html>gateway</html>'))).code, 'bad_answer');
  const odd = await msg(reply(500, { error: 'new_code', message: 'A sentence from a newer helper.' }));
  assert.equal(odd.message, 'A sentence from a newer helper.');
  assert.equal((await msg(async () => { throw new TypeError('Failed to fetch'); })).code, 'network');
  assert.equal((await msg(reply(200, {}), { url: '', key: 'k' })).code, 'no_helper');
  assert.equal((await msg(reply(200, {}), { url: 'https://helper.example', key: '' })).code, 'no_helper');
  assert.equal((await msg(reply(200, {}), null)).code, 'no_helper');
  for (const code of ['key', 'helper_busy', 'helper_old', 'network', 'bad_answer', 'no_helper']) assert.equal((code in FETCH_MESSAGES), true);
});

test('a helper that never answers: the time limit', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t0 = Date.now();
  const r = await fetchPage({ url: 'https://example.com/', helper: HELPER, fetch: hang, timeoutMs: 50 });
  assert.equal(r.code, 'helper_timeout'); assert.match(r.message, /too long/);
  assert.ok(Date.now() - t0 < 2000);
});

test('the privacy sentence says who sees the request', () => {
  assert.match(PRIVACY_NOTE, /helper/); assert.match(PRIVACY_NOTE, /website/); assert.match(PRIVACY_NOTE, /see/);
  assert.doesNotMatch(PRIVACY_NOTE, /never leaves|nothing leaves|stays on (this|your) device/i);
});
