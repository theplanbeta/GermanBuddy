import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const P='../samples/pdfjs-repo/test/pdfs/';
const fl=fs.readdirSync(P).filter(f=>f.endsWith('.pdf')&&fs.statSync(P+f).size>60000&&fs.statSync(P+f).size<3e6);
const out=[];
for(const f of fl){try{const d=await Promise.race([getDocument({data:new Uint8Array(fs.readFileSync(P+f)),verbosity:0}).promise,new Promise((_,r)=>setTimeout(()=>r('t'),3000))]);
 if(d.numPages<5||d.numPages>80){continue;}
 let nums=0,chars=0;const np=Math.min(d.numPages,8);
 for(let p=1;p<=np;p++){const pg=await d.getPage(p);const vp=pg.getViewport({scale:1});const tc=await pg.getTextContent();for(const i of tc.items){if(!i.str)continue;chars+=i.str.length;const y=i.transform[5];if(/^\s*\d{1,3}\s*$/.test(i.str)&&(y<vp.height*.09||y>vp.height*.91))nums++;}}
 out.push([f,d.numPages,chars,nums]);}catch(e){}}
out.filter(o=>o[2]>3000).sort((a,b)=>b[3]-a[3]).slice(0,15).forEach(o=>console.log(o.join(' ')));
console.log('total candidates',out.length);
