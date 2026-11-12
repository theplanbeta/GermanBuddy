// Renders each synthetic document in headless Chromium, extracts exact ground truth from the DOM
// (before pagination), paginates with Paged.js where used, and prints to PDF.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { builders } = require('./docs.cjs');
const OUT = path.join(__dirname, '../../corpus/synth');
fs.mkdirSync(OUT, { recursive: true });
const PAGED = fs.readFileSync(path.join(__dirname, '../../node_modules/pagedjs/dist/paged.polyfill.js'));
const only = process.argv[2];
function extractGT() {
  const segs = []; const byEl = new Map();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let prevParent = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement.closest('[data-gt]'); if (!el) continue;
    const t = n.nodeValue.replace(/­/g, ''); if (!t.trim() && !/\s/.test(t)) continue;
    let rec = byEl.get(el);
    if (!rec) { rec = { type: el.dataset.gt, level: el.dataset.level ? +el.dataset.level : undefined, text: '' }; byEl.set(el, rec); segs.push(rec); }
    const p = n.parentElement;
    const isBlockish = (e) => { if (!e || e === el) return false; if (e.classList.contains('drop')) return false; const d = getComputedStyle(e).display; return e.namespaceURI.includes('svg') || d === 'block' || d === 'list-item' || d === 'table-cell' || d === 'flex'; };
    let sep = '';
    if (rec.text && prevParent && prevParent !== p && (isBlockish(p) || isBlockish(prevParent) || p.tagName === 'text' || p.tagName === 'td' || p.tagName === 'th')) sep = ' ';
    if (rec.text && p.previousSibling && p.previousSibling.nodeName === 'BR') sep = ' ';
    if (n.previousSibling && n.previousSibling.nodeName === 'BR') sep = ' ';
    rec.text += sep + t; prevParent = p;
  }
  return segs.map(s => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter(s => s.text);
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const b of builders) {
    const spec = b();
    if (only && spec.id !== only) continue;
    const page = await browser.newPage();
    await page.route('http://synth.local/**', (r) => { const u = new URL(r.request().url()); if (u.pathname.startsWith('/pagedjs/')) return r.fulfill({ body: PAGED, contentType: 'text/javascript' }); return r.fulfill({ body: spec.html, contentType: 'text/html' }); });
    page.on('pageerror', e => console.log(spec.id, 'pageerror', e.message));
    await page.goto('http://synth.local/doc.html');
    await page.evaluate(() => document.fonts.ready);
    const segs = await page.evaluate(extractGT);
    if (spec.paged) { await page.evaluate(async () => { await window.PagedPolyfill.preview(); }); }
    const pdfPath = path.join(OUT, spec.id + '.pdf');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, ...(spec.pdf || {}) });
    fs.writeFileSync(path.join(OUT, spec.id + '.html'), spec.html);
    const gt = { id: spec.id, kind: spec.kind, title: spec.title, source: 'synthetic (HTML printed by headless Chromium' + (spec.paged ? ' + Paged.js 0.4.3)' : ')'), segments: segs, chrome: spec.chrome };
    fs.writeFileSync(path.join(OUT, spec.id + '.gt.json'), JSON.stringify(gt, null, 1));
    const counts = {}; segs.forEach(s => counts[s.type] = (counts[s.type] || 0) + s.text.split(' ').length);
    console.log(spec.id, 'segments', segs.length, JSON.stringify(counts));
    await page.close();
  }
  await browser.close();
})();
