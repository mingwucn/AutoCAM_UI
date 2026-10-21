"""Explicit radial layers; completion criterion remains independent of cuts."""
from .cad_cylindrical_contacts import _generate_contacts
from .domain import canonical,identity,qdata,qread,rational


def generate_cylindrical_layers(source, *, radial_allowances, **arguments):
    if type(radial_allowances) is not tuple or not 1<=len(radial_allowances)<=16:
        raise ValueError('Explicit bounded tuple of radial layers required')
    allowances=tuple(rational(v) for v in radial_allowances)
    if any(v<=0 for v in allowances) or any(a<=b for a,b in zip(allowances,allowances[1:])):
        raise ValueError('Positive strictly descending radial layers required')
    layers=[];total=0
    for offset in allowances:
        layer=_generate_contacts(source,**arguments,cutting_allowance=offset,roughing_layer=True)
        if allowances[-1]>=qread(layer['requirement']['radial_allowance_mm']):
            raise ValueError('Final layer must lie below shared radial allowance')
        total+=len(layer['rows'])
        if total>4096:raise ValueError('Complete layered bank exceeds row budget')
        layers.append(layer)
        # Account for the complete retained representation, not just executable rows.
        if len(canonical(layers))>4*1024**2:raise ValueError('Complete layered bank exceeds byte budget')
    result=dict(schema='adaptive-cad-cylindrical-layers-1',
        source_geometry_id=source.geometry_id,requirement_id=layers[0]['requirement_id'],
        radial_allowances_mm=[qdata(v) for v in allowances],layers=layers,total_rows=total,
        access_assessed=False,accepted_machining=False,common_completion_proven=False)
    if len(canonical(result))>4*1024**2:raise ValueError('Complete layered bank exceeds byte budget')
    return result


def verify_cylindrical_layers(record,source,**arguments):
    if canonical(record)!=canonical(generate_cylindrical_layers(source,**arguments)):
        raise ValueError('Layered bank differs from source regeneration')
    return True
