import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const P='../samples/pdfjs-repo/test/pdfs/';
const f=process.argv[2];
const d=await getDocument({data:new Uint8Array(fs.readFileSync(P+f)),verbosity:0}).promise;
const pages=[];
for(let p=1;p<=d.numPages;p++){
  const pg=await d.getPage(p);const vp=pg.getViewport({scale:1});
  const tc=await pg.getTextContent();
  const items=tc.items.filter(i=>i.str!==undefined&&(i.str.trim()||i.hasEOL)).map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.transform[3])||i.height,eol:i.hasEOL,font:i.fontName}));
  pages.push({W:vp.width,H:vp.height,items});
}
fs.writeFileSync(f+'.json',JSON.stringify(pages));
// 1 naive order excerpt p1
const p=pages[0];
console.log('PAGE1 naive first 14 items:');
p.items.slice(0,14).forEach(i=>console.log(`  (${i.x.toFixed(0)},${i.y.toFixed(0)}) h=${i.h.toFixed(1)} "${i.s}"`));
// count column interleave: x jumps across mid between consecutive text items on body page 3
function jumps(pg){let j=0,prev=null;const mid=pg.W/2;for(const i of pg.items){if(!i.s.trim())continue;const side=i.x+i.w/2<mid?0:1;if(prev!==null&&side!==prev)j++;prev=side;}return j;}
console.log('side switches in naive order per page:',pages.map(jumps).join(','));
