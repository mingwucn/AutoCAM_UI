import {AdaptivePythonSession} from './adaptive-python-session.mjs';

export class MixedLearningPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:64*1024**2,maximumJournalRecords:128,
      mutationOperations:['step','reset','restore']});
  }
}
