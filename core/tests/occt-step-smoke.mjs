import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import initOpenCascade from 'opencascade.js/dist/node.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const oc=await initOpenCascade();
oc.FS.writeFile('/box.step',fs.readFileSync(path.join(here,'fixtures','box.step')));
const reader=new oc.STEPControl_Reader_1(),progress=new oc.Message_ProgressRange_1();
try{
  const status=reader.ReadFile('/box.step');
  assert.equal(Number(status),Number(oc.IFSelect_RetDone),'STEP reader must accept the synthetic solid');
  assert.equal(reader.TransferRoots(progress),1);
  const shape=reader.OneShape(),classifier=new oc.BRepClass3d_SolidClassifier_2(shape);
  try{
    const inside=new oc.gp_Pnt_3(0,0,0),outside=new oc.gp_Pnt_3(20,0,0);
    try{
      classifier.Perform(inside,1e-7);assert.equal(Number(classifier.State()),Number(oc.TopAbs_IN));
      classifier.Perform(outside,1e-7);assert.equal(Number(classifier.State()),Number(oc.TopAbs_OUT));
    }finally{inside.delete();outside.delete();}
  }finally{classifier.delete();shape.delete();}
}finally{progress.delete();reader.delete();oc.FS.unlink('/box.step');}
console.log('Browser OCCT STEP import and solid classification passed');
