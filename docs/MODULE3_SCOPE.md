# Module 3: what this package does

This candidate contains the AutoCAM browser GYM and its local learning tools.
It extends GYM V1 (`v1.0.0`, commit
`de20f204114767124296542d8d8ecc0361e7666a`). V1 remains the comparison release.
Candidate verification and independent user acceptance are separate steps.

## Choose a workflow

| Workflow | Input and purpose | Available functions and limits |
| --- | --- | --- |
| Industrial sampled GYM | Pinned prepared cases, including 3-29-00350 | Manual turning/milling, one shared stock, a staged greedy baseline and replay. Volumes are sampled estimates. This route does not train an industrial policy. |
| Classic STEP import | A local STEP solid that the browser importer accepts, plus the selected engine and stock/setup settings | OpenCascade B-Rep cuts or sampled voxel turning/milling, depending on the selected mode. Import acceptance does not establish machining feasibility or support in the separate adaptive workflow. |
| Synthetic mixed learning | The compatible turning, transfer, indexing, face-milling and drilling task | Record/replay actions, train locally, load a compatible 34-weight model, request policy or bounded MCTS suggestions, preview and explicitly accept an action. Costs are synthetic. |
| Recorded task-5/task-6 learning | Compatible remaining-stock or cleared-holder browser episodes | Standalone launchers and examples for separate training/model families. Platform and browser checks are recorded independently. These checkpoints are incompatible with mixed-learning models. |
| Cylindrical policy learning | Exact compatible configuration, initial state and weights | Separate cylindrical trainer and model contracts; consult the training-family guide and per-scenario verification before use. |
| Adaptive STEP preparation | A supported profile and explicit stock, allowance and machining settings | Preparation, inspection and machining are separate capabilities. Axis-aligned planar, principal-frame sphere and coaxial cylindrical profiles have different restrictions. The rational-prism profile supports preparation/inspection; machining is unavailable. Model use requires a compatible prepared regional task and its exact feature/context contract; no industrial trained checkpoint is implied. |
| Regional v2/v3 learning | Separate compatible regional recorded episodes and models | Local recorded training and context-bound inference; v2 and v3 checkpoints are incompatible. Follow the training-family guide. |
| Diagnostic examples | Prepared finite-tool, fixture-shadow and CAD-face cases | Inspect the recorded check and its unresolved regions. A shadow display is not a whole-machine collision certificate. Some examples intentionally reject machining. |

Use the case/profile capability table in the application before selecting a
workflow. Support is stage-specific: **import, prepare stock, inspect, machine,
record/replay, policy, MCTS and local training**. A successful earlier stage does
not enable a later one. The runtime checks the exact input, model and state;
documentation does not override a rejection.

## What results mean

- **Zero sampled excess:** the sampled industrial model has no excess cells
  remaining. It does not mean a physically released or qualified workpiece.
- **Complete:** the selected task's declared material requirements are met.
  Read the task's scope; completion is not a universal manufacturing claim.
- **Truncated, blocked or unresolved:** the task did not establish completion.
  Accepted earlier actions remain distinct from the unresolved next decision.
- **Changed weights:** numerical training updated a compatible model. Selected
  actions may remain unchanged; improvement needs a separate evaluation.
- **Checked action:** the recorded checks passed within their stated geometry,
  tool, setup and motion scope. Unassessed properties remain unassessed.

General arbitrary STEP machining, an industrial trained planning policy,
qualified manufacturing plans, NC generation and machine execution are not
established by this package.

## Complete repository scope and component interfaces

The owner confirmed that this review covers all Module 3 functions in the single
`mingwucn/AutoCAM_UI` repository. The inventory below describes that delivery;
other Master research programmes are not implicitly part of this release.

| Component | Input and output interface | Implementation / use |
| --- | --- | --- |
| Material-removal GYM | Pinned case or supported imported STEP; current stock, checked actions and history | Classic sampled and B-Rep engines, plus family-specific adaptive sessions; manual and supported staged greedy operation |
| Adaptive preparation and inspection | Supported STEP/profile/settings or an exact prepared task/stock pair; prepared case, original-face and constraint views | Pinned CAD/runtime packages selected in `site.config.json`; stages and restrictions remain profile-specific |
| Recording and replay | Checked session decisions and exact initial context; versioned episode/transition downloads and compatible restoration | Browser session adapters preserve task, state, setup and tool identities; a valid recording is not automatically trainable by every trainer |
| Local learning pipeline | Compatible recorded episode or cylindrical configuration/state/model tuple; replay, training record and checkpoint | The four launchers under `python/`, packaged owner source and pinned dependencies; see the training-family inventory |
| Agent / model search | Compatible checkpoint, accepted state and search settings; suggested or explicitly executed checked action | Family-specific policy and bounded MCTS interfaces; industrial greedy and learned synthetic routes are distinct |
| Knowledge and constraints | Exact input/action/tool/setup/model/evidence contracts; allowed action or explicit rejection/unresolved result | Executable checks in the GYM and preserved runtime owners; see the allowed/blocked examples in knowledge scope |

The GYM does not provide a general rule-authoring, human rule-review, company
qualification or policy-activation workflow. The broader Master's governed
knowledge-control prototype is separate; describing it does not import it or
claim that this repository delivers it. These unavailable capabilities are
explicit boundaries, not a hidden prerequisite to running the supplied package.

The [workflow catalogue](WORKFLOW_CATALOGUE.md) maps every advertised family to
its input route, controls, expected observations and verification scope. Full
repository coverage, public delivery and independent-user acceptance require
their own evidence; a test for one family does not establish another.

See [the functional contract](FUNCTIONAL_CONTRACT.md) for observable behavior and
[training families](TRAINING_FAMILIES.md) for available and unavailable trainers.
The candidate must retain its verification record and record independent human
acceptance explicitly; neither is inferred from documentation or agent output.
