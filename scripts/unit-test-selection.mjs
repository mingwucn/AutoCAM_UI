import fs from 'node:fs/promises';
import path from 'node:path';

export async function unitTestSelection(root,command){
 if(typeof command!=='string')throw Error('Unsupported unit test command.');
 const args=command.split(' '),files=args.slice(2);
 if(args[0]!=='node'||args[1]!=='--test'||!files.length||new Set(files).size!==files.length||files.some(s=>!/^tests\/[A-Za-z0-9_.-]+$/.test(s)))throw Error('Unsupported unit test command.');
 for(const name of files){
  const stat=await fs.stat(path.join(root,name)).catch(()=>null);
  if(!stat?.isFile())throw Error('Required unit test file is missing: '+name);
 }
 return files;
}
