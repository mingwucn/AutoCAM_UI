import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function pythonExecutable({override,environment=process.env,platform=process.platform,checkout=root}={}){
  return override||environment.AUTOCAM_PYTHON||path.join(checkout,'.venv',platform==='win32'?'Scripts/python.exe':'bin/python');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);let override;
  if(args[0]==='--python'){
    override=args[1];args.splice(0,2);
    if(!override||override.startsWith('--'))throw Error('--python requires an executable');
  }
  if(!args.length)throw Error('Usage: node scripts/python-command.mjs [--python EXECUTABLE] PYTHON_ARGUMENTS');
  const executable=pythonExecutable({override});
  const run=spawnSync(executable,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(run.error)throw Error('Cannot run '+executable+'. Install the documented .venv or set AUTOCAM_PYTHON.',{cause:run.error});
  process.exitCode=run.status??1;
}
