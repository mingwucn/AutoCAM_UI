const pop = Uint8Array.from({length:256},(_,value)=>{
  let count=0;
  for(;value;value&=value-1) count++;
  return count;
});

function decode(row) {
  const raw=Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));
  const out=new Uint8Array(row.bytes);let input=0,output=0;
  while(input<raw.length){
    let length=0,shift=0,value;
    do{value=raw[input++];length|=(value&127)<<shift;shift+=7;}while(value&128);
    out.fill(raw[input++],output,output+length);output+=length;
  }
  if(output!==out.length) throw new Error('Incomplete example mask');
  return out;
}

function marginalCount(live,remove) {
  let count=0;
  for(let i=0;i<live.length;i++) count+=pop[live[i]&remove[i]];
  return count;
}

export function greedyGeometricBaseline(data,scene,mode) {
  const spec=scene.modes[mode],live=decode(data.masks[scene.masks.stock]);
  const candidates=spec.actions.filter(action=>action.evaluation.available).map(action=>({...action,mask:decode(data.masks[action.remove])}));
  const sequence=[];
  while(sequence.length<data.maximumSteps){
    const ranked=candidates.map(action=>({action,removed:marginalCount(live,action.mask)})).sort((a,b)=>
      b.removed-a.removed || a.action.length-b.action.length || (a.action.id<b.action.id?-1:a.action.id>b.action.id?1:0));
    const best=ranked[0];
    if(!best || best.removed===0) break;
    sequence.push(best.action.id);
    for(let i=0;i<live.length;i++) live[i]&=~best.action.mask[i];
  }
  return sequence;
}

export const reportTeachingMeta=Object.freeze({kind:'teaching_sequence',source:'report',objective:'explain_direction_and_reach'});
export const reportGreedyMeta=Object.freeze({kind:'greedy_geometric_baseline',source:'report',objective:'maximize_new_removal'});
export const browserGreedyMeta=Object.freeze({kind:'greedy_geometric_baseline',source:'browser_generated',objective:'maximize_new_removal'});
