# Case and profile capabilities

Generated from `config/module3-capabilities.json`. Edit the registry and run
`node scripts/generate-capabilities.mjs`; do not edit this projection by hand.

These are workflow limits. The runtime must still accept each exact input, model
and action. This table grants no manufacturing or runtime authority.

Verification references below identify scenarios and their evidence level. A
source file or test definition is not a passing result. Check the
[verification status](VERIFICATION_STATUS.md) and retained command receipts
for what ran on this candidate; no complete browser pass for every family is
inferred. Paths refer to the standalone source checkout.

- **supported**: Supported by the standalone package.
- **restricted**: Supported within the stated input and task limits.
- **external**: Requires a separate package or trainer.
- **unavailable**: Unavailable in this workflow.

All training marked **external** requires a separate compatible trainer. It is
not an independently executable training route of this standalone package.
See the [training family guide](TRAINING_GUIDE.md) for packaged commands and
the [scope contract](MODULE3_SCOPE.md) for unresolved whole-module requirements.

| Case/profile | Import inputs | Prepare stock | Inspect | Machining actions | Record / replay | Policy | MCTS | Local training |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Classic sampled GYM | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Classic STEP: B-Rep | restricted | restricted | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Classic STEP: sampled comparison | restricted | restricted | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Adaptive STEP: Axis-aligned planar solid | restricted | restricted | restricted | restricted | restricted | restricted | restricted | restricted |
| Adaptive STEP: Coaxial cylindrical part | restricted | restricted | restricted | restricted | restricted | restricted | restricted | restricted |
| Adaptive STEP: Complete principal-frame sphere | restricted | restricted | restricted | restricted | restricted | restricted | restricted | restricted |
| Adaptive STEP: rational prism | restricted | restricted | restricted | unavailable | unavailable | unavailable | unavailable | unavailable |
| Adaptive core roughing task 4 | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | external |
| Adaptive core roughing task 5 | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | supported |
| Adaptive core roughing task 6 | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | supported |
| Combined turning and indexed milling | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | external |
| Combined regional task (v2) | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | restricted |
| Combined regional-completion task | restricted | restricted | restricted | restricted | restricted | restricted | restricted | restricted |
| Indexed finite-tool task | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | external |
| Finite drill | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Face milling | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Turning and face milling | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Full finite-tool mill-turn | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Synthetic mixed learning | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | supported |
| Cylindrical checked choices | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |
| Cylindrical model-guided choices | restricted | unavailable | restricted | restricted | restricted | restricted | restricted | restricted |
| Recorded adaptive inspection | restricted | unavailable | restricted | unavailable | restricted | unavailable | unavailable | unavailable |
| Equivalent-groove comparison | restricted | unavailable | restricted | restricted | restricted | unavailable | unavailable | unavailable |

## Classic sampled GYM

Manual turning and milling share stock. Teaching sequences and industrial staged greedy baselines are not trained policies.

Inputs/routes: `classic-sampled`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Pinned case catalogue and bounded prepared masks. |
| Prepare stock | unavailable | Stock is included in the prepared catalogue. |
| Inspect | restricted | Volumes and material are sampled estimates. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Replay the visible session and baseline; no trainable episode download. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/providers.test.mjs` | import | contract_regression: Pinned catalogue input and identity checks. |
| `tests/workflow.test.cjs` | machine, record_replay | model_regression: Shared-stock switching, terminal state and zero-removal rejection. |
| `tests/browser.cjs` | inspect, machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Classic STEP: B-Rep

Accepted STEP solids use bounded geometric subtraction. No general machining qualification or adaptive-profile admission follows.

Inputs/routes: `brep`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Local STEP up to 100 MiB; OpenCascade must accept the solid. |
| Prepare stock | restricted | Declared stock allowance, holding end, spindle and tool reaches. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Replay the session and download actions plus original STEP for compatible local replay; no compatible learning episode. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `core/tests/occt-step-smoke.mjs` | import, prepare | native_wasm_scenario: Bounded STEP fixture import through the C++/WASM bridge. |
| `tests/brep-browser.cjs` | inspect, machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `tests/brep-client.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |

## Classic STEP: sampled comparison

Sampled comparison with a bounded cell budget. Cell pitch affects the approximation.

