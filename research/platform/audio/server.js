// tiny static server with Range support. usage: node server.js dir port [coi]  (coi => send COOP/COEP headers)
const http=require('http'),fs=require('fs'),path=require('path');
const [dir,port,coi]=[process.argv[2],+process.argv[3],process.argv[4]==='coi'];
const mime={'.mjs':'text/javascript','.m4a':'audio/mp4','.mp3':'audio/mpeg','.ogg':'audio/ogg','.opus':'audio/ogg','.webm':'audio/webm','.html':'text/html','.js':'text/javascript','.json':'application/json','.wav':'audio/wav','.webmanifest':'application/manifest+json'};
http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(dir,u);
 if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('nf')}
 const size=fs.statSync(f).size;const h={'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
 if(coi){h['Cross-Origin-Opener-Policy']='same-origin';h['Cross-Origin-Embedder-Policy']='require-corp'}
 const m=/bytes=(\d*)-(\d*)/.exec(q.headers.range||'');
 if(m){let a=m[1]===''?size-+m[2]:+m[1],b=m[1]!==''&&m[2]!==''?+m[2]:size-1;b=Math.min(b,size-1);h['Content-Range']=`bytes ${a}-${b}/${size}`;h['Content-Length']=b-a+1;s.writeHead(206,h);fs.createReadStream(f,{start:a,end:b}).pipe(s)}
 else{h['Content-Length']=size;s.writeHead(200,h);fs.createReadStream(f).pipe(s)}}).listen(port,()=>console.log('up',port));
