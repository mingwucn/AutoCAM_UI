const encoder=new TextEncoder();
let attempted=false,machiningAttempt=false,machiningInvalidated=false,machiningErrorSent=false;
let inspectionAttempt=false,inspectionInvalidated=false;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
function closed(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Unknown or missing CAD message fields.');
}
function url(value){
  const resolved=new URL(value,self.location.href);
  if(resolved.origin!==self.location.origin||!['http:','https:'].includes(resolved.protocol)||resolved.username||resolved.password)throw Error('CAD assets must belong to this application origin.');
  return resolved.href;
}
async function asset(address,pin,limit){
  if(typeof pin!=='string'||!/^[0-9a-f]{64}$/.test(pin))throw Error('Invalid CAD asset identity.');
  const response=await fetch(url(address));
  if(!response.ok||new URL(response.url).origin!==self.location.origin)throw Error('CAD asset unavailable.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>limit||await hash(bytes)!==pin)throw Error('CAD asset bytes or identity differ.');
  return bytes;
}
function machiningActive(){if(machiningInvalidated)throw Error('Machining preparation was invalidated.');}
async function inspectSourceCell(data){
  closed(data,['id','operation','assets','certificate','certificateSHA256','cell','cellSHA256']);
  if(data.id!==1)throw Error('Invalid source-cell request identity.');
  if(!(data.certificate instanceof Uint8Array)||!(data.certificate.buffer instanceof ArrayBuffer)||!data.certificate.length||data.certificate.length>8*1024**2)throw Error('Invalid source certificate bytes.');
  if(typeof data.cell!=='string'||!data.cell.length||encoder.encode(data.cell).length>16*1024)throw Error('Invalid exact cell JSON.');
  if(await hash(data.certificate)!==data.certificateSHA256||await hash(encoder.encode(data.cell))!==data.cellSHA256)throw Error('Source-cell input identity differs.');
  const a=data.assets;
  closed(a,['runtimeBaseURL','codeURL','codeSHA256','cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256']);
  for(const key of ['runtimeBaseURL','codeURL','cadModuleURL','cadWasmURL']){
    if(typeof a[key]!=='string'||!a[key].length||a[key].length>4096)throw Error('Invalid source inspection asset URL.');url(a[key]);
  }
  for(const key of ['codeSHA256','cadModuleSHA256','cadWasmSHA256'])
    if(typeof a[key]!=='string'||!/^[0-9a-f]{64}$/.test(a[key]))throw Error('Invalid source inspection asset hash.');
  const runtime=url(a.runtimeBaseURL);if(!runtime.endsWith('/'))throw Error('Invalid Python runtime URL.');
  const active=()=>{if(inspectionInvalidated)throw Error('Source inspection was invalidated.');};
  active();self.postMessage({id:data.id,type:'progress',phase:'Loading shared source-face queries'});
  const archive=await asset(a.codeURL,a.codeSHA256,32*1024**2);active();
  const {loadPyodide}=await import(new URL('pyodide.mjs',runtime).href);active();
  const py=await loadPyodide({indexURL:runtime});active();
  py.unpackArchive(archive,'zip',{extractDir:'/app'});
  py.runPython('import sys; sys.dont_write_bytecode=True; sys.path[:0]=["/app/sources","/app/deps"]');
  py.FS.mkdirTree('/inspection');py.FS.writeFile('/inspection/certificate.json',data.certificate);py.FS.writeFile('/inspection/cell.json',encoder.encode(data.cell));
  py.FS.writeFile('/inspection/pin.txt',encoder.encode(data.certificateSHA256));
  const associations=py.runPython(`
from pathlib import Path
from autocam.adaptive_delta.cad_cell_faces import CadCellFaceIndex
from autocam.adaptive_delta.codec import parse_canonical
from autocam.adaptive_delta.domain import Bounds, canonical
inspection_index=CadCellFaceIndex(Path('/inspection/certificate.json').read_bytes(),expected_sha256=Path('/inspection/pin.txt').read_text())
inspection_cell=Bounds.from_data(parse_canonical(Path('/inspection/cell.json').read_bytes(),maximum_bytes=16384))
canonical(inspection_index.query(inspection_cell)).decode()
`);
  if(typeof associations!=='string'||!associations.length||encoder.encode(associations).length>1024**2)throw Error('Source-face response exceeds its byte budget.');
  const associationsSHA256=await hash(encoder.encode(associations));active();
  self.postMessage({id:data.id,type:'result',operation:'inspect_source_cell',certificateSHA256:data.certificateSHA256,cellSHA256:data.cellSHA256,associations,associationsSHA256});
}
async function prepareMachining(data){
  const {id}=data;
  closed(data,['id','operation','assets','initial','initialSHA256','setup','setupSHA256','policy','policySHA256']);
  if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid machining operation identity.');
  for(const [name,limit] of [['initial',64*1024**2],['setup',1024**2],['policy',1024**2]]){
    if(!(data[name] instanceof Uint8Array)||!(data[name].buffer instanceof ArrayBuffer)||!data[name].byteLength||data[name].byteLength>limit)throw Error('Invalid or oversized machining '+name+' bytes.');
    if(typeof data[name+'SHA256']!=='string'||!/^[0-9a-f]{64}$/.test(data[name+'SHA256']))throw Error('Invalid machining input identity.');
  }
  const pins=await Promise.all(['initial','setup','policy'].map(name=>hash(data[name])));
  if(pins.some((pin,i)=>pin!==data[['initialSHA256','setupSHA256','policySHA256'][i]]))throw Error('Machining input bytes or identity differ.');
  machiningActive();
  const a=data.assets;
  closed(a,['runtimeBaseURL','codeURL','codeSHA256','cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256']);
  for(const name of ['runtimeBaseURL','codeURL','cadModuleURL','cadWasmURL']){
    if(typeof a[name]!=='string'||!a[name].length||a[name].length>4096)throw Error('Invalid machining asset address.');
    url(a[name]);
  }
  for(const name of ['codeSHA256','cadModuleSHA256','cadWasmSHA256'])
    if(typeof a[name]!=='string'||!/^[0-9a-f]{64}$/.test(a[name]))throw Error('Invalid machining asset identity.');
  const runtime=url(a.runtimeBaseURL);if(!runtime.endsWith('/'))throw Error('Invalid Python runtime URL.');
  self.postMessage({id,type:'progress',phase:'Loading shared Python machining code'});
  const archive=await asset(a.codeURL,a.codeSHA256,32*1024**2);
  machiningActive();
  const {loadPyodide}=await import(new URL('pyodide.mjs',runtime).href);
  machiningActive();
  const py=await loadPyodide({indexURL:runtime});
  machiningActive();
  py.unpackArchive(archive,'zip',{extractDir:'/app'});
  py.runPython('import sys; sys.dont_write_bytecode=True; sys.path[:0]=["/app/sources","/app/deps"]');
  py.FS.mkdirTree('/machining');
  for(const name of ['initial','setup','policy'])py.FS.writeFile('/machining/'+name+'.bin',data[name]);
  py.FS.writeFile('/machining/pins.json',encoder.encode(JSON.stringify({initial:data.initialSHA256,setup:data.setupSHA256,policy:data.policySHA256})));
  self.postMessage({id,type:'progress',phase:'Preparing source-derived machining candidates with shared Python'});
  py.runPython(`
import json
from pathlib import Path
from autocam.adaptive_delta.cad_machining import prepare_cad_mill_turn
machining_pins=json.loads(Path('/machining/pins.json').read_bytes())
machining_prepared=prepare_cad_mill_turn(Path('/machining/initial.bin').read_bytes(),expected_initial_sha256=machining_pins['initial'],setup=Path('/machining/setup.bin').read_bytes(),expected_setup_sha256=machining_pins['setup'],policy=Path('/machining/policy.bin').read_bytes(),expected_policy_sha256=machining_pins['policy'])
Path('/machining/configuration.json').write_bytes(machining_prepared.configuration)
Path('/machining/preparation.json').write_bytes(machining_prepared.preparation)
Path('/machining/returned-initial.bin').write_bytes(machining_prepared.initial_snapshot)
None
`);
  const configurationBytes=py.FS.readFile('/machining/configuration.json'),preparationBytes=py.FS.readFile('/machining/preparation.json');
  const initial=new Uint8Array(py.FS.readFile('/machining/returned-initial.bin'));
  if(!configurationBytes.byteLength||configurationBytes.byteLength>4*1024**2||!preparationBytes.byteLength||preparationBytes.byteLength>4*1024**2||!initial.byteLength||initial.byteLength>64*1024**2||configurationBytes.byteLength+preparationBytes.byteLength+initial.byteLength>72*1024**2)throw Error('Machining result exceeds its complete response budget.');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const configuration=decoder.decode(configurationBytes),preparation=decoder.decode(preparationBytes);
  const [configurationSHA256,preparationSHA256,initialSHA256]=await Promise.all([hash(configurationBytes),hash(preparationBytes),hash(initial)]);
  machiningActive();
  if(initialSHA256!==data.initialSHA256)throw Error('Machining preparation changed the original initial snapshot.');
  self.postMessage({id,type:'result',operation:'prepare_machining',configuration,configurationSHA256,initial,initialSHA256,preparation,preparationSHA256,setupSHA256:data.setupSHA256,policySHA256:data.policySHA256},[initial.buffer]);
}
self.onmessage=async({data})=>{
  const id=data?.id;
  try{
    if(attempted){if(machiningAttempt)machiningInvalidated=true;if(inspectionAttempt)inspectionInvalidated=true;throw Error(machiningAttempt?'This CAD worker has already attempted machining preparation.':inspectionAttempt?'This CAD worker has already attempted source inspection.':'This CAD worker has already attempted an import.');}
    attempted=true;
    if(data.operation==='inspect_source_cell'){inspectionAttempt=true;await inspectSourceCell(data);return;}
    if(data.operation==='prepare_machining'){machiningAttempt=true;await prepareMachining(data);return;}
    const automatic=data.operation==='prepare_auto',preparing=data.operation==='prepare'||automatic,inspecting=data.operation==='inspect_directions';
    closed(data,['id','operation','assets','source','sourceSHA256','profile',...(automatic?['stockOptions']:preparing?['preparation']:inspecting?['directionSetup']:[])]);
    if(!Number.isSafeInteger(id)||id<1||!['construct','prepare','prepare_auto','inspect_directions'].includes(data.operation))throw Error('Invalid CAD operation.');
    if(automatic)closed(data.stockOptions,['mode','margin','axis','depth',...(Object.hasOwn(data.stockOptions??{},'allowance')?['allowance']:[])]);
    else if(preparing)closed(data.preparation,['stock','root','budget']);
    else if(inspecting){
      closed(data.directionSetup,['machineJSON','machineSHA256','advanceSign']);
      if(!Number.isInteger(data.directionSetup.advanceSign)||![-1,1].includes(data.directionSetup.advanceSign))throw Error('Invalid tool advance sign.');
      if(typeof data.directionSetup.machineJSON!=='string'||!data.directionSetup.machineJSON.length||encoder.encode(data.directionSetup.machineJSON).length>1024**2)throw Error('Invalid or oversized exact machine JSON.');
      if(typeof data.directionSetup.machineSHA256!=='string'||!/^[0-9a-f]{64}$/.test(data.directionSetup.machineSHA256)||await hash(encoder.encode(data.directionSetup.machineJSON))!==data.directionSetup.machineSHA256)throw Error('Exact machine identity differs.');
    }
    const rational=data.profile==='rational_nominal';
    if(!['rectilinear','periodic_nominal','spherical_nominal','rational_nominal'].includes(data.profile))throw Error('Explicit supported source construction profile required.');
    if(rational&&!['construct','prepare','prepare_auto'].includes(data.operation))throw Error('Rational source supports construction and stock preparation only.');
    if(!(data.source instanceof Uint8Array)||!data.source.length||data.source.length>100*1024**2||await hash(data.source)!==data.sourceSHA256)throw Error('STEP source bytes or identity differ.');
    const a=data.assets;
    closed(a,['runtimeBaseURL','codeURL','codeSHA256','cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256',...(rational?['rationalModuleURL','rationalModuleSHA256','rationalWasmURL','rationalWasmSHA256']:[])]);
    const runtime=url(a.runtimeBaseURL);if(!runtime.endsWith('/'))throw Error('Invalid Python runtime URL.');
    self.postMessage({id,type:'progress',phase:'Loading CAD and Python code'});
    const [moduleBytes,wasm,archive]=await Promise.all([
      asset(a.cadModuleURL,a.cadModuleSHA256,8*1024**2),asset(a.cadWasmURL,a.cadWasmSHA256,128*1024**2),asset(a.codeURL,a.codeSHA256,32*1024**2)]);
    const moduleURL=URL.createObjectURL(new Blob([moduleBytes],{type:'text/javascript'}));
    const stdout=[],stderr=[];let cad;
    try{const {default:create}=await import(moduleURL);cad=await create({wasmBinary:wasm,locateFile:()=>url(a.cadWasmURL),noInitialRun:true,print:s=>stdout.push(s),printErr:s=>stderr.push(s)});}
    finally{URL.revokeObjectURL(moduleURL);}
    self.postMessage({id,type:'progress',phase:'Reading STEP without geometry repair'});
    cad.FS.writeFile('/source.step',data.source);
    if(cad.callMain(['step','/source.step',rational?'0.0000001':'0.000001','/imported.brep',...(data.profile==='spherical_nominal'?['spherical_nominal']:[])])!==0)throw Error('STEP reader or source audit failed.');
    const snapshot=cad.FS.readFile('/imported.brep');
    const line=stdout.findLast(s=>s.startsWith('{"schema":"adaptive-cad-audit-1"'));
    if(!line)throw Error('CAD audit output missing.');
    const audit=encoder.encode(line),snapshotSHA256=await hash(snapshot),auditSHA256=await hash(audit);
    let rationalInputs=null;
    if(rational){
      self.postMessage({id,type:'progress',phase:'Reading original rational surfaces and checking preserved geometry'});
      if(await hash(cad.FS.readFile('/source.step'))!==data.sourceSHA256)throw Error('STEP source changed during audit.');
      const [extractorBytes,extractorWasm]=await Promise.all([
        asset(a.rationalModuleURL,a.rationalModuleSHA256,8*1024**2),asset(a.rationalWasmURL,a.rationalWasmSHA256,128*1024**2)]);
      const extractorURL=URL.createObjectURL(new Blob([extractorBytes],{type:'text/javascript'}));
      let extractor;const extracted=[];
      try{const {default:create}=await import(extractorURL);extractor=await create({wasmBinary:extractorWasm,locateFile:()=>url(a.rationalWasmURL),noInitialRun:true,print:s=>extracted.push(s),printErr:()=>{}});}
      finally{URL.revokeObjectURL(extractorURL);}
      extractor.FS.writeFile('/source.step',data.source);extractor.FS.writeFile('/reference.brep',snapshot);
      if(extractor.callMain(['/source.step','/reference.brep','/before.brep'])!==0)throw Error('Original rational source extraction failed.');
      const before=extractor.FS.readFile('/before.brep'),after=extractor.FS.readFile('/before.brep.after.brep');
      if(await hash(extractor.FS.readFile('/source.step'))!==data.sourceSHA256||await hash(extractor.FS.readFile('/reference.brep'))!==snapshotSHA256||await hash(before)!==snapshotSHA256||await hash(after)!==snapshotSHA256)throw Error('Original rational source or retained import changed.');
      const observationLine=extracted.findLast(s=>s.startsWith('{"schema":"adaptive-rational-patch-source-2"'));
      if(!observationLine)throw Error('Original rational observation missing.');
      const observation=encoder.encode(observationLine);
      rationalInputs={before,after,observation,observationSHA256:await hash(observation),execution:{
        audit_module_sha256:a.cadModuleSHA256,audit_wasm_sha256:a.cadWasmSHA256,
        extractor_module_sha256:a.rationalModuleSHA256,extractor_wasm_sha256:a.rationalWasmSHA256,
        audit_returncode:0,extractor_returncode:0}};
    }
    self.postMessage({id,type:'progress',phase:'Proving the imported target with shared Python'});
    const {loadPyodide}=await import(new URL('pyodide.mjs',runtime).href);
    const py=await loadPyodide({indexURL:runtime});
    py.unpackArchive(archive,'zip',{extractDir:'/app'});
    py.runPython('import sys; sys.dont_write_bytecode=True; sys.path[:0]=["/app/sources","/app/deps"]');
    py.FS.mkdirTree('/cad');py.FS.writeFile('/cad/source.step',data.source);py.FS.writeFile('/cad/imported.brep',snapshot);py.FS.writeFile('/cad/audit.json',audit);
    py.FS.writeFile('/cad/pins.json',encoder.encode(JSON.stringify({source_sha256:data.sourceSHA256,snapshot_sha256:snapshotSHA256,audit_sha256:auditSHA256,profile:data.profile})));
    let certificate;
    if(rational){
      for(const [key,name] of [['before','before.brep'],['after','after.brep'],['observation','observation.json']])py.FS.writeFile('/cad/'+name,rationalInputs[key]);
      py.FS.writeFile('/cad/rational-pins.json',encoder.encode(JSON.stringify({source_sha256:data.sourceSHA256,snapshot_sha256:snapshotSHA256,audit_sha256:auditSHA256,observation_sha256:rationalInputs.observationSHA256,execution:rationalInputs.execution})));
      certificate=py.runPython(`
import json
from pathlib import Path
from autocam.adaptive_delta.cad_browser_rational import construct_browser_rational
from autocam.adaptive_delta.domain import canonical
canonical(construct_browser_rational(*(Path('/cad/'+name).read_bytes() for name in ('source.step','imported.brep','audit.json','observation.json','before.brep','after.brep')),**json.loads(Path('/cad/rational-pins.json').read_bytes()))).decode()
`);
    }else certificate=py.runPython(`
import json
from pathlib import Path
from autocam.adaptive_delta.cad_browser_construction import construct_browser_import
from autocam.adaptive_delta.domain import canonical
canonical(construct_browser_import(Path('/cad/source.step').read_bytes(),Path('/cad/imported.brep').read_bytes(),Path('/cad/audit.json').read_bytes(),**json.loads(Path('/cad/pins.json').read_bytes()))).decode()
`);
    if(typeof certificate!=='string'||encoder.encode(certificate).length>32*1024**2)throw Error('Construction certificate exceeds response budget.');
    let initial=null,proposedPreparation=null,preview=null,directions=null,sourceFaceProvenance=null,sourceFaceProvenanceSHA256=null;
    if(automatic){
      py.FS.writeFile('/cad/certificate.json',encoder.encode(certificate));
      py.FS.writeFile('/cad/face-provenance-pins.json',encoder.encode(JSON.stringify({expected_certificate_sha256:await hash(encoder.encode(certificate)),
        expected_audit_sha256:auditSHA256,importer:{runtime:'emscripten-browser',kernel_version:'7.8.1',binary_sha256:a.cadWasmSHA256,module_sha256:a.cadModuleSHA256,wrapper_code_sha256:a.codeSHA256}})));
      sourceFaceProvenance=py.runPython(`
from autocam.adaptive_delta.cad_face_provenance import build_face_provenance
canonical(build_face_provenance(Path('/cad/certificate.json').read_bytes(),Path('/cad/audit.json').read_bytes(),**json.loads(Path('/cad/face-provenance-pins.json').read_bytes()))).decode()
`);
      if(typeof sourceFaceProvenance!=='string'||encoder.encode(sourceFaceProvenance).length>1024**2)throw Error('Source-face provenance exceeds its response budget.');
      sourceFaceProvenanceSHA256=await hash(encoder.encode(sourceFaceProvenance));
    }
    if(inspecting){
      self.postMessage({id,type:'progress',phase:'Deriving source face directions for the declared machine'});
      py.FS.writeFile('/cad/certificate.json',encoder.encode(certificate));
      py.FS.writeFile('/cad/machine.json',encoder.encode(data.directionSetup.machineJSON));
      py.FS.writeFile('/cad/direction-setup.json',encoder.encode(JSON.stringify({advanceSign:data.directionSetup.advanceSign,expected_sha256:await hash(encoder.encode(certificate))})));
      directions=py.runPython(`
from autocam.adaptive_delta.cad_face_directions import propose_face_directions
from autocam.adaptive_delta.codec import parse_canonical
from autocam.adaptive_delta.indexed_frames import IndexedMachine
direction_setup=json.loads(Path('/cad/direction-setup.json').read_bytes())
direction_machine=IndexedMachine.from_data(parse_canonical(Path('/cad/machine.json').read_bytes(),maximum_bytes=1024**2))
canonical(propose_face_directions(Path('/cad/certificate.json').read_bytes(),expected_sha256=direction_setup['expected_sha256'],machine=direction_machine,advance_sign=direction_setup['advanceSign'])).decode()
`);
      if(typeof directions!=='string'||encoder.encode(directions).length>4*1024**2||encoder.encode(certificate).length+encoder.encode(directions).length>64*1024**2)throw Error('Direction response exceeds byte budget.');
    }
    if(preparing){
      self.postMessage({id,type:'progress',phase:'Preparing adaptive stock and target'});
      py.FS.writeFile('/cad/certificate.json',encoder.encode(certificate));
      const certificateID=await hash(encoder.encode(certificate));
      if(automatic){
        py.FS.writeFile('/cad/options.json',encoder.encode(JSON.stringify({...data.stockOptions,expected_sha256:certificateID})));
        proposedPreparation=py.runPython(`
from autocam.adaptive_delta.cad_browser_domain import propose_import_stock
proposal=propose_import_stock(Path('/cad/certificate.json').read_bytes(),**json.loads(Path('/cad/options.json').read_bytes()))
settings=dict(proposal,expected_sha256=json.loads(Path('/cad/options.json').read_bytes())['expected_sha256'])
Path('/cad/preparation.json').write_text(json.dumps(settings))
canonical(proposal).decode()
`);
      }else py.FS.writeFile('/cad/preparation.json',encoder.encode(JSON.stringify({...data.preparation,expected_sha256:certificateID})));
      initial=py.runPython(`
from autocam.adaptive_delta.cad_browser_domain import prepare_imported_domain
prepare_imported_domain(Path('/cad/certificate.json').read_bytes(),**json.loads(Path('/cad/preparation.json').read_bytes())).decode()
`);
      if(typeof initial!=='string'||encoder.encode(certificate).length+encoder.encode(initial).length>64*1024**2)throw Error('Prepared CAD response exceeds byte budget.');
    }
    if(automatic){
      self.postMessage({id,type:'progress',phase:'Preparing the geometry preview'});
      py.FS.writeFile('/cad/initial.bin',encoder.encode(initial));
      const occupied=encoder.encode(initial).length+encoder.encode(certificate).length+encoder.encode(proposedPreparation).length+encoder.encode(sourceFaceProvenance).length+4096;
      if(occupied>64*1024**2)throw Error('Prepared CAD response exceeds byte budget.');
      py.FS.writeFile('/cad/preview-options.json',encoder.encode(JSON.stringify({expected_sha256:await hash(encoder.encode(initial)),occupied_bytes:occupied})));
      preview=JSON.parse(py.runPython(`
from autocam.adaptive_delta.cad_preview import prepare_preview_response
canonical(prepare_preview_response(Path('/cad/initial.bin').read_bytes(),**json.loads(Path('/cad/preview-options.json').read_bytes()))).decode()
`));
    }
    self.postMessage({id,type:'result',certificate,sourceSHA256:data.sourceSHA256,snapshotSHA256,auditSHA256,profile:data.profile,...(preparing?{initial}: {}),...(automatic?{proposedPreparation,preview,sourceFaceProvenance,sourceFaceProvenanceSHA256}: {}),...(inspecting?{directions}: {})});
  }catch(error){
    if(machiningAttempt){if(machiningErrorSent)return;machiningErrorSent=true;machiningInvalidated=true;}
    self.postMessage({id,type:'error',message:machiningAttempt?String(error.message||error).slice(0,4096):String(error.message||error)});
  }
};
