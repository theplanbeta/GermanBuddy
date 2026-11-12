// Dedicated worker: OPFS sync access handle append test + comparison with IndexedDB + Cache API
self.onmessage = async (e) => {
  const { mb, chunkKB } = e.data, out = {};
  const chunk = new Uint8Array(chunkKB * 1024); for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 31) & 255;
  const n = Math.round(mb * 1024 / chunkKB);
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('bench', { create: true });
  // 1. OPFS sync access handle, append chunk by chunk, flush at the end (and flush each 8 chunks variant)
  for (const flushEvery of [0, 8]) {
    const fh = await dir.getFileHandle('sah' + flushEvery + '.bin', { create: true });
    const h = await fh.createSyncAccessHandle(); h.truncate(0);
    let pos = 0; const t0 = performance.now();
    for (let i = 0; i < n; i++) { pos += h.write(chunk, { at: pos }); if (flushEvery && i % flushEvery === 0) h.flush(); }
    h.flush(); const ms = performance.now() - t0; h.close();
    out['opfs-syncAccessHandle flush=' + (flushEvery || 'end')] = { ms: Math.round(ms), MBps: +(mb / (ms / 1000)).toFixed(0) };
  }
  // 2. OPFS createWritable (async stream; main-thread-capable)
  { const fh = await dir.getFileHandle('wr.bin', { create: true }); const w = await fh.createWritable(); const t0 = performance.now();
    for (let i = 0; i < n; i++) await w.write(chunk); await w.close(); const ms = performance.now() - t0; out['opfs-createWritable'] = { ms: Math.round(ms), MBps: +(mb / (ms / 1000)).toFixed(0) }; }
  // 3. IndexedDB: one record (Blob) per chunk, in 1 MB records (realistic), single transaction per 8 records
  { const db = await new Promise((res, rej) => { const r = indexedDB.open('bench', 1); r.onupgradeneeded = () => r.result.createObjectStore('c'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction('c', 'readwrite'); tx.objectStore('c').clear(); tx.oncomplete = res; });
    const rec = new Uint8Array(1024 * 1024); const per = n * chunkKB / 1024; const t0 = performance.now();
    for (let i = 0; i < per; i += 8) await new Promise((res, rej) => { const tx = db.transaction('c', 'readwrite'); for (let j = 0; j < 8 && i + j < per; j++) tx.objectStore('c').put(new Blob([rec]), 'k' + (i + j)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const ms = performance.now() - t0; out['indexeddb Blob 1MB records'] = { ms: Math.round(ms), MBps: +(mb / (ms / 1000)).toFixed(0) };
    // read back 100 random records
    const t1 = performance.now(); for (let i = 0; i < 50; i++) { const k = 'k' + Math.floor(Math.random() * per); const b = await new Promise((res) => { const r = db.transaction('c').objectStore('c').get(k); r.onsuccess = () => res(r.result); }); await b.arrayBuffer(); }
    out['indexeddb random read 1MB x50 ms'] = Math.round(performance.now() - t1); db.close(); await indexedDB.deleteDatabase('bench'); }
  // 4. Cache API put of 1 MB Responses
  { await caches.delete('bench'); const c = await caches.open('bench'); const rec = new Uint8Array(1024 * 1024); const per = n * chunkKB / 1024; const t0 = performance.now();
    for (let i = 0; i < per; i++) await c.put('/k' + i, new Response(rec.slice(), { headers: { 'content-type': 'application/octet-stream' } }));
    const ms = performance.now() - t0; out['cache-api put 1MB responses'] = { ms: Math.round(ms), MBps: +(mb / (ms / 1000)).toFixed(0) }; await caches.delete('bench'); }
  // read speed OPFS random 1 MB x50
  { const fh = await dir.getFileHandle('sah0.bin'); const h = await fh.createSyncAccessHandle(); const buf = new Uint8Array(1024 * 1024); const t0 = performance.now(); const sz = h.getSize();
    for (let i = 0; i < 50; i++) h.read(buf, { at: Math.floor(Math.random() * (sz - buf.length)) }); out['opfs random read 1MB x50 ms'] = Math.round(performance.now() - t0); h.close(); }
  await root.removeEntry('bench', { recursive: true });
  postMessage(out);
};
