"""Closed canonical snapshot codec; derived metadata cannot rewrite material."""
import json

from .admission import admit
from .domain import CellAddress, Relation, Root, canonical, fields, qread
from .geometry import from_data
from .partition import DomainSnapshot, GeometryPolicy, Leaf, ResourceBudget, SourceDomain, verify_partition


def parse_canonical(raw, *, maximum_bytes=64*1024*1024):
    if type(raw) is not bytes or len(raw) > maximum_bytes:
        raise ValueError("Invalid or oversized artifact")
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=pairs)
    except (TypeError, UnicodeError, RecursionError, json.JSONDecodeError) as error:
        raise ValueError("Invalid canonical artifact") from error
    if canonical(value) != raw:
        raise ValueError("Artifact is not canonical")
    return value


def decode_source(data):
    constructed = isinstance(data, dict) and data.get("schema") == "adaptive-source-domain-2"
    fields(data, ("schema", "stock", "target", "protected", "root", "policy", *(("target_construction",) if constructed else ())))
    if data["schema"] not in ("adaptive-source-domain-1", "adaptive-source-domain-2"):
        raise ValueError("Unsupported source schema")
    r, p = data["root"], data["policy"]
    fields(r, ("schema", "units", "origin", "side", "frame"))
    if r["schema"] != "adaptive-root-1" or r["units"] != "mm":
        raise ValueError("Unsupported root contract")
    root = Root(tuple(qread(v) for v in r["origin"]), qread(r["side"]), r["frame"])
    uniform=isinstance(p,dict) and p.get('schema')=='adaptive-policy-2'
    fields(p, ("schema", "version", "allowance_description", "cell_boundary", "units", *(("uniform_allowance_mm","allowance_construction") if uniform else ())))
    policy = GeometryPolicy(p["version"], p["allowance_description"],qread(p['uniform_allowance_mm']) if uniform else None,
                            p['allowance_construction'] if uniform else 'euclidean_box_sphere_union_1')
    if policy.to_data() != p:
        raise ValueError("Unsupported policy fields")
    return SourceDomain(from_data(data["stock"]), from_data(data["target"]),
                        from_data(data["protected"]), root, policy,
                        canonical(data["target_construction"]) if constructed else None)


def encode_snapshot(snapshot):
    verify_partition(snapshot)
    return canonical({"schema": "adaptive-snapshot-envelope-1", "logical_hash": snapshot.logical_hash,
                      "logical": snapshot.logical_data(), "build": {"budget": snapshot.budget.to_data(),
                      "stop_reason": snapshot.stop_reason, "query_count": snapshot.query_count}})


def decode_snapshot(raw):
    data = parse_canonical(raw)
    fields(data, ("schema", "logical_hash", "logical", "build"))
    if data["schema"] != "adaptive-snapshot-envelope-1":
        raise ValueError("Unsupported snapshot envelope")
    logical = data["logical"]
    fields(logical, ("schema", "source", "admission", "leaves"))
    if logical["schema"] != "adaptive-domain-snapshot-1":
        raise ValueError("Unsupported domain snapshot")
    source = decode_source(logical["source"])
    admission = admit(source.stock, source.target)
    if admission.to_data() != logical["admission"]:
        raise ValueError("Admission certificate mismatch")
    leaves = []
    for c in logical["leaves"]:
        fields(c, ("address", "stock", "target", "protected", "delta_lower", "delta_upper", "eligible_lower", "eligible_upper"))
        a = c["address"]
        fields(a, ("domain_geometry_id", "root_frame_id", "depth", "morton_prefix"))
        address = CellAddress(**a)
        flags = [c[k] for k in ("delta_lower", "delta_upper", "eligible_lower", "eligible_upper")]
        if not all(type(v) is bool for v in flags):
            raise ValueError("Invalid membership flag")
        leaves.append(Leaf(address, Relation(c["stock"]), Relation(c["target"]), Relation(c["protected"]), *flags))
    build = data["build"]
    fields(build, ("budget", "stop_reason", "query_count"))
    fields(build["budget"], ("max_depth", "max_leaves", "max_seconds"))
    budget = ResourceBudget(**build["budget"])
    if build["stop_reason"] not in ("resolved", "depth_budget", "leaf_budget", "time_budget", "cancelled"):
        raise ValueError("Unknown build outcome")
    if type(build["query_count"]) is not int or build["query_count"] < 1:
        raise ValueError("Invalid query count")
    if len(leaves) > budget.max_leaves or any(c.address.depth > budget.max_depth for c in leaves):
        raise ValueError("Snapshot exceeds declared budget")
    result = DomainSnapshot(source, admission, tuple(leaves), budget, build["stop_reason"], build["query_count"])
    if result.logical_hash != data["logical_hash"]:
        raise ValueError("Logical hash mismatch")
    verify_partition(result)
    return result
