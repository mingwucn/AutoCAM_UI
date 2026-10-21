"""Indexed cuts through the existing material writer, with composite exact replay."""
import json

from .domain import Bounds, canonical, digest, fields, identity, qdata, qread, rational, triple
from .geometry import Box, Union, from_data
from .indexed_frames import IndexedMachine
from .indexed_queries import RotatedRegion
from .index_journal import IndexJournal
from .index_motion import assess_retract_index, milling_pose_geometry, assembly_pose_geometry
from .storage import action_from_data
from .tool_catalog import AxialPlunge, MillingTool, plunge_action, plunge_geometry
from .transitions import TransitionService, protected_check
from .side_milling import SideMill, side_geometry
from .indexed_tool_action import IndexedMillMotion, indexed_mill_action, indexed_mill_geometry
from .indexed_cost import IndexedCostModel
from .indexed_tool_change import ToolChangeStation
from .indexed_parked import ParkedTool,context_from_data


class IndexedCutJournal(IndexJournal):
    def __init__(self, service, machine, initial_pose, predecessor, rotating_fixture, stationary_geometry,
                 *, index_seconds, retract_seconds, cut_seconds, motion_profile='quarter_turn_plunge_1', cost_model=None, tool_change=None,
                 explicit_primitives=False, drill_tools=False, face_tools=False):
        if type(face_tools) is not bool or (face_tools and not drill_tools):
            raise ValueError('Face profile requires drill-capable explicit primitives')
        if face_tools and (type(cost_model) is not IndexedCostModel or not cost_model.face_support):
            raise ValueError('Face profile requires explicit face timing')
        if not face_tools and cost_model is not None and cost_model.face_support:
            raise ValueError('Face timing requires journal profile 8')
        self._face_tools = face_tools
        if type(drill_tools) is not bool or (drill_tools and not explicit_primitives):
            raise ValueError('Drill profile requires explicit primitives')
        if drill_tools and not face_tools and (type(cost_model) is not IndexedCostModel or not cost_model.drill_support):
            raise ValueError('Drill profile requires explicit drill timing')
        if not drill_tools and cost_model is not None and cost_model.drill_support:
            raise ValueError('Drill timing requires journal profile 7')
        self._drill_tools = drill_tools
        if type(explicit_primitives) is not bool:
            raise ValueError('Explicit primitive profile must be boolean')
        if explicit_primitives and (motion_profile != 'indexed_milling_2' or cost_model is None or tool_change is None):
            raise ValueError('Explicit primitives require costed indexed milling and an exchange station')
        self._explicit_primitives = explicit_primitives
        if motion_profile not in ('quarter_turn_plunge_1', 'indexed_milling_2'):
            raise ValueError('Unsupported indexed workflow profile')
        self._motion_profile = motion_profile
        if cost_model is not None:
            if type(cost_model) is not IndexedCostModel or motion_profile != 'indexed_milling_2':
                raise ValueError('Cost model requires indexed workflow v2')
            cost_model.validate_context(machine, service.state.tool_catalog)
        self._cost_model = cost_model
        self._starts_parked = type(predecessor) is ParkedTool
        if self._starts_parked and cost_model is None: raise ValueError('Parked start requires costed indexed workflow')
        if tool_change is not None and (type(tool_change) is not ToolChangeStation or cost_model is None or tool_change.machine_id!=machine.id):
            raise ValueError('Tool exchange requires matching costed machine context')
        self._tool_change = tool_change
        if not isinstance(service, TransitionService):
            raise ValueError('Existing material writer required')
        cut_seconds = rational(cut_seconds)
        if cut_seconds <= 0: raise ValueError('Positive declared cut-time estimate required')
        self._service = service.fork()
        self._cut_seconds = cut_seconds
        super().__init__(self._service.state, machine, initial_pose, predecessor, rotating_fixture,
                         stationary_geometry, index_seconds=index_seconds, retract_seconds=retract_seconds)
        genesis = json.loads(self._genesis)
        genesis.update(schema='adaptive-indexed-cut-genesis-1', cut_seconds=qdata(cut_seconds))
        if motion_profile == 'indexed_milling_2':
            genesis.update(schema='adaptive-indexed-cut-genesis-2', motion_profile=motion_profile)
        if cost_model is not None: genesis.update(schema='adaptive-indexed-cut-genesis-3', cost_model=cost_model.to_data())
        if tool_change is not None: genesis.update(schema='adaptive-indexed-cut-genesis-4', tool_change=tool_change.to_data())
        if self._starts_parked: genesis.update(schema='adaptive-indexed-cut-genesis-5', tool_change=tool_change.to_data() if tool_change else None)
        if self._explicit_primitives: genesis['schema'] = 'adaptive-indexed-cut-genesis-6'
        if self._drill_tools: genesis['schema'] = 'adaptive-indexed-cut-genesis-7'
        if self._face_tools: genesis['schema'] = 'adaptive-indexed-cut-genesis-8'
        self._genesis = canonical(genesis)

    @property
    def state(self):
        result = super().state
        result.update(schema='adaptive-indexed-cut-state-1', tool_reference_orientation=self._initial_pose,
                      tool_context_action_id=identity(self._predecessor.to_data()))
        if self._motion_profile == 'indexed_milling_2': result['schema'] = 'adaptive-indexed-cut-state-2'
        if self._cost_model is not None: result['schema'] = 'adaptive-indexed-cut-state-3'
        if self._tool_change is not None: result['schema'] = 'adaptive-indexed-cut-state-4'
        if self._starts_parked: result['schema'] = 'adaptive-indexed-cut-state-5'
        if self._explicit_primitives: result['schema'] = 'adaptive-indexed-cut-state-6'
        if self._drill_tools: result['schema'] = 'adaptive-indexed-cut-state-7'
        if self._face_tools: result['schema'] = 'adaptive-indexed-cut-state-8'
        return result

    @property
    def explicit_primitives(self): return self._explicit_primitives

    @property
    def drill_tools(self): return self._drill_tools

    @property
    def face_tools(self): return self._face_tools

    def _assess_index_context(self, *args):
        return assess_retract_index(*args, allow_drill=self._drill_tools, allow_face=self._face_tools)

    @property
    def material(self): return self._material

    def semantic_snapshot(self):
        """Physical/representation context, separate from decision delivery history."""
        from .geometry import region_id
        material = self._material
        envelopes = {region_id(e): e.to_data() for e in material.envelopes}
        result = json.loads(canonical(dict(schema='adaptive-indexed-semantic-state-1',
            material=dict(domain_id=material.domain.logical_hash,
                          envelopes=[envelopes[key] for key in sorted(envelopes)],
                          catalog=material.tool_catalog.to_data(),
                          turning_axis=material.turning_axis.to_data()),
            machine=self._machine.to_data(), orientation_id=self._pose,
            rotating_fixture=self._fixture.to_data(), stationary_geometry=self._stationary.to_data(),
            motion_context=dict(predecessor=self._predecessor.to_data(), parked=self._parked,
                                reference_orientation=self._initial_pose),
            workflow=dict(motion_profile=self._motion_profile,
                          index_seconds=qdata(self._index_seconds), retract_seconds=qdata(self._retract_seconds),
                          cut_seconds=qdata(self._cut_seconds),
                          cost_model=None if self._cost_model is None else self._cost_model.to_data(),
                          tool_change=None if self._tool_change is None else self._tool_change.to_data()))))
        if self._explicit_primitives: result['workflow']['explicit_primitives'] = True
        if self._drill_tools: result['workflow']['drill_tools'] = True
        if self._face_tools: result['workflow']['face_tools'] = True
        return result

    def fork(self):
        other = super().fork(); other._service = self._service.fork()
        return other

    def _previous_motion(self):
        if type(self._predecessor) is ParkedTool: return None
        motion = self._predecessor.motion
        return motion.world_motion if type(motion) is IndexedMillMotion else motion

    def _index_estimate(self, target, retract):
        if self._cost_model is None: return None
        return self._cost_model.estimate(before=self._pose,after=target,retract=self._previous_motion() if retract else None)

    def _cut_estimate(self, motion, tool_id, tips, retract):
        if self._cost_model is None: return None
        previous = self._previous_motion()
        parked = self._predecessor.tip if previous is None else previous.start_tip
        if type(self._predecessor.motion) not in (IndexedMillMotion,ParkedTool):
            parked = self._machine.select(self._initial_pose).point(parked)
        changing=tool_id!=self._predecessor.tool_id
        route=self._tool_change.return_route(parked,self._machine.live_tool_axis) if changing else ()
        result=self._cost_model.estimate(motion=motion,tool_id=tool_id,approach=(parked,*route,*tips,motion.start_tip),
                                         retract=previous if retract else None)
        if changing:
            result['components']['tool_change']=qdata(self._tool_change.seconds)
            result['total_seconds']=qdata(qread(result['total_seconds'])+self._tool_change.seconds)
            result['tool_change_station_id']=self._tool_change.id
        return result

    def change_tool(self, tool_id, *, event_key, expected_head):
        """Version 6 exchange primitive; no material writer and no bundled CUT."""
        if not self._explicit_primitives: raise ValueError('Explicit tool change requires journal version 6')
        if type(tool_id) is not str or not 1 <= len(tool_id) <= 128:
            raise ValueError('Bounded tool ID required')
        if type(event_key) is not str or not 1 <= len(event_key) <= 128:
            raise ValueError('Bounded idempotency key required')
        request = dict(primitive='TOOL_CHANGE', tool_id=tool_id, event_key=event_key, expected_head=expected_head)
        request_id = identity(request)
        if event_key in self._receipts:
            prior, raw = self._receipts[event_key]
            if prior != request_id: raise ValueError('Conflicting operation idempotency key')
            return dict(json.loads(raw), duplicate_delivery=True, charged_seconds=qdata(rational(0)), removal_reward=qdata(rational(0)))
        if expected_head != self.head: raise ValueError('Stale indexed planning head')
        if len(self._records) >= 256: raise ValueError('Composite journal request budget')
        before = self.head; old_tool_id = self._predecessor.tool_id
        checks = {}; estimate = None; route = (); cost = rational(0); retract = False
        status, reason = 'REJECTED', 'unsupported_exchange_assembly'
        try: selected = self._material.tool_catalog.select(tool_id)
        except ValueError: selected = None
        if tool_id == old_tool_id:
            status, reason = 'ACCEPTED', 'already_mounted'
        elif type(selected) is MillingTool or (self._drill_tools and self._is_drill(selected)) or (self._face_tools and self._is_face(selected)):
            old_tool = self._material.tool_catalog.select(old_tool_id)
            retract = not self._parked
            if retract:
                assessment = assess_retract_index(self._material, self._machine, self._initial_pose, self._pose,
                                                 self._predecessor, self._fixture, self._stationary)
                for name in ('accepted_envelope', 'forward_access', 'machine_tool_axis', 'retraction_fixture', 'retraction_stationary'):
                    checks[name] = assessment['checks'].get(name, dict(status='UNRESOLVED', reason='missing_retraction_check', witness=None))
            motion = self._predecessor.motion
            world = type(motion) in (IndexedMillMotion, ParkedTool)
            if type(motion) is IndexedMillMotion: motion = motion.world_motion
            parked = motion.start_tip if world else self._machine.select(self._initial_pose).point(motion.start_tip)
            route = self._tool_change.return_route(parked, self._machine.live_tool_axis)
            fits = self._tool_change.contains_assemblies(self._machine, old_tool, selected, allow_drill=self._drill_tools, allow_face=self._face_tools)
            checks['exchange_assembly_containment'] = dict(status='PASS' if fits else 'REJECTED',
                reason='declared_exchange_chamber_contains_assemblies', witness=None)
            pose = self._machine.select(self._pose)
            obstacles = dict(stock=RotatedRegion(self._material.domain.source.stock, pose),
                             fixture=RotatedRegion(self._fixture, pose), stationary=self._stationary)
            chamber = Box(self._tool_change.chamber)
            for name, obstacle in obstacles.items():
                checks['exchange_'+name] = protected_check(chamber, obstacle).to_data()
            previous = Union(tuple(assembly_pose_geometry(old_tool, self._machine.live_tool_axis, 1, parked, allow_drill=self._drill_tools, allow_face=self._face_tools).values()))
            for n, tip in enumerate(route):
                entry = Union(tuple(assembly_pose_geometry(old_tool, self._machine.live_tool_axis, 1, tip, allow_drill=self._drill_tools, allow_face=self._face_tools).values()))
                a, b = previous.bounds, entry.bounds
                sweep = Box(Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)), tuple(max(x,y) for x,y in zip(a.high,b.high))))
                for name, obstacle in obstacles.items():
                    checks[f'exchange_return_{n}_'+name] = protected_check(sweep, obstacle).to_data()
                previous = entry
            statuses = [c['status'] for c in checks.values()]
            status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if any(s != 'PASS' for s in statuses) else 'ACCEPTED'
            reason = 'exchange_at_declared_station' if status == 'ACCEPTED' else 'exchange_geometry_not_proved'
            if status == 'ACCEPTED':
                estimate = self._cost_model.estimate(approach=(parked, *route), retract=self._previous_motion() if retract else None)
                estimate['components']['tool_change'] = qdata(self._tool_change.seconds)
                cost = qread(estimate['total_seconds']) + self._tool_change.seconds
                estimate['total_seconds'] = qdata(cost)
                estimate['tool_change_station_id'] = self._tool_change.id
        performed = status == 'ACCEPTED' and tool_id != old_tool_id
        event = dict(schema='adaptive-indexed-tool-change-event-1', request=request, before_head=before,
            status=status, reason=reason, checks=checks, previous_tool_id=old_tool_id,
            requested_tool_id=tool_id, station_id=self._tool_change.id, performed=performed,
            retraction_performed=performed and retract, return_route=[[qdata(v) for v in p] for p in route],
            time_estimate=estimate, charged_seconds=qdata(cost), removal_reward=qdata(rational(0)),
            material_hash=self._material.logical_hash, motion_scope='existing_bounded_exchange_not_full_R5_certificate')
        event_id = identity(event)
        branch = self.fork()
        if performed:
            branch._predecessor = ParkedTool(self._material.tool_catalog.id, tool_id, self._machine.live_tool_axis, self._tool_change.tip)
            branch._initial_pose = self._pose; branch._parked = True
            branch._revision += 1; branch._parent = event_id; branch._elapsed += cost
        result = dict(event=event, event_id=event_id, status=status, reason=reason,
            before_head=before, after_head=branch.head, duplicate_delivery=False,
            charged_seconds=qdata(cost), removal_reward=qdata(rational(0)), material_hash=self._material.logical_hash)
        raw = canonical(result)
        branch._records += (canonical(dict(request=request, result=result)),)
        branch._receipts[event_key] = (request_id, raw)
        self.__dict__ = branch.__dict__
        return json.loads(raw)

    @staticmethod
    def _is_drill(tool):
        from .drill_tools import DrillTool
        return type(tool) is DrillTool

    @staticmethod
    def _is_face(tool):
        from .face_tools import FaceMillTool
        return type(tool) is FaceMillTool

    def drill(self, operation, tool_id, *, event_key, expected_head, evaluation_id, approach_tips=()):
        """Profile 7 drill, sole material writer, exact return to the start tip."""
        from .drill_operation import DrillOperation, assess_drill_route
        from .hole_equivalence import compare_hole_shape
        if not self._drill_tools or type(operation) is not DrillOperation:
            raise ValueError('Drill operation requires journal profile 7')
        digest(evaluation_id)
        if type(tool_id) is not str or not 1 <= len(tool_id) <= 128:
            raise ValueError('Bounded tool ID required')
        if type(event_key) is not str or not 1 <= len(event_key) <= 128:
            raise ValueError('Bounded idempotency key required')
        if not isinstance(approach_tips, (list,tuple)) or len(approach_tips)>8:
            raise ValueError('Unsupported approach route')
        tips=tuple(triple(t) for t in approach_tips)
        request=dict(drill_operation=operation.to_data(),tool_id=tool_id,event_key=event_key,
            expected_head=expected_head,evaluation_id=evaluation_id,approach_tips=[[qdata(v) for v in t] for t in tips])
        request_id=identity(request)
        if event_key in self._receipts:
            prior,raw=self._receipts[event_key]
            if prior!=request_id:raise ValueError('Conflicting operation idempotency key')
            return dict(json.loads(raw),duplicate_delivery=True,charged_seconds=qdata(rational(0)),removal_reward=qdata(rational(0)))
        if expected_head!=self.head:raise ValueError('Stale indexed planning head')
        if len(self._records)>=256:raise ValueError('Composite journal request budget')
        before=self.head; route=assess_drill_route(self,operation,tool_id,tips,evaluation_id=evaluation_id)
        status,reason=route['status'],route['reason']; writer_result=None; proposed=None; estimate=None
        cost=rational(0);reward=rational(0)
        if status=='PASS':
            proposed=self._service.fork();action=action_from_data(route['part_action'])
            writer=proposed.commit(proposed.propose(action),event_key='indexed/'+before+'/'+event_key,
                expected_pre_hash=proposed.state.logical_hash)
            writer_result=writer.to_data();status,reason=writer.status,writer.reason
            if status=='ACCEPTED':
                estimate=self._cost_model.estimate(motion=operation,tool_id=tool_id,
                    approach=(self._predecessor.tip,*tips,operation.world_motion.start_tip))
                cost=qread(estimate['total_seconds']);reward=writer.reward
        accepted=proposed.state if status=='ACCEPTED' else self._material
        shape=compare_hole_shape(accepted,operation.requirement)
        event=dict(schema='adaptive-indexed-drill-event-1',request=request,before_head=before,
            orientation_id=self._pose,route=route,writer_result=writer_result,status=status,reason=reason,
            accepted_shape=shape,operation_complete=status=='ACCEPTED' and shape['comparison']=='EQUAL',
            time_estimate=estimate,charged_seconds=qdata(cost),removal_reward=qdata(reward))
        event_id=identity(event);branch=self.fork()
        if status=='ACCEPTED':
            branch._service=proposed;branch._material=proposed.state
            branch._predecessor=ParkedTool(self._material.tool_catalog.id,tool_id,self._machine.live_tool_axis,operation.world_motion.start_tip)
            branch._initial_pose=self._pose;branch._parked=True
            branch._revision+=1;branch._parent=event_id;branch._elapsed+=cost
        result=dict(event=event,event_id=event_id,status=status,reason=reason,before_head=before,after_head=branch.head,
            duplicate_delivery=False,charged_seconds=qdata(cost),removal_reward=qdata(reward),material_hash=branch._material.logical_hash)
        raw=canonical(result);branch._records+=(canonical(dict(request=request,result=result)),)
        branch._receipts[event_key]=(request_id,raw);self.__dict__=branch.__dict__
        return json.loads(raw)

    def face(self, operation, tool_id, *, event_key, expected_head, evaluation_id, approach_tips=(), budget=None):
        """Profile 8 face operation; commit once through the existing writer."""
        from .face_operation import FaceOperation
        from .face_route import assess_face_route
        from .face_coverage import certify_face_coverage
        from .ordered_motion import MotionBudget
        if not self._face_tools or type(operation) is not FaceOperation:
            raise ValueError('Face operation requires journal profile 8')
        budget = MotionBudget() if budget is None else budget
        if type(budget) is not MotionBudget: raise ValueError('Typed face motion budget required')
        digest(evaluation_id)
        if type(tool_id) is not str or not 1 <= len(tool_id) <= 128:
            raise ValueError('Bounded tool ID required')
        if type(event_key) is not str or not 1 <= len(event_key) <= 128:
            raise ValueError('Bounded idempotency key required')
        if type(approach_tips) not in (list, tuple) or len(approach_tips) > 8:
            raise ValueError('Unsupported approach route')
        tips = tuple(triple(t) for t in approach_tips)
        request = dict(face_operation=operation.to_data(), tool_id=tool_id, event_key=event_key,
            expected_head=expected_head, evaluation_id=evaluation_id,
            approach_tips=[[qdata(v) for v in t] for t in tips], budget=budget.to_data())
        request_id = identity(request)
        if event_key in self._receipts:
            prior, raw = self._receipts[event_key]
            if prior != request_id: raise ValueError('Conflicting operation idempotency key')
            return dict(json.loads(raw), duplicate_delivery=True, charged_seconds=qdata(rational(0)), removal_reward=qdata(rational(0)))
        if expected_head != self.head: raise ValueError('Stale indexed planning head')
        if len(self._records) >= 256: raise ValueError('Composite journal request budget')
        before = self.head
        route = assess_face_route(self, operation, tool_id, tips, evaluation_id=evaluation_id, budget=budget)
        status, reason = route['status'], route['reason']
        writer_result = None; proposed = None; estimate = None; cost = rational(0); reward = rational(0)
        if status == 'PASS':
            proposed = self._service.fork(); action = action_from_data(route['part_action'])
            writer = proposed.commit(proposed.propose(action), event_key='indexed/'+before+'/'+event_key,
                                     expected_pre_hash=proposed.state.logical_hash)
            writer_result = writer.to_data(); status, reason = writer.status, writer.reason
            if status == 'ACCEPTED':
                estimate = self._cost_model.estimate(motion=operation, tool_id=tool_id,
                    approach=(self._predecessor.tip, *tips, operation.plan.passes[0].safe_start))
                cost = qread(estimate['total_seconds']); reward = writer.reward
        if status == 'ACCEPTED':
            coverage = certify_face_coverage(proposed.state, operation.requirement, budget=budget)
        else:
            coverage = dict(status='NOT_ASSESSED', reason='face_operation_not_accepted')
        event = dict(schema='adaptive-indexed-face-event-1', request=request, before_head=before,
            orientation_id=self._pose, route=route, writer_result=writer_result, status=status, reason=reason,
            accepted_coverage=coverage, operation_complete=status == 'ACCEPTED' and coverage['status'] == 'COVERED',
            time_estimate=estimate, charged_seconds=qdata(cost), removal_reward=qdata(reward))
        event_id = identity(event); branch = self.fork()
        if status == 'ACCEPTED':
            branch._service = proposed; branch._material = proposed.state
            branch._predecessor = ParkedTool.from_data(route['returned_context'])
            branch._initial_pose = self._pose; branch._parked = True
            branch._revision += 1; branch._parent = event_id; branch._elapsed += cost
        result = dict(event=event, event_id=event_id, status=status, reason=reason,
            before_head=before, after_head=branch.head, duplicate_delivery=False,
            charged_seconds=qdata(cost), removal_reward=qdata(reward), material_hash=branch._material.logical_hash)
        raw = canonical(result); branch._records += (canonical(dict(request=request, result=result)),)
        branch._receipts[event_key] = (request_id, raw); self.__dict__ = branch.__dict__
        return json.loads(raw)

    def cut(self, world_motion, tool_id, *, event_key, expected_head, approach_tips=()):
        extended = self._motion_profile == 'indexed_milling_2'
        if type(world_motion) not in ((AxialPlunge, SideMill) if extended else (AxialPlunge,)):
            raise ValueError('Typed machine-frame axial plunge required')
        if not isinstance(approach_tips, (tuple,list)) or len(approach_tips) > 8 or (approach_tips and not extended):
            raise ValueError('Unsupported or excessive approach route')
        approach_tips = tuple(triple(tip) for tip in approach_tips)
        if type(event_key) is not str or not 1 <= len(event_key) <= 128:
            raise ValueError('Bounded idempotency key required')
        request = dict(world_motion=world_motion.to_data(), tool_id=tool_id,
                       event_key=event_key, expected_head=expected_head)
        if extended: request['approach_tips'] = [[qdata(v) for v in tip] for tip in approach_tips]
        request_id = identity(request)
        if event_key in self._receipts:
            prior, raw = self._receipts[event_key]
            if prior != request_id: raise ValueError('Conflicting operation idempotency key')
            return dict(json.loads(raw), duplicate_delivery=True, charged_seconds=qdata(rational(0)), removal_reward=qdata(rational(0)))
        if expected_head != self.head: raise ValueError('Stale indexed planning head')
        if len(self._records) >= 256: raise ValueError('Composite journal request budget')
        before = self.head; pose = self._machine.select(self._pose)
        part_action = None; checks = {}; writer_result = None; proposed = None
        cost = rational(0); reward = rational(0); retract = not self._parked; estimate = None
        status, reason = 'UNRESOLVED', 'unsupported_indexed_cut_profile'
        direction = [0, 0, 0]; direction[world_motion.axis] = world_motion.sign
        transformed = pose.inverse().vector(direction)
        axes = [k for k, v in enumerate(transformed) if v]
        changing=tool_id!=self._predecessor.tool_id
        try: selected_tool=self._material.tool_catalog.select(tool_id)
        except ValueError: selected_tool=None
        if self._explicit_primitives and changing:
            status, reason = 'REJECTED', 'MACHINE_STATE_INCOMPATIBLE'
        profile = (world_motion.axis == self._machine.live_tool_axis and world_motion.sign == 1 and
                   (not changing or (self._tool_change is not None and not self._explicit_primitives)) and type(selected_tool) is MillingTool and
                   (extended or (len(axes) == 1 and abs(transformed[axes[0]]) == 1)))
        if profile:
            tool = self._material.tool_catalog.select(tool_id)
            part_motion = IndexedMillMotion(pose, world_motion) if extended else AxialPlunge(axes[0], int(transformed[axes[0]]),
                                      pose.inverse().point(world_motion.start_tip), pose.inverse().point(world_motion.end_tip))
            part_action = (indexed_mill_action if extended else plunge_action)(self._material.tool_catalog, tool_id, part_motion)
            if retract:
                assessment = assess_retract_index(self._material, self._machine, self._initial_pose, self._pose,
                                                 self._predecessor, self._fixture, self._stationary)
                for name in ('accepted_envelope', 'forward_access', 'machine_tool_axis', 'retraction_fixture', 'retraction_stationary'):
                    checks[name] = assessment['checks'][name]
            reference_pose = self._machine.select(self._initial_pose)
            old_motion = self._predecessor.motion
            old_indexed = type(old_motion) in (IndexedMillMotion,ParkedTool)
            if type(old_motion) is IndexedMillMotion: old_motion = old_motion.world_motion
            old_tool=self._material.tool_catalog.select(self._predecessor.tool_id)
            old_shape = Union(tuple(milling_pose_geometry(old_tool, old_motion.axis, old_motion.sign, old_motion.start_tip).values()))
            old_park = old_shape if old_indexed else RotatedRegion(old_shape, reference_pose)
            world_sweep = Union(tuple((side_geometry if type(world_motion) is SideMill else plunge_geometry)(tool, world_motion).values()))
            part_sweep = Union(tuple((indexed_mill_geometry if extended else plunge_geometry)(tool, part_motion).values()))
            queries = {}
            previous = old_park
            if changing:
                fits=self._tool_change.contains_assemblies(self._machine,old_tool,tool)
                checks['exchange_assembly_containment']=dict(status='PASS' if fits else 'REJECTED',reason='declared_exchange_chamber_contains_assemblies',witness=None)
                chamber=Box(self._tool_change.chamber)
                queries.update(exchange_stock=(chamber,RotatedRegion(self._material.domain.source.stock,pose)),
                               exchange_fixture=(chamber,RotatedRegion(self._fixture,pose)),exchange_stationary=(chamber,self._stationary))
                parked_tip=old_motion.start_tip if old_indexed else reference_pose.point(old_motion.start_tip)
                for n,tip in enumerate(self._tool_change.return_route(parked_tip,self._machine.live_tool_axis)):
                    entry=Union(tuple(milling_pose_geometry(old_tool,world_motion.axis,world_motion.sign,tip).values()))
                    a,b=previous.bounds,entry.bounds
                    sweep=Box(Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)),tuple(max(x,y) for x,y in zip(a.high,b.high))))
                    queries.update({f'exchange_return_{n}_stock':(sweep,RotatedRegion(self._material.domain.source.stock,pose)),
                                    f'exchange_return_{n}_fixture':(sweep,RotatedRegion(self._fixture,pose)),
                                    f'exchange_return_{n}_stationary':(sweep,self._stationary)})
                    previous=entry
                previous=Union(tuple(milling_pose_geometry(tool,world_motion.axis,world_motion.sign,self._tool_change.tip).values()))
            for n, tip in enumerate((*approach_tips, world_motion.start_tip)):
                entry = Union(tuple(milling_pose_geometry(tool, world_motion.axis, world_motion.sign, tip).values()))
                a, b = previous.bounds, entry.bounds
                translation = Box(Bounds(tuple(min(x, y) for x, y in zip(a.low, b.low)),
                                         tuple(max(x, y) for x, y in zip(a.high, b.high))))
                prefix = 'approach_'+str(n)+'_' if extended else 'approach_'
                queries.update({prefix+'stock':(translation, RotatedRegion(self._material.domain.source.stock, pose)),
                                prefix+'fixture':(translation, RotatedRegion(self._fixture, pose)),
                                prefix+'stationary':(translation, self._stationary)})
                previous = entry
            queries.update(cut_fixture=(part_sweep, self._fixture), cut_stationary=(world_sweep, self._stationary))
            for name, (moving, obstacle) in queries.items(): checks[name] = protected_check(moving, obstacle).to_data()
            statuses = [v['status'] for v in checks.values()]
            status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'ACCEPTED'
            reason = 'indexed_motion_geometry_not_proved'
            if status == 'ACCEPTED':
                proposed = self._service.fork()
                writer = proposed.commit(proposed.propose(part_action), event_key='indexed/'+before+'/'+event_key,
                                         expected_pre_hash=proposed.state.logical_hash)
                writer_result = writer.to_data(); status, reason = writer.status, writer.reason
                if status == 'ACCEPTED':
                    cost = self._cut_seconds+(self._retract_seconds if retract else 0)
                    estimate = self._cut_estimate(world_motion,tool_id,approach_tips,retract)
                    if estimate is not None: cost = qread(estimate['total_seconds'])
                    reward = writer.reward
        event = dict(schema='adaptive-indexed-cut-event-2' if extended else 'adaptive-indexed-cut-event-1', request=request, before_head=before,
                     orientation_id=self._pose, generated_part_action=part_action.to_data() if part_action else None,
                     checks=checks, writer_result=writer_result, status=status, reason=reason,
                     retraction_performed=retract and status == 'ACCEPTED',
                     charged_seconds=qdata(cost), removal_reward=qdata(reward))
        if estimate is not None: event.update(schema='adaptive-indexed-cut-event-3',time_estimate=estimate)
        if self._tool_change is not None:
            event.update(schema='adaptive-indexed-cut-event-4',tool_exchange=dict(previous_tool_id=self._predecessor.tool_id,
                         requested_tool_id=tool_id,station_id=self._tool_change.id,performed=changing and status=='ACCEPTED'))
        event_id = identity(event)
        if status == 'ACCEPTED':
            self._service = proposed; self._material = proposed.state
            self._predecessor = part_action; self._initial_pose = self._pose; self._parked = False
            self._revision += 1; self._parent = event_id; self._elapsed += cost
        result = dict(event=event, event_id=event_id, status=status, reason=reason,
                      before_head=before, after_head=self.head, duplicate_delivery=False,
                      charged_seconds=qdata(cost), removal_reward=qdata(reward), material_hash=self._material.logical_hash)
        raw = canonical(result)
        self._records += (canonical(dict(request=request, result=result)),)
        self._receipts[event_key] = (request_id, raw)
        return json.loads(raw)

    def export(self):
        result = super().export(); result['schema'] = 'adaptive-indexed-cut-journal-1'
        if self._motion_profile == 'indexed_milling_2': result['schema'] = 'adaptive-indexed-cut-journal-2'
        if self._cost_model is not None: result['schema'] = 'adaptive-indexed-cut-journal-3'
        if self._tool_change is not None: result['schema'] = 'adaptive-indexed-cut-journal-4'
        if self._starts_parked: result['schema'] = 'adaptive-indexed-cut-journal-5'
        if self._explicit_primitives: result['schema'] = 'adaptive-indexed-cut-journal-6'
        if self._drill_tools: result['schema'] = 'adaptive-indexed-cut-journal-7'
        if self._face_tools: result['schema'] = 'adaptive-indexed-cut-journal-8'
        return result

    @classmethod
    def replay(cls, service, data, *, expected_export_id):
        if identity(data) != expected_export_id: raise ValueError('Composite export identity mismatch')
        fields(data, ('schema', 'genesis', 'records', 'final_state', 'final_head'))
        if data['schema'] not in tuple('adaptive-indexed-cut-journal-'+str(i) for i in range(1,9)): raise ValueError('Unsupported composite journal')
        face = data['schema']=='adaptive-indexed-cut-journal-8'
        drill = data['schema']=='adaptive-indexed-cut-journal-7' or face
        explicit = data['schema']=='adaptive-indexed-cut-journal-6' or drill
        parked = data['schema']=='adaptive-indexed-cut-journal-5'
        exchange = data['schema']=='adaptive-indexed-cut-journal-4' or parked or explicit
        costed = data['schema'] in ('adaptive-indexed-cut-journal-3','adaptive-indexed-cut-journal-4','adaptive-indexed-cut-journal-5') or explicit
        extended = data['schema'] != 'adaptive-indexed-cut-journal-1'
        g = data['genesis']
        fields(g, ('schema', 'material_hash', 'machine', 'initial_pose', 'predecessor', 'rotating_fixture',
                   'stationary_geometry', 'index_seconds', 'retract_seconds', 'cut_seconds')+(('motion_profile',) if extended else ())+(('cost_model',) if costed else ())+(('tool_change',) if exchange else ()))
        expected_schema = 'adaptive-indexed-cut-genesis-5' if parked else 'adaptive-indexed-cut-genesis-4' if exchange else 'adaptive-indexed-cut-genesis-3' if costed else 'adaptive-indexed-cut-genesis-2' if extended else 'adaptive-indexed-cut-genesis-1'
        if explicit: expected_schema = 'adaptive-indexed-cut-genesis-6'
        if drill: expected_schema = 'adaptive-indexed-cut-genesis-7'
        if face: expected_schema = 'adaptive-indexed-cut-genesis-8'
        if g['schema'] != expected_schema or service.state.logical_hash != g['material_hash']:
            raise ValueError('Original material writer context mismatch')
        if not isinstance(data['records'], list) or len(data['records']) > 256: raise ValueError('Composite replay budget')
        journal = cls(service, IndexedMachine.from_data(g['machine']), g['initial_pose'], context_from_data(g['predecessor']),
                      from_data(g['rotating_fixture']), from_data(g['stationary_geometry']),
                      index_seconds=qread(g['index_seconds']), retract_seconds=qread(g['retract_seconds']), cut_seconds=qread(g['cut_seconds']),
                      motion_profile=g['motion_profile'] if extended else 'quarter_turn_plunge_1',
                      cost_model=IndexedCostModel.from_data(g['cost_model']) if costed else None,
                      tool_change=ToolChangeStation.from_data(g['tool_change']) if exchange and g['tool_change'] is not None else None,
                      explicit_primitives=explicit, drill_tools=drill, face_tools=face)
        for record in data['records']:
            fields(record, ('request', 'result')); request = record['request']
            if 'face_operation' in request:
                from .face_operation import FaceOperation
                from .ordered_motion import MotionBudget
                fields(request, ('face_operation','tool_id','event_key','expected_head','evaluation_id','approach_tips','budget'))
                fields(request['budget'], ('spatial_depth','maximum_queries','time_depth','maximum_intervals'))
                tips=tuple(tuple(qread(v) for v in t) for t in request['approach_tips'])
                result=journal.face(FaceOperation.from_data(request['face_operation']),request['tool_id'],
                    event_key=request['event_key'],expected_head=request['expected_head'],evaluation_id=request['evaluation_id'],
                    approach_tips=tips,budget=MotionBudget(**request['budget']))
            elif 'drill_operation' in request:
                from .drill_operation import DrillOperation
                fields(request, ('drill_operation','tool_id','event_key','expected_head','evaluation_id','approach_tips'))
                tips=tuple(tuple(qread(v) for v in t) for t in request['approach_tips'])
                result=journal.drill(DrillOperation.from_data(request['drill_operation']),request['tool_id'],
                    event_key=request['event_key'],expected_head=request['expected_head'],evaluation_id=request['evaluation_id'],approach_tips=tips)
            elif 'primitive' in request:
                fields(request, ('primitive', 'tool_id', 'event_key', 'expected_head'))
                if not explicit or request['primitive'] != 'TOOL_CHANGE': raise ValueError('Unsupported journal primitive')
                result = journal.change_tool(request['tool_id'], event_key=request['event_key'], expected_head=request['expected_head'])
            elif 'target' in request:
                fields(request, ('target', 'event_key', 'expected_head'))
                result = journal.index(request['target'], event_key=request['event_key'], expected_head=request['expected_head'])
            else:
                fields(request, ('world_motion', 'tool_id', 'event_key', 'expected_head')+(('approach_tips',) if extended else ()))
                motion_type = SideMill if extended and request['world_motion'].get('schema') == 'adaptive-side-mill-1' else AxialPlunge
                tips = tuple(tuple(qread(v) for v in tip) for tip in request['approach_tips']) if extended else ()
                result = journal.cut(motion_type.from_data(request['world_motion']), request['tool_id'],
                                     event_key=request['event_key'], expected_head=request['expected_head'], approach_tips=tips)
            if canonical(result) != canonical(record['result']): raise ValueError('Composite replay result mismatch')
        if canonical(journal.export()) != canonical(data): raise ValueError('Composite replay final mismatch')
        return journal
