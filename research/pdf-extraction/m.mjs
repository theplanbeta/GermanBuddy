import fs from 'fs';
import {buildLines,xycut} from './xy.mjs';
import * as mupdf from 'mupdf';
const f=process.argv[2];
const P=JSON.parse(fs.readFileSync(f+'.json'));
const doc=mupdf.Document.openDocument(fs.readFileSync('../samples/pdfjs-repo/test/pdfs/'+f),'application/pdf');
let t=performance.now();const mu=[];
for(let i=0;i<doc.countPages();i++){const pg=doc.loadPage(i);const st=pg.toStructuredText('preserve-whitespace');mu.push(JSON.parse(st.asJSON()));}
console.log('mupdf ms/page',((performance.now()-t)/doc.countPages()).toFixed(1));
fs.writeFileSync(f+'.mu.json',JSON.stringify(mu));
const sw=(a,W)=>{let j=0,p=null;for(const l of a){if(l.x2-l.x>W*0.6)continue;const s=(l.x+l.x2)/2<W/2?0:1;if(p!==null&&s!==p)j++;p=s;}return j;};
const rows=[];
P.forEach((pg,i)=>{
  const naive=buildLines(pg).sort(()=>0);
  // naive order lines: rebuild in original order
  const xy=xycut(buildLines(pg));
  const ml=[];for(const b of mu[i].blocks)for(const l of b.lines)ml.push({x:l.bbox.x,x2:l.bbox.x+l.bbox.w,y:l.y,s:l.text});
  rows.push([i+1,sw(naive,pg.W),sw(xy,pg.W),sw(ml,pg.W),mu[i].blocks.length]);
});
console.log('page | switches: naive-line-build, xycut, mupdf | mupdf blocks');rows.forEach(r=>console.log(r.join(' | ')));
