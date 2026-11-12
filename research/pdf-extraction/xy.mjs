import fs from 'fs';
export function buildLines(pg){
  const its=pg.items.filter(i=>i.s.trim()).map(i=>({...i,x2:i.x+i.w,top:i.y+i.h*0.8,bot:i.y-i.h*0.2}));
  its.sort((a,b)=>b.y-a.y||a.x-b.x);
  const lines=[];
  for(const i of its){
    let l=lines.find(l=>Math.abs(l.y-i.y)<Math.max(l.h,i.h)*0.35 && i.x-l.x2<Math.max(l.h,i.h)*1.2 && i.x>=l.x-1);
    // also allow superscripts (small, offset) - keep simple
    if(l){l.s+=(i.x-l.x2>l.h*0.15?' ':'')+i.s;l.x2=Math.max(l.x2,i.x2);l.top=Math.max(l.top,i.top);l.bot=Math.min(l.bot,i.bot);l.h=Math.max(l.h,i.h);}
    else lines.push({s:i.s,x:i.x,x2:i.x2,y:i.y,h:i.h,top:i.top,bot:i.bot});
  }
  return lines;
}
function gaps(boxes,lo,hi,get,min){ // 1D projection gaps
  const iv=boxes.map(get).sort((a,b)=>a[0]-b[0]);const g=[];let end=iv[0][1];
  for(let k=1;k<iv.length;k++){if(iv[k][0]-end>=min)g.push({pos:(iv[k][0]+end)/2,size:iv[k][0]-end});end=Math.max(end,iv[k][1]);}
  return g;
}
export function xycut(lines,opt={}){
  const vmin=opt.vmin??10,hmin=opt.hmin??4;
  const out=[];
  (function rec(L){
    if(L.length<=1){out.push(...L);return;}
    const v=gaps(L,0,0,l=>[l.x,l.x2],vmin);
    if(v.length){const g=v.sort((a,b)=>b.size-a.size)[0];
      rec(L.filter(l=>(l.x+l.x2)/2<g.pos));rec(L.filter(l=>(l.x+l.x2)/2>=g.pos));return;}
    const h=gaps(L,0,0,l=>[l.bot,l.top],hmin);
    if(h.length){const g=h.sort((a,b)=>b.size-a.size)[0];// top = larger y
      rec(L.filter(l=>l.y>g.pos));rec(L.filter(l=>l.y<=g.pos));return;}
    out.push(...L.sort((a,b)=>b.y-a.y||a.x-b.x));
  })(lines);
  return out;
}
if(process.argv[1].endsWith('xy.mjs')){
  const f=process.argv[2],pn=+process.argv[3];
  const P=JSON.parse(fs.readFileSync(f+'.json'));
  const pg=P[pn-1];const L=buildLines(pg);const O=xycut(L);
  console.log('lines',L.length);
  const sw=a=>{let j=0,p=null;for(const l of a){const s=(l.x+l.x2)/2<pg.W/2?0:1;if(l.x2-l.x>pg.W*0.6)continue;if(p!==null&&s!==p)j++;p=s;}return j;};
  console.log('side switches xycut',sw(O),'| lines-in-naive order',sw(L.slice().sort(()=>0)));
  O.slice(0,+process.argv[4]||30).forEach(l=>console.log(`(${l.x.toFixed(0)},${l.y.toFixed(0)}) ${l.s.slice(0,80)}`));
}
