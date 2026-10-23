import {IndustrialLearningClient} from './industrial-learning-client.mjs';

// Dedicated worker preserves strict version dispatch: no old actions payloads.
export class SetupLearningClient extends IndustrialLearningClient {
  constructor(data,{workerFactory=()=>new Worker(new URL('assets/industrial-setup-learning-worker.js',document.baseURI),{type:'module'})}={}){super(data,{workerFactory});}
}
