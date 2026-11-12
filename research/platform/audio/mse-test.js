const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const p=await b.newPage();p.on('pageerror',e=>console.log('E',e.message));
 await p.goto('http://localhost:8110/bench.html');await p.waitForFunction(()=>window.ready);await p.evaluate(()=>{registerAacEncoder();registerMp3Encoder()});
 const cases=[['mp3','mp3','mp3','audio/mpeg',48],['fmp4-aac','aac','fmp4','audio/mp4;codecs=mp4a.40.2',32]];
 for(const [id,codec,fmt,mime,kbps] of cases){
  const r=await p.evaluate(async([codec,fmt,mime,kbps])=>{
   const ab=await (await fetch('tones6min.wav')).arrayBuffer();const i16=new Int16Array(ab,44);const pcm=new Float32Array(i16.length);for(let i=0;i<pcm.length;i++)pcm[i]=i16[i]/32768;const sr=24000;
   const mk=()=>fmt==='webm'?new MB.WebMOutputFormat():fmt==='fmp4'?new MB.Mp4OutputFormat({fastStart:'fragmented'}):new MB.Mp3OutputFormat();
   async function enc(slice){const target=new MB.BufferTarget();const out=new MB.Output({format:mk(),target});const src=new MB.AudioSampleSource({codec,bitrate:kbps*1000});out.addAudioTrack(src);await out.start();const s=new MB.AudioSample({data:slice,format:'f32',numberOfChannels:1,sampleRate:sr,timestamp:0});await src.add(s);s.close();await out.finalize();return target.buffer}
   const chunks=[];for(let i=0;i<12;i++)chunks.push(await enc(pcm.slice(i*sr*30,(i+1)*sr*30)));
   const res={supported:MediaSource.isTypeSupported(mime)};if(!res.supported)return res;
   const results={};
   for(const mode of (fmt==='mp3'?['sequence']:['segments+offset','sequence'])){
    const ms=new MediaSource();const a=new Audio();a.src=URL.createObjectURL(ms);await new Promise(r=>ms.addEventListener('sourceopen',r,{once:true}));
    const sb=ms.addSourceBuffer(mime);sb.mode=mode==='sequence'?'sequence':'segments';
    for(let i=0;i<12;i++){if(mode!=='sequence')sb.timestampOffset=i*30;sb.appendBuffer(chunks[i]);await new Promise(r=>sb.addEventListener('updateend',r,{once:true}))}
    const ranges=[];for(let i=0;i<sb.buffered.length;i++)ranges.push([+sb.buffered.start(i).toFixed(3),+sb.buffered.end(i).toFixed(3)]);
    results[mode]={ranges:ranges.length>4?ranges.slice(0,4).concat(['…',ranges.length+' ranges']):ranges};
    ms.endOfStream();
   }
   res.results=results;return res},[codec,fmt,mime,kbps]);
  console.log(id,JSON.stringify(r));
 }
 // MediaRecorder: realtime-only
 const mr=await p.evaluate(async()=>{const ctx=new AudioContext({sampleRate:24000});const buf=ctx.createBuffer(1,24000*8,24000);const d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(i*0.05);const dest=ctx.createMediaStreamDestination();const s=ctx.createBufferSource();s.buffer=buf;s.connect(dest);const rec=new MediaRecorder(dest.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:32000});const parts=[];rec.ondataavailable=e=>parts.push(e.data);const t0=performance.now();rec.start();s.start();await new Promise(r=>s.onended=r);rec.stop();await new Promise(r=>rec.onstop=r);return {audioSec:8,wallSec:+((performance.now()-t0)/1000).toFixed(2),bytes:new Blob(parts).size}});
 console.log('MediaRecorder webm/opus 8 s of audio:',JSON.stringify(mr));
 await b.close();process.exit(0)})();
