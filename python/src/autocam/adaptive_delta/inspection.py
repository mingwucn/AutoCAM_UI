"""Read-only projections from one canonical accepted state; no display geometry authority."""
from fractions import Fraction

from .domain import canonical, identity
from .evidence import cell_certificate
from .partition import VolumeInterval


def project_frame(state, *, label, outcome=None):
    from .packed_domain import PackedDomainSnapshot
    if type(state.domain) is PackedDomainSnapshot:
        # Display-only transient reference; accepted packed state is never replaced.
        from dataclasses import replace
        from .codec import decode_snapshot
        from .transitions import MaterialState
        from .wasm_material import PackedWasmMaterialState
        if type(state) not in (MaterialState,PackedWasmMaterialState):raise ValueError('Typed packed display state required')
        if state.domain.count>20000:raise ValueError('Packed display cell budget exceeded')
        raw=b''.join(state.domain.canonical_snapshot_chunks())
        if len(raw)>64*1024**2:raise ValueError('Packed display byte budget exceeded')
        state=MaterialState(decode_snapshot(raw),state.envelopes,state.revision,state.parent_event,state.tool_catalog,state.turning_axis)
    coverage = state.coverage()
    lo, hi = Fraction(), Fraction()
    for leaf, flags in zip(state.domain.leaves, coverage):
        volume = state.domain.source.root.side**3 / (1 << (3*leaf.address.depth))
        if flags[0]: lo += volume
        if flags[1]: hi += volume
    return {"label": label, "state_hash": state.logical_hash, "domain_hash": state.domain.logical_hash,
            "material": state.to_data(), "domain": state.domain.logical_data(),
            "coverage": [list(flags) for flags in coverage], "outcome": outcome,
            "volumes": {"initial_delta": state.domain.volume().to_data(),
                        "remaining_delta": state.remaining().to_data(),
                        "remaining_eligible": state.remaining(eligible=True).to_data(),
                        "remaining_stock": state.stock_remaining().to_data(),
                        "removed": VolumeInterval(lo, hi).to_data()},
            "stop_reason": state.domain.stop_reason}


