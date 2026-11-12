// Runs Readability + Defuddle inside headless Chromium using the browser's own DOMParser. HTML is passed as data only.
const { chromium } = require('playwright');
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const root = path.resolve('..');
(async () => {
  const gt = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json'));
  const ids = Object.keys(gt).slice(0, 60);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, javaScriptEnabled: true });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: fs.readFileSync('node_modules/@mozilla/readability/Readability.js', 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync('node_modules/defuddle/dist/index.js', 'utf8') });
  const cdp = await ctx.newCDPSession(page);
  const results = {};
  for (const throttle of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const res = { readability: [], defuddle: [], parse: [] };
    for (const id of ids) {
      const html = zlib.gunzipSync(fs.readFileSync(`${root}/corpora/article-extraction-benchmark/html/${id}.html.gz`)).toString('utf8');
      const r = await page.evaluate(async ({ html, url }) => {
        const out = {};
        let t = performance.now();
        const doc = new DOMParser().parseFromString(html, 'text/html'); out.parse = performance.now() - t;
        const base = doc.createElement('base'); base.href = url; doc.head && doc.head.appendChild(base);
        t = performance.now();
        try { const a = new Readability(doc.cloneNode(true)).parse(); out.readability = performance.now() - t; out.rText = a ? (a.textContent || '').replace(/\s+/g, ' ').trim() : ''; } catch (e) { out.rErr = String(e); }
        t = performance.now();
        try { const d = new Defuddle(doc.cloneNode(true), { url }); const b = d.parse(); out.defuddle = performance.now() - t; const tmp = new DOMParser().parseFromString('<body>' + b.content + '</body>', 'text/html'); out.dText = (tmp.body.textContent || '').replace(/\s+/g, ' ').trim(); out.dTitle = b.title; } catch (e) { out.dErr = String(e); }
        return out;
      }, { html, url: gt[id].url });
      results[id + '@' + throttle] = r;
      if (r.rErr || r.dErr) console.error(id, r.rErr, r.dErr);
      res.parse.push(r.parse); if (r.readability) res.readability.push(r.readability); if (r.defuddle) res.defuddle.push(r.defuddle);
    }
    const med = a => a.sort((x, y) => x - y)[a.length >> 1].toFixed(1);
    console.log(`CPU throttle x${throttle}: n=${ids.length} median ms  DOMParser=${med(res.parse)}  Readability=${med(res.readability)}  Defuddle=${med(res.defuddle)}  (errors R=${ids.length - res.readability.length} D=${ids.length - res.defuddle.length})`);
  }
  fs.writeFileSync(root + '/out/browser_results.json', JSON.stringify(results));
  await browser.close();
})();
