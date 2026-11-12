const {chromium}=require('playwright'),fs=require('fs'),cp=require('child_process');
const base='http://localhost:8110/bench.html';
(async()=>{
 const b=await chromium.launch();const p=await b.newPage();p.on('pageerror',e=>console.log('E',e.message));p.on('console',m=>{if(m.type()==='error')console.log('C',m.text())});
 await p.goto(base);await p.waitForFunction(()=>window.ready);
 const caps=await p.evaluate(async()=>{const o={};for(const c of ['opus','aac','mp3','flac','vorbis'])o[c]=await MB.canEncodeAudio(c,{bitrate:32000,numberOfChannels:1,sampleRate:24000});return o});
 console.log('native encoders via mediabunny canEncodeAudio:',JSON.stringify(caps));
 await p.evaluate(()=>{registerAacEncoder();registerMp3Encoder()});
 console.log('after registering wasm encoders:',JSON.stringify(await p.evaluate(async()=>{const o={};for(const c of ['opus','aac','mp3'])o[c]=await MB.canEncodeAudio(c,{bitrate:32000,numberOfChannels:1,sampleRate:24000});return o})));
 await p.evaluate(async()=>{const ab=await (await fetch('speech6min.wav')).arrayBuffer();const i16=new Int16Array(ab,44);const f=new Float32Array(i16.length);for(let i=0;i<f.length;i++)f[i]=i16[i]/32768;window.pcm=f});
 const variants=[
  ['opus-ogg',16,'ogg'],['opus-ogg',24,'ogg'],['opus-ogg',32,'ogg'],['opus-ogg',48,'ogg'],['opus-webm',32,'webm'],
  ['aac-m4a',24,'mp4'],['aac-m4a',32,'mp4'],['aac-m4a',48,'mp4'],['aac-m4a',64,'mp4'],['aac-fmp4',32,'fmp4'],
  ['mp3-lame',32,'mp3'],['mp3-lame',48,'mp3'],['mp3-lame',64,'mp3'],['lamejs-js',48,'mp3']];
 const rows=[];
 for(const [name,kbps,fmt] of variants){
  const r=await p.evaluate(async([name,kbps,fmt])=>{
   const pcm=window.pcm,sr=24000,dur=pcm.length/sr;const t0=performance.now();
   let bytes;
   if(name==='lamejs-js'){const enc=new lamejs.Mp3Encoder(1,sr,kbps);const i16=new Int16Array(pcm.length);for(let i=0;i<pcm.length;i++)i16[i]=Math.max(-32768,Math.min(32767,pcm[i]*32768));const parts=[];for(let i=0;i<i16.length;i+=1152*10){const o=enc.encodeBuffer(i16.subarray(i,i+1152*10));if(o.length)parts.push(new Uint8Array(o))}parts.push(new Uint8Array(enc.flush()));bytes=new Blob(parts)}
   else{
    const codec=name.startsWith('opus')?'opus':name.startsWith('aac')?'aac':'mp3';
    const format=fmt==='ogg'?new MB.OggOutputFormat():fmt==='webm'?new MB.WebMOutputFormat():fmt==='mp4'?new MB.Mp4OutputFormat({fastStart:'in-memory'}):fmt==='fmp4'?new MB.Mp4OutputFormat({fastStart:'fragmented'}):new MB.Mp3OutputFormat();
    const target=new MB.BufferTarget();const out=new MB.Output({format,target});
    const src=new MB.AudioSampleSource({codec,bitrate:kbps*1000});out.addAudioTrack(src);
    out.setMetadataTags({title:'Test reading',artist:'Hearshot'});
    await out.start();
    const CH=24000*30; // feed in 30 s "chunks" as the TTS would deliver them
    for(let i=0;i<pcm.length;i+=CH){const d=pcm.slice(i,i+CH);const s=new MB.AudioSample({data:d,format:'f32',numberOfChannels:1,sampleRate:sr,timestamp:i/sr});await src.add(s);s.close()}
    await out.finalize();bytes=new Blob([target.buffer]);
   }
   const ms=performance.now()-t0;const ab=new Uint8Array(await bytes.arrayBuffer());
   return {ms,size:ab.length,dur,b64:btoa(String.fromCharCode.apply(null,ab.subarray(0,0))),arr:Array.from(ab)};
  },[name,kbps,fmt]);
  const ext={ogg:'ogg',webm:'webm',mp4:'m4a',fmp4:'fmp4.m4a',mp3:'mp3'}[fmt];const fn=`out/${name}-${kbps}.${ext}`;fs.writeFileSync(fn,Buffer.from(r.arr));
  const row={route:name,kbps,fmt,bytes:r.size,effKbps:+(r.size*8/r.dur/1000).toFixed(1),encodeSec:+(r.ms/1000).toFixed(2),xRealtime:+(r.dur/(r.ms/1000)).toFixed(1),MBperMin:+(r.size/1e6/(r.dur/60)).toFixed(3)};
  rows.push(row);console.log(JSON.stringify(row));
 }
 fs.writeFileSync('bench-results.json',JSON.stringify(rows,null,1));await b.close();process.exit(0);
})();
