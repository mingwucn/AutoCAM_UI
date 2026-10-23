import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as core from '../src/industrial-setup-learning.mjs';
import {setupCasePin} from '../src/industrial-setup-registry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n'),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseSetupTrainingArguments(args){
  const names=new Map([['--feedback','feedback'],['--expected-sha256','expectedSha256'],['--dataset','dataset'],['--output','output'],['--initial-checkpoint','initialCheckpoint'],['--initial-checkpoint-sha256','initialCheckpointSha256'],...Object.keys(core.DEFAULT_TRAINING_CONFIG).map(key=>['--'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),key])]),options={};
  for(let i=0;i<args.length;i+=2){const key=names.get(args[i]),value=args[i+1];if(!key||typeof value!=='string'||!value.trim()||value.startsWith('--')||Object.hasOwn(options,key))throw Error('Unknown, duplicate or incomplete setup training option.');options[key]=Object.hasOwn(core.DEFAULT_TRAINING_CONFIG,key)?Number(value):value;if(typeof options[key]==='number'&&!Number.isFinite(options[key]))throw Error('Training value must be finite.');}return options;
}
async function readPinned(filename,expected,maxSize,label){
  if(typeof filename!=='string'||!filename||!hash(expected))throw Error(label+' requires a file and lowercase SHA-256.');
  const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>maxSize)throw Error(label+' must be a regular file within its byte bound.');
  const bytes=await fs.readFile(filename);if(bytes.length>maxSize||sha(bytes)!==expected)throw Error(label+' SHA-256 differs.');return bytes;
}
export async function trainSetupEpisode(options={}){
  if(Number(process.versions.node.split('.')[0])!==24)throw Error('Use Node.js24 for setup training.');
  if(typeof options.output!=='string'||!options.output.trim())throw Error('Supply --output NEW-DIRECTORY.');const output=path.resolve(options.output);
  try{await fs.lstat(output);throw Error('Output already exists; choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(Boolean(options.initialCheckpoint)!==Boolean(options.initialCheckpointSha256))throw Error('Initial checkpoint path and SHA-256 must be supplied together.');
  const datasetPath=options.dataset?path.resolve(options.dataset):path.join(root,'examples/industrial-setup/00350/case.json');
  const feedbackRaw=await readPinned(options.feedback,options.expectedSha256,16*1024*1024,'Feedback'),bundle=JSON.parse(feedbackRaw),pin=setupCasePin(bundle?.case?.scene_id);
  if(!pin)throw Error('Feedback selects an unsupported setup case.');
  const datasetRaw=await readPinned(datasetPath,pin.raw_sha256,pin.raw_size_bytes,'Dataset');
  if(datasetRaw.length!==pin.raw_size_bytes)throw Error('Dataset byte size differs.');
  const context=await core.createSetupContext(JSON.parse(datasetRaw));
  const initialRaw=options.initialCheckpoint?await readPinned(options.initialCheckpoint,options.initialCheckpointSha256,1024*1024,'Initial checkpoint'):null;
  const initial=initialRaw?JSON.parse(initialRaw):core.createInitialModel(context);core.validateCheckpoint(context,initial);
  const sources=[],sourceNames=['src/industrial-setup-model.mjs','src/industrial-setup-rule.mjs','src/industrial-millturn-rule.mjs','src/industrial-setup-pins.mjs','src/industrial-finite-pins.mjs','src/industrial-paths-pins.mjs','src/industrial-setup-registry.mjs','src/industrial-setup-learning.mjs','scripts/train-industrial-setup-episode.mjs'];
  if(context.scene.id==='industrial_reach_00350')sourceNames.push('src/industrial-reach-pins.mjs');
  for(const filename of sourceNames){const bytes=await fs.readFile(path.join(root,filename));sources.push({path:filename,sha256:sha(bytes),size_bytes:bytes.length});}
  const config={};for(const key of Object.keys(core.DEFAULT_TRAINING_CONFIG))if(options[key]!==undefined)config[key]=options[key];
  const trained=await core.trainModel(context,bundle,{...config,initialModel:initial});core.validateCheckpoint(context,trained.model);
  const before=await core.generateModelSequence(context,initial),after=await core.generateModelSequence(context,trained.model);
  await core.replayEpisode(context,before);await core.replayEpisode(context,after);
  const reach=context.scene.id==='industrial_reach_00350',named=context.scene.id==='industrial_paths_00350'||reach&&context.scene.workflow.authorized_sequence_preference?await core.generateNamedPaths(context):null;
  const reachBaselines=reach?{path1:await core.generateBaseline(context),greedy:await core.generateGreedyBaseline(context)}:null;
  for(const source of sources)if(sha(await fs.readFile(path.join(root,source.path)))!==source.sha256)throw Error('Training source changed during the run: '+source.path);
  const checkpointRaw=json(trained.model),initialBytes=initialRaw??json(initial),summary=e=>({episode_id:e.id,complete:e.complete,events:e.events.length,cuts:e.final_observation.step_count,setups:e.final_observation.setup_event_count,final_residual_voxels:e.final_observation.final_residual_voxels,terminal_reason:e.final_observation.terminal_reason});
  const comparison={schema:'industrial-setup-policy-comparison-1',...(named?{baseline:{label:'Path 1',...summary(named.baseline)},preferred_reference:{label:'Path 2',...summary(named.preferred)}}:{}),...(reachBaselines?{baseline:{label:'Path 1',...summary(reachBaselines.path1)},greedy_baseline:{label:'Greedy',...summary(reachBaselines.greedy)}}:{}),initial:summary(before),trained:summary(after),commands_changed:core.canonicalJSON(before.commands)!==core.canonicalJSON(after.commands),explicit_preference_labels:trained.report.explicit_preference_labels,interpretation:'Actual complete or incomplete simulated rollouts; sequence change alone is not improvement.'};
  const report={schema:'industrial-training-report-setup-1',status:'passed',runtime:{node:process.versions.node},case:context.identity,dataset:{path:datasetPath,sha256:sha(datasetRaw),size_bytes:datasetRaw.length},feedback:{path:'feedback.json',sha256:sha(feedbackRaw),size_bytes:feedbackRaw.length},initial_checkpoint:{path:'initial-checkpoint.json',sha256:sha(initialBytes),size_bytes:initialBytes.length},checkpoint:{path:'checkpoint.json',sha256:sha(checkpointRaw),size_bytes:checkpointRaw.length},source_files:sources,training:trained.report,comparison};
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output);
  const outputs={'feedback.json':feedbackRaw,'initial-checkpoint.json':initialBytes,...(named?{'baseline.json':json(named.baseline),'alternative.json':json(named.preferred)}:{}),...(reachBaselines?{'baseline.json':json(reachBaselines.path1),'greedy-baseline.json':json(reachBaselines.greedy)}:{}),'initial-policy.json':json(before),'trained-policy.json':json(after),'comparison.json':json(comparison),'training-report.json':json(report),'checkpoint.json':checkpointRaw};
  // Publish checkpoint last; partial directories remain diagnosable and are never reused.
  for(const [filename,bytes]of Object.entries(outputs))await fs.writeFile(path.join(output,filename),bytes,{flag:'wx'});
  return {output,checkpoint:path.join(output,'checkpoint.json'),report};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{if(process.argv.length===3&&process.argv[2]==='--help')console.log('node scripts/train-industrial-setup-episode.mjs --feedback FILE --expected-sha256 SHA256 --output NEW-DIRECTORY [--dataset FILE] [--initial-checkpoint FILE --initial-checkpoint-sha256 SHA256] [--alpha N --gamma N --clip N --epochs N --reward-epochs N --reward-alpha N --exploration-episodes N --seed N]');
    else{const result=await trainSetupEpisode(parseSetupTrainingArguments(process.argv.slice(2)));console.log(JSON.stringify({status:'passed',output:result.output,checkpoint:result.report.checkpoint,training:result.report.training,comparison:result.report.comparison},null,2));}}
  catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
