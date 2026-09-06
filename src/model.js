(function(root){
  'use strict';
  const pop = Uint8Array.from({length:256},(_,n)=>{let c=0;for(;n;n&=n-1)c++;return c;});
  const count = a => a.reduce((s,v)=>s+pop[v],0);
  const datasets=new WeakMap();
  function decode(row){
    if(!row || row.codec!=='packed-lsb-rle1') throw new Error('Unknown mask codec');
    const raw=typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(row.data,'base64')):Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));
    const out=new Uint8Array(row.bytes);let i=0,p=0;
    while(i<raw.length){
      let n=0,shift=0,v;
      do{if(i>=raw.length||shift>28)throw new Error('Malformed mask');v=raw[i++];n|=(v&127)<<shift;shift+=7;}while(v&128);
      if(n<=0||i>=raw.length||p+n>out.length)throw new Error('Invalid mask length');
      out.fill(raw[i++],p,p+n);p+=n;
    }
    if(p!==out.length)throw new Error('Incomplete mask');return out;
  }
  class Gym {
    constructor(data,sceneId,mode){
      if(data.schema!=='shadow-gym-visual-data-1')throw new Error('Unknown data schema');
      this.data=data;this.scene=data.scenes.find(s=>s.id===sceneId);
      if(!this.scene||!this.scene.modes[mode])throw new Error('Invalid scene or process mode');
      this.mode=mode;this.spec=this.scene.modes[mode];
      if(!datasets.has(data))datasets.set(data,{masks:new Map(),possible:new Map()});
      const shared=datasets.get(data);this.cache=shared.masks;
      this.stock=this.mask(this.scene.masks.stock);this.target=this.mask(this.scene.masks.target);this.holding=this.mask(this.scene.masks.holding);
      this.protected=Uint8Array.from(this.target,(v,i)=>v|this.holding[i]);
      this.actions=new Map(this.spec.actions.map(a=>[a.id,a]));
      const key=sceneId+'/'+mode;
      if(!shared.possible.has(key)){
        const possible=new Uint8Array(this.stock.length);
        for(const a of this.spec.actions)if(a.evaluation.available){const m=this.mask(a.remove);for(let i=0;i<m.length;i++)possible[i]|=m[i];}
        shared.possible.set(key,possible);
      }
      this.possible=shared.possible.get(key);
      this.initialExcess=this.spec.initial.residual_excess_voxels;this.reset();
    }
    mask(id){
      if(!this.cache.has(id))this.cache.set(id,decode(this.data.masks[id]));
      const m=this.cache.get(id),n=this.scene.geometry.shape.reduce((a,b)=>a*b,1);
      if(m.length!==Math.ceil(n/8))throw new Error('Scene mask size mismatch');return m;
    }
    reset(){this.live=this.stock.slice();this.steps=0;return this.observation();}
    observation(){
      let current=0,excess=0,possible=0;
      for(let i=0;i<this.live.length;i++){current+=pop[this.live[i]];excess+=pop[this.live[i]&~this.protected[i]];possible+=pop[this.live[i]&this.possible[i]];}
      const ended=excess===0||possible===0,truncated=!ended&&this.steps>=this.data.maximumSteps;
      const reason=excess===0?'excess_exhausted':possible===0?'no_available_action_can_remove_more':truncated?'step_budget_reached':'active';
      const cv=this.scene.geometry.cell_volume_mm3;
      return {mode:this.mode,step_count:this.steps,remaining_voxels:current,remaining_volume_mm3:current*cv,
        residual_excess_voxels:excess,residual_excess_mm3:excess*cv,cumulative_removed_voxels:count(this.stock)-current,
        cumulative_removed_mm3:(count(this.stock)-current)*cv,terminated:ended,truncated,terminal_reason:reason,
        action_availability:Object.fromEntries(this.spec.actions.map(a=>[a.id,a.evaluation.available]))};
    }
    evaluate(id){
      const a=this.actions.get(id);if(!a)throw new Error('Action is outside the catalog');
      const available=a.evaluation.available,remove=available?this.mask(a.remove):null,shadow=available?this.mask(a.shadow):null;
      let current=0,excess=0,removed=0,blocked=0,protectedCount=0,target=0,holding=0;
      for(let i=0;i<this.live.length;i++){
        const live=this.live[i];current+=pop[live];excess+=pop[live&~this.protected[i]];
        protectedCount+=pop[live&this.protected[i]];target+=pop[live&this.target[i]];holding+=pop[live&this.holding[i]];
        if(available){removed+=pop[live&remove[i]];blocked+=pop[live&shadow[i]];}
      }
      const cv=this.scene.geometry.cell_volume_mm3,beyond=excess-removed-blocked;
      return {action_id:id,direction_id:a.direction,length_mm:a.length,available,
        unavailable_reason:available?null:'held_end_facing',removed_voxels:removed,removed_mm3:removed*cv,
        remaining_voxels:current-removed,remaining_mm3:(current-removed)*cv,residual_excess_voxels:excess-removed,
        residual_excess_mm3:(excess-removed)*cv,shadow_blocked_voxels:available?blocked:null,
        shadow_blocked_mm3:available?blocked*cv:null,beyond_reach_voxels:available?beyond:null,
        beyond_reach_mm3:available?beyond*cv:null,protected_voxels:protectedCount,target_voxels:target,
        holding_voxels:holding,reward:this.initialExcess?removed/this.initialExcess:0,initial_excess_voxels:this.initialExcess,
        reference:a.evaluation.reference};
    }
    step(id){
      const obs=this.observation();if(obs.terminated||obs.truncated)throw new Error('Episode ended; reset before stepping');
      const evaluation=this.evaluate(id);if(!evaluation.available)throw new Error('held_end_facing');
      const remove=this.mask(this.actions.get(id).remove);
      for(let i=0;i<this.live.length;i++)this.live[i]&=~remove[i];
      this.steps++;const observation=this.observation();
      return {observation,evaluation,reward:evaluation.reward,terminated:observation.terminated,truncated:observation.truncated};
    }
    labels(id,phase='action'){
      const n=this.scene.geometry.shape.reduce((a,b)=>a*b,1),out=new Uint8Array(n);
      const a=this.actions.get(id),valid=a&&a.evaluation.available;
      const remove=valid?this.mask(a.remove):null,shadow=valid?this.mask(a.shadow):null;
      for(let i=0;i<n;i++){
        const byte=i>>3,bit=1<<(i&7);
        if(!(this.live[byte]&bit))continue;
        if(phase==='stock'){out[i]=6;continue;}
        if(this.target[byte]&bit)out[i]=1;
        else if(this.holding[byte]&bit)out[i]=2;
        else if(phase==='target')out[i]=0;
        else if(phase==='before'||phase==='remaining'||!valid)out[i]=6;
        else if(remove[byte]&bit)out[i]=phase==='after'?0:3;
        else out[i]=(shadow[byte]&bit)?4:5;
      }
      return out;
    }
  }
  const api={Gym,decode,count};root.ShadowModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
