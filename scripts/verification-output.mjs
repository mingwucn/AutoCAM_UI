import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export function validateVerificationOutput(root,output){
  root=fs.realpathSync(root);output=path.resolve(output);
  if(fs.existsSync(output))throw Error('Output already exists; retain it and use a new directory');
  let ancestor=path.dirname(output);
  while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const realOutput=path.join(fs.realpathSync(ancestor),path.relative(ancestor,output));
  if(realOutput===root)throw Error('Output cannot replace the checkout');
  if(realOutput.startsWith(root+path.sep)){
    const relative=path.relative(root,realOutput).replaceAll('\\','/')+'/';
    try{execFileSync('git',['check-ignore','--quiet','--',relative],{cwd:root,windowsHide:true,stdio:'ignore'});}
    catch{throw Error('Verification output inside the checkout must be Git-ignored; use runs/NEW_DIRECTORY or an external directory');}
  }
  return realOutput;
}
