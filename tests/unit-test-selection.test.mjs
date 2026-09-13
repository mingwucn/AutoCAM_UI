import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unitTestSelection} from '../scripts/unit-test-selection.mjs';

test('declared test selection rejects missing files, directories, duplicates and command options',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-test-selection-'));
 try{
  await fs.mkdir(path.join(root,'tests'));await fs.writeFile(path.join(root,'tests/real.test.mjs'),'');await fs.mkdir(path.join(root,'tests/directory'));
  assert.deepEqual(await unitTestSelection(root,'node --test tests/real.test.mjs'),['tests/real.test.mjs']);
  for(const command of ['node --test tests/real.test.mjs tests/missing.test.mjs','node --test tests/directory','node --test tests/real.test.mjs tests/real.test.mjs','node --test','node --test tests/../escape','node --test --test-only','node --test tests/*.mjs'])await assert.rejects(()=>unitTestSelection(root,command));
 }finally{
  const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));await fs.rm(resolved,{recursive:true,force:true});
 }
});
