"""Local immutable episode blocks with a single atomic accepted-head pointer."""
from contextlib import contextmanager
from fractions import Fraction
from hashlib import sha256
import os
from pathlib import Path
from uuid import uuid4

from .codec import decode_snapshot, encode_snapshot, parse_canonical
from .domain import canonical, digest, fields, identity, qdata, qread
from .geometry import from_data
from .partition import VolumeInterval
from .transitions import Action, MaterialState, Proposal, SafetyResult, TransitionResult, TransitionService, action_safety


def action_from_data(data):
    common = ("schema", "envelope", "scope", "axis", "sign", "access_model", "finite_tool_access", "continuous_motion")
    if isinstance(data, dict) and data.get("schema") in ("adaptive-action-2", "adaptive-action-3", "adaptive-action-4", "adaptive-action-5", "adaptive-action-6", "adaptive-action-7", "adaptive-action-8", "adaptive-action-9"):
        from .tool_catalog import AxialPlunge
        from .side_milling import SideMill
        from .turning import TurningMotion
        from .indexed_tool_action import IndexedMillMotion
        from .drill_action import RequiredDrillMotion
        from .face_action import RequiredFaceMotion
        fields(data, common+("catalog_id", "tool_id", "motion")+(("clearance_profile",) if data["schema"] in ("adaptive-action-6","adaptive-action-7") else ()))
        motion_type = {'adaptive-action-2': AxialPlunge, 'adaptive-action-3': SideMill,
                       'adaptive-action-4': TurningMotion, 'adaptive-action-5': IndexedMillMotion, 'adaptive-action-6': SideMill, 'adaptive-action-7': SideMill,
                       'adaptive-action-8': RequiredDrillMotion, 'adaptive-action-9': RequiredFaceMotion}[data['schema']]
        action = Action(from_data(data["envelope"]), data["scope"], data["axis"], data["sign"],
                        data["catalog_id"], data["tool_id"], motion_type.from_data(data["motion"]),data.get("clearance_profile","original_stock_v1"))
    else:
        fields(data, common)
        action = Action(from_data(data["envelope"]), data["scope"], data["axis"], data["sign"])
    if action.to_data() != data:
        raise ValueError("Unsupported action contract")
    return action


def interval_from_data(data):
    fields(data, ("lower_mm3", "upper_mm3"))
    return VolumeInterval(qread(data["lower_mm3"]), qread(data["upper_mm3"]))


