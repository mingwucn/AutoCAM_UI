import {AdaptivePythonSession} from './adaptive-python-session.mjs';

export class CylindricalPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:65*1024**2,maximumJournalRecords:128,
      mutationOperations:['execute','reset','restore']});
  }
}
