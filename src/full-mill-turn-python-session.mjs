import {AdaptivePythonSession} from './adaptive-python-session.mjs';

export class FullMillTurnPythonSession extends AdaptivePythonSession {
  constructor(workerURL,options={}){
    super(workerURL,{...options,maximumCommandBytes:64*1024**2,maximumJournalRecords:128,
      mutationOperations:['prepare_initial','select_initial','suffix','reset','restore']});
  }
  async loadModel(){throw new Error('This full mill-turn profile does not support model loading yet.');}
}
