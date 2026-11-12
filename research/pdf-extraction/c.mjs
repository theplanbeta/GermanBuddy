import fs from 'fs';
const f=process.argv[2];
const pages=JSON.parse(fs.readFileSync(f+'.json'));
const norm=s=>s.toLowerCase().replace(/\d+/g,'#').replace(/\s+/g,' ').trim();
// header/footer: top/bottom 9% band, normalized text repeated on >=40% of pages (>=3)
const N=pages.length, cnt={};
const band=(pg,i)=>i.y>pg.H*0.91||i.y<pg.H*0.09;
// group items into lines in band
function lines(pg){const L=[];for(const i of pg.items){if(!band(pg,i)||!i.s.trim())continue;const k=Math.round(i.y/3);let l=L.find(l=>l.k===k);if(!l)L.push(l={k,y:i.y,xs:i.x,s:''}),l.parts=[];l.parts.push(i);}return L.map(l=>({y:l.y,s:l.parts.sort((a,b)=>a.x-b.x).map(i=>i.s).join(' '),x:Math.min(...l.parts.map(i=>i.x))}));}
const per=pages.map(lines);
per.forEach(L=>{new Set(L.map(l=>norm(l.s)+'@'+(l.y>400?'T':'B'))).forEach(k=>cnt[k]=(cnt[k]||0)+1)});
const thr=Math.max(3,Math.ceil(N*0.4));
const hf=Object.entries(cnt).filter(([k,c])=>c>=thr);
console.log(f,'pages',N,'repeated band lines (>=',thr,'pages):');hf.forEach(([k,c])=>console.log('  ',c,k));
// what was in the band but NOT flagged (potential misses)
const flagged=new Set(hf.map(h=>h[0]));
let miss=0,tot=0;const ex=[];per.forEach((L,pi)=>L.forEach(l=>{tot++;if(!flagged.has(norm(l.s)+'@'+(l.y>400?'T':'B'))){miss++;if(ex.length<8)ex.push(`p${pi+1}: "${l.s.slice(0,70)}"`)}}));
console.log('band lines flagged:',tot-miss,'/',tot,' unflagged examples:');ex.forEach(e=>console.log('  ',e));
