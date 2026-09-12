import {AdaptivePythonSession} from './adaptive-python-session.mjs';

export class CombinedPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:65*1024**2,
      maximumJournalBytes:128*1024**2,maximumJournalRecords:128,
      mutationOperations:['reset','step','restore','load_model']});
  }
}
