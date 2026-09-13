import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCombinedView} from '../src/combined-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-provider.mjs';
import {prepareCadMachining} from '../src/adaptive-cad-client.mjs';

const directory=process.env.REFINED_REGIONAL_FIXTURES;
if(!directory)throw Error('Explicit refined regional fixtures required');
const bytes=n=>fs.readFileSync(path.join(directory,n));
const raw=n=>bytes(n).toString();
const hash=v=>createHash('sha256').update(v).digest('hex');

test('actual completed tube view binds refined profile to acknowledged step',async()=>{
  const configuration=parseAdaptiveJson(raw('configuration.json'));
  const step=parseAdaptiveJson(raw('turn-expected.json'));
  const view=await readCombinedView(raw('view-expected.json'),configuration,{...step.after,session_epoch:step.session_epoch});
  assert.ok(view);
  assert.equal(step.after.completion.query_profile,'regional_refined_history_1');
  assert.equal(step.after.completion.completed,true);
});

test('view rejects substituted report profiles',async()=>{
  const configuration=parseAdaptiveJson(raw('configuration.json'));
  for(const value of ['regional_positive_volume_box_1','unknown']){
    const view=parseAdaptiveJson(raw('view-expected.json'));view.observation.completion.query_profile=value;
    await assert.rejects(readCombinedView(canonicalAdaptive(view),configuration,{...view.observation,session_epoch:0}),/Regional completion profile differs/);
  }
});

test('machining transport binds policy2 to returned completion profile',async()=>{
  const configuration=raw('configuration.json'),preparation=raw('preparation.json');
  const initial=new Uint8Array(bytes('coaxial-tube-allowance.bin')),setup=new Uint8Array(bytes('setup.json')),policy=new Uint8Array(bytes('policy.json'));
  const template={id:1,type:'result',operation:'prepare_machining',configuration,configurationSHA256:hash(configuration),
    preparation,preparationSHA256:hash(preparation),initial,initialSHA256:hash(initial),setupSHA256:hash(setup),policySHA256:hash(policy)};
  let reply=template;globalThis.location=new URL('http://localhost/gym/');
  globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:structuredClone(reply)}));}terminate(){}};
  const options={workerURL:'./worker.mjs',assets:{runtimeBaseURL:'./runtime/',codeURL:'./code.zip',codeSHA256:'0'.repeat(64),
    cadModuleURL:'./cad.mjs',cadModuleSHA256:'0'.repeat(64),cadWasmURL:'./cad.wasm',cadWasmSHA256:'0'.repeat(64)}};
  const result=await prepareCadMachining({initial,setup,policy},options);assert.equal(result.configuration,configuration);
  const changed=parseAdaptiveJson(configuration);changed.completion.query_profile='regional_positive_volume_box_1';
  reply={...template,configuration:canonicalAdaptive(changed)};reply.configurationSHA256=hash(reply.configuration);
  await assert.rejects(prepareCadMachining({initial,setup,policy},options),/completion profile differs from requested policy/);
});
