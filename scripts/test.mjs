import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareTestFixtures} from './prepare-test-fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scripts=JSON.parse(await fs.readFile(path.join(root,'package.json'))).scripts;
const args=scripts['test:unit'].split(' ');
if(args[0]!=='node'||args[1]!=='--test'||args.length<3||args.slice(2).some(s=>!/^tests\/[A-Za-z0-9_.-]+$/.test(s)))throw Error('Unsupported unit test command.');
const fixtures=await prepareTestFixtures();
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...args.slice(2)],{cwd:root,env:{...process.env,...fixtures.environment},encoding:'utf8',maxBuffer:16*1024**2});
if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;
const counts=Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)\s*$/gm)].map(m=>[m[1],Number(m[2])]));
if(result.status!==0||!counts.tests||counts.pass!==counts.tests||counts.fail!==0||counts.skipped!==0||counts.cancelled!==0){
  process.stderr.write('Complete fixture-backed unit suite required: no failures, skips or cancellations.\n');process.exitCode=1;
}
