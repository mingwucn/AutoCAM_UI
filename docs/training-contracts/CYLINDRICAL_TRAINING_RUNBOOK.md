# Train machining-choice weights locally

Run from the repository root on Windows. The operator is
`tools/shadow_gym/train_cylindrical_policy.py`. It needs Python and the shared
source tree; it does not use the test fixtures, OCCT or a remote training service.

Supply a prepared `adaptive-cylindrical-policy-browser-config-1` task, its initial
stock snapshot, compatible starting weights, and optionally the decision JSON
downloaded from the machining gym. The configuration supplies completion,
horizon, machine, tools and reward settings. Decisions alone do not supply the
training contract. Use a fresh output directory for each run.

The same command supports the full-cycle version-3 choice configuration inside
that policy wrapper. Keep the original stock, turning and transfer decisions in
the download. Replay includes them before fitting; do not replace the initial
snapshot with post-turn material. Full-cycle weights have their own feature
identity and cannot substitute for an older milling-only checkpoint.

This example uses the locally retained demonstration files. These are small
fixture inputs, not industrial training or validated production weights:

```powershell
$trainingConfig = 'artifacts/shadow-gym/adaptive-delta/full-cycle-react-01/task.json'
$trainingStock = 'artifacts/shadow-gym/adaptive-delta/full-cycle-react-01/initial.bin'
$trainingWeights = 'artifacts/shadow-gym/adaptive-delta/full-cycle-react-01/checkpoint.json'
$trainingDecisions = 'artifacts/shadow-gym/adaptive-delta/full-cycle-react-01/download.json'

& 'C:\ProgramData\miniconda3\python.exe' tools/shadow_gym/train_cylindrical_policy.py `
  --configuration $trainingConfig --configuration-sha256 (Get-FileHash $trainingConfig -Algorithm SHA256).Hash.ToLower() `
  --initial $trainingStock --initial-sha256 (Get-FileHash $trainingStock -Algorithm SHA256).Hash.ToLower() `
  --weights $trainingWeights --weights-sha256 (Get-FileHash $trainingWeights -Algorithm SHA256).Hash.ToLower() `
  --decisions $trainingDecisions --decisions-sha256 (Get-FileHash $trainingDecisions -Algorithm SHA256).Hash.ToLower() `
  --epochs 4 --learning-rate 0.05 `
  --output artifacts/shadow-gym/adaptive-delta/my-recorded-training
```

The hashes bind the selected local bytes; computing them does not independently
establish provenance. For MCTS self-play, omit both decision arguments and add
`--seed 19 --simulations 4 --depth 2`. The current command runs one episode;
its resulting weights can be the next run's starting weights.

Outputs include `weights.json`, `training-record.json`, `training-decisions.json`,
`material-transitions.json`, `execution.json`,
`result.json`, input copies, the frozen shared source, recipe and hash indexes. A successful run
has `status: passed` and `inputs_unchanged: true`; check the exit code as well.
Recorded mode verifies full simulator replay before fitting. Accepted decisions
provide imitation targets; rejected decisions train value estimates only.
Self-play uses MCTS visit distributions and simulator rewards.

`training-decisions.json` contains the selected ordinary machining session.
`material-transitions.json` records its accepted material publications using the
same recorder as the browser, including inherited turning history, removal
bounds, conservation checks, witnesses and state hashes. Rejected choices stay
in the decision record without becoming accepted material changes. These files
describe the selected training episode, not unselected MCTS branches. The result
binds both files and the training record by SHA-256. Recording performs an
additional local replay; a capture or binding failure fails the run before
writing the model outputs. Existing capture capacity limits still apply.

The separate `execution.json` binds the input/source index, recipe and Python
interpreter bytes. It reports the observed checkout revision and dirty status,
platform/compiler settings, declared CPU/GPU roles and mode-specific RNG seed.
Unknown build and hardware fields remain unknown. The archived source bytes,
rather than HEAD alone, identify the implementation that ran. This record does
not alter the weights or material-state hashes.

Optionally supply `--dependency-lock <path>` to retain an exact dependency lock
with the run. An empty supplied file is retained as empty; omission is explicitly
`not_provided`. The launcher records supplied provenance without reconstructing
or validating the installed environment. Failed runs after execution setup also
retain the execution record and failure result; use a new output directory to retry.

Load `weights.json` through **Model weights** in a compatible prepared machining
gym, then use **Suggest with model + MCTS**. Apply remains a separate action.
Changing machine/tool/cost/reward context requires compatible weights.
Neither a successful training run nor lower training error demonstrates
held-out machining quality or whole-part completion.
