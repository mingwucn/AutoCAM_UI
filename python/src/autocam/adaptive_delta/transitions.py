"""One accepted-state writer, conservative removal history and scoped actions."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from fractions import Fraction
from itertools import product
from hashlib import sha256
from time import monotonic

from .domain import Bounds, Relation, canonical, digest, identity, integer, qdata
from .geometry import Box, Cylinder, Cutout, Empty, Union, region_id
from .partition import AnalyticClassifier, DomainSnapshot, VolumeInterval, verify_partition
from .codec import encode_snapshot

I, O, M = Relation.INSIDE, Relation.OUTSIDE, Relation.MIXED


@dataclass(frozen=True, slots=True)
class ClosedQuery:
    """May be a face/edge/point for safety; never an integration cell."""
    low: tuple
    high: tuple


@dataclass(frozen=True, slots=True)
class SafetyResult:
    status: str
    reason: str
    witness: dict | None = None

    def to_data(self):
        return {"status": self.status, "reason": self.reason, "witness": self.witness}


def protected_check(envelope, protected, *, depth=8, maximum_queries=10000):
    """Test the whole envelope before any delta clipping, including contact."""
    return _protected_check(envelope,protected,depth=depth,maximum_queries=maximum_queries)


def _protected_check(envelope,protected,*,depth,maximum_queries,classify_pair=None):
    """Shared traversal; the default Fraction predicates remain the reference."""
    if isinstance(protected, Empty):
        return SafetyResult("PASS", "empty_protected_set")
    eb, pb = envelope.bounds, protected.bounds
    if eb is None or pb is None:
        return SafetyResult("PASS", "empty_intersection")
    low = tuple(max(a, b) for a, b in zip(eb.low, pb.low))
    high = tuple(min(a, b) for a, b in zip(eb.high, pb.high))
    if any(a > b for a, b in zip(low, high)):
        return SafetyResult("PASS", "separated_support_bounds")
    if type(envelope) is Cutout and type(protected) is Cylinder:
        for hole in envelope.cutters:
            if (type(hole) is Cylinder and hole.axis == protected.axis
                    and hole.low < protected.low and protected.high < hole.high
                    and protected.radius + sum(abs(a-b) for a,b in zip(hole.center,protected.center)) < hole.radius):
                return SafetyResult("PASS", "strict_cylindrical_exclusion")
    stack = [(ClosedQuery(low, high), 0)]
    queries = 0
    unresolved = False
    while stack:
        query, level = stack.pop()
        queries += 1
        if queries > maximum_queries:
            return SafetyResult("UNRESOLVED", "protected_query_budget")
        e,p=(envelope.classify(query),protected.classify(query)) if classify_pair is None else classify_pair(query)
        if e == O or p == O:
            continue
        if e == I and p == I:
            return SafetyResult("REJECTED", "protected_intersection_or_contact",
                                {"low": [qdata(v) for v in query.low], "high": [qdata(v) for v in query.high]})
        if level >= depth or any(a == b for a, b in zip(query.low, query.high)):
            unresolved = True; continue
        stack.extend((c, level+1) for c in reversed(Bounds(query.low, query.high).children()))
    return SafetyResult("UNRESOLVED", "protected_boundary_unresolved") if unresolved else SafetyResult("PASS", "complete_envelope_separation")


def union_relation(envelopes, cell, *, max_tiles=32768):
    """Exact closed box-union coverage; other families retain conservative bounds."""
    return _union_relation(envelopes, cell, max_tiles=max_tiles)


def _union_relation(envelopes, cell, *, max_tiles=32768, classify=None):
    """Internal predicate hook; preserve the full reference box arrangement."""
    active = []
    for envelope in envelopes:
        relation = envelope.classify(cell) if classify is None else classify(envelope, cell)
        if relation == I:
            return I
        if relation != O:
            active.append(envelope)
    if not active:
        return O
    if not all(isinstance(e, Box) for e in active):
        return M
    cuts = []
    for axis in range(3):
        values = {cell.low[axis], cell.high[axis]}
        for envelope in active:
            for v in (envelope.bounds.low[axis], envelope.bounds.high[axis]):
                if cell.low[axis] < v < cell.high[axis]:
                    values.add(v)
        cuts.append(sorted(values))
    count = (len(cuts[0])-1)*(len(cuts[1])-1)*(len(cuts[2])-1)
    if count > max_tiles:
        return M
    intervals = [list(zip(v, v[1:])) for v in cuts]
    for axes in product(*intervals):
        tile = Bounds(tuple(a[0] for a in axes), tuple(a[1] for a in axes))
        if not any(e.classify(tile) == I for e in active):
            return M
    return I


@dataclass(frozen=True, slots=True)
class Action:
    envelope: object
    scope: str = "GEOMETRIC_SUBTRACTION"
    axis: int | None = None
    sign: int | None = None
    catalog_id: str | None = None
    tool_id: str | None = None
    motion: object | None = None
    clearance_profile: str = "original_stock_v1"

    def __post_init__(self):
        region_id(self.envelope)
        from .side_milling import SideMill
        if self.clearance_profile not in ('original_stock_v1','remaining_stock_v1','remaining_stock_side_entry_v2'):
            raise ValueError('Unsupported clearance profile')
        if self.clearance_profile!='original_stock_v1' and (self.scope!='FINITE_TOOL_SHADOW_PLANNING' or type(self.motion) is not SideMill):
            raise ValueError('Remaining clearance requires a side-milling action')
        if self.scope not in ("GEOMETRIC_SUBTRACTION", "DIRECTIONAL_SHADOW_PLANNING", "FINITE_TOOL_SHADOW_PLANNING"):
            raise ValueError("Unsupported action scope")
        if self.scope in ("DIRECTIONAL_SHADOW_PLANNING", "FINITE_TOOL_SHADOW_PLANNING"):
            if self.scope == "DIRECTIONAL_SHADOW_PLANNING" and not isinstance(self.envelope, Box):
                raise ValueError("Initial directional profile requires a box corridor")
            integer(self.axis, "direction axis", 0, 2)
            if type(self.sign) is not int or self.sign not in (-1, 1):
                raise ValueError("Invalid direction sign")
        elif self.axis is not None or self.sign is not None:
            raise ValueError("Geometric subtraction has no directional access claim")
        if self.scope == "FINITE_TOOL_SHADOW_PLANNING":
            from .tool_catalog import AxialPlunge
            from .side_milling import SideMill
            from .turning import TurningMotion
            from .indexed_tool_action import IndexedMillMotion
            from .drill_action import RequiredDrillMotion
            from .face_action import RequiredFaceMotion
            digest(self.catalog_id)
            if type(self.tool_id) is not str or not self.tool_id or not isinstance(self.motion, (AxialPlunge, SideMill, TurningMotion, IndexedMillMotion, RequiredDrillMotion, RequiredFaceMotion)):
                raise ValueError("Tool action requires a tool ID and supported motion")
            direction = (self.motion.direction if isinstance(self.motion, (TurningMotion, IndexedMillMotion, RequiredDrillMotion, RequiredFaceMotion)) else
                         (self.motion.travel_axis, self.motion.travel_sign) if isinstance(self.motion, SideMill)
                         else (self.motion.axis, self.motion.sign))
            if (self.axis, self.sign) != direction:
                raise ValueError("Action direction differs from tool motion")
        elif any(v is not None for v in (self.catalog_id, self.tool_id, self.motion)):
            raise ValueError("Version-1 actions cannot carry tool claims")

    def to_data(self):
        if self.scope == "FINITE_TOOL_SHADOW_PLANNING":
            from .drill_action import RequiredDrillMotion
            from .face_action import RequiredFaceMotion
            if type(self.motion) is RequiredFaceMotion:
                return dict(schema='adaptive-action-9',envelope=self.envelope.to_data(),scope=self.scope,
                    axis=self.axis,sign=self.sign,catalog_id=self.catalog_id,tool_id=self.tool_id,motion=self.motion.to_data(),
                    access_model='required-external-face-material-1',finite_tool_access='REQUIRES_STATE_BOUND_FACE_CHECKS',
                    continuous_motion='EXACT_EXTERNAL_FACE_LANES_WITH_CONNECTIONS')
            if type(self.motion) is RequiredDrillMotion:
                return dict(schema='adaptive-action-8',envelope=self.envelope.to_data(),scope=self.scope,
                    axis=self.axis,sign=self.sign,catalog_id=self.catalog_id,tool_id=self.tool_id,motion=self.motion.to_data(),
                    access_model='required-boundary-drill-material-1',finite_tool_access='REQUIRES_STATE_BOUND_DRILL_CHECKS',
                    continuous_motion='EXACT_MONOTONE_DRILL_ADVANCE_RETRACE')
            from .indexed_tool_action import IndexedMillMotion
            if isinstance(self.motion, IndexedMillMotion):
                return dict(schema='adaptive-action-5', envelope=self.envelope.to_data(), scope=self.scope,
                            axis=self.axis, sign=self.sign, catalog_id=self.catalog_id, tool_id=self.tool_id,
                            motion=self.motion.to_data(), access_model='exact-indexed-milling-1',
                            finite_tool_access='REQUIRES_INDEXED_MILLING_CHECKS', continuous_motion='FIXED_ORIENTATION_EXACT_MILLING_SWEEP')
            from .side_milling import SideMill
            from .turning import TurningMotion
            if isinstance(self.motion, TurningMotion):
                return {"schema": "adaptive-action-4", "envelope": self.envelope.to_data(),
                        "scope": self.scope, "axis": self.axis, "sign": self.sign,
                        "catalog_id": self.catalog_id, "tool_id": self.tool_id, "motion": self.motion.to_data(),
                        "access_model": "full_angle_meridional_shadow_1",
                        "finite_tool_access": "REQUIRES_RESTRICTED_TURNING_CHECKS",
                        "continuous_motion": "FULL_ANGLE_MERIDIONAL_SHADOW"}
            if isinstance(self.motion, SideMill) and self.clearance_profile=='remaining_stock_side_entry_v2':
                return dict(schema='adaptive-action-7',envelope=self.envelope.to_data(),scope=self.scope,
                    axis=self.axis,sign=self.sign,catalog_id=self.catalog_id,tool_id=self.tool_id,motion=self.motion.to_data(),
                    access_model='exact-monotone-side-cleared-holder-1',clearance_profile=self.clearance_profile,
                    finite_tool_access='REQUIRES_CLEARED_HOLDER_SIDE_CHECKS',continuous_motion='EXACT_MONOTONE_LATERAL_SWEEP')
            if isinstance(self.motion, SideMill) and self.clearance_profile=='remaining_stock_v1':
                return dict(schema='adaptive-action-6',envelope=self.envelope.to_data(),scope=self.scope,
                    axis=self.axis,sign=self.sign,catalog_id=self.catalog_id,tool_id=self.tool_id,motion=self.motion.to_data(),
                    access_model='exact-monotone-side-remaining-1',clearance_profile=self.clearance_profile,
                    finite_tool_access='REQUIRES_REMAINING_SIDE_MILL_CHECKS',continuous_motion='EXACT_MONOTONE_LATERAL_SWEEP')
            if isinstance(self.motion, SideMill):
                return {"schema": "adaptive-action-3", "envelope": self.envelope.to_data(),
                        "scope": self.scope, "axis": self.axis, "sign": self.sign,
                        "catalog_id": self.catalog_id, "tool_id": self.tool_id, "motion": self.motion.to_data(),
                        "access_model": "exact-monotone-side-mill-1",
                        "finite_tool_access": "REQUIRES_RESTRICTED_SIDE_MILL_CHECKS",
                        "continuous_motion": "EXACT_MONOTONE_LATERAL_SWEEP"}
            return {"schema": "adaptive-action-2", "envelope": self.envelope.to_data(),
                    "scope": self.scope, "axis": self.axis, "sign": self.sign,
                    "catalog_id": self.catalog_id, "tool_id": self.tool_id, "motion": self.motion.to_data(),
                    "access_model": "exact-monotone-plunge-1",
                    "finite_tool_access": "REQUIRES_RESTRICTED_PLUNGE_CHECKS",
                    "continuous_motion": "EXACT_MONOTONE_AXIAL_SWEEP"}
        return {"schema": "adaptive-action-1", "envelope": self.envelope.to_data(),
                "scope": self.scope, "axis": self.axis, "sign": self.sign,
                "access_model": "axis_prefix_shadow_v1" if self.axis is not None else "not_assessed",
                "finite_tool_access": "NOT_ASSESSED", "continuous_motion": "NOT_ASSESSED"}

    def validate_tool_binding(self, catalog):
        if self.scope != "FINITE_TOOL_SHADOW_PLANNING":
            return SafetyResult("PASS", "version_1_action") if catalog is None else SafetyResult(
                "REJECTED", "frozen_tool_catalog_requires_tool_action")
        if catalog is None or catalog.id != self.catalog_id:
            return SafetyResult("REJECTED", "tool_catalog_binding_mismatch")
        from .tool_catalog import plunge_geometry
        from .side_milling import SideMill, side_geometry
        from .turning import TurningMotion, turning_geometry
        from .indexed_tool_action import IndexedMillMotion, indexed_mill_geometry
        from .drill_action import RequiredDrillMotion, required_drill_geometry
        from .face_action import RequiredFaceMotion, required_face_geometry
        try:
            tool = catalog.select(self.tool_id)
        except ValueError:
            return SafetyResult("REJECTED", "tool_not_in_frozen_catalog")
        construct = (required_face_geometry if type(self.motion) is RequiredFaceMotion else
                     required_drill_geometry if type(self.motion) is RequiredDrillMotion else
                     indexed_mill_geometry if isinstance(self.motion, IndexedMillMotion) else
                     turning_geometry if isinstance(self.motion, TurningMotion) else
                     side_geometry if isinstance(self.motion, SideMill) else plunge_geometry)
        try:
            cutting = construct(tool, self.motion)['cutting']
        except ValueError:
            return SafetyResult('REJECTED', 'tool_motion_profile_mismatch')
        if region_id(cutting) != region_id(self.envelope):
            return SafetyResult("REJECTED", "tool_envelope_construction_mismatch")
        return SafetyResult("PASS", "tool_catalog_and_envelope_bound")

    def validate_setup_binding(self, turning_axis):
        from .turning import TurningMotion
        from .indexed_tool_action import IndexedMillMotion
        from .drill_action import RequiredDrillMotion
        from .face_action import RequiredFaceMotion
        if type(self.motion) is RequiredFaceMotion and self.motion.pose.spindle != turning_axis:
            return SafetyResult('REJECTED','face_spindle_binding_mismatch')
        if type(self.motion) is RequiredDrillMotion and self.motion.pose.spindle != turning_axis:
            return SafetyResult('REJECTED','drill_spindle_binding_mismatch')
        if isinstance(self.motion, IndexedMillMotion) and self.motion.pose.spindle != turning_axis:
            return SafetyResult('REJECTED', 'indexed_spindle_binding_mismatch')
        if isinstance(self.motion, TurningMotion) and self.motion.spindle_axis != turning_axis:
            return SafetyResult('REJECTED', 'turning_axis_binding_mismatch')
        return SafetyResult('PASS', 'frozen_setup_bound')

    def validate_access(self, source, catalog=None, turning_axis=None):
        binding = self.validate_tool_binding(catalog)
        if binding.status != "PASS":
            return binding
        setup = self.validate_setup_binding(turning_axis)
        if setup.status != 'PASS': return setup
        from .drill_action import RequiredDrillMotion
        from .face_action import RequiredFaceMotion
        if type(self.motion) is RequiredFaceMotion:
            return SafetyResult('UNRESOLVED','face_clearance_requires_material_state')
        if type(self.motion) is RequiredDrillMotion:
            return SafetyResult('UNRESOLVED','drill_clearance_requires_material_state')
        if self.clearance_profile!='original_stock_v1':
            return SafetyResult('UNRESOLVED','remaining_clearance_requires_material_state')
        if self.scope == "FINITE_TOOL_SHADOW_PLANNING":
            from .tool_catalog import assess_plunge
            from .side_milling import SideMill, assess_side_mill
            from .turning import TurningMotion, assess_turning
            from .indexed_tool_action import IndexedMillMotion, assess_indexed_mill
            assess = (assess_indexed_mill if isinstance(self.motion, IndexedMillMotion) else
                      assess_turning if isinstance(self.motion, TurningMotion) else
                      assess_side_mill if isinstance(self.motion, SideMill) else assess_plunge)
            assessment = assess(source, catalog, self.tool_id, self.motion)
            return SafetyResult(assessment["status"], assessment["reason"], {"tool_assessment": assessment})
        if self.scope == "GEOMETRIC_SUBTRACTION":
            return SafetyResult("PASS", "geometric_subtraction_only")
        stock, envelope = source.stock.bounds, self.envelope.bounds
        if stock is None:
            return SafetyResult("REJECTED", "no_stock_entry")
        axis = self.axis
        entry = envelope.low[axis] if self.sign == 1 else envelope.high[axis]
        exterior = entry < stock.low[axis] if self.sign == 1 else entry > stock.high[axis]
        if not exterior:
            return SafetyResult("REJECTED", "directional_action_omits_exterior_prefix")
        return SafetyResult("PASS", "explicit_exterior_corridor_whole_footprint")


def action_safety(action, source, catalog=None, turning_axis=None, *, material_state=None):
    if not isinstance(action, Action):
        raise ValueError("Typed action required")
    from .face_action import RequiredFaceMotion, assess_required_face
    if type(action.motion) is RequiredFaceMotion:
        if material_state is None:return SafetyResult('UNRESOLVED','face_clearance_requires_material_state')
        if type(material_state) is not MaterialState or material_state.domain.source.to_data()!=source.to_data():
            raise ValueError('Face material/source mismatch')
        for binding in (action.validate_tool_binding(catalog),action.validate_setup_binding(turning_axis)):
            if binding.status!='PASS':return binding
        return assess_required_face(material_state,catalog,action.tool_id,action.motion)
    from .drill_action import RequiredDrillMotion, assess_required_drill
    if type(action.motion) is RequiredDrillMotion:
        if material_state is None:return SafetyResult('UNRESOLVED','drill_clearance_requires_material_state')
        if type(material_state) is not MaterialState or material_state.domain.source.to_data()!=source.to_data():
            raise ValueError('Drill material/source mismatch')
        for binding in (action.validate_tool_binding(catalog),action.validate_setup_binding(turning_axis)):
            if binding.status!='PASS':return binding
        return assess_required_drill(material_state,catalog,action.tool_id,action.motion)
    if action.clearance_profile!='original_stock_v1' and material_state is not None:
        if not isinstance(material_state,MaterialState) or material_state.domain.source.geometry_id!=source.geometry_id:
            raise ValueError('Remaining clearance state/source mismatch')
        for binding in (action.validate_tool_binding(catalog),action.validate_setup_binding(turning_axis)):
            if binding.status!='PASS':return binding
        from .side_milling import assess_side_mill_remaining,assess_side_mill_cleared_holder
        assess=assess_side_mill_cleared_holder if action.clearance_profile=='remaining_stock_side_entry_v2' else assess_side_mill_remaining
        assessment=assess(material_state,catalog,action.tool_id,action.motion)
        return SafetyResult(assessment['status'],assessment['reason'],{'tool_assessment':assessment})
    access = action.validate_access(source, catalog, turning_axis)
    if access.status != "PASS" or action.scope == "FINITE_TOOL_SHADOW_PLANNING":
        return access
    return protected_check(action.envelope, source.protected)


def refine_for_envelope(snapshot, envelope, max_depth):
    integer(max_depth, "refinement depth", 0, snapshot.budget.max_depth)
    classifier = AnalyticClassifier(snapshot.source)
    result = []
    stack = list(reversed(snapshot.leaves))
    leaf_count = len(stack)
    exhausted = False
    start = monotonic()
    timed_out = False
    while stack:
        if monotonic()-start >= snapshot.budget.max_seconds:
            result.extend(stack)
            timed_out = True
            break
        leaf = stack.pop()
        relation = envelope.classify(snapshot.source.root.cell(leaf.address))
        split = (leaf.delta_upper and relation != O and (relation != I or not leaf.delta_lower)
                 and leaf.address.depth < max_depth)
        if split and leaf_count+7 <= snapshot.budget.max_leaves:
            children = classifier.classify_cells(leaf.address.child(n) for n in range(8))
            stack.extend(reversed(children))
            leaf_count += 7
        else:
            exhausted |= split
            result.append(leaf)
    return replace(snapshot, leaves=tuple(sorted(result, key=lambda c: (c.address.depth, c.address.morton_prefix))),
                   stop_reason="time_budget" if timed_out else ("leaf_budget" if exhausted else snapshot.stop_reason),
                   query_count=snapshot.query_count+classifier.query_count)


@dataclass(frozen=True, slots=True)
class MaterialState:
    domain: DomainSnapshot
    envelopes: tuple = ()
    revision: int = 0
    parent_event: str | None = None
    tool_catalog: object | None = None
    turning_axis: object | None = None
    _coverage: tuple | None = field(default=None, init=False, repr=False, compare=False)
    _history_cache: object = field(default=None, init=False, repr=False, compare=False)
    _remaining_clearance_cache: object = field(default=None, init=False, repr=False, compare=False)

    def __post_init__(self):
        from .turning_tools import TurningAxis, TurningInsert
        if self.tool_catalog is not None:
            from .tool_catalog import ToolCatalog
            if not isinstance(self.tool_catalog, ToolCatalog):
                raise ValueError("Material state requires a typed immutable tool catalog")
            if any(isinstance(t, TurningInsert) for t in self.tool_catalog.tools) and self.turning_axis is None:
                raise ValueError('Turning tools require a frozen spindle axis')
        if self.turning_axis is not None and (not isinstance(self.turning_axis, TurningAxis) or self.tool_catalog is None):
            raise ValueError('Turning setup requires a typed axis and frozen tool catalog')

    def history_relation(self, address):
        from .domain import CellAddress
        from .partition import SourceDomain
        from .history_cache import immutable_history, MAX_HISTORY_CACHE_ENTRIES
        if self._history_cache is None:
            eligible = (type(self) is MaterialState and type(self.domain) is DomainSnapshot
                        and type(self.domain.source) is SourceDomain
                        and immutable_history(self.domain.source.root, self.envelopes))
            object.__setattr__(self, '_history_cache', {} if eligible else False)
        cache = self._history_cache
        if cache is not False and type(address) is CellAddress and address in cache:
            return cache[address]
        result = union_relation(self.envelopes, self.domain.source.root.cell(address))
        if cache is not False and type(address) is CellAddress and len(cache) < MAX_HISTORY_CACHE_ENTRIES:
            cache[address] = result
        return result

    def coverage(self):
        if self._coverage is not None:
            return self._coverage
        result = []
        for leaf in self.domain.leaves:
            if not leaf.delta_upper:
                result.append((False, False)); continue
            relation = self.history_relation(leaf.address)
            result.append((leaf.delta_lower and relation == I, leaf.delta_upper and relation != O))
        object.__setattr__(self, "_coverage", tuple(result))
        return self._coverage

    def remaining(self, *, eligible=False):
        lower, upper = Fraction(), Fraction()
        for leaf, (removed_lower, removed_upper) in zip(self.domain.leaves, self.coverage()):
            lo = leaf.eligible_lower if eligible else leaf.delta_lower
            hi = leaf.eligible_upper if eligible else leaf.delta_upper
            volume = self.domain.source.root.side**3 / (1 << (3*leaf.address.depth))
            if lo and not removed_upper:
                lower += volume
            if hi and not removed_lower:
                upper += volume
        return VolumeInterval(lower, upper)

    def stock_remaining(self):
        lower, upper = Fraction(), Fraction()
        for leaf, (removed_lower, removed_upper) in zip(self.domain.leaves, self.coverage()):
            volume = self.domain.source.root.side**3 / (1 << (3*leaf.address.depth))
            if leaf.stock == I and not removed_upper:
                lower += volume
            if leaf.stock != O and not removed_lower:
                upper += volume
        return VolumeInterval(lower, upper)

    def to_data(self):
        data = {"schema": "adaptive-material-state-1", "domain_hash": self.domain.logical_hash,
                "envelopes": [e.to_data() for e in self.envelopes], "revision": self.revision,
                "parent_event": self.parent_event}
        if self.tool_catalog is not None:
            data.update(schema="adaptive-material-state-2", tool_catalog=self.tool_catalog.to_data())
        if self.turning_axis is not None:
            data.update(schema='adaptive-material-state-3', turning_axis=self.turning_axis.to_data())
        return data

    @property
    def logical_hash(self):
        return identity(self.to_data())


@dataclass(frozen=True, slots=True)
class Proposal:
    before_hash: str
    action: Action
    candidate_domain: DomainSnapshot
    safety: SafetyResult


@dataclass(frozen=True, slots=True)
class TransitionResult:
    event_id: str | None
    status: str
    reason: str
    before_hash: str
    after_hash: str
    removed: VolumeInterval
    reward: Fraction
    duplicate_delivery: bool = False

    def to_data(self):
        return {"event_id": self.event_id, "status": self.status, "reason": self.reason,
                "before_hash": self.before_hash, "after_hash": self.after_hash,
                "removed": self.removed.to_data(), "reward": qdata(self.reward),
                "duplicate_delivery": self.duplicate_delivery}


class TransitionService:
    """Single writer. Persistence is supplied through the commit sink port."""
    def __init__(self, domain, *, sink=None, tool_catalog=None, turning_axis=None):
        self._artifact_domain = None
        self._artifact_digest = None
        self._snapshot_artifact(domain)
        self.state = self._make_state(domain, tool_catalog=tool_catalog, turning_axis=turning_axis)
        self.receipts = {}
        self.attempt_receipts = {}
        self.sink = sink
        self.normalizer = domain.volume("eligible").upper

    def _make_state(self, *args, **kwargs):
        return MaterialState(*args, **kwargs)

    def fork(self):
        """Independent in-memory rollout sharing immutable geometry and history."""
        other = object.__new__(type(self))
        other.state = self.state
        other.receipts = dict(self.receipts)
        other.attempt_receipts = dict(self.attempt_receipts)
        other.normalizer = self.normalizer
        other._artifact_domain, other._artifact_digest = self._artifact_domain, self._artifact_digest
        other.sink = None
        return other

    def _snapshot_artifact(self, domain):
        from .snapshot_cache import immutable_snapshot
        if domain is not self._artifact_domain:
            digest = sha256(encode_snapshot(domain)).hexdigest()
            self._artifact_domain = domain if immutable_snapshot(domain) else None
            self._artifact_digest = digest
        return self._artifact_digest

    def propose(self, action, *, refinement_depth=None):
        if not isinstance(action, Action):
            raise ValueError("Typed action required")
        before = self.state
        safety = action_safety(action, before.domain.source, before.tool_catalog, before.turning_axis, material_state=before)
        candidate = before.domain
        if safety.status == "PASS" and refinement_depth is not None:
            candidate = self._refine_domain(candidate, action.envelope, refinement_depth)
        return Proposal(before.logical_hash, action, candidate, safety)

    def _refine_domain(self,domain,envelope,max_depth):
        return refine_for_envelope(domain,envelope,max_depth)

    def _verify_candidate(self,before,candidate):
        if candidate is not before:
            verify_partition(candidate)
        old_addresses = {(leaf.address.depth, leaf.address.morton_prefix) for leaf in before.leaves}
        for leaf in candidate.leaves:
            address = leaf.address
            if not any((depth, address.morton_prefix >> (3*(address.depth-depth))) in old_addresses
                       for depth in range(address.depth+1)):
                raise ValueError("Candidate partition coarsens or replaces accepted cells")

    def _measure_removal(self, previous, proposed):
        """Conservative new coverage on the already checked candidate partition."""
        lower, upper = Fraction(), Fraction()
        for leaf, old, new in zip(proposed.domain.leaves, previous.coverage(), proposed.coverage()):
            volume = proposed.domain.source.root.side**3 / (1 << (3*leaf.address.depth))
            if new[0] and not old[1]:
                lower += volume
            if new[1] and not old[0]:
                upper += volume
        return VolumeInterval(lower, upper)

    def commit(self, proposal, *, event_key, expected_pre_hash):
        if type(event_key) is not str or not event_key:
            raise ValueError("An event idempotency key is required")
        if self.sink is not None:
            self.sink.synchronize(self)
        request_id = identity({"action": proposal.action.to_data(), "before_hash": proposal.before_hash,
                               "expected_pre_hash": expected_pre_hash,
                               "candidate_domain_hash": proposal.candidate_domain.logical_hash})
        if event_key in self.receipts or event_key in self.attempt_receipts:
            prior_request, result = self.receipts[event_key] if event_key in self.receipts else self.attempt_receipts[event_key]
            if prior_request != request_id:
                raise ValueError("Conflicting idempotency key reuse")
            return replace(result, duplicate_delivery=True, reward=Fraction())
        before = self.state
        if expected_pre_hash != before.logical_hash or proposal.before_hash != before.logical_hash:
            raise ValueError("Stale expected state")
        # The service checks again; a caller-created Proposal cannot bypass safety.
        safety = action_safety(proposal.action, before.domain.source, before.tool_catalog, before.turning_axis, material_state=before)
        if safety.status != "PASS":
            result = TransitionResult(None, safety.status, safety.reason, before.logical_hash, before.logical_hash,
                                      VolumeInterval(Fraction(), Fraction()), Fraction())
            if self.sink is not None:
                self.sink.record_rejection(proposal, event_key, request_id, result)
            self.attempt_receipts[event_key] = (request_id, result)
            return result
        candidate = proposal.candidate_domain
        if candidate.source.to_data() != before.domain.source.to_data():
            raise ValueError("Proposal changes frozen geometry")
        self._verify_candidate(before.domain,candidate)
        previous = self._make_state(candidate, before.envelopes, before.revision, before.parent_event, before.tool_catalog, before.turning_axis)
        repeated = region_id(proposal.action.envelope) in {region_id(e) for e in before.envelopes}
        envelopes = before.envelopes if repeated else before.envelopes+(proposal.action.envelope,)
        proposed = self._make_state(candidate, envelopes, before.revision+1, tool_catalog=before.tool_catalog, turning_axis=before.turning_axis)
        removed = VolumeInterval(Fraction(), Fraction()) if repeated else self._measure_removal(previous, proposed)
        reward = removed.lower/self.normalizer if self.normalizer else Fraction()
        event = {"schema": "adaptive-event-3" if before.turning_axis is not None else "adaptive-event-2" if before.tool_catalog else "adaptive-event-1", "kind": "action", "event_key": event_key,
                 "request_id": request_id, "before_hash": before.logical_hash,
                 "parent_event": before.parent_event, "action": proposal.action.to_data(),
                 "domain_hash": candidate.logical_hash, "removed": removed.to_data(),
                 "domain_artifact": self._snapshot_artifact(candidate),
                 "reward": qdata(reward), "safety": safety.to_data()}
        event_id = identity(event)
        after = replace(proposed, parent_event=event_id)
        result = TransitionResult(event_id, "ACCEPTED", "idempotent_geometry" if repeated else "bounded_removal",
                                  before.logical_hash, after.logical_hash, removed, reward)
        if self.sink is not None:
            self.sink.publish(before, after, event, result, dict(self.receipts))
        self.state = after
        self.receipts[event_key] = (request_id, result)
        return result

    def refine(self, envelope, *, max_depth):
        # History is reapplied to every child by coverage(), not reset to uncut.
        if self.sink is not None:
            self.sink.synchronize(self)
        before = self.state
        candidate = self._refine_domain(before.domain, envelope, max_depth)
        self._verify_candidate(before.domain,candidate)
        event = {"schema": "adaptive-event-3" if before.turning_axis is not None else "adaptive-event-2" if before.tool_catalog else "adaptive-event-1", "kind": "refinement", "before_hash": before.logical_hash,
                 "parent_event": before.parent_event, "domain_hash": candidate.logical_hash,
                 "domain_artifact": self._snapshot_artifact(candidate),
                 "envelope": envelope.to_data(), "max_depth": max_depth,
                 "reward": qdata(Fraction())}
        event_id = identity(event)
        after = self._make_state(candidate, before.envelopes, before.revision+1, event_id, before.tool_catalog, before.turning_axis)
        result = TransitionResult(event_id, "ACCEPTED", "refinement_only", before.logical_hash, after.logical_hash,
                                  VolumeInterval(Fraction(), Fraction()), Fraction())
        if self.sink is not None:
            self.sink.publish(before, after, event, result, dict(self.receipts))
        self.state = after
        return result
