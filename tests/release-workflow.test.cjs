const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {withBuildOutput}=require('../scripts/build-output.cjs');

function fixture(run){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-release-workflow-'));
  const root=path.join(temporary,'checkout'),source=path.join(root,'src'),output=path.join(root,'dist');
  fs.mkdirSync(source,{recursive:true});
  try{return run({temporary,root,source,output});}
  finally{
    const resolved=fs.realpathSync(temporary),parent=fs.realpathSync(os.tmpdir());
    if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('autocam-release-workflow-'))throw Error('Unexpected test cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
function buildFile(out,name,content='current'){
  fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});
  fs.writeFileSync(path.join(out,name),content);
  fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({schema:'shadow-gym-ui-build-1',files:[{path:name}]}));
}

test('Pages runs the adaptive preparation browser regression after installing Chromium',()=>{
  const workflow=fs.readFileSync(path.resolve(__dirname,'../.github/workflows/pages.yml'),'utf8');
  const commands=[...workflow.matchAll(/^\s*- run:\s*(.+)$/gm)].map(match=>match[1].trim());
  const command='npm run test:module3-workflow';
  assert.equal(commands.filter(value=>value===command).length,1,'Pages must execute the browser regression exactly once, without --build-only');
  const install=commands.indexOf('npx playwright install --with-deps chromium');
  assert(install>=0&&commands.indexOf(command)>install,'Install the browser before running its regression');
});

test('rebuilding replaces the complete generated tree and removes obsolete manual/example files',()=>fixture(options=>{
  withBuildOutput(options,out=>buildFile(out,'docs/old.html','obsolete'));
  withBuildOutput(options,out=>buildFile(out,'examples/current.json','{}'));
  assert(!fs.existsSync(path.join(options.output,'docs/old.html')));
  assert.equal(fs.readFileSync(path.join(options.output,'examples/current.json'),'utf8'),'{}');
  assert.deepEqual(fs.readdirSync(options.root).sort(),['dist','src']);
}));
test('failed builds preserve the previous release and remove only their own staging tree',()=>fixture(options=>{
  withBuildOutput(options,out=>buildFile(out,'index.html','previous'));
  assert.throws(()=>withBuildOutput(options,out=>{buildFile(out,'index.html','partial');throw Error('build failed');}),/build failed/);
  assert.equal(fs.readFileSync(path.join(options.output,'index.html'),'utf8'),'previous');
  assert.deepEqual(fs.readdirSync(options.root).sort(),['dist','src']);
}));
test('build publication refuses repository inputs, unowned directories and unexpected output files',()=>fixture(options=>{
  assert.throws(()=>withBuildOutput({...options,output:options.root},()=>{}),/overlaps/);
  assert.throws(()=>withBuildOutput({...options,output:path.join(options.source,'dist')},()=>{}),/overlaps/);
  fs.mkdirSync(options.output);fs.writeFileSync(path.join(options.output,'user.txt'),'preserve');
  assert.throws(()=>withBuildOutput(options,()=>{}));
  assert.equal(fs.readFileSync(path.join(options.output,'user.txt'),'utf8'),'preserve');
  buildFile(options.output,'index.html');
  assert.throws(()=>withBuildOutput(options,()=>{}),/Unmanifested/);
  assert.equal(fs.readFileSync(path.join(options.output,'user.txt'),'utf8'),'preserve');
}));
test('an explicit external build destination remains supported',()=>fixture(options=>{
  const output=path.join(options.temporary,'published');
  withBuildOutput({...options,output},out=>buildFile(out,'index.html'));
  assert.equal(fs.readFileSync(path.join(output,'index.html'),'utf8'),'current');
}));
test('release build records nested evidence manifests and accepts a fresh rebuild',()=>fixture(({output})=>{
  const checkout=path.resolve(__dirname,'..'),build=path.join(checkout,'scripts/build.cjs');
  const evidence=['docs/verification/linux/build-manifest.json','docs/verification/windows/build-manifest.json'];
  const inputs=evidence.map(name=>({name,bytes:fs.readFileSync(path.join(checkout,name))}));
  // An existing, owned release may still contain the obsolete Pages marker.
  buildFile(output,'.nojekyll','');
  for(let generation=0;generation<2;generation++){
    execFileSync(process.execPath,[build,'--out',output],{cwd:checkout,encoding:'utf8',windowsHide:true,timeout:120000,stdio:'pipe'});
    const manifest=JSON.parse(fs.readFileSync(path.join(output,'build-manifest.json'),'utf8'));
    assert(!manifest.files.some(row=>row.path==='build-manifest.json'),'Only the output-root manifest excludes itself');
    assert(!fs.existsSync(path.join(output,'.nojekyll')),'Rebuilding removes the obsolete Pages marker');
    // The configured Pages action excludes hidden paths from its uploaded tar.
    // A locally valid manifest must not promise files that production omits.
    assert.deepEqual(manifest.files.filter(row=>row.path.split('/').some(part=>part.startsWith('.'))),[],
      'Every release file must survive the configured Pages upload filtering');
    for(const {name,bytes} of inputs){
      const entries=manifest.files.filter(row=>row.path===name);
      assert.equal(entries.length,1,'Nested evidence must have exactly one output entry: '+name);
      assert.equal(entries[0].size_bytes,bytes.length);
      assert.equal(entries[0].sha256,createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual(fs.readFileSync(path.join(output,name)),bytes,'Nested evidence must be copied unchanged');
    }
  }
}));
test('Python selection uses explicit override, declared environment, then platform venv',async()=>{
  const {pythonExecutable}=await import('../scripts/python-command.mjs');
  assert.equal(pythonExecutable({override:'explicit',environment:{AUTOCAM_PYTHON:'declared'}}),'explicit');
  assert.equal(pythonExecutable({environment:{AUTOCAM_PYTHON:'declared'}}),'declared');
  assert.equal(pythonExecutable({environment:{},platform:'win32',checkout:'checkout'}),path.join('checkout','.venv','Scripts/python.exe'));
  assert.equal(pythonExecutable({environment:{},platform:'linux',checkout:'checkout'}),path.join('checkout','.venv','bin/python'));
  const launcher=path.resolve(__dirname,'../scripts/python-command.mjs');
  const actual=execFileSync(process.execPath,[launcher,'--python',process.execPath,'-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','one argument','two'],{encoding:'utf8',windowsHide:true});
  assert.deepEqual(JSON.parse(actual),['one argument','two']);
});
test('verification rejects unignored in-checkout receipts before writing and accepts ignored/external new directories',async()=>{
  const {validateVerificationOutput}=await import('../scripts/verification-output.mjs');
  fixture(({root,temporary})=>{
    execFileSync('git',['init','--quiet'],{cwd:root,windowsHide:true});
    fs.writeFileSync(path.join(root,'.gitignore'),'runs/\n');
    const ignored=path.join(root,'runs','new-run'),unignored=path.join(root,'verification-run'),external=path.join(temporary,'external-run');
    assert.equal(validateVerificationOutput(root,ignored),ignored);
    assert.equal(validateVerificationOutput(root,external),external);
    assert.throws(()=>validateVerificationOutput(root,unignored),/Git-ignored/);
    assert(!fs.existsSync(unignored));
    fs.mkdirSync(ignored,{recursive:true});
    assert.throws(()=>validateVerificationOutput(root,ignored),/already exists/);
  });
});
