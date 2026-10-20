"""Explicit machine-frame parked milling context, never a removal action."""
from dataclasses import dataclass
from .domain import digest,fields,integer,qdata,qread,triple,identity


@dataclass(frozen=True,slots=True)
class ParkedTool:
    catalog_id: str
    tool_id: str
    axis: int
    tip: tuple

    def __post_init__(self):
        digest(self.catalog_id); integer(self.axis,'parked tool axis',0,2)
        if type(self.tool_id) is not str or not self.tool_id: raise ValueError('Parked tool ID required')
        object.__setattr__(self,'tip',triple(self.tip))

    @property
    def sign(self): return 1
    @property
    def start_tip(self): return self.tip
    @property
    def motion(self): return self

    def to_data(self):
        return dict(schema='adaptive-parked-tool-1',catalog_id=self.catalog_id,tool_id=self.tool_id,axis=self.axis,
                    tip=[qdata(v) for v in self.tip])

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','catalog_id','tool_id','axis','tip'))
        if data['schema']!='adaptive-parked-tool-1': raise ValueError('Unsupported parked context')
        return cls(data['catalog_id'],data['tool_id'],data['axis'],tuple(qread(v) for v in data['tip']))


def context_from_data(data):
    from .storage import action_from_data
    return ParkedTool.from_data(data) if data.get('schema')=='adaptive-parked-tool-1' else action_from_data(data)


def assess_parked_index(state,machine,before_id,after_id,context,fixture,stationary,*,depth,maximum_queries,allow_drill=False,allow_face=False):
    from .geometry import Union,Empty,IndexedSolid,supported
    from .index_motion import assembly_pose_geometry
    from .indexed_queries import full_rotation_envelope
    from .transitions import protected_check
    before=machine.select(before_id); after=machine.select(after_id)
    if context.catalog_id!=state.tool_catalog.id or context.axis!=machine.live_tool_axis:
        raise ValueError('Parked context catalogue/machine binding mismatch')
    if not supported(fixture) or not supported(stationary): raise ValueError('Explicit supported setup geometry required')
    integer(depth,'parked query depth',0,20); integer(maximum_queries,'parked query budget',1,1000000)
    tool=state.tool_catalog.select(context.tool_id)
    assembly=Union(tuple(assembly_pose_geometry(tool,context.axis,1,context.tip,allow_drill=allow_drill,allow_face=allow_face).values()))
    parts=[full_rotation_envelope(state.domain.source.stock,machine.spindle)]
    if fixture.bounds is not None: parts.append(full_rotation_envelope(fixture,machine.spindle))
    rotation=Union(tuple(parts))
    checks={name:protected_check(a,b,depth=depth,maximum_queries=maximum_queries).to_data() for name,a,b in (
        ('stock_clearance',assembly,IndexedSolid(state.domain.source.stock,before)),
        ('retraction_fixture',assembly,IndexedSolid(fixture,before)),
        ('retraction_stationary',assembly,stationary),('rotation_parked_tool',rotation,assembly),('rotation_stationary',rotation,stationary))}
    statuses=[v['status'] for v in checks.values()]
    status='REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    return dict(schema='adaptive-parked-index-assessment-1',status=status,material_hash=state.logical_hash,
                machine=machine.to_data(),before_orientation=before.id,after_orientation=after.id,context=context.to_data(),
                checks=checks,parked_machine=assembly.to_data(),rotation=rotation.to_data(),
                source_identity=identity(state.domain.source.to_data()),retraction_performed=False,removal_claim=False)
