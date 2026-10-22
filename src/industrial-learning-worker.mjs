import {createIndustrialContext,makeEpisode,replayEpisode,generateBaseline,makeFeedbackBundle,createInitialModel,validateCheckpoint,suggestPolicy,searchMCTS} from './industrial-learning.mjs';
let context;
self.onmessage=async({data:{id,command,payload,data}})=>{
  try{
    if(data)context=await createIndustrialContext(data);
    if(!context)throw Error('The industrial case is not ready.');
    let result;
    if(command==='baseline')result=await generateBaseline(context);
    else if(command==='bundle')result=await makeFeedbackBundle(context,payload);
    else if(command==='initial')result=await createInitialModel(context);
    else if(command==='record')result=await makeEpisode(context,payload.actions);
    else if(command==='restore'){
      await replayEpisode(context,payload.episode);
      result={episode:payload.episode};
    }else if(command==='model'){
      await validateCheckpoint(context,payload.model);result=payload.model;
    }else if(command==='policy')result=await suggestPolicy(context,payload.actions,payload.model);
    else if(command==='search')result=await searchMCTS(context,payload.actions,payload.model,
      {...payload.options,onProgress:progress=>self.postMessage({id,progress})});
    else throw Error('Unknown industrial operation.');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message||String(error)});}
};