Inputs/routes: `classic-voxel`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Local STEP up to 100 MiB; valid solid and cell budget required. |
| Prepare stock | restricted | Voxel pitch, stock allowance, holding and reach settings. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Replay visible actions; no compatible learning episode. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/step-upload.cjs` | import, prepare, inspect, machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Adaptive STEP: Axis-aligned planar solid

Axis-aligned planar solids only. Positive allowance must fit inside stock margin.

Inputs/routes: `rectilinear`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | STEP must satisfy this exact profile. |
| Prepare stock | restricted | Conservative box/cylinder stock proposal; explicit margin and allowance. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Supply compatible machine/tools and roughing requirements, then check each proposed action. |
| Record / replay | restricted | Prepared machining route records actions; preparation alone has none. |
| Policy | restricted | After machining task preparation, compatible learned scores may be used inside MCTS if that runtime exposes inference. |
| MCTS | restricted | Only for a generated compatible regional machining task and exact model; preparation alone does not enable search. |
| Local training | restricted | Compatible recorded regional v3 machining episodes can use python/train_recorded_regional.py --task-version 3. This is not general arbitrary-STEP learning. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/cad-allowance-client.test.mjs` | import, prepare | contract_fixture: Planar stock/allowance preparation request and pinned response checks. |
| `tests/allowance-provider.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/adaptive-cad-machining-client.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `examples/recorded-training/regional-manifest.json` | policy, mcts, training | prepared_task_example: Regional learning example after compatible task preparation. It does not validate model transfer to a newly imported part. |

## Adaptive STEP: Coaxial cylindrical part

Coaxial cylindrical profiles, including supported through-bores. Positive allowance must fit inside stock margin.

Inputs/routes: `periodic_nominal`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | STEP must satisfy this exact profile. |
| Prepare stock | restricted | Conservative box/cylinder stock proposal; explicit margin and allowance. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Supply compatible machine/tools and roughing requirements, then check each proposed action. |
| Record / replay | restricted | Prepared machining route records actions; preparation alone has none. |
| Policy | restricted | After machining task preparation, compatible learned scores may be used inside MCTS if that runtime exposes inference. |
| MCTS | restricted | Only for a generated compatible regional machining task and exact model; preparation alone does not enable search. |
| Local training | restricted | Compatible recorded regional v3 machining episodes can use python/train_recorded_regional.py --task-version 3. This is not general arbitrary-STEP learning. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/cad-annular-client.test.mjs` | import, prepare | contract_fixture: Coaxial hollow-cylinder preparation and input scope checks. |
| `tests/annular-shadow-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/adaptive-cad-machining-client.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `examples/recorded-training/regional-manifest.json` | policy, mcts, training | prepared_task_example: Regional learning example after compatible task preparation. It does not validate model transfer to a newly imported part. |

## Adaptive STEP: Complete principal-frame sphere

Complete principal-frame spheres. Roughing can leave material; curved finishing is unavailable. Positive allowance must fit inside stock margin.

Inputs/routes: `spherical_nominal`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | STEP must satisfy this exact profile. |
| Prepare stock | restricted | Conservative box/cylinder stock proposal; explicit margin and allowance. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Supply compatible machine/tools and roughing requirements, then check each proposed action. |
| Record / replay | restricted | Prepared machining route records actions; preparation alone has none. |
| Policy | restricted | After machining task preparation, compatible learned scores may be used inside MCTS if that runtime exposes inference. |
| MCTS | restricted | Only for a generated compatible regional machining task and exact model; preparation alone does not enable search. |
| Local training | restricted | Compatible recorded regional v3 machining episodes can use python/train_recorded_regional.py --task-version 3. This is not general arbitrary-STEP learning. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/cad-allowance-client.test.mjs` | import, prepare | contract_fixture: Spherical profile and allowance request validation. |
| `tests/allowance-provider.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/spherical-bands-browser.mjs` | inspect, machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `examples/recorded-training/regional-manifest.json` | policy, mcts, training | prepared_task_example: Regional learning example after compatible task preparation. It does not validate model transfer to a newly imported part. |

## Adaptive STEP: rational prism

Experimental trimmed rational caps joined by vertical sides; zero allowance. Unresolved face associations are not proven contact.

