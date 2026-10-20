import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {module3Capabilities,capabilityFor,preparedCapability,validateCapabilityRegistry} from '../src/module3-capabilities.mjs';

test('every accepted prepared task schema has an explicit capability family',async()=>{
  const source=await fs.readFile(new URL('../src/adaptive-prepared-case.mjs',import.meta.url),'utf8');
  const schemas=[...new Set([...source.matchAll(/'(adaptive-[a-z0-9-]+(?:config|task)-\d+)'/g)].map(m=>m[1]))];
  assert.ok(schemas.length>=20);
  for(const schema of schemas)assert.ok(capabilityFor({schema}),`Missing capability for ${schema}`);
});
test('rational stays preparation-only while regional inference retains its exact runtime/model restrictions',()=>{
  const rational=capabilityFor({profile:'rational_nominal'});
  assert.equal(rational.stages.prepare.status,'restricted');assert.equal(rational.stages.inspect.status,'restricted');
  for(const stage of ['machine','record_replay','policy','mcts','training'])assert.equal(rational.stages[stage].status,'unavailable');
  const regional=capabilityFor({schema:'adaptive-combined-browser-config-3'});
  assert.equal(regional.stages.machine.status,'restricted');
  for(const stage of ['policy','mcts','training'])assert.equal(regional.stages[stage].status,'restricted');
  assert.match(regional.stages.policy.detail,/inference_available/);
  assert.match(regional.model,/adaptive-regional-objective-linear-q-1/);
});
test('unknown schemas and profiles remain unknown even with a recognized fallback kind',()=>{
  assert.equal(capabilityFor({schema:'future-task',kind:'classic-sampled'}),null);
  assert.equal(capabilityFor({profile:'free-form-cad',kind:'brep'}),null);
  assert.equal(preparedCapability({kind:'adaptive-live',task:{schema:'future-task'}}),null);
  assert.equal(preparedCapability({scenes:[{}]}).id,'classic-step-voxel');
});
test('local trainers distinguish bundled mixed/task5/task6 routes from external model families',()=>{
  const bundled=module3Capabilities.families.filter(f=>f.stages.training.status==='supported').map(f=>f.id).sort();
  assert.deepEqual(bundled,['mixed-learning','task-5','task-6']);
  assert.equal(capabilityFor({schema:'adaptive-cylindrical-policy-browser-config-1'}).stages.mcts.status,'restricted');
  assert.equal(capabilityFor({schema:'adaptive-cylindrical-policy-browser-config-1'}).stages.training.status,'restricted');
  assert.equal(capabilityFor({schema:'adaptive-combined-browser-config-1'}).stages.training.status,'external');
  assert.match(capabilityFor({schema:'adaptive-combined-browser-config-2'}).stages.training.detail,/--task-version 2/);
  assert.match(capabilityFor({schema:'adaptive-combined-browser-config-3'}).stages.training.detail,/--task-version 3/);
});
test('registry rejects missing restrictions, ambiguous routes and missing stages',()=>{
  for(const mutate of [r=>{delete r.families[0].stages.policy;},r=>{r.families[0].stages.policy.detail='';},r=>{r.families[1].kinds=r.families[0].kinds;},r=>{r.families[0].stages.policy.status='approved';},r=>{r.families[0].verification=[];},r=>{r.families[0].verification[0].path='../outside';}]){
    const copy=structuredClone(module3Capabilities);mutate(copy);assert.throws(()=>validateCapabilityRegistry(copy));
  }
  assert.ok(Object.isFrozen(module3Capabilities.families[0].stages));
});
test('all family verification references resolve in the standalone checkout and state their evidence level',async()=>{
  const paths=new Set(module3Capabilities.families.flatMap(f=>f.verification.map(ref=>ref.path)));
  for(const path of paths)assert.ok((await fs.stat(new URL('../'+path,import.meta.url))).isFile(),path);
  assert.ok(paths.has('tests/recorded-training-ui-browser.mjs'));
  assert.ok(paths.has('python/verify_cylindrical_examples.py'));
});
