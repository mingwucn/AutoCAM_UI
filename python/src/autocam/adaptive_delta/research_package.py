"""Portable research-candidate integrity and consumer-vector verification."""
from hashlib import sha256
import json
import math
from pathlib import Path, PurePosixPath

from .domain import canonical, digest, fields, identity


FEATURE_CONTRACT={"schema":"adaptive-linear-features-1","dimension":17,"maximum_candidates":9,
                  "candidate":["bias","new_lower_fraction","new_upper_fraction","size_x_over_32mm","size_y_over_32mm","size_z_over_32mm",
                               "direction_x","direction_y","direction_z","safety_pass","safety_unresolved","previously_applied","refinement"],
                  "global":["remaining_lower_fraction","remaining_upper_fraction","horizon_fraction","core_obligation_fraction"],
                  "observation":"partial","score":"linear_action_value","selection":"masked_argmax_first_tie","runtime_activation":False}


def score_candidate(checkpoint,features,mask):
    if checkpoint.get("schema")!="adaptive-linear-q-checkpoint-1" or checkpoint.get("features")!=17:
        raise ValueError("Incompatible research model")
    weights=checkpoint.get("weights")
    if not isinstance(weights,list) or len(weights)!=17 or any(type(v)not in (int,float) or not math.isfinite(v) for v in weights):
        raise ValueError("Invalid model weights")
    if not isinstance(features,list) or not 1<=len(features)<=9 or not isinstance(mask,list) or len(mask)!=len(features):
        raise ValueError("Invalid consumer feature dimensions")
    if any(type(v)is not int or v not in (0,1) for v in mask) or not any(mask):
        raise ValueError("Invalid consumer mask")
    scores=[]
    for row in features:
        if not isinstance(row,list) or len(row)!=17 or any(type(v)not in (int,float) or not math.isfinite(v) or not -1<=v<=1 for v in row):
            raise ValueError("Invalid normalized consumer features")
        scores.append(math.fsum(a*b for a,b in zip(row,weights)))
    return max((i for i,v in enumerate(mask) if v),key=lambda i:(scores[i],-i))


def verify_candidate(directory):
    directory=Path(directory).resolve();raw=(directory/"manifest.json").read_bytes()
    manifest=json.loads(raw)
    fields(manifest,("schema","kind","runtime_activation","manufacturing_qualified","feature_contract_id","members","blockers"))
    if canonical(manifest)!=raw or manifest["schema"]!="adaptive-research-candidate-1" or manifest["kind"]!="PackageCandidate":
        raise ValueError("Unsupported candidate manifest")
    if manifest["runtime_activation"] is not False or manifest["manufacturing_qualified"] is not False:
        raise ValueError("Research candidate cannot grant activation or manufacturing authority")
    if manifest["feature_contract_id"]!=identity(FEATURE_CONTRACT):raise ValueError("Feature contract identity mismatch")
    seen=set()
    for row in manifest["members"]:
        fields(row,("path","sha256","size","media_type","role"));digest(row["sha256"])
        path=PurePosixPath(row["path"])
        if path.is_absolute() or ".." in path.parts or "\\" in row["path"] or ":" in row["path"] or row["path"] in seen:
            raise ValueError("Invalid package member path")
        seen.add(row["path"]);resolved=(directory/row["path"]).resolve()
        if not resolved.is_relative_to(directory):raise ValueError("Escaping package reference")
        data=resolved.read_bytes()
        if len(data)!=row["size"] or sha256(data).hexdigest()!=row["sha256"]:raise ValueError("Candidate member integrity mismatch")
    if not {"checkpoint.json","feature-contract.json","consumer-vectors.json","model-card.md","evidence/selection.json","evidence/metrics.json"}<=seen:
        raise ValueError("Missing required candidate members")
    if json.loads((directory/"feature-contract.json").read_bytes())!=FEATURE_CONTRACT:raise ValueError("Incompatible feature contract")
    checkpoint=json.loads((directory/"checkpoint.json").read_bytes());selection=json.loads((directory/"evidence/selection.json").read_bytes())
    if checkpoint["epoch"]!=selection["epoch"] or selection["test_observed"] is not False:raise ValueError("Invalid checkpoint selection binding")
    vectors=json.loads((directory/"consumer-vectors.json").read_bytes())
    if not vectors:raise ValueError("Consumer vectors missing")
    for vector in vectors:
        if score_candidate(checkpoint,vector["features"],vector["mask"])!=vector["expected_action"]:
            raise ValueError("Consumer vector mismatch")
    return {"schema":"adaptive-candidate-validation-1","status":"passed","manifest_sha256":sha256(raw).hexdigest(),
            "member_count":len(seen),"consumer_vectors":len(vectors),"canonical_model_admission":False,"runtime_activation":False}
