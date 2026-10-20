"""Non-mutating numerical CAD audit adapter; never a strict analytic Region."""
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import subprocess


def file_digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


@dataclass(frozen=True, slots=True)
class CadAuditPolicy:
    tolerance_ceiling_mm: str = "0.000001"
    timeout_seconds: int = 90
    maximum_bytes: int = 100*1024*1024

    def __post_init__(self):
        from .domain import rational, integer
        if rational(self.tolerance_ceiling_mm) <= 0:
            raise ValueError("Positive source tolerance budget required")
        integer(self.timeout_seconds, "CAD timeout", 1, 600)
        integer(self.maximum_bytes, "CAD byte budget", 1, 100*1024*1024)


def audit_cad(source, output, *, executable, expected_sha256, policy=CadAuditPolicy(), construction_profile=None):
    """Each output directory is a new execution with a frozen input copy."""
    if construction_profile is not None and construction_profile != "spherical_nominal":
        raise ValueError("Unsupported optional construction profile")
    source, output, executable = Path(source).resolve(), Path(output).resolve(), Path(executable).resolve()
    if source.stat().st_size > policy.maximum_bytes:
        raise ValueError("CAD input byte budget exceeded")
    raw = source.read_bytes()
    if not raw or sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("CAD source bytes differ from explicit input pin")
    kind = "step" if source.suffix.lower() in (".step", ".stp") else "brep" if source.suffix.lower()==".brep" else None
    if kind is None:
        raise ValueError("Unsupported CAD file format")
    output.mkdir(parents=True, exist_ok=False)
    frozen = output/("source"+source.suffix.lower())
    frozen.write_bytes(raw)
    snapshot = output/"imported.brep"
    command = [str(executable), kind, str(frozen), policy.tolerance_ceiling_mm, str(snapshot)]
    if construction_profile is not None:
        command.append(construction_profile)
    record = {"schema": "adaptive-cad-execution-1", "source_sha256": expected_sha256,
              "source_path": str(source), "executable_sha256": file_digest(executable),
              "command": command, "timeout_seconds": policy.timeout_seconds,
              "tolerance_ceiling_mm": policy.tolerance_ceiling_mm, "strict_admission": False}
    try:
        result = subprocess.run(command, capture_output=True, timeout=policy.timeout_seconds)
        (output/"stdout.txt").write_bytes(result.stdout)
        (output/"stderr.txt").write_bytes(result.stderr)
        record["returncode"] = result.returncode
        if result.returncode:
            record.update(status="QUARANTINED", reason="cad_reader_or_audit_failure")
        else:
            lines = result.stdout.decode("utf-8").splitlines()
            observation = json.loads(next(line for line in reversed(lines) if line.startswith('{"schema":"adaptive-cad-audit-1"')))
            if observation["kernel"] != "7.8.1" or observation["strict_admission"] is not False:
                raise ValueError("Unexpected CAD adapter contract")
            record.update(status=observation["status"], observation=observation)
            record["imported_snapshot_sha256"] = file_digest(snapshot)
            for face in observation["faces"]:
                binding = {"source_sha256": expected_sha256, "snapshot_sha256": record["imported_snapshot_sha256"],
                           "importer_sha256": record["executable_sha256"], "face": face.copy()}
                face["source_face_id"] = sha256(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    except subprocess.TimeoutExpired as error:
        (output/"stdout.txt").write_bytes(error.stdout or b"")
        (output/"stderr.txt").write_bytes(error.stderr or b"")
        record.update(status="QUARANTINED", reason="cad_audit_timeout")
    except (ValueError, KeyError, StopIteration) as error:
        record.update(status="QUARANTINED", reason="invalid_adapter_output", detail=str(error))
    record["raw_source_unchanged"] = file_digest(source)==expected_sha256 and file_digest(frozen)==expected_sha256
    if not record["raw_source_unchanged"]:
        record.update(status="QUARANTINED", reason="source_bytes_changed")
    record["limitations"] = ["Numerical source audit only; no complete trimmed-patch enclosure",
                             "SameParameter flags do not prove curve/pcurve consistency",
                             "STEP translation creates a pinned imported source; no source-to-import tolerance equality claim",
                             "No strict CAD-to-analytic conversion or material-removal admission"]
    (output/"result.json").write_text(json.dumps(record, indent=2, sort_keys=True)+"\n", encoding="utf-8")
    return record
