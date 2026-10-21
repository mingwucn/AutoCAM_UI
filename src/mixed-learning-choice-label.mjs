import {exactNumber} from './adaptive-provider.mjs';

const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const names={turn:'Turning',transfer:'Transfer to live tooling',index:'Index workpiece',change_tool:'Exchange tool',no_op:'No operation',face:'Face milling',drill:'Drilling'};

export function mixedLearningChoiceLabel(choice,tools){
  const e=choice.entry,m=choice.after_machine,t=tools.find(t=>(t.tool_id??t.assembly_id)===m.tool_id);
  const angle=Math.atan2(exactNumber(m.sine),exactNumber(m.cosine))*180/Math.PI;
  const kind=e.specification.kind,motion=e.specification.native_candidate?.motion,parameters=e.preparation?.row?.parameters;
  const detail=kind==='turn'&&motion?.end_radius?` · radius ${fmt(exactNumber(motion.end_radius))} mm`
    :kind==='face'&&parameters?.stepover?` · stepover ${fmt(exactNumber(parameters.stepover))} mm`:'';
  return `${names[kind]}${detail} · ${m.tool_id}${t?.usable_reach?` · ${fmt(exactNumber(t.usable_reach))} mm reach`:''} · ${fmt(angle)}° · ${fmt(exactNumber(e.charged_seconds))} s`;
}
