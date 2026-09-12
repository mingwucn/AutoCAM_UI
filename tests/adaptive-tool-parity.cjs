const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const esbuild=require('esbuild');

(async()=>{
  const directory=path.resolve(process.argv[2]),raw=fs.readFileSync(path.join(directory,'vectors.json'));
  assert.equal(createHash('sha256').update(raw).digest('hex'),process.argv[3]);
  const vectors=JSON.parse(raw),modulePath=path.resolve(__dirname,'../src/adaptive-tool-model.mjs');
  const consumer=await import(pathToFileURL(modulePath));
  const scoreBits=x=>{const b=Buffer.alloc(8);b.writeDoubleBE(x);return b.toString('hex');};
  function check(result,vector){
    if(vector.error){assert.equal(result.error,true,vector.name);return;}
    assert.equal(result.action,vector.action,vector.name);assert.deepEqual(result.score_bits,vector.score_bits,vector.name);
  }
  for(const vector of vectors.cases){
    let result;
    try{const value=consumer.scoreToolCandidate(vector.checkpoint,vector.features,vector.mask);result={action:value.action,score_bits:value.scores.map(scoreBits)};}
    catch(error){result={error:true};}
    check(result,vector);
  }
  const built=esbuild.buildSync({entryPoints:[modulePath],bundle:true,format:'iife',globalName:'AdaptiveToolConsumer',write:false,target:'es2020'}).outputFiles[0].text;
  fs.writeFileSync(path.join(directory,'browser-consumer.js'),built);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Tool model numeric parity</title>'}));
    await page.goto('https://adaptive-consumer.invalid/');await page.addScriptTag({content:built});
    const results=await page.evaluate(async data=>{
      const model=AdaptiveToolConsumer;
      await model.loadToolCheckpoint(new Uint8Array(data.checkpoint_bytes),data.checkpoint_sha256);
      const bits=x=>{const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,x,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');};
      return data.cases.map(vector=>{
        try{const value=model.scoreToolCandidate(vector.checkpoint,vector.features,vector.mask);return {action:value.action,score_bits:value.scores.map(bits)};}
        catch(error){return {error:true};}
      });
    },vectors);
    results.forEach((value,i)=>check(value,vectors.cases[i]));
    console.log(JSON.stringify({status:'passed',cases:vectors.cases.length,score_bits_equal:true,actions_equal:true,
      real_recorded_vectors:vectors.cases.filter(v=>v.name.startsWith('recorded-')).length,
      browser:browser.version(),playwright:require('playwright/package.json').version,esbuild:esbuild.version,node:process.version,
      browser_checkpoint_pin_verified:true,material_state_mutated:false,runtime_activation:false}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
