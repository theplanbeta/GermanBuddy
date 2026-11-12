/* Hearshot service worker prototype: precache + own COOP/COEP + update-on-consent. Placeholders are injected by build.js. */
const VERSION = 'v2';
const PRECACHE = ["./","./index.html","./app.v2.js","./worker.v2.js","./lazy.v2.js"];                 // ['./', './index.html', './app.<hash>.js', ...]
const SHELL = 'shell-' + VERSION;
const KEEP = 2;                                // current + previous shell cache stay (old tabs still find their lazy chunks)

self.addEventListener('install', (e) => {
  // NOTE: no skipWaiting() here: the page asks for it when the user accepts the update.
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const shells = (await caches.keys()).filter((k) => k.startsWith('shell-')).sort(); // only OUR caches; never touch model caches
    // keep newest KEEP by install time: names embed VERSION so sort order is by version string in this prototype
    const stale = shells.filter((k) => k !== SHELL).slice(0, Math.max(0, shells.length - KEEP));
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

// Same-origin responses get the isolation headers here, so it works on GitHub Pages (no headers) and on Vercel (headers already there).
function isolate(res) {
  if (!res || res.status === 0) return res;               // opaque: cannot be modified
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// current version's cache FIRST (caches.match() alone walks caches oldest-first and would serve the OLD index.html: found by the test),
// then any older shell cache (so a tab still running old code can fetch its old lazy chunks).
async function fromShell(req, ignoreSearch) {
  const cur = await (await caches.open(SHELL)).match(req, { ignoreSearch });
  return cur || caches.match(req, { ignoreSearch });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;             // Hugging Face etc: let the browser do it (CORS fetches satisfy COEP)
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  e.respondWith((async () => {
    if (req.mode === 'navigate') {
      // cache-first app shell: HTML always matches the precached assets of the same version
      const hit = await fromShell('./index.html', true);
      if (hit) return isolate(hit);
      return isolate(await fetch(req));
    }
    const hit = await fromShell(req, false);
    if (hit) return isolate(hit);
    return isolate(await fetch(req));                      // unknown file: network (e.g. not precached)
  })());
});
