import {canonicalAdaptive} from './adaptive-provider.mjs';
const fraction=value=>String(value[1])==='1'?String(value[0]):`${value[0]}/${value[1]}`;

export function TransformEnclosureDetails({record}){
  if(!record)return null;
  return <section aria-label="Indexed query bounds">
    <h4>Indexed query bounds</h4>
    <p>A rotated cell is enclosed by an axis-aligned query box. The extra bounding volume describes this conservatism; it does not change remaining stock.</p>
    <div style={{overflowX:'auto'}}><table>
      <thead><tr><th>Source operand</th><th>Arithmetic error (mm)</th><th>Enclosure widths (mm)</th><th>Extra bounding volume (mm³)</th></tr></thead>
      <tbody>{record.entries.map(row=><tr key={JSON.stringify(row.source_path)}>
        <td>{row.source_path.join(' / ')}</td>
        <td>{fraction(row.transform.arithmetic_error_upper_mm)}</td>
        <td>{row.transform.enclosure_extents_mm.map(fraction).join(' × ')}</td>
        <td>{fraction(row.transform.enclosure_excess_volume_mm3)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="adaptive-small">Values are exact fractions for each recorded query. Nested and overlapping operand volumes must not be added. Tool clearance is assessed separately.</p>
    <details><summary>Transform enclosure evidence</summary><pre>{canonicalAdaptive(record,true)}</pre></details>
  </section>;
}
