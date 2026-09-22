import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
export async function startDemoServer() {
  const html=await readFile(new URL('../fixtures/demo.html',import.meta.url),'utf8');
  const server=createServer((req,res)=>{
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(html.replace('__PAGE_CLASS__',req.url?.startsWith('/detail')?'detail':'list'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {baseURL:`http://127.0.0.1:${server.address().port}`,
    stop:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
