import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import * as core from '../src/industrial-learning.mjs';
import {INDUSTRIAL_CASES,prepareIndustrialLearningData} from '../scripts/fetch-industrial-learning-data.mjs';
import {trainIndustrialEpisode} from '../scripts/train-industrial-episode.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const name={'--site':'site','--output':'output'}[args[i]];if(!name||!args[i+1]||name in options)throw Error('Usage: node tests/industrial-learning-browser.mjs [--site DIR] [--output NEW-DIR]');options[name]=args[i+1];}
const site=path.resolve(options.site||path.join(root,'dist')),output=path.resolve(options.output||path.join(root,'test-results','industrial-learning'));
await assert.rejects(fs.stat(output),{code:'ENOENT'});
await fs.mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const writeJSON=(filename,value)=>fs.writeFile(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sourceNames=['src/model.js','src/industrial-learning.mjs','src/app.jsx','src/industrial-learning-panel.jsx','src/industrial-learning-worker.mjs','scripts/train-industrial-episode.mjs'];
async function sourcePins(){return Promise.all(sourceNames.map(async name=>({path:name,sha256:sha(await fs.readFile(path.join(root,name)))})));}
const initialSourcePins=await sourcePins(),servers=[],trainingReports=new Map();
const buildRecordBytes=await fs.readFile(path.join(site,'execution-build.json')),buildRecord=JSON.parse(buildRecordBytes);
for(const source of initialSourcePins){
  const builtPath=source.path.replace(/^src\//,'ui_source/').replace(/^scripts\//,'build_scripts/');
  assert.equal(buildRecord.inputs.find(row=>row.path===builtPath)?.sha256,source.sha256,'Build is stale for '+source.path);
}
const escapeHTML=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function serve(folder,{prefix='/',cors=false,reports=false}={}){
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(!pathname.startsWith(prefix)){res.statusCode=404;return res.end();}
      if(cors)res.setHeader('Access-Control-Allow-Origin','*');
      if(reports){
        const caseId=pathname.slice(prefix.length).replace(/\.html$/,'');
        const report=trainingReports.get(caseId);if(!report){res.statusCode=404;return res.end();}
        const summary={status:report.status,case_id:report.dataset.case_id,td_updates:report.training.td_updates,experience_transitions:report.training.experience_transitions,
          actual_feedback_choice_changed:report.training.actual_feedback_choice_changed,
          preference_probabilities_before:report.training.preferences_before,preference_probabilities_after:report.training.preferences_after,
          policy_choices:report.training.policy_choices,
          configuration:report.training.configuration,runtime:report.runtime,dataset:report.dataset,feedback:report.feedback,checkpoint:report.checkpoint};
        res.setHeader('Content-Type','text/html');
        return res.end('<!doctype html><meta charset="utf-8"><title>Local training output</title><style>body{font:16px/1.5 system-ui;color:#183442;max-width:1100px;margin:40px auto}h1{color:#004070}pre{padding:24px;background:#eef4f6;white-space:pre-wrap;font:13px/1.5 monospace}p{max-width:900px}</style><h1>Local training output · '+escapeHTML(caseId)+'</h1><p>Projection of the saved Node.js training-report.json. Reward fitting and simulated temporal-difference RL completed with the feedback bundle downloaded from the browser.</p><pre>'+escapeHTML(JSON.stringify(summary,null,2))+'</pre>');
      }
      const relative=pathname.slice(prefix.length)||'index.html',filename=path.resolve(folder,relative);
      if(!filename.startsWith(folder+path.sep)){res.statusCode=404;return res.end();}
      const stat=await fs.stat(filename);if(!stat.isFile()){res.statusCode=404;return res.end();}
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type',filename.endsWith('.json')?'application/json':/\.m?js$/.test(filename)?'text/javascript':filename.endsWith('.wasm')?'application/wasm':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/html');
      res.end(await fs.readFile(filename));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
  return 'http://127.0.0.1:'+server.address().port+prefix;
}
const uiBase=await serve(site,{prefix:'/AutoCAM_UI/'}),dataBase=await serve(path.join(root,'.test-data'),{cors:true}),reportBase=await serve(output,{prefix:'/training/',reports:true});
let browser;
const report={schema:'industrial-browser-regression-1',status:'running',browser:process.platform==='win32'?'Edge':'Chromium',site,execution_build_sha256:sha(buildRecordBytes),industrial_worker_sha256:sha(await fs.readFile(path.join(site,'assets','industrial-learning-worker.js'))),source_files:initialSourcePins,cases:[],page_errors:[],interpretation:'Automated software verification with explicit illustrative preference labels. No independent human acceptance or manufacturing qualification.'};
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  page.setDefaultTimeout(120000);page.on('pageerror',error=>report.page_errors.push(error.message));
  const status=page.getByTestId('industrial-learning-status');
  const snap=()=>page.evaluate(()=>shadowApp.snapshot());
  const accepted=()=>page.evaluate(async()=>{
    const snapshot=shadowApp.snapshot(),bytes=Uint8Array.from(snapshot.material);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return {scene:snapshot.scene,stock_sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),
      history:snapshot.history,step_count:snapshot.observation.step_count,residual_excess_mm3:snapshot.observation.residual_excess_mm3};
  });
  const protectedStock=()=>page.evaluate(()=>{
    const data=shadowApp.caseData(),scene=data.scenes[0],material=shadowApp.snapshot().material;
    return ['target','holding'].every(role=>Array.from(ShadowModel.decode(data.masks[scene.masks[role]])).every((bits,index)=>(bits&material[index])===bits));
  });
  const idle=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="Load industrial model"]')?.disabled);
  async function download(button,name){
    const [result]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:button,exact:true}).click()]);
    const filename=path.join(output,name);await result.saveAs(filename);await idle();
    return {path:filename,bytes:await fs.readFile(filename),value:JSON.parse(await fs.readFile(filename,'utf8'))};
  }
  async function selectAction(action){
    await page.locator('#mode').selectOption(action.process);
    const selected=await page.evaluate(action=>{
      const scene=shadowApp.caseData().scenes[0],row=scene.modes[action.process].actions.find(row=>row.id===action.action_id);
      return {direction:row.direction,index:scene.lengths.indexOf(row.length)};
    },action);
    await page.locator('#direction').selectOption(selected.direction);
    await page.locator('#length').fill(String(selected.index));
  }
  async function screenshot(stage,caseId,label){const filename='industrial-'+caseId+'-'+label+'.png';await stage.screenshot({path:path.join(output,filename)});return filename;}
  async function requestSuggestion(command,expected){
    const before=await accepted();
    await page.getByRole('button',{name:command==='policy'?'Suggest industrial policy':'Search industrial MCTS',exact:true}).click();
    await status.filter({hasText:command==='policy'?'Industrial policy suggestion ready.':'Industrial MCTS suggestion ready.'}).waitFor();
    await idle();assert.deepEqual(await accepted(),before,'suggestion must preserve accepted stock/history');
    const text=await page.getByTestId('industrial-suggestion').textContent();
    assert(text.includes(command==='policy'?'policy action value (Q)':'MCTS backed-up return'));
    if(command==='search'){
      const budgetText=await page.getByTestId('industrial-search-budget').textContent();
      assert(budgetText.includes(expected.budget.completed+' / '+expected.budget.simulations));
      assert(budgetText.includes(expected.budget.expanded_root_actions+' / '+expected.budget.eligible_root_actions));
    }
    if(expected?.action){const row=await page.evaluate(action=>shadowApp.caseData().scenes[0].modes[action.process].actions.find(row=>row.id===action.action_id),expected.action);assert(text.includes(row.label));assert(text.includes(row.length+' mm'));assert(text.includes(expected.action.process==='turning'?'Turning':'Milling'));}
    return text;
  }
  async function generateMCTSSequence(context,model,label){
    const actions=[],searches=[];
    let episode=await core.makeEpisode(context,actions);
    for(let index=0;index<32&&!episode.summary.final_observation.terminated;index++){
      const result=await core.searchMCTS(context,actions,model,{simulations:16,depth:2,exploration:1});
      searches.push({prefix_length:actions.length,action:result.action,budget:result.budget});
      if(!result.action)break;
      actions.push(result.action);
      episode=await core.makeEpisode(context,actions,{reasons:actions.map(()=> 'Bounded model-guided MCTS choice through simulator hard gates; automated comparison.')});
      if(actions.length%4===0)console.log(label+' MCTS rollout: '+context.case.scene_id+' · '+actions.length+'/32 actions · residual '+episode.summary.residual_excess_mm3+' mm3');
    }
    return {episode,searches,budget:{max_actions:32,simulations_per_action:16,depth:2,total_completed_simulations:searches.reduce((sum,search)=>sum+search.budget.completed,0),applied_actions:actions.length},stop_reason:episode.complete?'sampled_excess_exhausted':actions.length===32?'rollout_action_budget_reached':episode.summary.terminal_reason};
  }
  for(const caseId of Object.keys(INDUSTRIAL_CASES)){
    console.log('Industrial real-browser workflow: '+caseId);
    const dataPin=await prepareIndustrialLearningData({caseId}),data=JSON.parse(await fs.readFile(dataPin.path,'utf8'));
    const context=await core.createIndustrialContext(data),baseline=await core.generateBaseline(context),reverse=await core.generateBaseline(context,{processOrder:['milling','turning']});
    const initial=core.createInitialModel(context),initialPolicy=await core.suggestPolicy(context,[],initial),preferredKind=initialPolicy.action.process==='turning'?'milling':'turning';
    await page.goto(uiBase+'index.html?data='+encodeURIComponent(dataBase+'catalog.json')+'&case='+caseId+'&process=turning#gym');
    await page.waitForFunction(id=>window.shadowApp?.snapshot().scene===id,caseId);
    await page.getByRole('heading',{name:/Industrial rules, preferences and RL/}).waitFor();
    const initialStock=await accepted(),screenshots={};
    await page.getByRole('button',{name:'Generate rule baseline',exact:true}).click();
    await page.getByTestId('industrial-baseline').waitFor();await idle();
    assert.deepEqual(await accepted(),initialStock,'baseline generation is read-only');
    const downloadedBaseline=await download('Download rule baseline',caseId+'-baseline-ui.json');
    assert.deepEqual(downloadedBaseline.value,baseline);
    screenshots.baseline=await screenshot(page.locator('.industrial-stage').nth(0),caseId,'baseline');
    // The existing explicit controls accept each alternative action separately.
    const alternativeResiduals=[];
    for(const action of reverse.actions){
      await selectAction(action);assert(await page.locator('#apply').isEnabled());await page.locator('#apply').click();
      assert.equal((await snap()).history.at(-1).id,action.action_id);assert(await protectedStock());
      alternativeResiduals.push((await snap()).observation.residual_excess_mm3);
    }
    assert.equal((await snap()).observation.residual_excess_mm3,0);
    const downloadedAlternative=await download('Download industrial decisions',caseId+'-alternative-ui.json');
    assert.deepEqual(downloadedAlternative.value.actions,reverse.actions);assert.equal(downloadedAlternative.value.complete,true);
    await core.replayEpisode(context,downloadedAlternative.value);
    await page.getByRole('button',{name:'Save my sequence as alternative',exact:true}).click();
    await status.filter({hasText:'Your complete sequence is saved as the alternative.'}).waitFor();await idle();
    const completedAlternative=await accepted();
    await page.locator('#reset').click();assert.deepEqual(await accepted(),initialStock);
    await page.getByLabel('Restore industrial decisions',{exact:true}).setInputFiles(downloadedAlternative.path);
    await status.filter({hasText:'Industrial decisions restored.'}).waitFor();await idle();
    assert.deepEqual(await accepted(),completedAlternative);
    await page.locator('#reset').click();assert.deepEqual(await accepted(),initialStock);
    await page.getByLabel('Load sequence alternative',{exact:true}).setInputFiles(downloadedAlternative.path);
    await status.filter({hasText:'Complete sequence alternative loaded'}).waitFor();await idle();
    assert.deepEqual(await accepted(),initialStock);
    await page.getByLabel('Preferred whole sequence',{exact:true}).selectOption(preferredKind==='turning'?'baseline':'alternative');
    await page.getByRole('button',{name:'Add whole-sequence preference',exact:true}).click();
    await status.filter({hasText:'Whole-sequence preference saved'}).waitFor();await idle();
    await page.getByLabel('Preferred action kind',{exact:true}).selectOption(preferredKind);
    await page.getByRole('button',{name:'Add action-kind preference',exact:true}).click();
    await status.filter({hasText:'Case-scoped action-kind preference saved'}).waitFor();await idle();
    assert.deepEqual(await accepted(),initialStock);
    screenshots.feedback=await screenshot(page.locator('.industrial-stage').nth(1),caseId,'feedback');
    const downloadedFeedback=await download('Download industrial feedback',caseId+'-feedback-ui.json');
    assert.equal(downloadedFeedback.value.sequence_preferences.length,1);assert.equal(downloadedFeedback.value.action_preferences.length,1);
    assert.equal(downloadedFeedback.value.action_preferences[0].preferred_kind,preferredKind);
    assert.deepEqual(downloadedFeedback.value.action_preferences[0].actions,[]);
    await page.getByRole('button',{name:'Use initial model',exact:true}).click();await idle();
    const initialPolicyUI=await requestSuggestion('policy',initialPolicy);
    const initialMCTS=await core.searchMCTS(context,[],initial,{simulations:16,depth:2,exploration:1});
    const initialMCTSUI=await requestSuggestion('search',initialMCTS);
    assert.deepEqual(await accepted(),initialStock);
    console.log('Training UI feedback locally: '+caseId);
    const trained=await trainIndustrialEpisode({feedback:downloadedFeedback.path,expectedSha256:sha(downloadedFeedback.bytes),output:path.join(output,caseId+'-training')});
    const model=JSON.parse(await fs.readFile(trained.checkpoint,'utf8'));await core.validateCheckpoint(context,model);
    trainingReports.set(caseId,trained.report);
    const trainingPage=await browser.newPage({viewport:{width:1280,height:1000}});
    await trainingPage.goto(reportBase+caseId+'.html');assert.equal(await trainingPage.title(),'Local training output');
    screenshots.training=await screenshot(trainingPage,caseId,'training');await trainingPage.close();
    await page.getByLabel('Load industrial model',{exact:true}).setInputFiles(trained.checkpoint);
    await status.filter({hasText:'Compatible industrial model loaded.'}).waitFor();await idle();
    screenshots.model_loaded=await screenshot(page.locator('.industrial-stage').nth(2),caseId,'model-loaded');
    assert.deepEqual(await accepted(),initialStock);
    const updatedPolicy=await core.suggestPolicy(context,[],model),updatedPolicyUI=await requestSuggestion('policy',updatedPolicy);
    const updatedMCTS=await core.searchMCTS(context,[],model,{simulations:16,depth:2,exploration:1}),updatedMCTSUI=await requestSuggestion('search',updatedMCTS);
    screenshots.search=await screenshot(page.locator('.industrial-stage').nth(2),caseId,'search');
    assert(updatedMCTS.budget.max_depth_reached>=2,'MCTS must search beyond the root under its stated budget');
    await page.getByRole('button',{name:'Preview suggested action',exact:true}).click();assert.deepEqual(await accepted(),initialStock);
    await page.locator('#apply').click();const applied=await accepted();assert.equal(applied.step_count,1);assert(await protectedStock());
    assert.deepEqual({process:applied.history[0].process,action_id:applied.history[0].id},updatedMCTS.action);
    screenshots.applied=await screenshot(page.locator('.gym-state'),caseId,'applied');
    // Wrong-case imports cannot replace the accepted history or loaded model.
    const modelLabel=await page.getByTestId('industrial-model').textContent(),wrong=structuredClone(model);
    wrong.case.scene_id=caseId==='industrial'?'industrial_00289':'industrial';
    await page.getByLabel('Load industrial model',{exact:true}).setInputFiles({name:'wrong-case-checkpoint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wrong))});
    await status.filter({hasText:'identity differs'}).waitFor();await idle();
    assert.equal(await page.getByTestId('industrial-model').textContent(),modelLabel);assert.deepEqual(await accepted(),applied);
    await page.locator('#reset').click();assert.deepEqual(await accepted(),initialStock);
    await page.getByLabel('Industrial MCTS simulations',{exact:true}).selectOption('64');
    await page.getByLabel('Industrial MCTS depth',{exact:true}).selectOption('4');
    await page.getByRole('button',{name:'Search industrial MCTS',exact:true}).click();
    await status.filter({hasText:'Industrial MCTS:'}).waitFor();
    await page.getByRole('button',{name:'Cancel industrial computation',exact:true}).click();
    await status.filter({hasText:'Computation cancelled.'}).waitFor();await page.waitForTimeout(150);
    assert.deepEqual(await accepted(),initialStock);assert.equal(await page.getByTestId('industrial-suggestion').count(),0);
    assert.equal(await page.getByTestId('industrial-model').textContent(),modelLabel);
    // Capture full policy sequences and every baseline-prefix decision, including unchanged ones.
    const initialSequence=await core.generateModelSequence(context,initial),updatedSequence=await core.generateModelSequence(context,model),choices=[];
    for(let index=0;index<=baseline.actions.length;index++){
      const actions=baseline.actions.slice(0,index),before=await core.suggestPolicy(context,actions,initial),after=await core.suggestPolicy(context,actions,model);
      choices.push({baseline_prefix_length:index,actions,before:before.action,after:after.action,changed:JSON.stringify(before.action)!==JSON.stringify(after.action)});
    }
    const initialMCTSSequence=await generateMCTSSequence(context,initial,'Initial'),mctsSequence=await generateMCTSSequence(context,model,'Updated');
    const returns={};
    for(const [name,episode] of Object.entries({baseline,initial_policy:initialSequence,updated_policy:updatedSequence,initial_mcts:initialMCTSSequence.episode,updated_mcts:mctsSequence.episode}))returns[name]=await core.evaluateEpisode(context,episode,model);
    const comparison={schema:'industrial-browser-comparison-1',case_id:caseId,feedback_origin:'Illustrative explicit labels entered through the browser regression, not independent human acceptance.',
      preferred_kind:preferredKind,baseline,alternative:downloadedAlternative.value,initial_policy:initialSequence,updated_policy:updatedSequence,
      initial_mcts:initialMCTS,updated_mcts:updatedMCTS,initial_mcts_sequence:initialMCTSSequence.episode,initial_mcts_rollout_budget:initialMCTSSequence.budget,initial_mcts_stop_reason:initialMCTSSequence.stop_reason,
      updated_mcts_sequence:mctsSequence.episode,updated_mcts_searches:mctsSequence.searches,updated_mcts_rollout_budget:mctsSequence.budget,updated_mcts_stop_reason:mctsSequence.stop_reason,
      episode_returns_under_updated_model:returns,baseline_prefix_choices:choices,training:trained.report.training,
      initial_action_changed:JSON.stringify(initialPolicy.action)!==JSON.stringify(updatedPolicy.action),
      mcts_action_changed:JSON.stringify(initialMCTS.action)!==JSON.stringify(updatedMCTS.action)};
    assert.equal(initialSequence.complete,true);assert.equal(updatedSequence.complete,true);
    assert(trained.report.training.actual_feedback_choice_changed,'matched-experience comparison must demonstrate an actual feedback choice effect');
    assert(comparison.initial_action_changed,'preference example must change an actual initial policy action');
    if(caseId==='industrial')assert.deepEqual([baseline.summary.final_observation.cumulative_removed_mm3+baseline.summary.residual_excess_mm3,...baseline.steps.map(step=>step.residual_excess_mm3)],[388600,286750,33236,0]);
    await writeJSON(path.join(output,caseId+'-comparison.json'),comparison);
    report.cases.push({case_id:caseId,preferred_kind:preferredKind,initial_stock:initialStock.stock_sha256,alternative_residuals:alternativeResiduals,
      feedback_sha256:sha(downloadedFeedback.bytes),checkpoint_sha256:trained.report.checkpoint.sha256,baseline_steps:baseline.actions.length,
      initial_policy_steps:initialSequence.actions.length,updated_policy_steps:updatedSequence.actions.length,
      initial_mcts_steps:initialMCTSSequence.episode.actions.length,initial_mcts_complete:initialMCTSSequence.episode.complete,initial_mcts_residual_mm3:initialMCTSSequence.episode.summary.residual_excess_mm3,
      updated_mcts_steps:mctsSequence.episode.actions.length,updated_mcts_complete:mctsSequence.episode.complete,updated_mcts_residual_mm3:mctsSequence.episode.summary.residual_excess_mm3,
      updated_mcts_rollout_budget:mctsSequence.budget,updated_mcts_stop_reason:mctsSequence.stop_reason,
      episode_returns_under_updated_model:returns,
      initial_policy_ui:initialPolicyUI,updated_policy_ui:updatedPolicyUI,initial_mcts_ui:initialMCTSUI,updated_mcts_ui:updatedMCTSUI,
      initial_action_changed:comparison.initial_action_changed,mcts_action_changed:comparison.mcts_action_changed,
      matched_experience_feedback_choice_changed:trained.report.training.actual_feedback_choice_changed,
      unchanged_baseline_prefixes:choices.filter(choice=>choice.before&&!choice.changed).map(choice=>choice.baseline_prefix_length),
      search_budget:updatedMCTS.budget,cancelled_search_preserved_stock:true,failed_import_preserved_model:true,protected_stock_preserved:true,screenshots});
    assert.deepEqual(await sourcePins(),initialSourcePins,'source changed during real browser verification');
  }
  assert.deepEqual(report.page_errors,[]);report.status='passed';
  await writeJSON(path.join(output,'INDUSTRIAL_BROWSER_QA.json'),report);
  console.log(JSON.stringify({status:report.status,output,cases:report.cases.map(({case_id,initial_action_changed,mcts_action_changed,matched_experience_feedback_choice_changed})=>({case_id,initial_action_changed,mcts_action_changed,matched_experience_feedback_choice_changed})),page_errors:report.page_errors}));
}catch(error){report.status='failed';report.error=error.stack||String(error);await writeJSON(path.join(output,'INDUSTRIAL_BROWSER_FAILURE.json'),report);throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
