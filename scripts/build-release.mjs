import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareReleaseBuild} from './fetch-release-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await fs.readFile(path.join(root,'site.config.json'),'utf8')),args=process.argv.slice(2);
if((Object.hasOwn(config,'adaptiveRuntimeRelease')&&args.includes('--adaptive-assets'))||
   (Object.hasOwn(config,'adaptiveCadRelease')&&args.includes('--adaptive-cad-assets')))
  throw Error('Configured release conflicts with explicit local assets; use the plain build command for local packages.');
const releaseArgs=await prepareReleaseBuild(config,path.join(root,'.cache/releases'));
const run=spawnSync(process.execPath,[path.join(root,'scripts/build.cjs'),...args,...releaseArgs],{stdio:'inherit'});
if(run.error)throw run.error;
process.exitCode=run.status??1;
