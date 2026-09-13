import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {task5TrainingGuide,recordedTrainingGuide} from '../src/adaptive-training-guide.mjs';

const episode={schema:'adaptive-browser-episode-1',task:{schema:'adaptive-mill-turn-core-roughing-task-5'},records:[{operation:'reset'},{operation:'step'}]};
test('guide binds exact download bytes, retains newlines and ignores untrusted labels',async()=>{
  const raw=JSON.stringify({...episode,label:'`$(Get-Content secrets)` <script>evil()</script>'});
  const expected=createHash('sha256').update(raw).digest('hex'),guide=await task5TrainingGuide(raw);
  assert.equal(guide.episodeSHA256,expected);assert.ok(Object.isFrozen(guide));
  assert.ok(guide.text.includes(`--expected-sha256 ${expected}`));assert.ok(guide.text.includes('```powershell\n'));
  assert.ok(guide.text.includes('train_recorded_remaining.py `\n'));assert.ok(!guide.text.includes('secrets'));
  assert.notEqual((await task5TrainingGuide(raw+'\n')).episodeSHA256,expected);
});
test('guide rejects other formats and empty demonstrations',async()=>{
  for(const raw of [null,'bad JSON',JSON.stringify({...episode,task:{schema:'adaptive-mill-turn-core-roughing-task-4'}}),JSON.stringify({...episode,records:[{}]})]){
    await assert.rejects(()=>task5TrainingGuide(raw));
  }
});

test('shared guide selects task6 explicitly while preserving task5 text',async()=>{
  const old=JSON.stringify(episode);
  assert.deepEqual(await recordedTrainingGuide(old),await task5TrainingGuide(old));
  const raw=JSON.stringify({...episode,task:{schema:'adaptive-mill-turn-core-roughing-task-6',label:'$(bad)'}});
  const guide=await recordedTrainingGuide(raw);
  assert.equal(guide.episodeSHA256,createHash('sha256').update(raw).digest('hex'));
  assert.ok(guide.text.includes('my-task6-training'));assert.ok(guide.text.includes('compatible task-6 Gym'));
  assert.ok(!guide.text.includes('$(bad)'));await assert.rejects(()=>task5TrainingGuide(raw));
  await assert.rejects(()=>recordedTrainingGuide(JSON.stringify({...episode,task:{schema:'adaptive-mill-turn-core-roughing-task-7'}})));
});
