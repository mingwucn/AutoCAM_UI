const http=require('http'),fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist-dev');
function build(){execFileSync(process.execPath,[path.join(__dirname,'build.cjs'),'--development','--out',out],{stdio:'inherit'});}
build();
http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname==='/')build();
 const file=path.resolve(out,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(out+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');
 fs.createReadStream(file).pipe(res);
}).listen(5173,'127.0.0.1',()=>console.log('Shadow Gym: http://127.0.0.1:5173'));
