// Headless Chromium test of the real worker + test page (COOP/COEP, no external requests).
const { chromium } = require('playwright');
(async () => {
  const files = process.argv.slice(2);
  const fs0 = require('fs'); const preexisting = new Set(fs0.readdirSync('/proc').filter(x => /^\d+$/.test(x)));
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
  const ctx = await browser.newContext();
  const external = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (!u.startsWith('http://localhost')) { external.push(u); return r.abort(); } return r.continue(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  await page.goto('http://localhost:5190/index.html');
  await page.waitForFunction(() => window.hearshotReady);
  console.log('crossOriginIsolated', await page.evaluate(() => crossOriginIsolated));
  const fs = require('fs');
  const rssOf = () => { // sum RSS of renderer processes (the page and its workers live there)
    let sum = 0; for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x) && !preexisting.has(x))) { try { const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (!cmd.includes('--type=renderer')) continue; const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); if (m) sum += +m[1]; } catch {} } return sum / 1024; };
  for (const f of files) {
    const base = rssOf(); let peak = base; const iv = setInterval(() => { peak = Math.max(peak, rssOf()); }, 100);
    const t0 = Date.now();
    const r = await page.evaluate(async (f) => {
      const res = await window.hearshot.openUrl(f, { headless: true, batchSize: 8 });
      let mem = null; try { if (performance.measureUserAgentSpecificMemory) mem = (await performance.measureUserAgentSpecificMemory()).bytes; } catch (e) { mem = 'n/a ' + e.message; }
      const enc = new TextEncoder().encode(window.hearshot.state.blocks.map(b => b.type + '|' + b.text).join('\n'));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc))].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
      const types = {}; for (const b of window.hearshot.state.blocks) types[b.type] = (types[b.type] || 0) + 1;
      const preview = window.hearshot.listeningItems(window.hearshot.state.blocks).slice(0, 4).map(i => i.text.slice(0, 120));
      return { res: { ...res, events: undefined }, events: res.events, mem, types, preview, hash };
    }, f);
    clearInterval(iv); console.log(`renderer RSS before ${base.toFixed(0)} MB, peak during parse ${peak.toFixed(0)} MB, after ${rssOf().toFixed(0)} MB`);
    const m = await cdp.send('Performance.getMetrics'); const heap = m.metrics.find(x => x.name === 'JSHeapUsedSize').value;
    const ev = r.events || []; const pages = ev.filter(e => e.type === 'page');
    const per = pages.map(e => (e.ms?.liteparse || 0) + (e.ms?.layer || 0)).sort((a, b) => a - b);
    const layer = pages.map(e => e.ms?.layer || 0).sort((a, b) => a - b);
    console.log(`\n== ${f}  wall ${Date.now() - t0} ms`);
    if (pages.length) console.log(`pages ${pages.length}; worker 'open' at ${ev.find(e => e.type === 'open')?.t.toFixed(0)} ms; first page at ${pages[0].t.toFixed(0)} ms; done at ${ev.find(e => e.type === 'done')?.t.toFixed(0)} ms; per page (LP+layer) median ${per[per.length >> 1].toFixed(1)} p95 ${per[Math.floor(per.length * 0.95)].toFixed(1)} max ${per[per.length - 1].toFixed(1)}; layer median ${layer[layer.length >> 1].toFixed(1)} ms`);
    console.log('warnings', JSON.stringify(pages.flatMap(p => p.warnings || []).reduce((a, w) => (a[w] = (a[w] || 0) + 1, a), {})));
    console.log('memory (measureUserAgentSpecificMemory bytes)', r.mem, '| main JS heap', (heap / 1048576).toFixed(1), 'MB');
    console.log('blocks hash', r.hash, 'types', JSON.stringify(r.types)); r.preview.forEach(p => console.log('  >', p));
  }
  console.log('\nexternal requests', external.length, external.slice(0, 3));
  await browser.close();
})();
