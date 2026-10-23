// Exact-scene prototype rule adopted by CODE-M3-DRILLING-001 v7.
// Continuous holding is assumed; fixture/contact geometry and rotary motion are unmodelled.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const INDUSTRIAL_MILLTURN_RULE=freeze({
  schema:'industrial-millturn-plan-order-1',id:'00350-continuous-millturn-final-profiles-v1',
  stages:[
    {id:'turning',type:'cut',operations:['turning'],setup_id:'millturn_continuous'},
    {id:'bulk_milling',type:'cut',operations:['bulk_milling'],setup_id:'millturn_continuous'},
    {id:'drilling',type:'cut',operations:['drilling'],setup_id:'millturn_continuous'},
    {id:'deep_features',type:'cut',operations:['deep_slot','lower_relief'],setup_id:'millturn_continuous'},
    {id:'old_cap_facing',type:'cut',operations:['old_cap_facing'],setup_id:'millturn_continuous'},
    {id:'profile_finishing',type:'cut',operations:['profile_finishing'],setup_id:'millturn_continuous'},
  ],
  advance:'Safe phase removal and required material are exhausted; positive stock-end cleanup and designated final feature passes are satisfied',
  within_stage:'All geometrically eligible productive cuts remain selectable; source-relative direction changes are orientation annotations, not reclamping events',
  scope:'Continuous mill-turn holding assumed; contact, fixture interference and rotary kinematics unmodelled; fixed sampled target and declared feature denominator',
});
