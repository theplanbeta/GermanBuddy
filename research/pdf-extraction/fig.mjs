import fs from 'fs';import {buildLines,xycut} from './xy.mjs';
const f=process.argv[2];const P=JSON.parse(fs.readFileSync(f+'.json'));
P.forEach((pg,i)=>{
 const O=xycut(buildLines(pg));
 let flagged=0,run=[],runs=0;const flush=()=>{if(run.length>=5){flagged+=run.length;runs++;}run=[]};
 for(const l of O){const short=l.s.length<=22&&!/[.!?]$/.test(l.s.trim())&&(l.x2-l.x)<pg.W*0.2; if(short)run.push(l);else flush();}
 flush();
 const caps=O.filter(l=>/^(Figure|Table)\s*\d+/.test(l.s)).length;
 console.log(`p${i+1}: lines ${O.length} flagged-as-figure-text ${flagged} (runs ${runs}) captions ${caps}`);
});
