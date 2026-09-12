export function preparedCaseConfiguration(configuration,item){
  if(Object.hasOwn(item,'removalWeights')&&(item.removalWeights!==true||item.remainingWeights!==true))
    throw new Error('Invalid case removal weights selection');
  if(!Object.hasOwn(item,'remainingWeights'))return configuration;
  if(item.remainingWeights!==true||configuration.historyQuery!==true||!configuration.volumeQuery)
    throw new Error('Invalid case remaining weights selection');
  return {...configuration,remainingWeights:true,...(item.removalWeights?{removalWeights:true}:{})};
}

export function preparedMachiningRuntimeConfiguration(configuration,cadConfiguration,baseURL){
  const cad=cadConfiguration?.assets;
  if(!configuration||typeof configuration.workerURL!=='string'||!configuration.workerURL.length)
    throw new Error('Prepared machining Gym worker is missing');
  if(!cad||['runtimeBaseURL','codeURL'].some(key=>typeof cad[key]!=='string'||!cad[key].length)||
     typeof cad.codeSHA256!=='string'||! /^[0-9a-f]{64}$/.test(cad.codeSHA256))
    throw new Error('Prepared machining Python assets are missing');
  if(typeof baseURL!=='string'||!baseURL.length||typeof cadConfiguration.workerURL!=='string'||!cadConfiguration.workerURL.length)
    throw new Error('Prepared machining page base or CAD worker is missing');
  const page=new URL(baseURL);
  const checkedURL=(value,base)=>{
    const url=new URL(value,base);
    if(!['http:','https:'].includes(url.protocol)||url.origin!==page.origin||url.username||url.password)
      throw new Error('Prepared machining assets must belong to this application origin');
    return url;
  };
  checkedURL(page.href,page);
  const worker=checkedURL(cadConfiguration.workerURL,page);
  const runtimeBaseURL=checkedURL(cad.runtimeBaseURL,worker).href;
  const codeURL=checkedURL(cad.codeURL,worker).href;
  if(!runtimeBaseURL.endsWith('/'))throw new Error('Prepared machining runtime base must end with a slash');
  return preparedRuntimeConfiguration({...configuration,assets:{...configuration?.assets,
    runtimeBaseURL,codeURL,codeSHA256:cad.codeSHA256}},
    'adaptive-combined-browser-config-3',undefined,{backend:'reference'});
}

export function preparedRuntimeConfiguration(configuration, schema, baseURL, {backend='configured'}={}) {
  if(!['configured','reference'].includes(backend))throw new Error('Unsupported prepared runtime backend');
  if(backend==='reference'){
    if(!configuration||typeof configuration!=='object'||!configuration.assets||typeof configuration.assets!=='object')
      throw new Error('Reference Python runtime configuration is missing');
    const selected={...configuration,assets:{...configuration.assets}};
    for(const name of ['volumeQuery','historyQuery','remainingWeights','removalWeights']){delete selected[name];delete selected.assets[name];}
    return selected;
  }
  const remaining = Object.hasOwn(configuration, 'remainingWeights');
  const removal = Object.hasOwn(configuration, 'removalWeights');
  if(removal&&(!remaining||configuration.removalWeights!==true))throw new Error('Invalid removal weights configuration');
  if (remaining && (schema !== 'adaptive-mill-turn-core-roughing-task-5' || configuration.remainingWeights !== true ||
      configuration.historyQuery !== true || !configuration.volumeQuery)) throw new Error('Invalid remaining weights configuration');
  if (schema !== 'adaptive-combined-browser-config-3' && !remaining) return configuration;
  const history = Object.hasOwn(configuration, 'historyQuery');
  if (history && (configuration.historyQuery !== true || !configuration.volumeQuery))
    throw new Error('Invalid history query configuration');
  if (!configuration.volumeQuery) return configuration;
  const volumeQuery = {...configuration.volumeQuery};
  volumeQuery.moduleURL = new URL(volumeQuery.moduleURL, baseURL).href;
  volumeQuery.wasmURL = new URL(volumeQuery.wasmURL, baseURL).href;
  return {...configuration, assets: {...configuration.assets, volumeQuery, ...(history ? {historyQuery: true} : {}), ...(remaining ? {remainingWeights: true} : {}), ...(removal ? {removalWeights: true} : {})}};
}
