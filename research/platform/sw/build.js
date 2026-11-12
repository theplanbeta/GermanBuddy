// node build.js <outdir> <version> : writes a tiny fake "Vite build" with hashed names + generated sw.js
const fs=require('fs'),path=require('path');const [out,ver]=[process.argv[2],process.argv[3]];
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const w=(n,s)=>fs.writeFileSync(path.join(out,n),s);
w(`app.${ver}.js`,fs.readFileSync(path.join(__dirname,'app.src.js'),'utf8').replaceAll('__VER__',ver));
w(`worker.${ver}.js`,`self.onmessage=e=>{const sab=e.data;const a=new Int32Array(sab);Atomics.add(a,0,1);postMessage({iso:self.crossOriginIsolated,sab:typeof SharedArrayBuffer!=='undefined',v:'${ver}'})}`);
w(`lazy.${ver}.js`,`export default 'lazy chunk of ${ver}'`);
w('index.html',`<!doctype html><meta charset=utf-8><title>spike ${ver}</title><body><pre id=out>loading</pre><button id=upd hidden>Update</button><script type=module src="./app.${ver}.js"></script>`);
const files=['./','./index.html',`./app.${ver}.js`,`./worker.${ver}.js`,`./lazy.${ver}.js`];
w('sw.js',fs.readFileSync(path.join(__dirname,'sw.template.js'),'utf8').replaceAll('__VERSION__',ver).replaceAll('__PRECACHE__',JSON.stringify(files)));
