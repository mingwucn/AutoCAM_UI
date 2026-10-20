# Module 3: what this package does

This candidate contains the AutoCAM browser GYM and its local learning tools.
It extends GYM V1 (`v1.0.0`, commit
`de20f204114767124296542d8d8ecc0361e7666a`). V1 remains the comparison release.
Candidate verification and independent user acceptance are separate steps.

## Choose a workflow

| Workflow | Input and purpose | Available functions and limits |
| --- | --- | --- |
| Industrial sampled GYM | Pinned prepared cases, including 3-29-00350 | Manual turning/milling, one shared stock, a staged greedy baseline and replay. Volumes are sampled estimates. This route does not train an industrial policy. |
| Classic STEP import | A local STEP solid that the browser importer accepts, plus voxel/stock/setup settings | Builds a sampled turning/milling case. Import acceptance does not establish machining feasibility or support in the separate adaptive workflow. |
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

## Knowledge and complete Module 3 scope

The GYM enforces action, material, tool, setup, model and state contracts. The
Master project's governed knowledge-control prototype and any partner-owned
components are separate. Their presence in another repository does not mean they
are delivered here. This package does not provide a general rule-authoring,
human review, company qualification or policy-activation workflow.

The authoritative whole-Module-3 specification, partner/component inventory and
required industrial/knowledge interfaces have not been supplied with this
candidate. These remain **open acceptance requirements**, owned by the Module 3
acceptance owner; passing the bounded GYM tests cannot close them.

See [the functional contract](FUNCTIONAL_CONTRACT.md) for observable behavior and
[training families](TRAINING_FAMILIES.md) for packaged versus external trainers.
The candidate must retain its verification record and record independent human
acceptance explicitly; neither is inferred from documentation or agent output.
