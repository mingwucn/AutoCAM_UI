import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createSetupSession,reduceSetupSession,setupPresentation,setupActionTitle,commandTitle} from '../prototypes/industrial-reach/src/industrial-setup-session.mjs';
import {nextExecutableReachCommand} from '../prototypes/industrial-reach/src/industrial-reach-controls.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../prototypes/industrial-reach/examples/industrial-reach/00350/case.json',import.meta.url)));
const scene=data.scenes[0],programs=scene.workflow.demonstration_programs;
const path1=programs.find(p=>p.id===scene.workflow.plan_presentations.baseline_program_id);
const path2=programs.find(p=>p.id===scene.workflow.plan_presentations.preferred_program_id);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const acceptedIdentity=state=>digest({accepted:state.accepted.acceptedState(),mode:state.accepted.mode,commands:state.commands});
const reduce=(state,event)=>reduceSetupSession(data,state,event);
function applyPrefix(commands){
  let state=createSetupSession(data);
  for(const command of commands){state=reduce(state,{type:'choose-command',command});state=reduce(state,{type:'apply'});assert.equal(state.error,'');}
  return state;
}

test('Reach starts on a bore-intersecting section and drilling titles distinguish source depth from reach',()=>{
  const state=createSetupSession(data),command=path1.commands.find(c=>c.process==='drilling');
  const action=scene.modes.drilling.actions.find(a=>a.id===command.action_id);
  assert.equal(state.sectionAxis,0);assert.equal(state.sectionPercent,50);
  assert.match(setupActionTitle(scene,action),/00350-bore-z-24.*Ø24 mm.*source bore depth 23 mm/);
  assert.match(commandTitle(scene,command),/source bore depth 23 mm.*modeled reach 80 mm/);
  const changed=reduce(state,{type:'view',key:'sectionAxis',value:2});
  assert.equal(reduce(changed,{type:'process',mode:'drilling'}).sectionAxis,2,'Manual section choice survives process changes');
});

for(const program of [path1,path2])test('Preview then Apply follows every positive '+program.label+' command without automatic cuts',()=>{
  let state=reduce(createSetupSession(data),{type:'select-plan',programId:program.id});
  for(const command of program.commands){
    const before=acceptedIdentity(state),preview=reduce(state,{type:'preview'});
    assert.equal(acceptedIdentity(preview),before,'Next-action preview changes accepted state');
    assert.deepEqual(preview.selection,command);assert.equal(preview.preview,true);
    const shown=setupPresentation(preview,data);assert.equal(shown.canApply,true);assert(shown.evaluation.removed_voxels>0);
    state=reduce(preview,{type:'apply'});assert.equal(state.error,'');
    assert.equal(state.preview,false,'Apply must show accepted stock until another preview');
    assert.deepEqual(state.selection,command,'Apply must not select or overlay a following cut');
  }
  assert.equal(state.accepted.observation().complete,true);assert.deepEqual(state.commands,program.commands);
  const before=acceptedIdentity(state),after=reduce(state,{type:'preview'});
  assert.equal(acceptedIdentity(after),before);assert.equal(after.preview,false);assert.equal(setupPresentation(after,data).canApply,false);
});

test('Explicit short drilling stays selected and blocked until next-action preview is requested',()=>{
  let state=applyPrefix(path1.commands.slice(0,3)),before=acceptedIdentity(state);
  const short={type:'cut',process:'drilling',action_id:'drilling/drilling/reach_neg_z@40mm'};
  state=reduce(state,{type:'choose-command',command:short});
  assert.equal(acceptedIdentity(state),before);assert.deepEqual(state.selection,short);
  assert.equal(setupPresentation(state,data).canApply,false);
  const refused=reduce(state,{type:'apply'});assert.equal(acceptedIdentity(refused),before);assert.equal(refused.error,'no_material_removed');
  const next=reduce(state,{type:'preview'});assert.equal(acceptedIdentity(next),before);
  assert.deepEqual(next.selection,path1.commands[3]);assert.equal(setupPresentation(next,data).canApply,true);
});

test('An early drilling process selection does not strand next-action preview',()=>{
  const initial=createSetupSession(data),before=acceptedIdentity(initial);
  const selected=reduce(initial,{type:'process',mode:'drilling'});
  assert.equal(acceptedIdentity(selected),before);assert.equal(setupPresentation(selected,data).canApply,false);
  const next=reduce(selected,{type:'preview'});
  assert.equal(acceptedIdentity(next),before);assert.deepEqual(next.selection,path1.commands[0]);assert.equal(setupPresentation(next,data).canApply,true);
});

test('Preview exits loaded replay and resolves eligibility against accepted stock',()=>{
  const accepted=applyPrefix(path1.commands.slice(0,3)),before=acceptedIdentity(accepted);
  let replay=reduce(accepted,{type:'replay-start',commands:path2.commands});
  replay=reduce(replay,{type:'replay-seek',delta:path2.commands.length});
  const shown=setupPresentation(replay,data);
  assert.equal(shown.observation.complete,true);assert.equal(shown.canApply,false);assert.equal(acceptedIdentity(replay),before);
  assert.equal(acceptedIdentity(reduce(replay,{type:'apply'})),before,'Replay cannot Apply');
  const next=reduce(replay,{type:'preview'});
  assert.equal(next.replay,null);assert.equal(acceptedIdentity(next),before);
  assert.deepEqual(next.selection,path1.commands[3]);assert.equal(setupPresentation(next,data).canApply,true);
});