def inspection_bundle(source, frames, *, replay, provenance, face_state=False):
    if type(face_state) is not bool:
        raise ValueError('Explicit boolean face projection selection required')
    if not frames:
        raise ValueError("Inspection requires at least one frame")
    catalogs = [frame["material"].get("tool_catalog") for frame in frames]
    if any(c != catalogs[0] for c in catalogs):
        raise ValueError("Inspection frames change frozen tool catalog")
    catalog = catalogs[0]
    has_face = catalog is not None and catalog['schema'] == 'adaptive-tool-catalog-4'
    if has_face and not face_state:
        raise ValueError('Face catalog inspection requires a versioned face-aware projection')
    if face_state and not has_face:
        raise ValueError('Face projection requires its face catalog')
    drill_state = catalog is not None and catalog['schema'] == 'adaptive-tool-catalog-3'
    axes = [frame['material'].get('turning_axis') for frame in frames]
    if any(axis != axes[0] for axis in axes):
        raise ValueError('Inspection frames change frozen spindle axis')
    turning_axis = axes[0]
    if drill_state and (turning_axis is None or any(frame.get('outcome') is not None for frame in frames)):
        raise ValueError('Drill state inspection requires a spindle axis and no action outcome')
    if face_state and (turning_axis is None or any(frame.get('outcome') is not None for frame in frames)):
        raise ValueError('Face state inspection requires a spindle axis and no action outcome')
    if catalog is not None:
        from .tool_catalog import ToolCatalog
        ToolCatalog.from_data(catalog)
    if turning_axis is not None:
        from .turning_tools import TurningAxis
        TurningAxis.from_data(turning_axis)
        if catalog is None: raise ValueError('Turning inspection requires its frozen tool catalog')
    if catalog is not None and catalog['schema'] == 'adaptive-tool-catalog-2' and turning_axis is None:
        raise ValueError('Turning catalog inspection requires a spindle axis')
    schema = 'adaptive-material-state-3' if turning_axis is not None else "adaptive-material-state-2" if catalog else "adaptive-material-state-1"
    if any(frame["material"]["schema"] != schema for frame in frames):
        raise ValueError("Inspection material schema differs from episode catalog")
    certificates = {}
    for frame in frames:
        if frame["domain"]["source"] != source.to_data():
            raise ValueError("Frame belongs to another source")
        refs = []
        for leaf in frame["domain"]["leaves"]:
            from .domain import CellAddress
            address = CellAddress(**leaf["address"])
            key = identity(address.to_data())
            if key not in certificates:
                certificate = cell_certificate(source, address)
                certificates[key] = {"sha256": identity(certificate), "certificate": certificate}
            refs.append(key)
        frame["certificate_refs"] = refs
    payload = {"schema": "adaptive-inspection-payload-1", "source": source.to_data(),
               "source_geometry_id": source.geometry_id, "frames": frames,
               "certificates": certificates, "replay": replay, "provenance": provenance,
               "scope": "DIRECTIONAL_SHADOW_PLANNING", "evidence_grade": "bounded",
               "limitations": ["Analytic geometric surrogate; no cutter or machine-motion qualification.",
                               "Possible material is not free space. Display meshes do not define volume.",
                               "Browser checks identities; geometric replay is performed by the pinned producer/verifier.",
                               "This bundle is a read-only record, not a browser inference runtime."]}
    if catalog is not None:
        payload.update(schema="adaptive-inspection-payload-2", scope="FINITE_TOOL_SHADOW_PLANNING", tool_catalog=catalog)
        payload["limitations"][0] = "Restricted tool-sweep geometric surrogate; see recorded action profiles. No manufacturing qualification."
        actions = [frame['outcome']['action'] for frame in frames
                   if frame.get('outcome') and frame['outcome'].get('action')]
        cleared_holder = any(action.get('schema')=='adaptive-action-7' for action in actions)
        if turning_axis is not None:
            profiles = sorted({action['access_model'] for action in actions if action['scope'] == 'FINITE_TOOL_SHADOW_PLANNING'})
            if not set(profiles) <= {'exact-monotone-plunge-1', 'exact-monotone-side-mill-1', 'exact-monotone-side-remaining-1', 'exact-monotone-side-cleared-holder-1', 'full_angle_meridional_shadow_1'}:
                raise ValueError('Unsupported mixed inspection motion profile')
            from .storage import action_from_data
            for encoded in actions:
                action = action_from_data(encoded)
                accepted = any(frame.get('outcome') and frame['outcome'].get('action') == encoded
                               and frame['outcome'].get('result', {}).get('status') == 'ACCEPTED' for frame in frames)
                if accepted and action.validate_setup_binding(TurningAxis.from_data(turning_axis)).status != 'PASS':
                    raise ValueError('Inspection action changes frozen spindle axis')
            payload.update(schema='adaptive-inspection-payload-9' if cleared_holder else 'adaptive-inspection-payload-7' if any(action['schema']=='adaptive-action-6' for action in actions) else 'adaptive-inspection-payload-4', motion_profiles=profiles, turning_axis=turning_axis)
            payload['limitations'].insert(0, 'Turning uses a full-angle meridional shadow with conservative whole-tool safety envelopes; finite-pitch synchronized motion is not assessed.')
        elif any(action['schema'] == 'adaptive-action-4' for action in actions):
            raise ValueError('Turning action inspection requires a frozen spindle axis')
        elif any(action['schema'] in ('adaptive-action-3','adaptive-action-6','adaptive-action-7') for action in actions):
            profiles = sorted({action['access_model'] for action in actions if action['scope'] == 'FINITE_TOOL_SHADOW_PLANNING'})
            if not set(profiles) <= {'exact-monotone-plunge-1', 'exact-monotone-side-mill-1','exact-monotone-side-remaining-1','exact-monotone-side-cleared-holder-1'}:
                raise ValueError('Unsupported tool inspection motion profile')
            payload.update(schema='adaptive-inspection-payload-8' if cleared_holder else 'adaptive-inspection-payload-6' if any(action['schema']=='adaptive-action-6' for action in actions) else 'adaptive-inspection-payload-3', motion_profiles=profiles)
    if drill_state:
        payload.update(schema='adaptive-inspection-payload-10', motion_profiles=[])
        payload['limitations'] = [
            'Accepted material state only; action feasibility and execution are owned by the prepared-session backend.',
            'Bounded analytic source and drill profiles; no general STEP or manufacturing qualification.',
            'Possible material is not free space. Display meshes do not define volume.',
            'Browser checks identities and recorded volume consistency; it does not recompute machining decisions.']
    if face_state:
        payload.update(schema='adaptive-inspection-payload-11', motion_profiles=[])
        payload['limitations'] = [
            'Accepted material state only; face feasibility and execution are owned by the prepared-session backend.',
            'Finite annular face profile with separate non-cutting components; no general STEP face recognition or manufacturing qualification.',
            'Possible material is not free space. Tessellated display meshes cannot represent zero-thickness retained membranes and do not define volume.',
            'Browser checks identities and recorded volume consistency; it does not recompute machining decisions.']
    if source.target_construction is not None:
        import json
        construction = json.loads(source.target_construction)
        if construction['schema'] == 'adaptive-periodic-construction-1':
            payload["limitations"].insert(0, "Target follows a declared periodic nominal CAD model with bounded source seam discrepancy; literal parameterized-trim equality, STEP/import equivalence and manufactured-surface tolerances are not proved.")
        else:
            payload["limitations"].insert(0, "Target is a proved nominal imported solid; STEP/import equivalence and manufactured-surface tolerances are not proved.")
    return canonical({"schema": "adaptive-inspection-bundle-1", "payload_sha256": identity(payload), "payload": payload})
