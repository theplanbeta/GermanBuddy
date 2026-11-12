import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';import fs from 'fs';
for(const f of ['issue5481.pdf','160F-2019.pdf','issue16553.pdf','issue17069.pdf','bug1755507.pdf','tracemonkey_with_annotations.pdf']){
 try{const d=await getDocument({data:new Uint8Array(fs.readFileSync('../samples/pdfjs-repo/test/pdfs/'+f)),verbosity:0}).promise;
 const roles={};let mc=0;
 const walk=n=>{if(n.role)roles[n.role]=(roles[n.role]||0)+1;if(n.type==='content')mc++;(n.children||[]).forEach(walk)};
 let tot=0;for(let p=1;p<=Math.min(d.numPages,6);p++){const pg=await d.getPage(p);const st=await pg.getStructTree();if(st)walk(st);}
 console.log(f,d.numPages,'pages; roles(first6pages):',JSON.stringify(roles).slice(0,260),'content leaves',mc);}catch(e){console.log(f,'err',String(e).slice(0,80))}}
