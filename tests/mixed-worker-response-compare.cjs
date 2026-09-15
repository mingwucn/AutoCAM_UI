const assert=require('node:assert/strict');

function bits(value){const bytes=new ArrayBuffer(8),view=new DataView(bytes);view.setFloat64(0,value);return view.getBigUint64(0);}
function compareWorkerResponse(expected,actual,{allowMixedPriorULP=false}={}){
  if(expected===actual)return {byteEqual:true,priorDifferences:[]};
  if(!allowMixedPriorULP){assert.equal(actual,expected);}
  const e=JSON.parse(expected),a=JSON.parse(actual);
  for(const v of [e,a]){assert.deepEqual(Object.keys(v).sort(),['ok','raw']);assert.equal(v.ok,true);assert.equal(typeof v.raw,'string');}
  const er=JSON.parse(e.raw),ar=JSON.parse(a.raw);
  for(const v of [er,ar]){assert.equal(v.trace?.schema,'adaptive-mixed-mcts-1');assert(Array.isArray(v.trace.root));}
  assert.equal(er.trace.root.length,ar.trace.root.length);
  const tokens=raw=>[...raw.matchAll(/"prior":(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/g)].map(m=>m[1]);
  const et=tokens(e.raw),at=tokens(a.raw),differences=[];
  assert.equal(et.length,er.trace.root.length);assert.equal(at.length,ar.trace.root.length);
  for(let i=0;i<et.length;i++){
    const ep=Number(et[i]),ap=Number(at[i]);
    for(const v of [ep,ap])assert(Number.isFinite(v)&&v>=0&&v<=1&&!Object.is(v,-0),'Invalid prior');
    assert.equal(ep,er.trace.root[i].prior);assert.equal(ap,ar.trace.root[i].prior);
    const eb=bits(ep),ab=bits(ap),distance=eb>ab?eb-ab:ab-eb;
    assert(distance<=1n,'Prior differs by more than one ULP');
    // Formatting-only drift is not silently admitted by the numerical policy.
    if(distance===0n)assert.equal(at[i],et[i]);
    if(distance)differences.push({path:`trace.root[${i}].prior`,native:ep,browser:ap,ulpDistance:Number(distance)});
  }
  const scrub=raw=>raw.replace(/"prior":(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/g,'"prior":CHECKED_PRIOR');
  assert.equal(scrub(a.raw),scrub(e.raw),'Non-prior response bytes differ');
  assert(differences.length>0,'Different response without admitted prior drift');
  return {byteEqual:false,priorDifferences:differences};
}
module.exports={compareWorkerResponse};
