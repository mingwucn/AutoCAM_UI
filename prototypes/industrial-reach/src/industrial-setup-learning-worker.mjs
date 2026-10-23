import * as core from './industrial-setup-learning.mjs';
let context;
const exact=(value,names)=>value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
export async function handleSetupRequest(message,onProgress){
  if(!exact(message,['id','command','payload'])&&!exact(message,['id','command','payload','data']))throw Error('Unknown setup worker envelope fields.');
  const {command,payload}=message;
  if(!Number.isSafeInteger(message.id)||message.id<1)throw Error('Invalid setup request ID.');
  if(Object.hasOwn(message,'data')){context=null;context=await core.createSetupContext(message.data);}
  if(!context)throw Error('The setup case is not ready.');
  const fields={baseline:[],'greedy-baseline':[],'named-paths':[],initial:[],bundle:['episodes','sequence_preferences','action_preferences'],record:['commands'],restore:['episode'],model:['model'],policy:['commands','model'],search:['commands','model','options']}[command];
  if(!fields||!exact(payload,fields))throw Error('Unknown setup operation or typed payload fields.');
  if(command==='baseline')return core.generateBaseline(context);
  if(command==='greedy-baseline')return core.generateGreedyBaseline(context);
  if(command==='named-paths')return core.generateNamedPaths(context);
  if(command==='initial')return core.createInitialModel(context);
  if(command==='bundle')return core.makeFeedbackBundle(context,payload);
  if(command==='record')return core.makeEpisode(context,payload.commands);
  if(command==='restore'){await core.replayEpisode(context,payload.episode);return {episode:payload.episode};}
  if(command==='model')return core.validateCheckpoint(context,payload.model);
  if(command==='policy')return core.suggestPolicy(context,payload.commands,payload.model);
  if(!exact(payload.options,['simulations','depth','exploration']))throw Error('Unknown search options.');
  return core.searchMCTS(context,payload.commands,payload.model,{...payload.options,onProgress});
}
if(typeof self!=='undefined')self.onmessage=async({data:message})=>{try{self.postMessage({id:message.id,result:await handleSetupRequest(message,progress=>self.postMessage({id:message.id,progress}))});}catch(error){self.postMessage({id:message.id,error:error.message||String(error)});}};
