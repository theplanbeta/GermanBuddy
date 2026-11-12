const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const p=await b.newPage();p.on('pageerror',e=>console.log('E',e.message));
 await p.goto('http://localhost:8110/bench.html');await p.waitForFunction(()=>window.ready);await p.evaluate(()=>{registerAacEncoder();registerMp3Encoder()});
 const fmts=[['opus-ogg32','opus','ogg',32],['opus-webm32','opus','webm',32],['aac-m4a32','aac','mp4',32],['aac-fmp4_32','aac','fmp4',32],['mp3-48','mp3','mp3',48]];
 const lenRes={};
 for(const [id,codec,fmt,kbps] of fmts){
  const r=await p.evaluate(async([codec,fmt,kbps])=>{
   const ab=await (await fetch('tones6min.wav')).arrayBuffer();const i16=new Int16Array(ab,44);const pcm=new Float32Array(i16.length);for(let i=0;i<pcm.length;i++)pcm[i]=i16[i]/32768;const sr=24000;
   const mk=()=>fmt==='ogg'?new MB.OggOutputFormat():fmt==='webm'?new MB.WebMOutputFormat():fmt==='mp4'?new MB.Mp4OutputFormat({fastStart:'in-memory'}):fmt==='fmp4'?new MB.Mp4OutputFormat({fastStart:'fragmented'}):new MB.Mp3OutputFormat();
   async function enc(slice,t0){const target=new MB.BufferTarget();const out=new MB.Output({format:mk(),target});const src=new MB.AudioSampleSource({codec,bitrate:kbps*1000});out.addAudioTrack(src);await out.start();
     const s=new MB.AudioSample({data:slice,format:'f32',numberOfChannels:1,sampleRate:sr,timestamp:t0});await src.add(s);s.close();await out.finalize();return target.buffer}
   // (a) one continuous file, chunk by chunk, is the bench; here: whole file for seek test
   const whole=await enc(pcm,0);
   // (b) 12 independent per-chunk files: decode each with WebAudio, sum lengths (gap/overlap per join)
   const ctx=new AudioContext({sampleRate:24000});let total=0;const per=[];
   for(let i=0;i<12;i++){const buf=await enc(pcm.slice(i*sr*30,(i+1)*sr*30),0);const d=await ctx.decodeAudioData(buf.slice(0));per.push(+(d.length/sr).toFixed(4));total+=d.length}
   const wd=await ctx.decodeAudioData(whole.slice(0));
   return {whole:Array.from(new Uint8Array(whole)),perChunkSec:per,sumPerChunk:+(total/sr).toFixed(4),wholeDecodedSec:+(wd.length/sr).toFixed(4)};
  },[codec,fmt,kbps]);
  const ext={ogg:'ogg',webm:'webm',mp4:'m4a',fmp4:'m4a',mp3:'mp3'}[fmt];fs.writeFileSync(`web/gen/${id}.${ext}`,Buffer.from(r.whole));
  lenRes[id]={perChunkFirst3:r.perChunkSec.slice(0,3),sumOf12ChunkFiles:r.sumPerChunk,singleFileDecoded:r.wholeDecodedSec,joinErrorMsPerJoin:+((r.sumPerChunk-360)/11*1000).toFixed(1)};
  console.log(id,JSON.stringify(lenRes[id]));
 }
 console.log('--- seek accuracy (tone-per-second signal; expected = floor(target)%50) via <audio src=http URL with Range>');
 const files=fs.readdirSync('web/gen');
 for(const f of files){
  const res=await p.evaluate(async(url)=>{
   const a=new Audio();a.preload='auto';a.src=url;const ctx=new AudioContext();const srcn=ctx.createMediaElementSource(a);const an=ctx.createAnalyser();an.fftSize=16384;srcn.connect(an);an.connect(ctx.destination);
   await new Promise((r,j)=>{a.onloadedmetadata=r;a.onerror=()=>j(a.error.message)});await ctx.resume();
   const out={duration:+a.duration.toFixed(3),seeks:[]};const buf=new Float32Array(an.frequencyBinCount);
   const peak=()=>{an.getFloatFrequencyData(buf);let m=-1e9,mi=0;for(let i=5;i<buf.length;i++)if(buf[i]>m){m=buf[i];mi=i}return mi*ctx.sampleRate/an.fftSize};
   for(const T of [0.2,37.3,123.3,200.3,301.3,359.2]){
     const t0=performance.now();a.currentTime=T;await new Promise(r=>a.addEventListener('seeked',r,{once:true}));const seekMs=performance.now()-t0;
     await a.play();await new Promise(r=>setTimeout(r,120));
     const f1=peak();a.pause();const idx=Math.round((f1-400)/40);
     out.seeks.push({T,detSec:idx,expect:Math.floor(T)%50,ok:idx===Math.floor(T)%50,seekMs:Math.round(seekMs)});
   }
   // sample-accurate-ish position check
   return out},'http://localhost:8110/gen/'+f);
  console.log(f.padEnd(18),'dur',res.duration,res.seeks.map(s=>s.ok?'ok('+s.seekMs+'ms)':'MISS det='+s.detSec+' exp='+s.expect).join(' '));
 }
 fs.writeFileSync('seek-gapless-results.json',JSON.stringify(lenRes,null,1));await b.close();process.exit(0)})();
