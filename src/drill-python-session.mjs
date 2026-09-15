import {AdaptivePythonSession} from './adaptive-python-session.mjs';

// The shared Python adapter owns epoch and semantic checks. Retain each
// acknowledged command exactly so cancellation recovery repeats those checks.
export class DrillPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:64*1024**2,
      maximumJournalRecords:128,
      mutationOperations:['generate','select','index','change_tool','no_op','reset','restore']});
  }
  async loadModel(){throw new Error('This drill-session profile does not support model loading yet.');}
}
