import {commandTitle} from './industrial-setup-session.mjs';
import {pathProgram,pathEntries,pathCounts,hasReachControls} from './industrial-path-presentation.mjs';
import {formatNumber as fmt} from './use-gym-session.js';

export function PathOutline({scene,plan,events=[],completedCount=0,acceptedOnly=false,testId}){
  const program=pathProgram(scene,plan.program_id),counts=pathCounts(scene,plan),reach=hasReachControls(scene);
  return <div className="named-path-outline" data-testid={testId} data-program-id={plan.program_id}>
    {!acceptedOnly&&<p className="named-path-counts">{counts.stages} main stages · {counts.cuts} {reach?'reach decisions':'detailed cuts'} · {counts.setups} setup changes</p>}
    {pathEntries(plan).map(group=>{
      const indices=group.command_indices.filter(i=>!acceptedOnly||i<completedCount);if(!indices.length&&acceptedOnly)return null;
      const finishing=group.kind==='stage'&&group.number===plan.stages.length;
      const complete=group.command_indices.every(i=>i<completedCount),done=group.command_indices.filter(i=>i<completedCount).length;
      return <section key={group.id} className={'named-path-group '+(group.kind==='auxiliary'?'named-path-auxiliary':'')+(finishing?' named-path-finishing':'')} data-main-stage={group.kind==='stage'?group.number:undefined} data-auxiliary={group.kind==='auxiliary'?group.id:undefined}>
        <details><summary>{group.kind==='stage'&&<span className="named-path-number">{group.number}</span>}<strong>{group.label}</strong><span>{group.command_indices.length?group.command_indices.length+' '+(reach?'decisions':finishing?'finishing cuts':group.command_indices.length===1?'cut':'cuts'):'No additional removal'}{reach&&finishing?' · 9 finishing checks':''}{completedCount>0?' · '+(complete?'complete':done+' / '+group.command_indices.length+' applied'):''}</span></summary>
          <ol className="named-path-cuts">{indices.map(index=>{const event=events[index],command=program.commands[index];return <li key={index} data-command-index={index}><span>{commandTitle(scene,command)}{finishing&&<small className="finishing-badge">Finishing</small>}</span><span>{event?fmt(event.removed_mm3)+' mm³ removed':index<completedCount?'Applied':'Planned cut'}</span></li>;})}</ol>
        </details>
      </section>;
    })}
  </div>;
}
