# Task5 and task6 recorded training examples

These are finite synthetic software fixtures. They check replay, compatibility,
masking and local training packaging. They do not establish held-out improvement,
physical accuracy or manufacturing qualification.

| Directory | Recorded decisions | Starting weights | Expected trained flags |
| --- | --- | --- | --- |
| `task5/manual/` | Short tool, opening with long tool, short tool, repeated opening | Zero | false, true, true, false |
| `task5/model-mcts/` | One recorded model/MCTS decision | Supplied `initial-checkpoint.json` | true |
| `task6/manual/` | Blocked short tool, opening, newly eligible short tool, repeat | Zero | false, true, true, false |
| `task6/model-mcts/` | One recorded model/MCTS decision | Supplied `initial-checkpoint.json` | true |

Every directory contains `episode.json`, `expected-checkpoint.json` and
`expected-training.json`, plus `task.json` and `initial.bin` for loading that exact
case. Expand **Run the adaptive shadow gym**, then **Open your prepared task and
stock**. Select **Task JSON** and **Initial stock snapshot** from the same folder,
then choose **Open local prepared case**.

To inspect the supplied reference model, load that folder's
`expected-checkpoint.json` using **Load model weights**. To test your own training
run end to end, follow the [recorded training quickstart](../../docs/RECORDED_TRAINING_QUICKSTART.md)
and load the newly emitted `checkpoint.json` instead. `expected-inference.json`
retains native initial policy/MCTS results; it is
not a completing-policy claim. The model/MCTS directories also contain the explicit
training starting checkpoint. The inference checkpoints archived in an episode
are used to replay its original choices; they are not implicitly selected as the
starting training weights. All episodes preserve seed 7. Exact archive hashes,
source provenance, input hashes and expected output hashes are in
[`manifest.json`](manifest.json).

The masked first and repeated final decisions remain in each manual training
record with `trained: false` and `reason: masked_recorded_action`. Task6's newly
eligible short tool has positive material credit but a negative net reward after
cost. The trainer preserves that distinction.

From the standalone repository root, install the pinned dependencies as described
in [installation](../../docs/INSTALLATION.md), then run:

```text
node scripts/python-command.mjs -I python/verify_examples.py --output runs/examples-check-01
```

Use the Python executable from the configured environment. The command refuses an
existing output directory, checks all example identities, reproduces mixed A/B
and these four cases, compares canonical output bytes, checks initial mixed
policy/MCTS behavior, and runs the rejection suite. It writes a `result.json`
receipt and preserves command stdout/stderr. `--family task5`, `--family task6`
or `--family mixed` limits positive runs; shared task5/task6 rejection checks still
run. Runtime depends on the CPU; mixed replay and search are slower than the small
task5/task6 fixtures.

For a single task5/task6 episode, follow the
[recorded training quickstart](../../docs/RECORDED_TRAINING_QUICKSTART.md).
Successful runs retain the episode, optional explicit initial checkpoint,
`checkpoint.json`, `training.json`, `summary.json`, source under `producer/python`,
and input, execution and result manifests. A failed replay produces no successful
checkpoint. An existing output is never overwritten.

The three archived cases retain bytes from the existing synthetic owner evidence.
Task5 manual was generated through the same owner fixture in
[`build_task5_manual.py`](../../python/tests/build_task5_manual.py); its original
owner test source identities are retained in the manifest. No external CAD data
or industrial training data were introduced.

Regional recorded routes have separate small synthetic examples in
`regional-v2/` and `regional-v3/`, pinned by
[`regional-manifest.json`](regional-manifest.json). Each retains three original
recorded actions and the original checkpoint/training bytes. Each also includes
the exact `task.json` and `initial.bin` pair for opening its prepared case;
`prepared-inputs-provenance.json` binds their deterministic derivation to the
committed episode. Follow the [regional guide](../../docs/REGIONAL_TRAINING_QUICKSTART.md)
to load your newly trained checkpoint and request a read-only MCTS suggestion.
Version 2 uses 48 features and its original reward; version 3 uses 50 features
and requires discount 1.

Do not convert a v2 episode or checkpoint by changing its label. The preserved
v2 learned example can prefer an incomplete choice; these checks reproduce it
without claiming policy improvement. Use `--family regional-v2` or
`--family regional-v3` to verify an individual regional example.
