import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';import fs from 'fs';
const d=await getDocument({data:new Uint8Array(fs.readFileSync('../samples/pdfjs-repo/test/pdfs/tracemonkey.pdf')),verbosity:0}).promise;
for(const n of [3,4,12]){const pg=await d.getPage(n);const t=performance.now();const ol=await pg.getOperatorList();
 const c={};for(const f of ol.fnArray){c[f]=(c[f]||0)+1;}
 console.log('p'+n,'ops',ol.fnArray.length,'constructPath',c[OPS.constructPath]||0,'paintImage',(c[OPS.paintImageXObject]||0)+(c[OPS.paintInlineImageXObject]||0),'ms',(performance.now()-t).toFixed(0));}
