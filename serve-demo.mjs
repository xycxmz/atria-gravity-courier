import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const port=Number(process.argv[2]||8000);
if(!existsSync(resolve(root,'index.html')))throw Error('Missing dist. Build the project first.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.pmtiles':'application/octet-stream'};
createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'); const relative=decodeURIComponent(url.pathname);
  const file=resolve(root,'.'+(relative.endsWith('/')?relative+'index.html':relative));
  if(!file.startsWith(resolve(root)+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  const size=statSync(file).size;const range=req.headers.range;
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
  let start=0,end=size-1;
  if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416);res.end();return;}start=Number(m[1]);end=m[2]?Number(m[2]):size-1;
   if(start> end||end>=size||start<0){res.setHeader('Content-Range','bytes */'+size);res.writeHead(416);res.end();return;}
   res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+size);
  }
  res.setHeader('Content-Length',end-start+1);if(req.method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).pipe(res);
 }catch{res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log('Demo: http://127.0.0.1:'+port+'/  (Ctrl+C to stop)'));
