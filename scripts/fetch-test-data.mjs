import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await fs.readFile(path.join(root,'site.config.json')));
const destination=path.join(root,'.test-data');
const bytes=await fetch(config.catalogUrl).then(r=>{if(!r.ok)throw Error('Catalog '+r.status);return r.arrayBuffer();}).then(Buffer.from);
const catalog=JSON.parse(bytes);await fs.mkdir(destination,{recursive:true});await fs.writeFile(path.join(destination,'catalog.json'),bytes);
for(const ref of [...catalog.cases.flatMap(c=>[c.dataset,c.preview]),catalog.verification]){
 const file=path.resolve(destination,ref.url);if(!file.startsWith(destination+path.sep))throw Error('Invalid data path');
 const raw=await fetch(new URL(ref.url,config.catalogUrl)).then(r=>{if(!r.ok)throw Error('Asset '+r.status);return r.arrayBuffer();}).then(Buffer.from);
 if(raw.length!==ref.size_bytes||createHash('sha256').update(raw).digest('hex')!==ref.sha256)throw Error('Data identity mismatch');
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,raw);
}
console.log('Downloaded pinned verification data');
