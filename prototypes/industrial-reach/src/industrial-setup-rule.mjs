// Bounded prototype sequence adopted by CODE-M3-DRILLING-001 v5.
// The original external fixture remains an explicit unmodelled assumption.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const INDUSTRIAL_SETUP_RULE=freeze({
  schema:'industrial-setup-plan-order-1',id:'00350-common-phases-reclamp-final-profiles-v1',
  stages:[
    {id:'turning',type:'cut',operations:['turning'],setup_id:'original_y_cap'},
    {id:'bulk_milling',type:'cut',operations:['bulk_milling'],setup_id:'original_y_cap'},
    {id:'drilling',type:'cut',operations:['drilling'],setup_id:'original_y_cap'},
    {id:'deep_features',type:'cut',operations:['deep_slot','lower_relief'],setup_id:'original_y_cap'},
    {id:'setup_transfer',type:'setup_change',operations:[],setup_id:'original_y_cap',transition_id:'transfer_to_opposed_x'},
    {id:'old_cap_facing',type:'cut',operations:['old_cap_facing'],setup_id:'opposed_x_jaws'},
    {id:'profile_finishing',type:'cut',operations:['profile_finishing'],setup_id:'opposed_x_jaws'},
  ],
  advance:'Declared-setup safe phase removal and required material are exhausted; explicit setup, cap-facing and positive feature-pass obligations are satisfied',
  within_stage:'All geometrically eligible productive cuts remain selectable; setup is a distinct zero-removal event',
  scope:'Fixed target and declared source-feature denominator; exact human bulk trajectories and original external fixture geometry remain unrepresented',
});
