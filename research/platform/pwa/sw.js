// share-target + shell prototype (the update/isolation logic is in ../sw/sw.template.js; here only what is new)
const SHARE_CACHE = 'incoming-shares';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const fd = await e.request.formData();                      // buffers the whole upload: fine for PDFs/photos, not for GB
      const id = crypto.randomUUID();
      const meta = { id, title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', files: [] };
      const cache = await caches.open(SHARE_CACHE);
      for (const f of fd.getAll('files')) {                        // park the files where the page can read them
        if (!(f instanceof File)) continue;
        meta.files.push({ name: f.name, type: f.type, size: f.size });
        await cache.put(`/__share/${id}/${encodeURIComponent(f.name)}`, new Response(f, { headers: { 'content-type': f.type, 'x-name': encodeURIComponent(f.name) } }));
      }
      await cache.put(`/__share/${id}/meta.json`, Response.json(meta));
      return Response.redirect(new URL(`./?share=${id}`, u).href, 303);  // 303 so a reload does not re-POST
    })());
  }
});
