import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as core from '../src/industrial-learning.mjs';
import {INDUSTRIAL_CASES,prepareIndustrialLearningData} from '../scripts/fetch-industrial-learning-data.mjs';
import {trainIndustrialEpisode,parseIndustrialTrainingArguments} from '../scripts/train-industrial-episode.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
async function fixture(run) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-industrial-training-'));
  try{return await run(directory);}
  finally {
    const absolute=await fs.realpath(directory);
    assert.equal(path.dirname(absolute),await fs.realpath(os.tmpdir()));
    assert(path.basename(absolute).startsWith('autocam-industrial-training-'));
    await fs.rm(absolute,{recursive:true,force:true});
  }
}
async function bundleFor(caseId) {
  const data=await prepareIndustrialLearningData({caseId});
  const context=await core.createIndustrialContext(JSON.parse(await fs.readFile(data.path,'utf8')));
  const a=await core.generateBaseline(context),b=await core.generateBaseline(context,{processOrder:['milling','turning']});
  const bundle=await core.makeFeedbackBundle(context,{episodes:[a,b],sequence_preferences:[{scope:'case',preferred_episode_id:b.id,rejected_episode_id:a.id}],action_preferences:[{scope:'case',actions:[],preferred_kind:'milling',rejected_kind:'turning'}]});
  return {context,bundle};
}
const cases={};
for(const caseId of Object.keys(INDUSTRIAL_CASES))cases[caseId]=await bundleFor(caseId);

test('local trainer fits actual feedback for both exact industrial cases and writes reproducible provenance',async()=>{
  for(const [caseId,{context,bundle}] of Object.entries(cases))await fixture(async directory=>{
    const feedback=path.join(directory,'feedback.json'),raw=bytes(bundle);
    await fs.writeFile(feedback,raw);
    const result=await trainIndustrialEpisode({feedback,expectedSha256:sha(raw),output:path.join(directory,'trained')});
    assert.equal(result.report.status,'passed');assert.equal(result.report.dataset.case_id,caseId);
    const model=JSON.parse(await fs.readFile(result.checkpoint,'utf8'));
    await core.validateCheckpoint(context,model);
    assert.equal((await core.generateModelSequence(context,model)).complete,true);
    assert.deepEqual(await fs.readFile(path.join(result.output,'feedback.json')),raw);
    assert.equal(sha(await fs.readFile(result.checkpoint)),result.report.checkpoint.sha256);
    assert.equal(result.report.source_files.length,4);
    assert((await fs.stat(path.join(result.output,'initial-checkpoint.json'))).isFile());
    await assert.rejects(()=>trainIndustrialEpisode({feedback,expectedSha256:sha(raw),output:result.output}),/already exists/);
  });
});
test('bad byte identities, incompatible checkpoints, unsupported scope and invalid config leave no output',async()=>fixture(async directory=>{
  const {bundle}=cases.industrial,feedback=path.join(directory,'feedback.json'),raw=bytes(bundle);
  await fs.writeFile(feedback,raw);
  const original={feedback,expectedSha256:sha(raw)};
  const check=async(overrides,pattern)=>{
    const output=path.join(directory,'rejected-'+Math.random().toString(36).slice(2));
    await assert.rejects(()=>trainIndustrialEpisode({...original,...overrides,output}),pattern);
    await assert.rejects(()=>fs.stat(output),{code:'ENOENT'});
  };
  await check({expectedSha256:'0'.repeat(64)},/SHA-256/);
  await check({dataset:feedback},/SHA-256|size limit/);
  const wrongModel=bytes(core.createInitialModel(cases.industrial_00289.context)),initialCheckpoint=path.join(directory,'other.json');
  await fs.writeFile(initialCheckpoint,wrongModel);
  await check({initialCheckpoint,initialCheckpointSha256:sha(wrongModel)},/case|compatible|identity/i);
  await check({alpha:0},/alpha|configuration|training/i);
  const unsupported=structuredClone(bundle);unsupported.action_preferences[0].scope='general';
  const unsupportedRaw=bytes(unsupported);await fs.writeFile(feedback,unsupportedRaw);
  await check({expectedSha256:sha(unsupportedRaw)},/scope|feedback|preference/i);
}));
test('CLI parser rejects duplicates, nonfinite values and obsolete episode-only invocation',()=>{
  for(const args of [['--feedback','a','--feedback','b'],['--alpha','NaN'],['--episode','a'],['--output']])assert.throws(()=>parseIndustrialTrainingArguments(args));
  assert.deepEqual(parseIndustrialTrainingArguments(['--epochs','25','--feedback','f']),{epochs:25,feedback:'f'});
});


test('source changes during training in an isolated fresh process prevent checkpoint publication',async()=>fixture(async directory=>{
  const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const cloned=path.join(directory,'package');
  for(const name of ['src/model.js','src/industrial-learning.mjs','scripts/train-industrial-episode.mjs','scripts/fetch-industrial-learning-data.mjs']) {
    const destination=path.join(cloned,name);await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(path.join(checkout,name),destination);
  }
  await fs.writeFile(path.join(cloned,'package.json'),JSON.stringify({type:'module'}));
  const injected="\nawait (await import('node:fs/promises')).appendFile(new URL('./model.js',import.meta.url),'\\n// simulated concurrent edit\\n');\n";
  await fs.appendFile(path.join(cloned,'src/industrial-learning.mjs'),injected);
  const feedback=path.join(directory,'feedback.json'),raw=bytes(cases.industrial.bundle),output=path.join(directory,'rejected-output');
  await fs.writeFile(feedback,raw);
  const run=spawnSync(process.execPath,[path.join(cloned,'scripts/train-industrial-episode.mjs'),
    '--feedback',feedback,'--expected-sha256',sha(raw),'--dataset',path.join(checkout,INDUSTRIAL_CASES.industrial.path),
    '--output',output,'--epochs','1','--exploration-episodes','0'],{encoding:'utf8',windowsHide:true});
  assert.equal(run.status,1);assert.match(run.stderr,/source files changed during the run/);
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
}));
