// Serialization only. State and transition metrics originate in the shared core.
import {validateStockRecipe} from './brep-core.mjs';
export function createBrepEpisode({fileName,modelHash,runtime,options,initialFrame,history}) {
  if(!/^[a-f0-9]{64}$/.test(modelHash||'')||runtime?.version!=='shadow-brep-1'||runtime?.runtime!=='wasm')
    throw new Error('The STEP and runtime identities must be ready before exporting.');
  for(const field of ['wasm_sha256','module_sha256'])
    if(!/^[a-f0-9]{64}$/.test(runtime.build?.[field]||''))throw new Error('The B-Rep runtime identity is unavailable.');
  const {revision,remaining_mm3,initial_excess_mm3}=initialFrame.observation;
  return {schema:'shadow-gym-brep-episode-1',engine:runtime,units:'mm',
    model:{name:fileName,sha256:modelHash},
    setup:{axis:initialFrame.info.axis,allowance_mm:options.allowance_mm,
      holding_length_mm:options.holding_length_mm,held_side:options.held_side,
      ...(Object.hasOwn(options,'stock')?{stock:validateStockRecipe(options.stock)}:{})},
    initial:{revision,remaining_mm3,initial_excess_mm3},
    actions:history.map((row,index)=>({index:index+1,status:'committed',source:'manual',
      action:{process:row.process,direction:row.process==='turning'?[0,0,1]:row.direction,
        operation:row.process==='milling'?'outside':row.operation,reach_mm:row.reach_mm},
      before_revision:row.before_revision,after_revision:row.revision,before_mm3:row.before_mm3,
      removed_mm3:row.removed_mm3,remaining_mm3:row.remaining_mm3}))};
}