Inputs/routes: `rational_nominal`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Only the experimental rational-prism profile with its separate pinned runtime. |
| Prepare stock | restricted | Initial stock at zero finishing allowance only. |
| Inspect | restricted | Inspect initial stock and original nominal faces; some contacts remain unresolved. |
| Machining actions | unavailable | No machining actions for this profile. |
| Record / replay | unavailable | Initial stock only; no machining episode. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/cad-rational-assets.test.mjs` | import, prepare | asset_contract: Exact separate rational runtime selection; it does not independently prove arbitrary STEP acceptance. |
| `tests/cad-rational-faces.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/module3-workflow-browser.mjs` | inspect | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Adaptive core roughing task 4

Fixed bounded core roughing.

Inputs/routes: `adaptive-mill-turn-core-roughing-task-4`.

Model compatibility: Only the checkpoint family and task binding accepted by this task version; mixed-learning weights are incompatible.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Run model selects and immediately applies one checked policy action. |
| MCTS | restricted | Run model + MCTS selects and immediately applies one checked search action. |
| Local training | external | A separate compatible trainer is required; it is not bundled here. The standalone training guide identifies the missing family. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/adaptive-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/adaptive-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/adaptive-live-browser.cjs` | inspect, machine, record_replay, policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Adaptive core roughing task 5

Side clearance uses current remaining stock.

Inputs/routes: `adaptive-mill-turn-core-roughing-task-5`.

Model compatibility: Only the checkpoint family and task binding accepted by this task version; mixed-learning weights are incompatible.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Run model selects and immediately applies one checked policy action. |
| MCTS | restricted | Run model + MCTS selects and immediately applies one checked search action. |
| Local training | supported | Standalone python/train_recorded_remaining.py verifies replay before TD updates; new output directory required. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/recorded-training-ui-browser.mjs` | inspect, machine, record_replay, policy | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `tests/recorded-training-browser.mjs` | policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `python/verify_examples.py` | training | native_scenario: Reproduces task5 manual/model-MCTS replay, checkpoint and training outputs from pinned examples. |

## Adaptive core roughing task 6

Full shank and holder clearance uses current stock, including previously cleared space.

Inputs/routes: `adaptive-mill-turn-core-roughing-task-6`.

Model compatibility: Only the checkpoint family and task binding accepted by this task version; mixed-learning weights are incompatible.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Run model selects and immediately applies one checked policy action. |
| MCTS | restricted | Run model + MCTS selects and immediately applies one checked search action. |
| Local training | supported | Standalone python/train_recorded_remaining.py verifies replay before TD updates; new output directory required. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/recorded-training-ui-browser.mjs` | inspect, machine, record_replay, policy | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `tests/recorded-training-browser.mjs` | policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `python/verify_examples.py` | training | native_scenario: Reproduces task6 manual/model-MCTS replay, checkpoint and training outputs from pinned examples. |

## Combined turning and indexed milling

Prepared combined geometry/tool tasks. Search suggests a candidate; Apply commits it.

Inputs/routes: `adaptive-combined-browser-config-1`.

Model compatibility: Compatible combined mill-turn checkpoint required.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Compatible learned scores are used inside MCTS; no separate policy button. |
| MCTS | restricted | Load compatible combined weights; bounded MCTS suggestion leaves stock unchanged. |
| Local training | external | A separate compatible trainer is required; it is not bundled here. The standalone training guide identifies the missing family. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/combined-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/combined-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/combined-react-browser.cjs` | inspect, machine, record_replay, policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Combined regional task (v2)

Prepared regional turning and indexed milling. Runtime inference capability and exact task/model compatibility are checked before suggestions.

Inputs/routes: `adaptive-combined-browser-config-2`.

Model compatibility: adaptive-regional-linear-q-1, 48 weights plus the exact regional task/context binding.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Compatible learned scores are used inside MCTS when the runtime reports inference_available; no separate policy button. |
| MCTS | restricted | The configured runtime supports compatible regional model search. Inference-disabled runtimes explain that restriction; Apply explicitly commits the suggestion. |
| Local training | restricted | Standalone python/train_recorded_regional.py --task-version 2 verifies compatible recorded episodes before local TD updates; exact task/model binding required. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/regional-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/combined-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/regional-model-react-browser.cjs` | machine, record_replay, policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `examples/recorded-training/regional-manifest.json` | training | pinned_native_example: Distinct regional-v2 recorded episode, expected checkpoint and training outputs; verify before claiming reproduction. |

