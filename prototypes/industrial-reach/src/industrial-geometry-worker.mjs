import {exportCurrentGeometry,exportSequenceGeometry} from './industrial-geometry-export.mjs';
self.onmessage=event=>{
  try{
    const {data,state,scope}=event.data;
    const bytes=scope==='current'?exportCurrentGeometry(data,state):exportSequenceGeometry(data,state.replay?state.replay.commands:state.commands);
    self.postMessage({bytes},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
