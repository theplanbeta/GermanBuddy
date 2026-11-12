// Reference design for POST /api/fetch-article (Vercel Node.js runtime, NOT edge: edge has no dns/net, so it cannot validate the connected IP).
// Returns the raw HTML of ONE public page, capped and decoded to UTF-8. Extraction happens in the browser (DOMParser + Readability).
// No URL is ever put in a query string (so platform request logs only show "/api/fetch-article"); nothing is persisted; no cache.
import http from 'node:http'; import https from 'node:https'; import dns from 'node:dns'; import net from 'node:net';

export const LIMITS = { maxBytes: 3 * 1024 * 1024, totalMs: 9000, maxRedirects: 4, ports: new Set(['', '80', '443']) };
export const UA = 'Mozilla/5.0 (compatible; HearshotFetcher/1.0; +https://hearshot.app/fetcher)';

const BLOCK = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['100::', 64], ['2002::', 16]]) BLOCK.addSubnet(a, p, 'ipv6');
export function isPublicIp(ip) {
  const fam = net.isIP(ip); if (!fam) return false;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); if (m) return isPublicIp(m[1]); // v4-mapped
  return !BLOCK.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}
export class FetchError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export function validateUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new FetchError('bad_url'); }
  if (!/^https?:$/.test(u.protocol)) throw new FetchError('bad_scheme');
  if (u.username || u.password) throw new FetchError('credentials_in_url');
  if (!LIMITS.ports.has(u.port)) throw new FetchError('bad_port');
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !net.isIP(h)) throw new FetchError('blocked_host');
  if (net.isIP(h) && !isPublicIp(h)) throw new FetchError('blocked_ip');
  return u;
}
// Guarded DNS: the connection itself uses the address we validated (defeats DNS rebinding between check and connect).
function guardedLookup(inner) {
  return (hostname, opts, cb) => {
    inner(hostname, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const ok = addrs.filter(a => isPublicIp(a.address)); if (!ok.length || ok.length !== addrs.length) return cb(new FetchError('blocked_ip', 'host resolves to a non-public address'));
      if (opts && opts.all) return cb(null, ok); cb(null, ok[0].address, ok[0].family);
    });
  };
}
function hop(u, { lookup, signal, allowPrivateForTests }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', lookup: allowPrivateForTests ? undefined : guardedLookup(lookup || dns.lookup), signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5', 'Accept-Language': 'en;q=0.9,*;q=0.3', 'Accept-Encoding': 'identity', 'Connection': 'close' } }, resolve);
    req.on('error', reject); req.end();
  });
}
export async function safeFetchHtml(rawUrl, opts = {}) {
  const signal = AbortSignal.timeout(opts.totalMs || LIMITS.totalMs); const val = (r) => (opts.allowLoopbackForTests && new URL(r).hostname === '127.0.0.1') ? new URL(r) : validateUrl(r); let u = val(rawUrl); const chain = [];
  for (let i = 0; i <= LIMITS.maxRedirects; i++) {
    let res; try { res = await hop(u, { ...opts, signal, allowPrivateForTests: !!opts.allowLoopbackForTests && u.hostname === '127.0.0.1' }); } catch (e) { if (e instanceof FetchError) throw e; if (e.name === 'AbortError' || e.code === 'ABORT_ERR') throw new FetchError('timeout'); if (e.code === 'blocked_ip') throw e; throw new FetchError('network', e.code || e.message); }
    const st = res.statusCode;
    if (st >= 300 && st < 400 && res.headers.location) { res.resume(); chain.push(u.href); u = val(new URL(res.headers.location, u).href); continue; } // every hop re-validated
    const ct = String(res.headers['content-type'] || '').toLowerCase();
    if (st >= 400) { res.resume(); throw new FetchError(st === 401 || st === 403 ? 'blocked_by_site' : st === 402 ? 'paywall' : st === 404 ? 'not_found' : st === 429 ? 'site_rate_limited' : 'site_error', String(st)); }
    if (/application\/pdf/.test(ct)) { res.resume(); return { kind: 'pdf', finalUrl: u.href }; }
    if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(ct)) { res.resume(); throw new FetchError('unsupported_type', ct.split(';')[0]); }
    const cl = +res.headers['content-length']; if (cl > LIMITS.maxBytes) { res.resume(); throw new FetchError('too_large'); }
    const chunks = []; let n = 0;
    try { for await (const c of res) { n += c.length; if (n > LIMITS.maxBytes) { res.destroy(); throw new FetchError('too_large'); } chunks.push(c); } } catch (e) { if (e instanceof FetchError) throw e; throw new FetchError(signal.aborted ? 'timeout' : 'network', e.code || e.message); }
    const buf = Buffer.concat(chunks);
    let cs = /charset=([\w-]+)/i.exec(ct)?.[1] || new RegExp('<meta[^>]+charset=["\']?([\\w-]+)', 'i').exec(buf.subarray(0, 4096).toString('latin1'))?.[1] || 'utf-8';
    let html; try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
    return { kind: 'html', finalUrl: u.href, status: st, bytes: n, redirects: chain.length, html };
  }
  throw new FetchError('too_many_redirects');
}
// ---- Vercel handler (Node runtime). Auth = owner access code (HMAC compare) + Origin check; see report for real strength. ----
export default async function handler(req, res) {
  const origin = req.headers.origin; const allowed = new Set(['https://hearshot.app', 'https://www.hearshot.app']);
  if (origin && allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-access-code'); res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (!origin || !allowed.has(origin)) return res.status(403).json({ error: 'origin' });
  const code = req.headers['x-access-code']; if (process.env.ACCESS_CODE && !(typeof code === 'string' && code.length === process.env.ACCESS_CODE.length && (await import('node:crypto')).timingSafeEqual(Buffer.from(code), Buffer.from(process.env.ACCESS_CODE)))) return res.status(401).json({ error: 'access_code' });
  const url = req.body && req.body.url; // never from query string
  const t0 = Date.now();
  try { const r = await safeFetchHtml(url); console.log(JSON.stringify({ host: new URL(r.finalUrl).hostname, ok: 1, bytes: r.bytes || 0, ms: Date.now() - t0 })); return res.status(200).json(r); }
  catch (e) { const code = e.code || 'error'; console.log(JSON.stringify({ host: (() => { try { return new URL(url).hostname; } catch { return '?'; } })(), ok: 0, code, ms: Date.now() - t0 })); return res.status(code === 'bad_url' || code === 'bad_scheme' || code === 'blocked_host' || code === 'blocked_ip' || code === 'bad_port' ? 400 : 502).json({ error: code }); }
}
