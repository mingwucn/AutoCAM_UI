# Native B-Rep episode replay

`autocam_brep.py` is a ctypes adapter to the shared C++ OpenCascade engine.
`replay_episode.py` validates the browser's downloaded episode and reproduces
its committed actions locally through that adapter. Python implements no
separate geometry or removal algorithm. No Python packages beyond the standard
library are required; build the native engine using `scripts/build-brep.ps1`.

Download **your episode** and **original STEP** from the B-Rep gym. From the UI
repository directory, run:

```powershell
python core/brep/python/replay_episode.py `
  --episode shadow-brep-episode.json `
  --step your-part.step `
  --native-library .cache/brep/build-native/libautocam_brep.dll `
  --output native-replay.json
```

Use the actual native DLL/SO path produced by your platform/build. On Windows,
keep the required MinGW runtime DLL beside the engine library, as the build
script arranges. Omitting `--output` prints the successful receipt to stdout.

Replay verifies the raw STEP SHA-256 before opening it. The versioned episode
must contain a resolved spindle origin/direction, original stock setup, initial
metrics, runtime digests and ordered committed manual actions. Each native
result must match recorded volume metrics within the fixed comparison policy
`1e-6 + 1e-10 * max(abs(actual), abs(recorded))` mm³. Unknown contracts, rejected
actions and mismatched geometry/metrics cause exit status 1. The verifier never
compares serialized B-Rep bytes or substitutes the browser's recorded metrics
for native calculation.

The success receipt pins the exact original episode bytes, original STEP,
source runtime and native library, then records the observed native transitions.
WASM and native binary hashes differ by design; matching calculations are not
a substitute for separate matching-source build provenance and release checks.
An engine version in an untrusted file is a compatibility claim, not a
signature. The current ctypes adapter exposes engine version `shadow-brep-1`.

Only committed actions belong in a version 1 episode. Preview and rejected
attempts are excluded. A reset begins a new episode from the original stock;
the recorded initial revision may be nonzero and maps to native revision zero.
The format currently supports separate STEP and JSON files, not an embedded
CAD/archive format. JSON is limited to 16 MiB and 10,000 action rows; STEP is
limited to 100 MiB. All processing is local. Successful replay does not classify
the sequence as optimal, executable machining or suitable training labels.

Run the native replay regression suite with an existing native library:

```powershell
python core/brep/tests/python_episode_test.py .cache/brep/build-native/libautocam_brep.dll
```

The suite checks the analytic volume of a 10 × 8 × 6 mm box after outside
turning and milling, malformed episodes, wrong STEP hashes, geometric rejection,
false recorded metrics, revision offsets after reset and initial-only episodes.
It does not rebuild or change the geometry kernel.
