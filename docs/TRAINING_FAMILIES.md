# Training and model families

Use the exact family of the prepared task or downloaded episode. Browser model
inference, a Python training API and a supported standalone command are separate
capabilities. A bundled source module alone is not a usable training workflow.

| Family | Browser behavior | Standalone local training in this candidate |
| --- | --- | --- |
| Classic sampled industrial/STEP | Manual actions and staged greedy baseline; no model interface | Unavailable; this route does not train an industrial agent |
| Mixed synthetic learning | Load `adaptive-mixed-linear-q-1` (34 weights); policy/MCTS suggest; Preview/Accept executes | `python/train_operator_episode.py`; [mixed guide](OPERATOR_INPUT_QUICKSTART.md); A/B examples |
| Task-5 remaining-stock | Compatible checkpoint-5; Run model / Run model + MCTS explicitly executes a checked choice | `python/train_recorded_remaining.py`; [recorded guide](RECORDED_TRAINING_QUICKSTART.md); manual/model-MCTS examples |
| Task-6 cleared-holder | Separate checkpoint-6; explicit model run actions | Same dispatcher, separate task/model contract and fixtures; never substitute task-5 weights |
| Cylindrical policy configurations 1–3 | Compatible version/task model used in bounded MCTS; suggestion then Apply; no separate policy button | `python/train_cylindrical_policy.py`; configuration, initial state and model identities must be supplied; [cylindrical examples](../examples/cylindrical-policy/README.md) |
| Task-4 adaptive | Compatible model and model-plus-search execution | Not packaged by the mixed/task-5/task-6 launchers; requires a separate compatible trainer/workflow |
| Indexed finite-tool configuration 1 | Compatible learned scores used in MCTS; suggestion then explicit Apply; no separate policy button | Separate compatible trainer required; no standalone route advertised here |
| Combined configuration 1 | Compatible learned scores used in MCTS; suggestion then explicit Apply | Separate compatible trainer required; no standalone route advertised here |
| Regional configuration 2 / 48-feature model | Compatible regional model and bounded search; exact task/context required | `python/train_recorded_regional.py --task-version 2`; [regional guide](REGIONAL_TRAINING_QUICKSTART.md) |
| Regional objective configuration 3 / 50-feature model | Its own model/feature contract; compatible model and bounded search | `python/train_recorded_regional.py --task-version 3`; same guide, separate examples/checkpoints |
| Other drill/face/mill-turn, cylindrical choice or inspection-only cases | See stage-specific [capabilities](CAPABILITIES.md) | Availability of a recording or geometric preview does not imply local training support |

The cylindrical CLI is a distinct wrapper around its existing owner. Follow its
example command and `--help`; the recorded-episode commands above cannot consume
its configuration/state/model tuple. Retained verification status identifies
which cylindrical variants and training modes were actually exercised.

## Compatibility and starting weights

- Mixed recording schema: `adaptive-mixed-learning-episode-1`.
- Task-5/task-6 recording schema: `adaptive-browser-episode-1`, with respectively
  `adaptive-mill-turn-core-roughing-task-5` or
  `adaptive-mill-turn-core-roughing-task-6` inside it.
- The task-5/task-6 dispatcher starts at zero unless an explicit compatible
  initial checkpoint and hash are supplied. Archived inference models reproduce
  recorded decisions; they do not silently become the learner's initial weights.
- Hash agreement identifies bytes; the trainer also checks task, model, feature,
  state and replay compatibility. A matching filename or array length is insufficient.

Regional v2 and v3 support must be checked for the exact prepared context,
including a CAD-derived task when applicable. The presence of these interfaces
does not provide a model trained for a newly uploaded industrial part.

## Acceptance limits

Every packaged route must retain inputs, recipe, source identities and actual
outputs, and reject incompatible inputs before producing a usable checkpoint.
Read [verification status](VERIFICATION_STATUS.md) and the exact scenario receipt
before claiming a workflow tested on your platform.

Task-4, indexed configuration 1 and combined configuration 1 expose the model
consumption described above, but have no promised standalone training command in
this repository. Their separate Master research contracts do not make those
trainers installed by this package. Keep that boundary visible when using those
models; inference support does not imply a local training route. All advertised
standalone trainers are the packaged routes listed in this table.

Successful synthetic fitting does not establish a completing policy, held-out
quality or industrial training coverage. Use the [workflow catalogue](WORKFLOW_CATALOGUE.md)
for the non-training controls and exact input routes of each model family.
