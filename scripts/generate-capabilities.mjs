import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {module3Capabilities as registry} from '../src/module3-capabilities.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.join(root,'docs/CAPABILITIES.md');
const source=await fs.readFile(path.join(root,'config/module3-capabilities.json'));
const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const lines=['# Case and profile capabilities','','Generated from `config/module3-capabilities.json`. Edit the registry and run',
  '`node scripts/generate-capabilities.mjs`; do not edit this projection by hand.','',
  'These are workflow limits. The runtime must still accept each exact input, model',
  'and action. This table grants no manufacturing or runtime authority.','',
  'Verification references below identify scenarios and their evidence level. A',
  'source file or test definition is not a passing result. Check the',
  '[verification status](VERIFICATION_STATUS.md) and retained command receipts',
  'for what ran on this candidate; no complete browser pass for every family is',
  'inferred. Paths refer to the standalone source checkout.','',
  ...Object.entries(registry.statuses).map(([key,value])=>`- **${key}**: ${value}.`),'',
  'All training marked **external** requires a separate compatible trainer. It is',
  'not an independently executable training route of this standalone package.',
  'See the [training family guide](TRAINING_GUIDE.md) for packaged commands and',
  'the [scope contract](MODULE3_SCOPE.md) for unresolved whole-module requirements.','',
  '| Case/profile | '+registry.stages.map(s=>s.label).join(' | ')+' |',
  '| --- | '+registry.stages.map(()=>'---').join(' | ')+' |',
  ...registry.families.map(f=>'| '+escape(f.title)+' | '+registry.stages.map(s=>f.stages[s.id].status).join(' | ')+' |'),''];
for(const family of registry.families){
  lines.push('## '+family.title,'',family.limits,'','Inputs/routes: '+['schemas','profiles','kinds'].flatMap(key=>(family[key]??[]).map(value=>'`'+value+'`')).join(', ')+'.','',
    'Model compatibility: '+family.model,'','| Stage | Status | Restriction |','| --- | --- | --- |',
    ...registry.stages.map(stage=>'| '+stage.label+' | '+family.stages[stage.id].status+' | '+escape(family.stages[stage.id].detail)+' |'),'','Verification scenarios:','',
    '| Source path | Stage(s) | Evidence level and scope |','| --- | --- | --- |',
    ...family.verification.map(ref=>'| `'+ref.path+'` | '+ref.stages.join(', ')+' | '+escape(ref.scope+': '+ref.claim)+' |'),'');
}
lines.push('Registry SHA-256: `'+createHash('sha256').update(source).digest('hex')+'`.','');
const text=lines.join('\n');
if(process.argv.includes('--check')){
  if(await fs.readFile(target,'utf8')!==text)throw Error('Capability documentation is stale. Run node scripts/generate-capabilities.mjs.');
  console.log('Capability documentation matches its registry.');
}else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);console.log('Wrote docs/CAPABILITIES.md.');}
