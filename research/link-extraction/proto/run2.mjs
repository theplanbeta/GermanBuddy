// usage: node run.mjs <extractor> <corpus: aeb|rdb> ; writes ../out/<corpus>/<extractor>.json
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { X } from './extractors2.mjs';
const [name, corpus] = process.argv.slice(2);
const root = path.resolve('..');
let items = [];
if (corpus === 'wceb') {
  for (const m of JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json'))) items.push({ id: m.id, url: m.url, html: fs.readFileSync(root + '/' + m.path, 'utf8') });
} else if (corpus === 'aeb') {
  const gt = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json'));
  for (const [id, v] of Object.entries(gt)) {
    const html = zlib.gunzipSync(fs.readFileSync(`${root}/corpora/article-extraction-benchmark/html/${id}.html.gz`)).toString('utf8');
    items.push({ id, url: v.url, html });
  }
} else {
  const d = root + '/corpora/readability/test/test-pages';
  for (const id of fs.readdirSync(d)) {
    const html = fs.readFileSync(`${d}/${id}/source.html`, 'utf8');
    items.push({ id, url: 'http://fakehost/test/page.html', html });
  }
}
const out = {}; const fn = X[name];
const origLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
for (const it of items) {
  const t0 = process.hrtime.bigint();
  let r;
  try { r = await Promise.race([fn(it.html, it.url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]); }
  catch (e) { r = { text: '', error: String(e.message || e).slice(0, 200) }; }
  r.ms = Number(process.hrtime.bigint() - t0) / 1e6; r.htmlBytes = it.html.length;
  out[it.id] = r;
}
fs.mkdirSync(`${root}/out/${corpus}`, { recursive: true });
fs.writeFileSync(`${root}/out/${corpus}/${name}.json`, JSON.stringify(out));
const errs = Object.values(out).filter(o => o.error).length;
origLog(name, corpus, 'done', items.length, 'errors', errs, 'median ms', Object.values(out).map(o=>o.ms).sort((a,b)=>a-b)[items.length>>1].toFixed(1));