class LocalEpisodeStore:
    """Process-crash recovery; power-loss durability is not qualified on Windows."""
    def __init__(self, directory, *, fault=None):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory/"blocks").mkdir(exist_ok=True)
        self.fault = fault

    @contextmanager
    def _lock(self):
        with (self.directory/"writer.lock").open("a+b") as stream:
            stream.seek(0, 2)
            if stream.tell() == 0:
                stream.write(b"0"); stream.flush()
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def _hook(self, stage):
        if self.fault is not None:
            self.fault(stage)

    def _atomic(self, path, raw):
        # A UUID already provides uniqueness. Repeating the final hash here can
        # exceed Windows' path limit even when the final block path fits.
        temporary = path.with_name(uuid4().hex+".staging")
        with temporary.open("xb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def _put(self, raw):
        ref = sha256(raw).hexdigest()
        path = self.directory/"blocks"/(ref+".json")
        if path.exists():
            if path.read_bytes() != raw:
                raise ValueError("Existing immutable block is corrupt")
        else:
            self._atomic(path, raw)
        return ref

    def _read(self, ref):
        digest(ref)
        raw = (self.directory/"blocks"/(ref+".json")).read_bytes()
        if sha256(raw).hexdigest() != ref:
            raise ValueError("Content block checksum mismatch")
        return raw

    def _pointer(self, name):
        return parse_canonical((self.directory/name).read_bytes())

    def _put_domain(self,domain):return self._put(encode_snapshot(domain))

    def _read_domain(self,ref):return decode_snapshot(self._read(ref))

    def _new_service(self,domain,**kwargs):return TransitionService(domain,**kwargs)

    @staticmethod
    def _state_record(state, domain_artifact):
        return {"schema": "adaptive-stored-state-3" if state.turning_axis is not None else "adaptive-stored-state-2" if state.tool_catalog else "adaptive-stored-state-1", "state": state.to_data(),
                "domain_artifact": domain_artifact, "state_hash": state.logical_hash}

    def initialize(self, domain, *, tool_catalog=None, turning_axis=None):
        state = MaterialState(domain, tool_catalog=tool_catalog, turning_axis=turning_axis)
        with self._lock():
            if (self.directory/"GENESIS.json").exists():
                genesis = self._pointer("GENESIS.json")
                if genesis["state_hash"] != state.logical_hash:
                    raise ValueError("Cannot replace a different episode genesis")
                if not (self.directory/"HEAD.json").exists():
                    raise ValueError("Missing accepted head; refusing to reset an existing episode")
            else:
                domain_ref = self._put_domain(domain)
                state_ref = self._put(canonical(self._state_record(state, domain_ref)))
                receipts_ref = self._put(canonical({"schema": "adaptive-receipts-1", "receipts": {}}))
                head = {"schema": "adaptive-head-1", "state_artifact": state_ref,
                        "state_hash": state.logical_hash, "event_id": None, "receipts_artifact": receipts_ref}
                genesis = {"schema": "adaptive-genesis-1", "state_hash": state.logical_hash, "head": head,
                           "domain_artifact": domain_ref, "normalizer_mm3": qdata(domain.volume("eligible").upper),
                           "durability_profile": "single_writer_atomic_head_process_crash_v1"}
                if tool_catalog is not None:
                    genesis.update(schema="adaptive-genesis-2", tool_catalog=tool_catalog.to_data())
                if turning_axis is not None:
                    genesis.update(schema='adaptive-genesis-3', turning_axis=turning_axis.to_data())
                self._atomic(self.directory/"GENESIS.json", canonical(genesis))
                self._atomic(self.directory/"HEAD.json", canonical(head))
        return self.resume()

    def _load(self):
        genesis = self._pointer("GENESIS.json")
        common = ("schema", "state_hash", "head", "domain_artifact", "normalizer_mm3", "durability_profile")
        catalog, axis = None, None
        if genesis.get("schema") in ("adaptive-genesis-2", "adaptive-genesis-3"):
            from .tool_catalog import ToolCatalog
            from .turning_tools import TurningAxis
            fields(genesis, common+("tool_catalog",)+(('turning_axis',) if genesis['schema'] == 'adaptive-genesis-3' else ()))
            catalog = ToolCatalog.from_data(genesis["tool_catalog"])
            if genesis['schema'] == 'adaptive-genesis-3': axis = TurningAxis.from_data(genesis['turning_axis'])
        else:
            fields(genesis, common)
        if genesis["schema"] not in ("adaptive-genesis-1", "adaptive-genesis-2", "adaptive-genesis-3") or genesis["durability_profile"] != "single_writer_atomic_head_process_crash_v1":
            raise ValueError("Unsupported genesis")
        initial = self._read_domain(genesis["domain_artifact"])
        normalizer = qread(genesis["normalizer_mm3"])
        if normalizer != initial.volume("eligible").upper or genesis["state_hash"] != MaterialState(initial, tool_catalog=catalog, turning_axis=axis).logical_hash:
            raise ValueError("Invalid genesis binding")
        head = self._pointer("HEAD.json")
        fields(head, ("schema", "state_artifact", "state_hash", "event_id", "receipts_artifact"))
        if head["schema"] != "adaptive-head-1":
            raise ValueError("Unsupported head")
        events = []
        event_id = head["event_id"]
        seen = set()
        while event_id is not None:
            if event_id in seen or len(seen) >= 100000:
                raise ValueError("Invalid or excessive history")
            seen.add(event_id)
            event = parse_canonical(self._read(event_id))
            if event.get("schema") != ("adaptive-event-3" if axis is not None else "adaptive-event-2" if catalog else "adaptive-event-1"):
                raise ValueError("Unsupported event schema")
            common = ("schema", "kind", "before_hash", "parent_event", "domain_hash", "domain_artifact", "reward")
            if event.get("kind") == "action":
                fields(event, common+("event_key", "request_id", "action", "removed", "safety"))
            elif event.get("kind") == "refinement":
                fields(event, common+("envelope", "max_depth"))
            else:
                raise ValueError("Unsupported event kind")
            events.append((event_id, event))
            event_id = event["parent_event"]
        state = MaterialState(initial, tool_catalog=catalog, turning_axis=axis)
        receipts = {}
        for event_id, event in reversed(events):
            if event["before_hash"] != state.logical_hash:
                raise ValueError("Broken accepted-state chain")
            domain = self._read_domain(event["domain_artifact"])
            if domain.source.to_data() != initial.source.to_data() or domain.logical_hash != event["domain_hash"]:
                raise ValueError("History changes frozen sources or domain identity")
            envelopes = state.envelopes
            if event["kind"] == "action":
                action = action_from_data(event["action"])
                if action.validate_tool_binding(catalog).status != "PASS":
                    raise ValueError("Accepted action violates frozen tool catalog or construction")
                if action.validate_setup_binding(axis).status != 'PASS':
                    raise ValueError('Accepted action violates frozen spindle axis')
                if action.envelope.to_data() not in [e.to_data() for e in envelopes]:
                    envelopes += (action.envelope,)
                repeated = envelopes == state.envelopes
            after = MaterialState(domain, envelopes, state.revision+1, event_id, catalog, axis)
            if event["kind"] == "action":
                key = event["event_key"]
                if type(key) is not str or not key or key in receipts:
                    raise ValueError("Invalid or duplicated accepted event key")
                expected_request = identity({"action": action.to_data(), "before_hash": state.logical_hash,
                                             "expected_pre_hash": state.logical_hash, "candidate_domain_hash": domain.logical_hash})
                if event["request_id"] != expected_request:
                    raise ValueError("Request identity mismatch")
                result = TransitionResult(event_id, "ACCEPTED", "idempotent_geometry" if repeated else "bounded_removal",
                                          state.logical_hash, after.logical_hash, interval_from_data(event["removed"]), qread(event["reward"]))
                receipts[key] = (event["request_id"], result)
            elif qread(event["reward"]) != 0:
                raise ValueError("Refinement cannot earn reward")
            state = after
        if state.logical_hash != head["state_hash"]:
            raise ValueError("Head does not name the accepted chain")
        stored = parse_canonical(self._read(head["state_artifact"]))
        if stored != self._state_record(state, events[0][1]["domain_artifact"] if events else genesis["domain_artifact"]):
            raise ValueError("Stored state differs from event projection")
        actual_receipts = parse_canonical(self._read(head["receipts_artifact"]))
        expected_receipts = {"schema": "adaptive-receipts-1", "receipts": {
            key: {"request_id": req, "result": result.to_data()} for key, (req, result) in receipts.items()}}
        if actual_receipts != expected_receipts:
            raise ValueError("Receipt index differs from accepted events")
        return state, receipts, normalizer, list(reversed(events)), initial

    def resume(self):
        state, receipts, normalizer, _, initial = self._load()
        service = self._new_service(initial, sink=self, tool_catalog=state.tool_catalog, turning_axis=state.turning_axis)
        restored=service._make_state(state.domain,state.envelopes,state.revision,state.parent_event,state.tool_catalog,state.turning_axis)
        if restored.logical_hash!=state.logical_hash:raise ValueError('State factory changed stored identity')
        service.state, service.receipts, service.normalizer = restored, receipts, normalizer
        service.attempt_receipts = self._load_rejections()[0]
        return service

    def synchronize(self, service):
        state, receipts, normalizer, _, _ = self._load()
        if state.domain.source.to_data() != service.state.domain.source.to_data():
            raise ValueError("Store belongs to a different source")
        if state.tool_catalog != service.state.tool_catalog:
            raise ValueError("Store belongs to a different tool catalog")
        if state.turning_axis != service.state.turning_axis:
            raise ValueError('Store belongs to a different spindle axis')
        restored=service._make_state(state.domain,state.envelopes,state.revision,state.parent_event,
                                     state.tool_catalog,state.turning_axis)
        if restored.logical_hash!=state.logical_hash:raise ValueError('State factory changed stored identity')
        attempts=self._load_rejections()[0]
        service.state,service.receipts,service.normalizer,service.attempt_receipts=restored,receipts,normalizer,attempts

    def _load_rejections(self):
        pointer = self.directory/"REJECTIONS.json"
        if not pointer.exists():
            return {}, []
        header = self._pointer("REJECTIONS.json")
        fields(header, ("schema", "last"))
        if header["schema"] != "adaptive-rejections-head-1":
            raise ValueError("Unsupported rejection journal")
        current = header["last"]
        seen, receipts, rows = set(), {}, []
        while current is not None:
            if current in seen or len(seen) >= 100000:
                raise ValueError("Invalid rejection history")
            seen.add(current)
            row = parse_canonical(self._read(current))
            fields(row, ("schema", "previous", "event_key", "request_id", "action", "candidate_domain_hash", "result"))
            if row["schema"] != "adaptive-rejection-1":
                raise ValueError("Unsupported rejection record")
            action = action_from_data(row["action"])
            data = row["result"]
            fields(data, ("event_id", "status", "reason", "before_hash", "after_hash", "removed", "reward", "duplicate_delivery"))
            digest(data["before_hash"]); digest(row["candidate_domain_hash"])
            result = TransitionResult(None, data["status"], data["reason"], data["before_hash"], data["before_hash"],
                                      VolumeInterval(Fraction(), Fraction()), Fraction())
            if data != result.to_data() or result.status not in ("REJECTED", "UNRESOLVED"):
                raise ValueError("Rejected action changed state or reward")
            request_id = identity({"action": action.to_data(), "before_hash": result.before_hash,
                                   "expected_pre_hash": result.before_hash, "candidate_domain_hash": row["candidate_domain_hash"]})
            key = row["event_key"]
            if type(key) is not str or not key or key in receipts or request_id != row["request_id"]:
                raise ValueError("Invalid rejection request identity")
            receipts[key] = (request_id, result); rows.append(row); current = row["previous"]
        return receipts, list(reversed(rows))

    def record_rejection(self, proposal, event_key, request_id, result):
        with self._lock():
            state, accepted, _, _, _ = self._load()
            rejected, _ = self._load_rejections()
            if event_key in accepted:
                raise ValueError("Rejection key already accepted")
            if event_key in rejected:
                if rejected[event_key] != (request_id, result):
                    raise ValueError("Conflicting rejection retry")
                return
            if state.logical_hash != result.before_hash:
                raise ValueError("Rejected attempt expected head is stale")
            previous = self._pointer("REJECTIONS.json")["last"] if (self.directory/"REJECTIONS.json").exists() else None
            row = {"schema": "adaptive-rejection-1", "previous": previous, "event_key": event_key,
                   "request_id": request_id, "action": proposal.action.to_data(),
                   "candidate_domain_hash": proposal.candidate_domain.logical_hash, "result": result.to_data()}
            ref = self._put(canonical(row))
            self._hook("before_rejection_head")
            self._atomic(self.directory/"REJECTIONS.json", canonical({"schema": "adaptive-rejections-head-1", "last": ref}))
            self._hook("after_rejection_head")

    def publish(self, before, after, event, result, receipts):
        with self._lock():
            current, _, _, _, _ = self._load()
            if current.logical_hash != before.logical_hash:
                raise ValueError("Persistent head is stale")
            if after.tool_catalog != before.tool_catalog:
                raise ValueError("Publication changes frozen tool catalog")
            if after.turning_axis != before.turning_axis:
                raise ValueError('Publication changes frozen spindle axis')
            domain_ref = self._put_domain(after.domain)
            if domain_ref != event["domain_artifact"]:
                raise ValueError("Event domain artifact mismatch")
            self._hook("after_domain")
            state_ref = self._put(canonical(self._state_record(after, domain_ref)))
            self._hook("after_state")
            event_ref = self._put(canonical(event))
            if event_ref != result.event_id:
                raise ValueError("Event identity mismatch")
            self._hook("after_event")
            if event["kind"] == "action":
                receipts[event["event_key"]] = (event["request_id"], result)
            receipts_ref = self._put(canonical({"schema": "adaptive-receipts-1", "receipts": {
                key: {"request_id": req, "result": r.to_data()} for key, (req, r) in receipts.items()}}))
            self._hook("after_receipts")
            head = {"schema": "adaptive-head-1", "state_artifact": state_ref, "state_hash": after.logical_hash,
                    "event_id": event_ref, "receipts_artifact": receipts_ref}
            self._hook("before_head")
            self._atomic(self.directory/"HEAD.json", canonical(head))
            self._hook("after_head")

    def verify(self, *, geometric=False):
        final, _, _, events, initial = self._load()
        _, rejected = self._load_rejections()
        accepted_keys = {event["event_key"] for _, event in events if event["kind"] == "action"}
        known_states = {MaterialState(initial, tool_catalog=final.tool_catalog, turning_axis=final.turning_axis).logical_hash, final.logical_hash} | {event["before_hash"] for _, event in events}
        for row in rejected:
            if row["event_key"] in accepted_keys or row["result"]["before_hash"] not in known_states:
                raise ValueError("Rejected attempt is detached from accepted history")
        if geometric:
            service = self._new_service(initial, tool_catalog=final.tool_catalog, turning_axis=final.turning_axis)
            states={service.state.logical_hash:service.state}
            for event_id, event in events:
                if event["kind"] == "action":
                    action = action_from_data(event["action"])
                    candidate = self._read_domain(event["domain_artifact"])
                    proposal = Proposal(service.state.logical_hash, action, candidate, SafetyResult("UNRESOLVED", "replay_rechecks_safety"))
                    result = service.commit(proposal, event_key=event["event_key"], expected_pre_hash=service.state.logical_hash)
                else:
                    result = service.refine(from_data(event["envelope"]), max_depth=event["max_depth"])
                states[service.state.logical_hash]=service.state
                if result.event_id != event_id:
                    raise ValueError("Geometric replay differs from recorded event")
            for row in rejected:
                before=states[row['result']['before_hash']]
                action=action_from_data(row['action'])
                safety=action_safety(action,before.domain.source,before.tool_catalog,before.turning_axis,material_state=before)
                if (safety.status,safety.reason)!=(row['result']['status'],row['result']['reason']):
                    raise ValueError('Rejected action geometric replay differs')
            if service.state.logical_hash != final.logical_hash:
                raise ValueError("Geometric final-state mismatch")
        return {"status": "passed", "level": "geometric" if geometric else "structural",
                "event_count": len(events), "rejected_attempt_count": len(rejected), "logical_hash": final.logical_hash,
                "durability_profile": "single_writer_atomic_head_process_crash_v1"}
