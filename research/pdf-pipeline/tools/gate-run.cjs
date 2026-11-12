// Runs the gate page in headless Chromium; blocks and reports any non-localhost request.
const { chromium } = require('playwright');
(async () => {
  const file = process.argv[2] || '/corpus/real/freeculture.pdf';
  const batch = +(process.argv[3] || 1);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const external = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (!u.startsWith('http://localhost')) { external.push(u); return r.abort(); } return r.continue(); });
  page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
  page.on('pageerror', e => console.log('pageerror', e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://localhost:5190/gate.html');
  await page.waitForFunction(() => window.gateReady);
  console.log('crossOriginIsolated', await page.evaluate(() => crossOriginIsolated));
  // sample process memory while it runs
  let peakRss = 0; const proc = browser.process ? null : null;
  const poll = setInterval(async () => { try { const m = await cdp.send('SystemInfo.getProcessInfo'); } catch {} }, 1000);
  const t0 = Date.now();
  const ev = await page.evaluate(({ file, batch }) => window.runGate(file, { batchSize: batch, verbose: false }), { file, batch });
  clearInterval(poll);
  for (const e of ev) console.log(JSON.stringify(e));
  console.log('wall ms', Date.now() - t0, 'external requests', external.length, external.slice(0, 5));
  await browser.close();
})();
