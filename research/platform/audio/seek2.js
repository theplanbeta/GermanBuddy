const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const p=await b.newPage();p.on('pageerror',e=>console.log('E',e.message));
 await p.goto('http://localhost:8110/bench.html');
 for(const f of fs.readdirSync('web/gen').sort()){
  const res=await p.evaluate(async(url)=>{
   const ctx=new AudioContext();await ctx.resume();const out={seeks:[]};
   for(const T of [0.2,37.3,123.3,200.3,301.3,359.2]){
     const a=new Audio();a.preload='auto';a.src=url;const srcn=ctx.createMediaElementSource(a);const an=ctx.createAnalyser();an.fftSize=16384;srcn.connect(an);an.connect(ctx.destination);
     await new Promise((r,j)=>{a.onloadedmetadata=r;a.onerror=()=>j(a.error.message)});out.duration=a.duration;
     const t0=performance.now();a.currentTime=T;await new Promise(r=>a.addEventListener('seeked',r,{once:true}));const seekMs=performance.now()-t0;
     await a.play();await new Promise(r=>setTimeout(r,350));
     const buf=new Float32Array(an.frequencyBinCount);an.getFloatFrequencyData(buf);let m=-1e9,mi=0;for(let i=5;i<buf.length;i++)if(buf[i]>m){m=buf[i];mi=i}
     const f=mi*ctx.sampleRate/an.fftSize;const ct=a.currentTime;a.pause();srcn.disconnect();const idx=Math.round((f-400)/40);
     out.seeks.push({T,ct:+ct.toFixed(2),idx,exp:Math.floor(T+0.1)%50,ok:idx===Math.floor(T+0.1)%50||idx===Math.floor(T+0.3)%50,seekMs:Math.round(seekMs)});
   }
   return out},'http://localhost:8110/gen/'+f).catch(e=>({err:String(e)}));
  console.log(f.padEnd(18),res.err||('dur '+res.duration+''+' | '+res.seeks.map(s=>(s.ok?'ok':'MISS(idx '+s.idx+' vs '+s.exp+')')+' '+s.seekMs+'ms').join(' ; ')));
 }
 await b.close();process.exit(0)})();
