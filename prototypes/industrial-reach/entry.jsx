import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SetupGymApp} from './src/industrial-setup-app.jsx';
import {validateSetupCase,validateSetupReference} from './src/industrial-setup-provider.mjs';
import {INDUSTRIAL_REACH_PIN} from './src/industrial-reach-pins.mjs';

const query=new URLSearchParams(location.search),id=query.get('case')||INDUSTRIAL_REACH_PIN.scene_id;
const mainCase=()=>new URL('../index.html?case=industrial_00289&process=turning#gym',location.href).href;
if(id==='industrial_00289')location.replace(mainCase());
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
async function load(){
  if(id!==INDUSTRIAL_REACH_PIN.scene_id)throw Error('Choose the published 3-29-00350 reach case.');
  const response=await fetch(new URL('data/catalog.json',location.href));
  if(!response.ok)throw Error('The reach case catalog could not be loaded.');
  const catalog=await response.json(),row=catalog.cases?.find(c=>c.id===id);
  validateSetupReference(row?.dataset,id);
  const caseResponse=await fetch(new URL(row.dataset.url,response.url));
  if(!caseResponse.ok)throw Error('The reach dataset could not be loaded.');
  const bytes=await caseResponse.arrayBuffer();
  if(bytes.byteLength!==row.dataset.size_bytes||await sha(bytes)!==row.dataset.sha256)throw Error('The reach dataset differs from its published byte identity.');
  const data=validateSetupCase(JSON.parse(new TextDecoder().decode(bytes)),id);
  return {data,catalog,initialMode:'turning',figureBaseUrl:new URL('.',row.preview.url).href,
    provenance:{case_id:id,case_sha256:row.dataset.sha256}};
}
function ReachApplication(){
  const [loaded,setLoaded]=useState(null),[error,setError]=useState(null);
  useEffect(()=>{let active=true;load().then(value=>{if(active)setLoaded(value);},failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[]);
  if(error)return <p role="alert">{error}</p>;
  if(!loaded)return <p role="status">Loading and checking the reach dataset…</p>;
  return <SetupGymApp {...loaded} onSelectCase={caseId=>{
    if(caseId==='industrial_00289')location.href=mainCase();
  }}/>;
}
createRoot(document.getElementById('shadow-gym-root')).render(<ReachApplication/>);
