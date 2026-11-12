import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const P='../samples/pdfjs-repo/test/pdfs/';
export async function load(f){const d=await getDocument({data:new Uint8Array(fs.readFileSync(P+f)),useSystemFonts:false,verbosity:0}).promise;return d;}
const f=process.argv[2];
const d=await load(f);
console.log(f,'pages',d.numPages);
let t0=performance.now();
let n=0,chars=0;
for(let p=1;p<=d.numPages;p++){const pg=await d.getPage(p);const tc=await pg.getTextContent({includeMarkedContent:true});n+=tc.items.length;chars+=tc.items.filter(i=>i.str).reduce((a,i)=>a+i.str.length,0);}
console.log('items',n,'chars',chars,'ms/page',((performance.now()-t0)/d.numPages).toFixed(1));
const st=await (await d.getPage(1)).getStructTree();
console.log('structTree p1', st?JSON.stringify(st).slice(0,300):null);