## Combined regional-completion task

Source-derived roughing with regional completion. The selected runtime may expose compatible model/MCTS inference; unresolved completion does not mean a completed part.

Inputs/routes: `adaptive-combined-browser-config-3`.

Model compatibility: adaptive-regional-objective-linear-q-1, 50 weights plus the exact v3 task/context binding.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | restricted | Generated from compatible adaptive STEP stock plus machine/tools and requirements. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Compatible learned scores are used inside MCTS when the runtime reports inference_available; no separate policy button. |
| MCTS | restricted | The configured runtime supports compatible regional model search. Inference-disabled runtimes explain that restriction; Apply explicitly commits the suggestion. |
| Local training | restricted | Standalone python/train_recorded_regional.py --task-version 3 verifies compatible recorded episodes before local TD updates; exact task/model binding required. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/adaptive-cad-machining-client.test.mjs` | prepare | contract_fixture: Generated task/configuration binding to source-derived stock and preparation archive. |
| `tests/regional-objective-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/combined-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/regional-model-react-browser.cjs` | machine, record_replay, policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |
| `examples/recorded-training/regional-manifest.json` | training | pinned_native_example: Distinct regional-v3 objective episode and 50-feature checkpoint; not interchangeable with v2. |

## Indexed finite-tool task

Fixed indexed setup and finite-tool checks. Suggestions do not change accepted stock.

Inputs/routes: `adaptive-indexed-browser-config-1`.

Model compatibility: Compatible indexed checkpoint required.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Compatible learned scores are used inside MCTS; no separate policy button. |
| MCTS | restricted | Load compatible indexed weights; bounded MCTS suggests an action. |
| Local training | external | A separate compatible trainer is required; it is not bundled here. The standalone training guide identifies the missing family. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/indexed-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/indexed-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/indexed-react-browser.cjs` | machine, record_replay, policy, mcts | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Finite drill

Finite drill length and holder restrictions. Preview before explicit acceptance; compatible learning inference is unavailable.

Inputs/routes: `adaptive-drill-browser-config-1`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/drill-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/drill-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/drill-local-save-browser.mjs` | machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Face milling

Finite face assembly and indexed-pose restrictions. Preview before explicit acceptance; compatible learning inference is unavailable.

Inputs/routes: `adaptive-face-browser-config-1`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/face-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/face-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |

## Turning and face milling

Shared turning and face-milling stock. Preview before explicit acceptance; compatible learning inference is unavailable.

Inputs/routes: `adaptive-mill-turn-browser-config-2`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/mill-turn-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/mill-turn-transition-record.test.mjs` | machine, record_replay | contract_fixture: Checks the exact accepted transition export and lineage for mill-turn fixtures. |

## Full finite-tool mill-turn

Turning, transfer, indexing, face milling and drilling under the prepared task. Preview before explicit acceptance; compatible learning inference is unavailable.

Inputs/routes: `adaptive-full-mill-turn-browser-config-1`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/full-mill-turn-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/full-mill-turn-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |

## Synthetic mixed learning

Constructed finite-tool case with synthetic cost. Changed weights do not establish improved decisions or transfer to industrial parts.

Inputs/routes: `adaptive-mixed-learning-browser-config-1`.

Model compatibility: adaptive-mixed-linear-q-1 (34 weights), bound to compatible task and action features.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Load compatible model; Suggest with policy leaves accepted stock unchanged. |
| MCTS | restricted | Bounded search leaves stock unchanged. Preview and Accept apply the selected action. |
| Local training | supported | Standalone python/train_operator_episode.py; canonical replay precedes TD Q updates. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/mixed-learning-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/mixed-learning-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `python/verify_examples.py` | policy, mcts, training | native_scenario: Reproduces supplied mixed A/B learning results and initial policy/MCTS comparison; no industrial-performance claim. |

## Cylindrical checked choices

Version-specific indexed, outer and full-turning choices, including facing variants. Some catalogues intentionally reject cuts.

Inputs/routes: `adaptive-cylindrical-choice-browser-config-1`, `adaptive-cylindrical-choice-browser-config-2`, `adaptive-cylindrical-choice-browser-config-3`, `adaptive-cylindrical-choice-browser-config-4`, `adaptive-cylindrical-choice-browser-config-5`, `adaptive-cylindrical-choice-browser-config-6`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/cylindrical-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/cylindrical-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `tests/cylindrical-transitions-browser.mjs` | machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

