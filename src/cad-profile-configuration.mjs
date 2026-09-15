const rationalKeys=['cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256','rationalModuleURL','rationalModuleSHA256','rationalWasmURL','rationalWasmSHA256'];
export function hasRationalCadRuntime(configuration){
  const value=configuration?.rationalAssets;
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...rationalKeys].sort().join(',')&&
    rationalKeys.every(key=>typeof value[key]==='string'&&(key.endsWith('SHA256')?/^[0-9a-f]{64}$/.test(value[key]):value[key].length>0));
}
export function cadConfigurationForProfile(configuration,profile){
  if(profile!=='rational_nominal')return configuration;
  if(!hasRationalCadRuntime(configuration))throw Error('Rational STEP runtime is unavailable.');
  return {workerURL:configuration.workerURL,assets:{...configuration.assets,...configuration.rationalAssets}};
}
