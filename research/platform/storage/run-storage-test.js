const {chromium}=require('playwright'),fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const ctx=await b.newContext();const p=await ctx.newPage();
 p.on('pageerror',e=>console.log('E',e.message));
 await p.goto('http://localhost:8120/');
 console.log('estimate before:',JSON.stringify(await p.evaluate(()=>navigator.storage.estimate())));
 console.log('persisted():',await p.evaluate(()=>navigator.storage.persisted()),' persist():',await p.evaluate(()=>navigator.storage.persist()));
 // throughput (worker): 256 MB in 256 KB chunks (a 30 s opus chunk is ~100 KB, so also 64 KB)
 for(const [mb,kb] of [[256,256],[64,64]]){
  const r=await p.evaluate(([mb,kb])=>new Promise(res=>{const w=new Worker('worker.js');w.onmessage=e=>res(e.data);w.postMessage({mb,chunkKB:kb})}),[mb,kb]);
  console.log(`--- write ${mb} MB in ${kb} KB chunks, from a dedicated worker`);console.log(JSON.stringify(r,null,1));
 }
 console.log('estimate after:',JSON.stringify(await p.evaluate(()=>navigator.storage.estimate())));
 // SW + Range playback from OPFS
 await p.evaluate(async()=>{await navigator.serviceWorker.register('sw.js',{scope:'/'});await navigator.serviceWorker.ready});
 await p.reload();await sleep(300);
 console.log('controller:',await p.evaluate(()=>!!navigator.serviceWorker.controller));
 for(const f of ['opus-ogg32.ogg','aac-m4a32.m4a','mp3-48.mp3','opus-webm32.webm','aac-fmp4_32.m4a']){
  const bytes=fs.readFileSync('../audio/web/gen/'+f);
  await p.evaluate(async([name,arr])=>{const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('audio',{create:true});const fh=await dir.getFileHandle(name,{create:true});const w=await fh.createWritable();await w.write(new Uint8Array(arr));await w.close()},[f,Array.from(bytes)]);
  const res=await p.evaluate(async(name)=>{
   const ctx=new AudioContext();await ctx.resume();const out={};
   for(const mode of ['sw-range','blob-url-from-opfs-file']){
    const url=mode==='sw-range'?'/lib/'+name:URL.createObjectURL(await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('audio')).getFileHandle(name)).getFile());
    const a=new Audio();a.preload='auto';a.src=url;const sn=ctx.createMediaElementSource(a);const an=ctx.createAnalyser();an.fftSize=16384;sn.connect(an);an.connect(ctx.destination);
    await new Promise((r,j)=>{a.onloadedmetadata=r;a.onerror=()=>j(a.error?.message)});
    const r={dur:+a.duration.toFixed(2),seeks:[]};
    for(const T of [37.3,200.3,359.0]){a.currentTime=T;await new Promise(r=>a.addEventListener('seeked',r,{once:true}));await a.play();await new Promise(r=>setTimeout(r,350));
      const buf=new Float32Array(an.frequencyBinCount);an.getFloatFrequencyData(buf);let m=-1e9,mi=0;for(let i=5;i<buf.length;i++)if(buf[i]>m){m=buf[i];mi=i}
      const idx=Math.round((mi*ctx.sampleRate/an.fftSize-400)/40);a.pause();r.seeks.push(idx===Math.floor(T+0.1)%50||idx===Math.floor(T+0.3)%50?'ok':'MISS')}
    out[mode]=r;sn.disconnect()}
   return out},f);
  const log=await p.evaluate(()=>new Promise(r=>{navigator.serviceWorker.onmessage=e=>r(e.data.log);navigator.serviceWorker.controller.postMessage('getlog')}));
  console.log(f.padEnd(18),JSON.stringify(res),'| SW saw',log.length,'requests, ranges:',[...new Set(log.map(l=>l.range))].slice(0,6).join(' '));
 }
 console.log('estimate end:',JSON.stringify(await p.evaluate(()=>navigator.storage.estimate())));
 await b.close();process.exit(0)})();