## Cylindrical model-guided choices

Version-specific cylindrical policy tasks. Search is a suggestion; Apply is the explicit state-changing action.

Inputs/routes: `adaptive-cylindrical-policy-browser-config-1`, `adaptive-cylindrical-policy-browser-config-2`, `adaptive-cylindrical-policy-browser-config-3`.

Model compatibility: Compatible cylindrical policy checkpoint for the exact version and task family.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Exact compatible task JSON and initial stock snapshot; schema and identity checks apply. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Only current actions passing the task checks can apply. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | restricted | Compatible learned scores are used inside MCTS; no separate policy button. |
| MCTS | restricted | Load compatible cylindrical weights; checked bounded MCTS suggestion. |
| Local training | restricted | Standalone python/train_cylindrical_policy.py supports compatible policy configs 1–3 with exact task, initial stock and weight pins; recorded and self-play recipes have distinct inputs. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-prepared-case.test.mjs` | import | contract_regression: Accepted task-schema routing, exact retained bytes and runtime selection; this is not a fresh simulation of every task. |
| `tests/cylindrical-live-view.test.mjs` | inspect | contract_fixture: Validates the scoped geometry/view projection and input bindings from fixed fixture responses. |
| `tests/cylindrical-python-session.test.mjs` | machine, record_replay | session_boundary_regression: Checks command, accepted-state, replay or cancellation boundaries; fixtures or controlled clients are not physical validation. |
| `python/verify_cylindrical_examples.py` | policy, mcts, training | native_scenario: Recorded/self-play fitting, compatible profile1/2/3 load/search and negative checks; consult actual receipt for platforms and cases. |

## Recorded adaptive inspection

Read-only inspection of an existing bundle; displayed scopes reflect recorded checks rather than new machining validation.

Inputs/routes: `adaptive`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Compatible inspection bundle up to 64 MiB with identity checks. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | unavailable | Inspection does not execute machining. |
| Record / replay | restricted | Inspect recorded steps and producer-reported replay status; no new decisions are recorded. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/adaptive-provider.test.mjs` | import, inspect, record_replay | contract_fixture: Read-only inspection bundle, frame, replay-status and identity validation. |
| `tests/adaptive-scope.test.mjs` | inspect | contract_regression: Recorded geometric/tool scope cannot become manufacturing certification. |

## Equivalent-groove comparison

Compare the supplied low/high prepared alternatives and bounded estimates. No general geometry equivalence or policy improvement follows.

Inputs/routes: `equivalent-groove`.

Model compatibility: No model interface.

| Stage | Status | Restriction |
| --- | --- | --- |
| Import inputs | restricted | Pinned comparison task pair and estimate file. |
| Prepare stock | unavailable | Open the supplied prepared task and initial stock. |
| Inspect | restricted | Inspect the displayed geometry and recorded scope. |
| Machining actions | restricted | Each alternative keeps its own checked accepted state. |
| Record / replay | restricted | Download decisions; replay must verify exact inputs and state. |
| Policy | unavailable | No compatible policy control in this workflow. |
| MCTS | unavailable | No compatible MCTS control in this workflow. |
| Local training | unavailable | No standalone trainer for this workflow. |

Verification scenarios:

| Source path | Stage(s) | Evidence level and scope |
| --- | --- | --- |
| `tests/module3-capabilities.test.mjs` | import, prepare, inspect, machine, record_replay, policy, mcts, training | capability_contract: Every visible route and stage is explicit; unknown inputs remain unknown. Metadata coverage does not prove numerical or browser execution. |
| `docs/TRAINING_FAMILIES.md` | policy, mcts, training | documented_boundary: Identifies compatible model families and packaged/external/unavailable trainers; no absent trainer is treated as tested. |
| `tests/prepared-comparison.test.mjs` | import, inspect | contract_fixture: Comparison pair and estimate identity; not general geometric equivalence. |
| `tests/indexed-react-browser.cjs` | machine, record_replay | browser_scenario: Browser scenario definition; run it with its declared inputs and retain the receipt. Its presence does not mean this release reran all supplied cases. |

Registry SHA-256: `d97427362817e3197f0f15e2afdee7c8da2d4f03ccb8f0976709e248a474cb79`.
