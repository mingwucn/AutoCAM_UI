// Thin memory/ABI adapter. Geometry and material decisions live in C++.
export function validateStockRecipe(stock) {
  const fail=()=>{throw new Error('Invalid explicit stock recipe.');};
  if(!stock||typeof stock!=='object'||Array.isArray(stock))fail();
  const fields=stock.kind==='box'?['kind','origin_mm','size_mm']:
    stock.kind==='cylinder'?['kind','radius_mm','station_min_mm','station_max_mm']:null;
  if(!fields||Object.keys(stock).length!==fields.length||fields.some(key=>!Object.hasOwn(stock,key)))fail();
  if(stock.kind==='box') {
    for(const key of ['origin_mm','size_mm'])
      if(!Array.isArray(stock[key])||stock[key].length!==3||!stock[key].every(Number.isFinite))fail();
    if(stock.size_mm.some((size,i)=>size<=0||!Number.isFinite(stock.origin_mm[i]+size)))fail();
    return {kind:'box',origin_mm:[...stock.origin_mm],size_mm:[...stock.size_mm]};
  }
  const {radius_mm,station_min_mm,station_max_mm}=stock;
  if(![radius_mm,station_min_mm,station_max_mm].every(Number.isFinite)||radius_mm<=0||
      station_max_mm<=station_min_mm||!Number.isFinite(station_max_mm-station_min_mm))fail();
  return {kind:'cylinder',radius_mm,station_min_mm,station_max_mm};
}

export function bindBrepCore(module) {
  const vector=value=>{if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw new Error('A direction or origin must contain three finite numbers.');return value;};
  const error=module.cwrap('sg_brep_error','string',[]);
  const check=status=>{if(status)throw new Error(error()||'B-Rep operation failed.');};
  function allocate(size,work) {
    const pointer=module._malloc(Math.max(1,size));
    if(!pointer)throw new Error('The B-Rep engine ran out of memory.');
    try{return work(pointer);}finally{module._free(pointer);}
  }
  function withBytes(bytes,work) {
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    return allocate(data.byteLength,p=>{module.HEAPU8.set(data,p);return work(p,data.byteLength);});
  }
  function session(handle) {
    if(!handle)throw new Error(error()||'Unable to create a B-Rep session.');
    let open=true;
    const assertOpen=()=>{if(!open)throw new Error('This B-Rep session is closed.');};
    const metrics=operation=>{assertOpen();return allocate(32,p=>{
      check(operation(p));const v=new DataView(module.HEAPU8.buffer,p,32);
      return {removed_mm3:v.getFloat64(0,true),remaining_mm3:v.getFloat64(8,true),
        initial_excess_mm3:v.getFloat64(16,true),token:v.getUint32(24,true),revision:v.getUint32(28,true)};
    });};
    return {
      engine:'shadow-brep-1',
      observe:()=>metrics(p=>module._sg_brep_observe(handle,p)),
      preview(action) {
        const process={milling:0,turning:1}[action.process];
        const operation=action.process==='turning'?{outside:0,face_positive:1,face_negative:2}[action.operation]:0;
        if(process===undefined||operation===undefined)throw new Error('Unknown shadow action.');
        const d=vector(action.direction||[0,0,1]);
        return metrics(p=>module._sg_brep_preview(handle,process,operation,...d,action.reach_mm,p));
      },
      apply(token,revision){assertOpen();check(module._sg_brep_apply(handle,token,revision));},
      cancel(){assertOpen();check(module._sg_brep_cancel(handle));},
      reset(){assertOpen();check(module._sg_brep_reset(handle));},
      info(){assertOpen();return allocate(128,p=>{
        check(module._sg_brep_info(handle,p));const v=Array.from(new Float64Array(module.HEAPU8.buffer,p,16));
        return {stock_bounds_mm:[v.slice(0,3),v.slice(3,6)],axis:{origin_mm:v.slice(6,9),direction:v.slice(9,12)},
          stock_radius_mm:v[12],target_mm3:v[13],holding_mm3:v[14],stock_mm3:v[15]};
      });},
      mesh(layer=0,token=0,deflection=.2){assertOpen();check(module._sg_brep_mesh(handle,layer,token,deflection));
        const size=module._sg_brep_mesh_size(handle),positions=module._sg_brep_positions(handle),normals=module._sg_brep_normals(handle);
        return {positions:new Float32Array(module.HEAPU8.buffer,positions,size).slice(),
          normals:new Float32Array(module.HEAPU8.buffer,normals,size).slice()};
      },
      section(layer,token,axis,station,deflection=.1){assertOpen();
        check(module._sg_brep_section(handle,layer,token,axis,station,deflection));
        const count=module._sg_brep_section_size(handle),p=module._sg_brep_section_points(handle);
        const offsetCount=module._sg_brep_section_offset_count(handle),offsets=module._sg_brep_section_offsets(handle);
        return {positions:new Float64Array(module.HEAPU8.buffer,p,count).slice(),
          offsets:new Uint32Array(module.HEAPU8.buffer,offsets,offsetCount).slice()};
      },
      snapshot(){assertOpen();const p=module._sg_brep_snapshot(handle);
        if(!p)throw new Error(error()||'Snapshot creation failed.');
        return module.HEAPU8.slice(p,p+module._sg_brep_snapshot_size(handle));
      },
      close(){if(open){check(module._sg_brep_close(handle));open=false;}},
    };
  }
  return {
    prepare(bytes,options){
      const axis=options.axis||'Z',index=typeof axis==='string'?['X','Y','Z'].indexOf(axis):-1;
      if(typeof axis==='string'&&index<0)throw new Error('Unknown spindle axis.');
      if(typeof axis!=='string'&&typeof axis!=='object')throw new Error('Invalid spindle axis.');
      const origin=vector(typeof axis==='object'?axis.origin_mm:[0,0,0]),direction=vector(typeof axis==='object'?axis.direction:[0,0,1]);
      const recipe=Object.hasOwn(options,'stock')?validateStockRecipe(options.stock):null;
      if(recipe&&typeof module._sg_brep_prepare_stock!=='function')
        throw new Error('This B-Rep runtime does not support explicit stock recipes.');
      return withBytes(bytes,(p,size)=>{
        const args=[p,size,index,...origin,...direction,options.allowance_mm??5,
          options.holding_length_mm??5,options.held_side??-1];
        if(!recipe)return session(module._sg_brep_prepare(...args));
        const values=recipe.kind==='box'?[1,...recipe.origin_mm,...recipe.size_mm]:
          [2,recipe.radius_mm,recipe.station_min_mm,recipe.station_max_mm,0,0,0];
        return session(module._sg_brep_prepare_stock(...args,...values));
      });
    },
    restore:bytes=>withBytes(bytes,(p,size)=>session(module._sg_brep_restore(p,size))),
  };
}
