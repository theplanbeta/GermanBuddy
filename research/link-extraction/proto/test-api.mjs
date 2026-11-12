import http from 'node:http'; import assert from 'node:assert';
import { isPublicIp, validateUrl, safeFetchHtml, FetchError } from './api-fetch-article.mjs';
let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
await t('private/public IP classification', () => { for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '224.0.0.1']) assert.equal(isPublicIp(ip), false, ip); for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip); });
await t('URL validation', () => { for (const u of ['ftp://a.com/', 'file:///etc/passwd', 'http://localhost/', 'http://foo.internal/', 'http://intranet/', 'http://user:pw@example.com/', 'http://example.com:8080/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://169.254.169.254/latest/meta-data']) assert.throws(() => validateUrl(u), FetchError, u); assert.doesNotThrow(() => validateUrl('https://example.com/a?b=1')); });
// local test server on loopback; loopback allowed ONLY via test flag, so redirects to metadata IPs are still validated normally
const srv = http.createServer((q, r) => {
  if (q.url === '/ok') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<html><body><p>h\u00e9llo</p></body></html>'); }
  else if (q.url === '/latin1') { r.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }); r.end(Buffer.from([0x3c,0x70,0x3e,0xe9,0x3c,0x2f,0x70,0x3e])); }
  else if (q.url === '/redir-internal') { r.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); r.end(); }
  else if (q.url === '/redir-ok') { r.writeHead(301, { location: '/ok' }); r.end(); }
  else if (q.url === '/big') { r.writeHead(200, { 'content-type': 'text/html' }); const c = Buffer.alloc(1024 * 1024, 'a'); let i = 0; const w = () => { while (i++ < 8) if (!r.write(c)) return r.once('drain', w); r.end(); }; w(); }
  else if (q.url === '/slow') { r.writeHead(200, { 'content-type': 'text/html' }); r.write('<p>x'); }
  else if (q.url === '/pdf') { r.writeHead(200, { 'content-type': 'application/pdf' }); r.end('%PDF'); }
  else if (q.url === '/bin') { r.writeHead(200, { 'content-type': 'image/png' }); r.end('x'); }
  else if (q.url === '/loop') { r.writeHead(302, { location: '/loop' }); r.end(); }
  else if (q.url === '/403') { r.writeHead(403); r.end(); }
  else { r.writeHead(404); r.end(); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; const B = `http://127.0.0.1:${port}`; const T = { allowLoopbackForTests: true };
await t('loopback refused without test flag', async () => { await assert.rejects(safeFetchHtml(B + '/ok'), e => e.code === 'bad_port' || e.code === 'blocked_ip'); });
await t('rebinding: public name -> private IP refused', async () => { const lookup = (h, o, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]); await assert.rejects(safeFetchHtml('http://rebind.example.com/', { lookup }), e => e.code === 'blocked_ip'); });
await t('mixed DNS answers (public + private) refused', async () => { const lookup = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]); await assert.rejects(safeFetchHtml('http://mixed.example.com/', { lookup }), e => e.code === 'blocked_ip'); });
await t('fetch html + utf-8', async () => { const r = await safeFetchHtml(B + '/ok', T); assert.equal(r.kind, 'html'); assert.match(r.html, /h\u00e9llo/); });
await t('latin-1 decoding', async () => { const r = await safeFetchHtml(B + '/latin1', T); assert.match(r.html, /\u00e9/); });
await t('redirect followed and counted', async () => { const r = await safeFetchHtml(B + '/redir-ok', T); assert.equal(r.redirects, 1); });
await t('redirect to cloud-metadata IP refused', async () => { await assert.rejects(safeFetchHtml(B + '/redir-internal', T), e => e.code === 'blocked_ip'); });
await t('redirect loop capped', async () => { await assert.rejects(safeFetchHtml(B + '/loop', T), e => e.code === 'too_many_redirects'); });
await t('size cap (8 MB body refused at 3 MB)', async () => { await assert.rejects(safeFetchHtml(B + '/big', T), e => e.code === 'too_large'); });
await t('timeout on never-ending response', async () => { await assert.rejects(safeFetchHtml(B + '/slow', { ...T, totalMs: 700 }), e => e.code === 'timeout'); });
await t('pdf is routed, not downloaded', async () => { const r = await safeFetchHtml(B + '/pdf', T); assert.equal(r.kind, 'pdf'); });
await t('binary content-type refused', async () => { await assert.rejects(safeFetchHtml(B + '/bin', T), e => e.code === 'unsupported_type'); });
await t('403 -> blocked_by_site', async () => { await assert.rejects(safeFetchHtml(B + '/403', T), e => e.code === 'blocked_by_site'); });
srv.closeAllConnections?.(); srv.close(); console.log(pass, 'passed');