test('Loaded invalid commands fail without substituting accepted stock or leaving a replay',()=>{
  const state=applyPrefix(path1.commands.slice(0,3)),before=acceptedIdentity(state);
  const invalid=reduce(state,{type:'replay-start',commands:[{type:'cut',process:'drilling',action_id:'a-different-case/drill'}]});
  assert(invalid.error);assert.equal(invalid.replay,null);assert.equal(acceptedIdentity(invalid),before);
  const recovered=reduce(invalid,{type:'preview'});assert.equal(recovered.error,'');assert.deepEqual(recovered.selection,path1.commands[3]);
});

test('A newly initialized case exits a loaded complete replay with its own original stock',()=>{
  const fresh=createSetupSession(data),before=acceptedIdentity(fresh);
  let replay=reduce(fresh,{type:'replay-start',commands:path2.commands});
  replay=reduce(replay,{type:'replay-seek',delta:path2.commands.length});
  assert.equal(setupPresentation(replay,data).observation.complete,true);
  const live=reduce(replay,{type:'preview'});
  assert.equal(live.replay,null);assert.equal(acceptedIdentity(live),before);
  assert.equal(live.commands.length,0);assert.deepEqual(live.selection,path1.commands[0]);assert.equal(setupPresentation(live,data).canApply,true);
});

test('Restored prefixes and reset initialize next-action selection from the current accepted state',()=>{
  let state=reduce(createSetupSession(data),{type:'restore-setup',commands:path1.commands.slice(0,3)});
  assert.equal(state.error,'');assert.equal(state.preview,false);assert.equal(setupPresentation(state,data).canApply,false);
  const before=acceptedIdentity(state);state=reduce(state,{type:'preview'});
  assert.equal(acceptedIdentity(state),before);assert.deepEqual(state.selection,path1.commands[3]);
  state=reduce(state,{type:'reset'});assert.equal(state.commands.length,0);assert.equal(state.sectionAxis,0);
  state=reduce(state,{type:'preview'});assert.deepEqual(state.selection,path1.commands[0]);assert.equal(setupPresentation(state,data).canApply,true);
});

test('Restore after drilling advances preview to deep milling and terminal restore stays complete',()=>{
  let partial=reduce(createSetupSession(data),{type:'restore-setup',commands:path1.commands.slice(0,4)});
  assert.equal(partial.error,'');assert.equal(partial.accepted.planning().active_stage,'deep_features');
  const before=acceptedIdentity(partial);partial=reduce(partial,{type:'preview'});
  assert.equal(acceptedIdentity(partial),before);assert.deepEqual(partial.selection,path1.commands[4]);assert.equal(setupPresentation(partial,data).canApply,true);
  const restored=reduce(createSetupSession(data),{type:'restore-setup',commands:path1.commands});
  assert.equal(restored.error,'');assert.equal(restored.accepted.observation().complete,true);assert.equal(restored.commands.length,path1.commands.length);
  const completeBefore=acceptedIdentity(restored),next=reduce(restored,{type:'preview'});
  assert.equal(acceptedIdentity(next),completeBefore);assert.equal(next.preview,false);assert.equal(setupPresentation(next,data).canApply,false);
});

test('Divergent manual paths receive deterministic positive candidates without changing stock',()=>{
  const initial=createSetupSession(data),alternate=scene.modes.turning.actions.find(a=>a.id!==path1.commands[0].action_id&&initial.accepted.evaluateCommand({type:'cut',process:'turning',action_id:a.id}).executable);
  assert(alternate);
  const state=applyPrefix([{type:'cut',process:'turning',action_id:alternate.id}]),before=acceptedIdentity(state);
  const options={selection:state.selection,commands:state.commands,programId:state.planId};
  const first=nextExecutableReachCommand(state.accepted,options),second=nextExecutableReachCommand(state.accepted,options);
  assert(first);assert.deepEqual(first,second);assert.equal(acceptedIdentity(state),before);
  assert.equal(state.accepted.evaluateCommand(first).executable,true);
  const next=reduce(state,{type:'preview'});assert.deepEqual(next.selection,first);assert.equal(acceptedIdentity(next),before);
  const staleSelection={type:'cut',process:'milling',action_id:'a-different-case/action'};
  const recovered=nextExecutableReachCommand(state.accepted,{...options,selection:staleSelection});
  assert(recovered);assert.equal(state.accepted.evaluateCommand(recovered).executable,true);assert.equal(acceptedIdentity(state),before);
});

test('A completed accepted case can exit replay without reviving an executable action',()=>{
  const complete=applyPrefix(path1.commands),before=acceptedIdentity(complete);
  const replay=reduce(complete,{type:'replay-start',commands:path2.commands});
  const live=reduce(replay,{type:'preview'});
  assert.equal(live.replay,null);assert.equal(live.preview,false);assert.equal(acceptedIdentity(live),before);
  assert.equal(setupPresentation(live,data).canApply,false);assert.equal(live.accepted.observation().complete,true);
});
