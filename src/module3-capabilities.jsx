import {module3Capabilities,preparedCapability,capabilityFor} from './module3-capabilities.mjs';

export function CapabilityPanel({prepared,profile,compact=false}){
  const family=profile?capabilityFor({profile}):preparedCapability(prepared);
  return <section className="module3-capabilities" aria-label={compact?'Selected profile capabilities':'Workflow capabilities'} data-capability-family={family?.id??'unknown'}>
    <p><strong>{family?.title??'Select a supported workflow'}</strong>{family&&<> · {family.limits}</>}</p>
    {!compact&&<p><a href="docs/MODULE3_SCOPE.html">Scope and workflow guide</a> · <a href="docs/CAPABILITIES.html">All case and profile capabilities</a> · <a href="docs/TRAINING_GUIDE.html">Local training</a> · <a href="docs/VALIDATION_GUIDE.html">Examples and expected results</a> · <a href="release.json">Build identity</a></p>}
    {family?<details><summary>Supported stages and restrictions</summary>
      <dl>{module3Capabilities.stages.map(stage=><div key={stage.id}><dt>{stage.label}: <strong>{module3Capabilities.statuses[family.stages[stage.id].status]}</strong></dt><dd>{family.stages[stage.id].detail}</dd></div>)}</dl>
      <p>Model compatibility: {family.model}</p>
      <p>The runtime checks each input and action. This table does not authorize an action or establish manufacturing qualification.</p>
    </details>:<p>Capabilities for this input have not been established. Read the scope guide before selecting or importing a case.</p>}
  </section>;
}
