import {DrillPythonSession} from './drill-python-session.mjs';

// Reuse acknowledged-command recovery and the same bounded mutation catalog.
export class FacePythonSession extends DrillPythonSession {
  async loadModel(){throw new Error('This face-session profile does not support model loading yet.');}
}
