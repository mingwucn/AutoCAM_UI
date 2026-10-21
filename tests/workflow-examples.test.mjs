import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {prepareWorkflowExamples} from '../scripts/prepare-workflow-examples.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-workflow-export-'));
  t.after(async()=>{const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));assert(path.basename(resolved).startsWith('autocam-workflow-export-'));await fs.rm(resolved,{recursive:true,force:true});});
  const base=path.join(root,'tests/fixtures/example'),raw=Buffer.from('{"example":"original bytes"}\n'),packed=gzipSync(raw);
  await fs.mkdir(base,{recursive:true});await fs.mkdir(path.join(root,'config'));
  const manifest={schema:'example-fixtures-1',files:[{path:'input.json',sha256:sha(raw),size_bytes:raw.length,gzip_sha256:sha(packed),gzip_size_bytes:packed.length}]};
  await fs.writeFile(path.join(base,'input.json.gz'),packed);
  const catalogue={schema:'autocam-workflow-examples-1',groups:[{id:'example',manifest:'tests/fixtures/example/manifest.json',manifest_sha256:'',files:[{source:'input.json',output:'task.json'}]}]};
  const save=async()=>{const bytes=JSON.stringify(manifest);await fs.writeFile(path.join(base,'manifest.json'),bytes);catalogue.groups[0].manifest_sha256=sha(bytes);await fs.writeFile(path.join(root,'config/workflow-examples.json'),JSON.stringify(catalogue));};
  await save();return {root,base,raw,packed,manifest,catalogue,save};
}
const absent=async filename=>assert.rejects(fs.stat(filename),{code:'ENOENT'});
test('workflow export preserves original input bytes and identifies each source manifest',async t=>{
  const f=await fixture(t),result=await prepareWorkflowExamples({root:f.root,output:'runs/first'});
  assert.deepEqual(await fs.readFile(path.join(result.output,'example/task.json')),f.raw);
  assert.equal(result.receipt.files[0].sha256,sha(f.raw));
  assert.equal(result.receipt.manifests[0].sha256,f.catalogue.groups[0].manifest_sha256);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.output,'receipt.json'),'utf8')).status,'passed');
});
test('workflow export refuses overwrite and leaves an existing user file unchanged',async t=>{
  const f=await fixture(t),out=path.join(f.root,'runs/kept');
  await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'keep.txt'),'keep');
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/kept'}),/already exists/);
  assert.equal(await fs.readFile(path.join(out,'keep.txt'),'utf8'),'keep');
  await absent(path.join(out,'receipt.json'));
});
test('workflow output cannot overlap source or escape runs',async t=>{
  const f=await fixture(t);
  for(const output of ['tests','runs','runs/../../outside','config/new'])
    await assert.rejects(prepareWorkflowExamples({root:f.root,output}),/below.*runs/);
  assert.deepEqual(await fs.readFile(path.join(f.base,'input.json.gz')),f.packed);
});
test('changed source manifest is rejected before creating an output',async t=>{
  const f=await fixture(t);await fs.appendFile(path.join(f.base,'manifest.json'),' ');
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/invalid'}),/manifest identity differs/);
  await absent(path.join(f.root,'runs/invalid'));
});
test('corrupted compressed input and mismatched expanded identity are rejected',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.base,'input.json.gz'),Buffer.alloc(f.packed.length));
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/bad-packed'}),/Compressed example identity differs/);
  await absent(path.join(f.root,'runs/bad-packed'));
  await fs.writeFile(path.join(f.base,'input.json.gz'),f.packed);
  f.manifest.files[0].sha256='0'.repeat(64);await f.save();
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/bad-raw'}),/Expanded example identity differs/);
  await absent(path.join(f.root,'runs/bad-raw'));
});
test('missing member, escaping path and unknown group cannot produce a success receipt',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/unknown',groupIds:['missing']}),/Unknown/);
  f.catalogue.groups[0].files[0].source='missing.json';await f.save();
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/missing'}),/Missing/);
  f.catalogue.groups[0].files[0]={source:'input.json',output:'../escape.json'};await f.save();
  await assert.rejects(prepareWorkflowExamples({root:f.root,output:'runs/escape'}),/Invalid relative/);
  for(const name of ['unknown','missing','escape'])await absent(path.join(f.root,'runs',name));
});
test('grouped fixture manifests export their original nested paths',async t=>{
  const f=await fixture(t),row=f.manifest.files[0];
  delete f.manifest.files;f.manifest.groups=[{id:'nested',files:[row]}];
  await fs.mkdir(path.join(f.base,'nested'));await fs.rename(path.join(f.base,'input.json.gz'),path.join(f.base,'nested/input.json.gz'));
  f.catalogue.groups[0].files[0].source='nested/input.json';await f.save();
  const result=await prepareWorkflowExamples({root:f.root,output:'runs/grouped'});
  assert.deepEqual(await fs.readFile(path.join(result.output,'example/task.json')),f.raw);
  assert.equal(result.receipt.files[0].source,'nested/input.json');
});
