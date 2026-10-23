import {INDUSTRIAL_SETUP_PIN} from './industrial-setup-pins.mjs';
import {INDUSTRIAL_FINITE_PIN} from './industrial-finite-pins.mjs';
import {INDUSTRIAL_PATHS_PIN} from './industrial-paths-pins.mjs';
import {INDUSTRIAL_REACH_PIN} from './industrial-reach-pins.mjs';

// Closed task-local identities. A scene ID selects a published pin, never trust.
const pins=Object.freeze({
  industrial_setup_00350:INDUSTRIAL_SETUP_PIN,
  industrial_finite_00350:INDUSTRIAL_FINITE_PIN,
  industrial_paths_00350:INDUSTRIAL_PATHS_PIN,
  industrial_reach_00350:INDUSTRIAL_REACH_PIN,
});
export function setupCasePin(sceneId){
  return typeof sceneId==='string'&&Object.hasOwn(pins,sceneId)?pins[sceneId]:null;
}
export function isSetupScene(sceneId){return setupCasePin(sceneId)!==null;}
