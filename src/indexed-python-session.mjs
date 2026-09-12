import {AdaptivePythonSession} from './adaptive-python-session.mjs';

export class IndexedPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:32*1024**2,
      mutationOperations:['reset','step','restore','load_model']});
  }
}
