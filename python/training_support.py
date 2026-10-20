"""Portable input custody for local trainers; no geometry or learning semantics."""
from hashlib import sha256
from importlib import metadata
import json
from pathlib import Path
import platform
import re
import shutil
import sys


def digest(raw):
    return sha256(raw).hexdigest()


def checked_input(path, expected, limit=64 * 1024**2):
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
        raise ValueError('Expected SHA-256 must contain exactly 64 hexadecimal characters')
    path = Path(path)
    if not 1 <= path.stat().st_size <= limit:
        raise ValueError(f'Input size outside 1..{limit} bytes: {path.name}')
    raw = path.read_bytes()
    if len(raw) > limit or digest(raw) != expected.lower():
        raise ValueError(f'Input SHA-256 differs: {path.name}')
    return raw


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode('utf-8')


def write_json(path, value):
    Path(path).write_bytes(json_bytes(value))


def file_pin(path, root):
    raw = path.read_bytes()
    return dict(path=path.relative_to(root).as_posix(), sha256=digest(raw), size_bytes=len(raw))


def checked_output(output, launcher):
    """Keep new run artifacts outside the executable producer and package inputs."""
    output = Path(output).resolve()
    python_root = Path(launcher).resolve().parent
    checkout = python_root.parent
    protected = [python_root] + [checkout / name for name in
        ('src', 'source', 'docs', 'examples', 'scripts', 'tests', 'config', 'core', '.git', 'node_modules')]
    for source in protected:
        source = source.resolve()
        if output.is_relative_to(source) or source.is_relative_to(output):
            raise ValueError('Training output overlaps producer source or package inputs: ' + str(output))
    return output


def prepare_run(output, inputs, launcher, recipe):
    """Reserve a fresh run and retain executable source, exact inputs and environment."""
    output = checked_output(output, launcher)
    output.mkdir(parents=True, exist_ok=False)
    python_root = Path(launcher).resolve().parent
    source_files = sorted((python_root / 'src').rglob('*.py'))
    source_files += [python_root / 'requirements.txt', Path(launcher).resolve(), Path(__file__).resolve()]
    for source in dict.fromkeys(source_files):
        target = output / 'producer' / 'python' / source.relative_to(python_root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    docs_root = python_root.parent / 'docs'
    contract_files = [docs_root / name for name in ('MODULE3_SCOPE.md', 'FUNCTIONAL_CONTRACT.md')]
    contract_files += sorted((docs_root / 'training-contracts').glob('*'))
    for source in contract_files:
        if source.is_file():
            target = output / 'producer' / 'docs' / source.relative_to(docs_root)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    for name, raw in inputs.items():
        if Path(name).name != name:
            raise ValueError('Input custody names must be single filenames')
        (output / name).write_bytes(raw)
    write_json(output / 'recipe.json', recipe)
    pins = [file_pin(p, output) for p in sorted(output.rglob('*')) if p.is_file()]
    write_json(output / 'inputs.json', dict(schema='autocam-local-training-inputs-1', files=pins))
    packages = {}
    for name in ('gymnasium', 'numpy', 'cloudpickle', 'Farama-Notifications', 'typing_extensions'):
        try:
            packages[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            packages[name] = None
    write_json(output / 'execution.json', dict(schema='autocam-local-training-execution-1',
        interpreter=dict(version=sys.version, implementation=platform.python_implementation(),
                         executable_sha256=digest(Path(sys.executable).read_bytes())),
        platform=dict(system=platform.system(), release=platform.release(), machine=platform.machine()),
        packages=packages, input_manifest_sha256=digest((output / 'inputs.json').read_bytes()),
        producer='retained producer/python source; no parent repository dependency',
        numerical_semantics_changed=False, manufacturing_qualified=False))
    return output, pins


def assert_inputs_unchanged(output, pins):
    if any(file_pin(output / p['path'], output) != p for p in pins):
        raise ValueError('Retained input or producer source changed during training')


def finish_run(output, result):
    write_json(output / 'result.json', result)
    write_json(output / 'index.json', [file_pin(p, output) for p in sorted(output.rglob('*'))
                                     if p.is_file() and p.name != 'index.json'])
