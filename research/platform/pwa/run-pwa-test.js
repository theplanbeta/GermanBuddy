const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();p.on('pageerror',e=>console.log('E',e.message));
 await p.goto('http://localhost:8130/');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();
 const cdp=await ctx.newCDPSession(p);
 const m=await cdp.send('Page.getAppManifest');console.log('manifest errors:',JSON.stringify(m.errors),'| parsed share_target present in raw:',/share_target/.test(m.data));
 const inst=await cdp.send('Page.getInstallabilityErrors');console.log('installability errors:',JSON.stringify(inst.installabilityErrors));
 // simulate the Android share POST (multipart, a PDF-ish file + text) as the OS would send to the share_target action
 const res=await p.evaluate(async()=>{const fd=new FormData();fd.append('title','A paper');fd.append('text','see this');fd.append('url','https://example.org/x');fd.append('files',new File([new Uint8Array(3*1024*1024)],'paper (1).pdf',{type:'application/pdf'}));fd.append('files',new File(['hi'],'note.txt',{type:'text/plain'}));
   const r=await fetch('./share-target',{method:'POST',body:fd});return {finalUrl:r.url,redirected:r.redirected,status:r.status}});
 console.log('POST share-target ->',JSON.stringify(res));
 await p.goto(res.finalUrl);await p.waitForFunction(()=>window.__share);console.log('page received:',JSON.stringify(await p.evaluate(()=>window.__share)));
 console.log("'launchQueue' in window (headless desktop chromium):",await p.evaluate(()=>'launchQueue' in window));
 await b.close();process.exit(0)})();
