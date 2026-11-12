const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json'};
function serve(dirRef,port,hdr){const s=http.createServer((q,r)=>{let u=q.url.split('?')[0];if(u.endsWith('/'))u+='index.html';const f=path.join(dirRef.dir,u);
 if(!fs.existsSync(f)){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':mime[path.extname(f)]||'text/plain','Cache-Control':'no-cache',...hdr});fs.createReadStream(f).pipe(r)});
 return new Promise(res=>s.listen(port,()=>res(s)))}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mode=process.argv[2]||'ghpages'; // 'ghpages' = no headers from server; 'vercel' = server also sends COOP/COEP
(async()=>{
 const dir={dir:path.join(__dirname,'dist1')};
 const hdr=mode==='vercel'?{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}:{};
 let s1=await serve(dir,8101,hdr);const s2=await serve({dir:path.join(__dirname,'dist1')},8102,{'Access-Control-Allow-Origin':'*'});
 const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();p.on('console',m=>console.log('  [console]',m.text()));p.on('pageerror',e=>console.log('  [pageerror]',e.message));
 const R=[];const note=(k,v)=>{R.push([k,v]);console.log(k.padEnd(52),typeof v==='string'?v:JSON.stringify(v))};
 const st=()=>p.evaluate(()=>window.__state);
 // 1 first visit
 const first=p.waitForResponse(r=>r.url()==='http://localhost:8101/');await p.goto('http://localhost:8101/');note('1a FIRST document response had COOP/COEP headers',await first.then(r=>r.headers()['cross-origin-embedder-policy']||'no'));
 
 await p.waitForFunction(()=>window.__state&&window.__state.worker,null,{timeout:10000}).catch(()=>{});
 let s=await st();note('1b after auto-reload',{iso:s.crossOriginIsolated,ctl:s.controlled,worker:s.worker,sab:s.sabCount,sharedWasm:s.sharedWasmMemory,caches:s.caches});
 // cross-origin behaviour
 note('1c cross-origin CORS fetch (like Hugging Face)',await p.evaluate(()=>xorigin('http://localhost:8102/app.v1.js')));
 note('1d cross-origin <img> no-cors, no CORP',await p.evaluate(()=>xImg('http://localhost:8102/app.v1.js')));
 // model-ish cache entry (cross-origin cors response stored in Cache API, as the app does)
 await p.evaluate(async()=>{const r=await fetch('http://localhost:8102/app.v1.js',{mode:'cors'});const c=await caches.open('kokoro-voices');await c.put('http://localhost:8102/voice.bin',new Response(await r.arrayBuffer()))});
 // 2 offline
 await s1.close();await s2.close?.();
 await p.reload();await sleep(500);
 s=await st();note('2a OFFLINE reload: iso/ctl/worker',{iso:s.crossOriginIsolated,ctl:s.controlled,worker:s.worker?.iso,ver:s.ver});
 await p.goto('http://localhost:8101/?utm=x&doc=1');await sleep(500);s=await st();note('2b OFFLINE nav with query string',{iso:s.crossOriginIsolated,ver:s.ver});
 note('2c OFFLINE Cache API model entry still readable',await p.evaluate(async()=>{const c=await caches.open('kokoro-voices');const r=await c.match('http://localhost:8102/voice.bin');return r?(await r.arrayBuffer()).byteLength:'missing'}));
 note('2d OFFLINE lazy chunk',await p.evaluate(()=>lazy()));
 // 3 deploy v2, online again
 fs.cpSync(path.join(__dirname,'dist2'),path.join(__dirname,'live2'),{recursive:true});dir.dir=path.join(__dirname,'live2');
 s1=await serve(dir,8101,hdr);
 await p.goto('http://localhost:8101/');await sleep(300);
 await p.waitForFunction(()=>window.__state&&window.__state.updateReady,null,{timeout:8000}).catch(()=>{});
 s=await st();note('3a after deploy: page still shows (cached) + updateReady',{shows:s.ver,updateReady:!!s.updateReady,iso:s.crossOriginIsolated});
 // mid-session: this tab runs v1 code; activate v2 now, then the old tab lazy-loads its v1 chunk
 const old=await p.evaluate(()=>window.__reg.waiting?'waiting':'none');note('3b registration.waiting',old);
 await p.evaluate(()=>{window.__reg.waiting.postMessage('SKIP_WAITING')});
 await p.waitForFunction(()=>navigator.serviceWorker.controller&&true);await sleep(800);
 note('3c OLD tab after v2 activated: lazy v1 chunk',await p.evaluate(()=>lazy().catch(e=>'FAIL '+e.message)));
 note('3d caches after activation',await p.evaluate(()=>caches.keys()));
 await p.reload();await sleep(500);s=await st();note('3e reload now shows',{ver:s.ver,iso:s.crossOriginIsolated,worker:s.worker?.v,caches:s.caches});
 // 4 third deploy -> v1 shell cache must be pruned, model cache kept
 await b.close();await s1.close();console.log('done',mode);process.exit(0);
})();
