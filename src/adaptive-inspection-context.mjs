import {exactNumber,validateInspectionTransition} from './adaptive-provider.mjs';

const stops={resolved:'Source classification resolved',depth_budget:'Depth limit reached',
  leaf_budget:'Cell limit reached',time_budget:'Time limit reached',cancelled:'Partition construction cancelled'};
const zero=()=>({lower_mm3:[0,1],upper_mm3:[0,1]});
const fail=()=>{throw Error('Invalid recorded transition context.');};
function volume(value){
  if(!value||Object.keys(value).sort().join('|')!=='lower_mm3|upper_mm3')fail();
  exactNumber(value.lower_mm3);exactNumber(value.upper_mm3);
  const [lo,ld]=value.lower_mm3.map(BigInt),[hi,hd]=value.upper_mm3.map(BigInt);
  if(lo<0n||hi*ld<lo*hd)fail();
  return value;
}

export function recordedPartitionContext(frame){
  if(typeof frame.stop_reason!=='string'||!frame.stop_reason||frame.stop_reason.length>256)throw Error('Invalid recorded partition stop reason.');
  const leaves=frame.domain.leaves;
  let low=20,high=0;
  for(const leaf of leaves){const depth=leaf.address.depth;
    if(!Number.isInteger(depth)||depth<0||depth>20)throw Error('Invalid recorded partition depth.');
    low=Math.min(low,depth);high=Math.max(high,depth);
  }
  if(!leaves.length)throw Error('Empty recorded partition.');
  const known=Object.hasOwn(stops,frame.stop_reason);
  return {cell_count:leaves.length,min_depth:low,max_depth:high,
    stop_reason:frame.stop_reason,stop_label:known?stops[frame.stop_reason]:'Unrecognized producer stop reason',
    stop_reason_recognized:known};
}

export function recordedTransitionContext(bundle,index){
  const frame=bundle.frames[index],result=frame.outcome?.result;
  if(result==null)return null;
  validateInspectionTransition(frame);const removed=volume(result.removed);
  const prior=bundle.frames.slice(0,index).findLast(f=>f.state_hash===result.before_hash);
  return {status:result.status,reason:result.reason,event_id:result.event_id,
    before_hash:result.before_hash,after_hash:result.after_hash,
    before_remaining:prior?volume(prior.volumes.remaining_delta):null,
    after_remaining:volume(frame.volumes.remaining_delta),
    credited_removal:result.duplicate_delivery?zero():removed,
    original_removal:result.duplicate_delivery?removed:null,duplicate_delivery:result.duplicate_delivery};
}
