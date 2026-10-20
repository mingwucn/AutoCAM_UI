"""R5 synthetic drill values. Read-only; not admitted to the executable catalog."""
from dataclasses import dataclass
from fractions import Fraction

from .domain import fields, identity, qdata, qread, rational
from .tool_catalog import _identifier


@dataclass(frozen=True, slots=True)
class DrillTool:
    assembly_id: str
    revision: str
    provenance: str
    mount_interface: str
    radius: Fraction
    point_height: Fraction
    active_length: Fraction
    usable_reach: Fraction
    shank_radius: Fraction
    holder_radius: Fraction
    holder_length: Fraction

    def __post_init__(self):
        for value in (self.assembly_id,self.revision,self.mount_interface): _identifier(value)
        if type(self.provenance) is not str or not self.provenance.strip() or len(self.provenance)>1024:
            raise ValueError('Explicit bounded synthetic provenance required')
        for name in self.dimensions():
            value=rational(getattr(self,name))
            if value<=0: raise ValueError('Drill dimension must be positive: '+name)
            object.__setattr__(self,name,value)
        if self.point_height+self.active_length>self.usable_reach:
            raise ValueError('Point and active cylinder extend behind holder front')

    @staticmethod
    def dimensions():
        return ('radius','point_height','active_length','usable_reach','shank_radius','holder_radius','holder_length')

    @property
    def overall_length(self): return self.usable_reach+self.holder_length

    @property
    def tool_id(self): return self.assembly_id

    @property
    def id(self): return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-drill-tool-1',assembly_id=self.assembly_id,revision=self.revision,
            family='DRILL',profile='SYNTHETIC_CONICAL_POINT_DRILL_V1',designation='SYNTHETIC',
            provenance=self.provenance,mount_interface=self.mount_interface,units='mm',gauge_reference='POINT_TIP',
            capabilities=['AXIAL_DRILL'],supported_machine_modes=['INDEXED_LIVE_TOOL'],
            additional_components=[],overall_length=qdata(self.overall_length),
            **{name:qdata(getattr(self,name)) for name in self.dimensions()})

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','assembly_id','revision','family','profile','designation','provenance','mount_interface',
            'units','gauge_reference','capabilities','supported_machine_modes','additional_components','overall_length',*cls.dimensions()))
        result=cls(data['assembly_id'],data['revision'],data['provenance'],data['mount_interface'],
                   **{name:qread(data[name]) for name in cls.dimensions()})
        # Check derived dimensions with the strict rational decoder too: Python
        # container equality must not let True stand in for numerator 1.
        if qread(data['overall_length'])!=result.overall_length or result.to_data()!=data:
            raise ValueError('Unsupported or noncanonical drill record')
        return result


@dataclass(frozen=True, slots=True)
class DrillDepth:
    reference: str
    requested_depth: Fraction
    through_thickness: Fraction | None = None

    def __post_init__(self):
        if self.reference not in ('FULL_DIAMETER_DEPTH','TIP_DEPTH','THROUGH_HOLE'):
            raise ValueError('Unsupported drill depth reference')
        object.__setattr__(self,'requested_depth',rational(self.requested_depth))
        if self.requested_depth<=0: raise ValueError('Positive requested depth required')
        if self.reference=='THROUGH_HOLE':
            thickness=rational(self.through_thickness)
            if thickness<=0 or self.requested_depth<thickness:
                raise ValueError('Through hole must request full-diameter breakthrough')
            object.__setattr__(self,'through_thickness',thickness)
        elif self.through_thickness is not None:
            raise ValueError('Only through-hole depth accepts stock thickness')

    def to_data(self):
        return dict(schema='adaptive-drill-depth-1',depth_reference=self.reference,
            requested_depth=qdata(self.requested_depth),
            through_thickness=None if self.through_thickness is None else qdata(self.through_thickness))

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','depth_reference','requested_depth','through_thickness'))
        if data['schema']!='adaptive-drill-depth-1': raise ValueError('Unsupported drill depth encoding')
        return cls(data['depth_reference'],qread(data['requested_depth']),
                   None if data['through_thickness'] is None else qread(data['through_thickness']))

    def resolve(self,tool):
        if type(tool) is not DrillTool: raise ValueError('Exact drill assembly required')
        tip=self.requested_depth if self.reference=='TIP_DEPTH' else self.requested_depth+tool.point_height
        full=tip-tool.point_height
        return dict(schema='adaptive-drill-depth-resolution-1',assembly_hash=tool.id,request=self.to_data(),
            gauge_reference='POINT_TIP',point_height=qdata(tool.point_height),derived_tip_depth=qdata(tip),
            derived_full_diameter_depth=qdata(full),positive_full_diameter_depth=full>0,
            cutting_length_result='PASS' if max(full,Fraction())<=tool.active_length else 'REJECTED',
            reach_result='PASS' if tip<=tool.usable_reach else 'REJECTED',
            point_overtravel=None if self.through_thickness is None else qdata(tip-self.through_thickness),
            assembly_clearance='NOT_ASSESSED',exit_permission='NOT_ASSESSED',completion='NOT_ASSESSED',
            operation_authorized=False)
