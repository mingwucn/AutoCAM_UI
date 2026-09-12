# B-Rep core (in development)

Controlled by parent task CODE-SGYM-008 and the accepted B-Rep replacement
specification. This directory is not connected to the published gym yet.

`Material` owns remaining/protected shapes and revision-checked transactions.
Preview computes candidate shapes and verifies mass conservation and protection;
commit recomputes from the removal shape rather than trusting a caller-supplied
remaining shape. `directional_shadow` uses analytic/OCCT HLR contours and the general
splitter before constructing boundary-face sweeps. This prevents cylindrical
and spherical faces from folding over themselves during translation.

`checked_boolean.hpp` ports existing Python safeguards: solid-leaf operands,
solid-only result checks and one destructive retry on independent copies for an
invalid result. `sweep_support.cpp` preserves a known source cylinder or plane
parallel to translation when a generated extrusion would obscure that support.
The reconstruction rejects tolerance growth and preserves the source geometry.
Broad B-spline conversion and unvalidated Boolean fallbacks are not used.

Configure with an OpenCascade development SDK using
`cmake -S core/brep -B core/build-brep -DOpenCASCADE_DIR=<SDK config directory>`.
Build with `cmake --build core/build-brep`, then run
`ctest --test-dir core/build-brep --output-on-failure`.

For a reproducible isolated build, run `scripts/build-brep.ps1 -Target native`.
For WebAssembly, use `-Target wasm -EmsdkDirectory <existing Emscripten SDK>`.
Both commands acquire the pinned OCCT source into `.cache/brep`, build the
required libraries and run the same C++ test executable. `-WorkDirectory`
overrides the isolated dependency/build directory. No system SDK is installed.

The initial isolated native SDK uses upstream OCCT V7_8_1,
commit `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`. The native and WASM
builds must pin the same source. Existing OpenCascade.js binaries are not a
substitute for compiling this shared implementation.

Native and WASM fixture tests pass for box shadows, axial/transverse cylinder
shadows, an oblique sphere shadow, reach limits, held-end rejection, stale
transactions, smooth tessellation, planar sections and shared turning/milling
state. The radial-envelope implementation uses continuous boundary curves and
trimmed analytic meridians, accepting their union only after full protected-shape
containment. Off-axis holes no longer cause blanket rejection. Tests cover a
cross-drilled cylinder on Z and both X spindle directions, an offset cylinder
with an inward seam, and an offset sphere. Native spline station isolation now
uses interval Bernstein/de Boor calculations on original curve coefficients,
including trimmed and rational curves. Analytic contributions are checked
first; supported splines are added only when needed. Both paths require the
same final validation and containment. General surface support and industrial
Boolean quality remain incomplete; insufficient candidates are rejected.

The shared core now imports STEP in millimetres, generates cylindrical stock
and holding geometry, manages revision-checked sessions and serializes B-Rep
snapshots. Restore checks stock containment and target/holding preservation.
The C ABI in `c_api.h` is used by both `python/autocam_brep.py` and
`src/brep-core.mjs`. Native calls through one Python Core are serialized. A
Windows native build keeps its MinGW pthread runtime beside the generated DLL.

`scripts/verify-brep.mjs --native-library <DLL/SO> --wasm-module <MJS>
--output <JSON>` exercises both public adapters and records pinned evidence.
It pins inputs before execution and verifies that their bytes are unchanged
after both adapters finish. These source/binary pins are run provenance;
the build records remain necessary to establish which source produced each
binary. A mutable checkout inspected only after execution is insufficient.
Box, overhang and stepped-shaft STEP fixtures currently agree exactly on
target, stock, removed and remaining volume. Native and WASM CTest also cover
invalid input, mixed processes, stale previews, cancellation, reset and snapshot
recovery. These results are narrower than full industrial/browser acceptance.

Add `--cases <manifest.json>` to run externally supplied hash-pinned STEP action
sequences through both adapters. The manifest schema is
`shadow-brep-action-cases-1`, with `cases` containing `id`, `step` (`path` relative
to the manifest and `sha256`), `setup` and ordered `actions`. The verifier saves
rejections and nonmutation checks, but exits nonzero if any sequence is incomplete.
The current local industrial probe applies 00350 outside turning followed by
negative-X milling in both runtimes (maximum numerical difference about
1.75e-10 mm3 across the probe). 00289 rejects a self-intersecting generated
envelope, preserving committed material; the verifier therefore exits nonzero.
This two-action 00350 probe does not complete the industrial acceptance surface.
Local industrial assets
and the ignored manifest have not yet been packaged for clean-clone CI.

The persistent worker/client and Three.js mesh-buffer renderer are implemented
but not yet wired into the published gym. Client lifecycle tests verify that
old worker replies cannot replace the committed checkpoint after cancellation.

The upload UI now connects the persistent worker to the B-Rep view. Run
`npm run test:brep-browser` after building and fetching test data to exercise
box upload, turning then milling, cancellation recovery, linked snapshot
sections and playback, return to live stock, reset and mobile layout. Recorded
sections use a temporary restored session and never replace live material.

The same interactive flow also passes for 00350 with an explicit Y spindle
origin `[0,0,27.5]`, reach 100 mm and negative-X milling after outside turning.
That setup is a chosen spindle line; the model has no nearby analytic Y axis
from which to infer it. Uploads now allow manual origin coordinates.

The worker hashes and instantiates the same module/WASM bytes, and recovery
rejects a changed runtime build. Downloads follow `shadow-gym-brep-episode-1`:
the original STEP, explicit resolved setup, runtime hashes, initial stock and
committed action metrics. [Python replay](python/README.md) verifies the STEP
and reproduces the actions using the shared native core. Actual box and 00350
browser downloads have passed native replay; this verifies numerical behavior,
not acceptance of the geometry defects described below.

Outstanding: industrial geometry consistency and the 00289 Boolean union,
broader browser/failure/performance coverage, example migration,
complete parity and release acceptance. Passing the box browser
flow does not establish completion of the replacement.

The latest common native build passes six CTest suites (45.24 seconds),
including spline, setup and analytic pcurve quality tests. Its matching WASM
rebuild remains pending.
Earlier public-adapter fixtures match exactly, and browser/client plus native
episode tests pass. Torus tangency regularization passes native tests.

Full pcurve audits found defects that ordinary BRepCheck and volume assertions
missed: generated drilled-cylinder parameterization errors, inherited imported
00350 curve/support discrepancies, and local tolerance growth during Boolean
operations. Reconstruction-only aggregate tolerance maxima are insufficient.
These quality gates remain open; a passing action sequence is not a complete
geometry fix. Source uncertainty and any derived preparation remain separate
from the simulation precision. No newer kernel or prepared STEP has been
adopted by the isolated comparison experiments.

The drilled-cylinder pcurve correction now preserves analytic supports and
passes eight direction/placement fixtures, with separate vertex/edge/face
budgets, full numerical curve/surface residual checks and source nonmutation.
The helper does not repair every Boolean or automatically prepare raw STEP.
The current 00289 merged-span envelope rejects containment after a lengthy
kernel self-intersection check; both industrial quality gates remain open.
