import { synthText, writeWav, voicePack } from "./lib.mjs";
import fs from "node:fs";
const s = "I honestly can't believe you did that. Where did you put the keys? We have to leave right now!";
const voices = fs.readdirSync("node_modules/kokoro-js/voices").map(f=>f.replace(".bin","")).filter(v=>/^[ab][fm]_/.test(v));
for (const v of voices) { const r = await synthText(s, { voice: v }); writeWav(`work/survey/${v}.wav`, r.audio); }
// style-vector statistics: norms of each half, distance to af_heart
const h = voicePack("af_heart"); const row = 60;
const norm = (a,o,n)=>Math.sqrt(a.slice(o,o+n).reduce((s,x)=>s+x*x,0));
const dist = (a,b,o,n)=>Math.sqrt(a.slice(o,o+n).reduce((s,x,i)=>s+(x-b[o+i])**2,0));
for (const v of voices) { const p = voicePack(v); console.log(v, "norm timbre", norm(p,row*256,128).toFixed(2), "prosody", norm(p,row*256+128,128).toFixed(2), "| dist to heart t", dist(p,h,row*256,128).toFixed(2), "p", dist(p,h,row*256+128,128).toFixed(2)); }
// how much does the row change with index?
for (const v of ["af_heart","af_nicole","af_bella"]) { const p=voicePack(v); console.log(v, [10,30,60,100,200,300,509].map(i=>`${i}:${dist(p.slice(i*256,i*256+256), p.slice(60*256,60*256+256),0,256).toFixed(2)}`).join(" ")); }
