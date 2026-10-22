# Examples and expected results

Start with the row matching your goal. An example contains a particular input
and bounded expected result; it does not qualify other parts or a learned model.

| Example | Inputs | What to reproduce |
| --- | --- | --- |
| [Industrial 00350](industrial-00350/README.md) | Pinned external sampled case; committed expected results | Three cuts reduce sampled excess 388600 → 286750 → 33236 → 0 mm³ while preserving target/holding material |
| [Industrial preference learning](industrial-learning/README.md) | Exact pinned 00350/00289 datasets; separate replay-bound feedback and case models | Rule baseline, explicit sequence/action-kind preference labels, local reward learning/RL, before/after policy and model-guided MCTS comparison |
| [Mixed operator learning](operator-input/README.md) | Committed A/B episodes, common model and result files | Replay; six updates and 28/34 changed weights; 161.6/228.4 synthetic seconds; unchanged selected actions at the two comparison states |
| [Task-5/task-6 recorded training](../docs/RECORDED_TRAINING_QUICKSTART.md) | Separate synthetic browser episode families under `recorded-training/` | Replayed inputs, family-compatible checkpoints, skipped masked decisions and rejected incompatible inputs |
| [Regional v2/v3 training](../docs/REGIONAL_TRAINING_QUICKSTART.md) | Separate versioned synthetic episodes and expected outputs under `recorded-training/` | Three replayed updates per reference and compatible family-specific checkpoints |
| [Cylindrical policy training](cylindrical-policy/README.md) | Pinned full-cycle configuration, original stock, weights and decisions | Recorded replay, deterministic self-play and learned-model read-only search with profile-specific checkpoints |
| [STEP preparation](step/README.md) | Public synthetic STEP fixtures | Supported-stage results, rejected invalid/unsupported input, resource-limit handling and cancellation recovery |
| [Rejections](rejections/README.md) | Deliberately invalid variants of supplied synthetic inputs | Failure at the expected check, no trained checkpoint or corrupted accepted state |
| [Complete workflow catalogue](../docs/WORKFLOW_CATALOGUE.md) | Pinned prepared-case, inspection and adaptive STEP fixtures exported by `npm run prepare:workflows -- --output runs/workflow-examples-01` | Input loading, supported controls, original-face inspection, reset and deliberate rejections for the advertised families |

[The manifest](manifest.json) supplies scenario identities, custody and exact
expected results. [The validation guide](../docs/VALIDATION_GUIDE.md) describes
automated and manual checks. Operator examples already existed in V1; this index
makes them easier to find and adds the missing workflow families.

The additional workflow exporter uses its separate
[pinned fixture selection](../config/workflow-examples.json) and writes a
`receipt.json` with the original manifest and output identities. It verifies
compressed and expanded bytes before writing, uses a new folder below `runs/`,
and refuses overwrite. These fixtures are additional to the recorded-training
manifest above. The task-4 model fixture has 54 zero weights and is explicitly
**untrained**: it demonstrates compatibility and controls, not learned quality.

## Custody and interpretation

- Git contains the operator episodes/checkpoints and synthetic test fixtures.
- The industrial UI case is derived sampled data acquired from the exact
  AutoCAM_Data release. Its raw industrial STEP is not bundled here.
- Runtime/CAD packages and the classic catalogue have different release pins.
  A local cache is a convenience, not the source of record.
- Software fixture checks, native replay, browser agreement and physical
  manufacturing validation answer different questions. Read each result's scope.
- Reusing an example for training prevents treating that same example as
  held-out performance evidence for the resulting model.

Never replace missing inputs with unrelated files to obtain a passing result.
Preserve failed-run details and record any changes to source, parameters or model.
