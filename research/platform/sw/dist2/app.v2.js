const VER='v2';const out=document.getElementById('out');
const log=(o)=>{window.__state={...(window.__state||{}),...o};out.textContent=JSON.stringify(window.__state,null,1)};
log({ver:VER});
async function main(){
  if(!('serviceWorker' in navigator)){log({err:'no sw'});return}
  const reg=await navigator.serviceWorker.register('./sw.js');
  // first visit: SW not controlling yet -> wait until it is, then reload once so the *document* carries COOP/COEP
  await navigator.serviceWorker.ready;
  if(!crossOriginIsolated&&!sessionStorage.getItem('reloaded')){sessionStorage.setItem('reloaded','1');location.reload();return}
  const watch=(r)=>{const nw=r.waiting||null;if(nw)log({updateReady:true})};
  watch(reg);reg.addEventListener('updatefound',()=>{const i=reg.installing;i.addEventListener('statechange',()=>{if(i.state==='installed'&&navigator.serviceWorker.controller)log({updateReady:true})})});
  document.getElementById('upd').onclick=()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});reg.waiting?.postMessage('SKIP_WAITING')};
  window.__reg=reg;
  const sab=new SharedArrayBuffer(8);
  const w=new Worker(`./worker.${VER}.js`);
  const wr=await new Promise((res,rej)=>{w.onmessage=e=>res(e.data);w.onerror=e=>rej(e.message);setTimeout(()=>res({timeout:true}),3000);w.postMessage(sab)});
  let shm='n/a';try{new WebAssembly.Memory({initial:1,maximum:2,shared:true});shm='ok'}catch(e){shm=String(e)}
  log({crossOriginIsolated,controlled:!!navigator.serviceWorker.controller,worker:wr,sabCount:new Int32Array(sab)[0],sharedWasmMemory:shm,caches:await caches.keys()});
}
window.lazy=()=>import(`./lazy.${VER}.js`).then(m=>m.default);
window.xorigin=async(u)=>{try{const r=await fetch(u,{mode:'cors'});return 'cors-fetch '+r.status+' '+(await r.text()).length}catch(e){return 'cors-fetch FAIL '+e.message}};
window.xImg=(u)=>new Promise(r=>{const i=new Image();i.onload=()=>r('img ok');i.onerror=()=>r('img BLOCKED');i.src=u});
main().catch(e=>log({err:String(e)}));
