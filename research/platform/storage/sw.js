// Serves /lib/<name> from OPFS (dir "audio") with proper Range/206 support, so <audio src="/lib/x.m4a"> streams + seeks from disk.
const log = []; 
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => { if (e.data === 'getlog') e.source.postMessage({ log: log.splice(0) }); });
const TYPES = { m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (!u.pathname.startsWith('/lib/')) return;
  e.respondWith((async () => {
    const name = decodeURIComponent(u.pathname.slice(5));
    let file;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('audio');
      file = await (await dir.getFileHandle(name)).getFile();          // disk-backed File, no full read into memory
    } catch { return new Response('not found', { status: 404 }); }
    const size = file.size, range = e.request.headers.get('range');
    const type = TYPES[name.split('.').pop()] || 'application/octet-stream';
    log.push({ name, range, t: Math.round(performance.now()) });
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cross-Origin-Resource-Policy': 'same-origin' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
    if (!m) return new Response(file, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
    let a = m[1] === '' ? Math.max(0, size - +m[2]) : +m[1];
    let b = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
    if (a >= size) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    return new Response(file.slice(a, b + 1), { status: 206, headers: { ...base, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
  })());
});
