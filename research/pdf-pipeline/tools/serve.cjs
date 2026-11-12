// Static server with COOP/COEP headers (as the app needs). Serves app/dist at / and corpus at /corpus.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mounts = [['/corpus/', path.join(ROOT, 'corpus')], ['/static/', path.join(ROOT, 'static')], ['/', path.join(ROOT, process.env.DIST || 'app/dist')]];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.json': 'application/json', '.css': 'text/css', '.gz': 'application/gzip', '.traineddata': 'application/octet-stream', '.onnx': 'application/octet-stream', '.png': 'image/png', '.txt': 'text/plain', '.epub': 'application/epub+zip', '.docx': 'application/octet-stream' };
const port = +(process.env.PORT || 5190);
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  for (const [m, dir] of mounts) {
    if (!url.startsWith(m)) continue;
    let f = path.join(dir, url.slice(m.length) || 'index.html');
    if (!f.startsWith(dir)) break;
    try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { continue; }
    if (!fs.existsSync(f)) continue;
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res); return;
  }
  res.writeHead(404); res.end('nf');
}).listen(port, () => console.log('serving on', port));
