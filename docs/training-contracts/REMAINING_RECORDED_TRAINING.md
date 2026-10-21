# Local training from task-5 browser decisions

Task-local continuation of P6 and the owner's request to download decisions,
train locally and load compatible weights into the browser. The current
`adaptive-mill-turn-core-roughing-task-5` browser records have a distinct
checkpoint-5 feature contract; the regional v2/v3 trainers cannot consume them.

Add an explicit local recorded-episode trainer for `adaptive-browser-episode-1`
containing task5. Reconstruct through `RemainingSideBrowserSession` and the
existing sole writer. Validate the caller's exact file hash, closed fields,
snapshot hash, task regeneration, checkpoint bytes/hashes and feature contracts.
Replay every reset/step/inference response, inference trace, trajectory and final
state before any learning update. Inference replay uses the recorded original
weights and search recipe. Reject unknown versions, tampered records, nonfinite
JSON, missing models, empty demonstrations and inconsistent final exports.

Use the existing normalized, clipped linear-Q update from `combined_training`;
use `search.action_features` for the existing 54-feature observation. Do not add
a second search or material-removal algorithm. Train only actions enabled by the
pre-action mask; retain skipped masked/repeated decisions and their reasons.
Use the writer's actual reward, zero bootstrap for terminated/truncated steps,
and masked successor values for an unfinished recorded prefix. Record every
update and its initial/final weights. An explicit compatible initial checkpoint
may continue learning; do not silently train from a demonstration's policy.

The trainer refuses browser/WASI execution. Keep this trainer out of the worker
archive and expose no training command in the browser. Its file CLI retains
original inputs, producer sources, interpreter identity, checkpoint and update
record in a new output directory. No model qualification follows from fitting
one demonstration. Split/held-out evaluation remains a separate requirement.

Verification: replay before updates, coherent-hash tampering rejection, schema
and parameter rejection, deterministic fitting, independent first-update
arithmetic, masked/repeated action handling, terminal bootstrap, input-model
nonmutation and browser refusal. Train an actual retained Chrome download;
load the resulting nonzero checkpoint in Chrome and compare model/MCTS
responses to local execution. Keep the default zero-weight worker tests intact.

## Usage

From the repository root, point the command at a task-5 decision download:

```powershell
$env:PYTHONPATH = 'src;artifacts/shadow-gym/adaptive-delta/training-deps'
$episodePath = 'D:/path/to/decisions.json'
$episodeHash = (Get-FileHash -LiteralPath $episodePath -Algorithm SHA256).Hash.ToLower()
& C:/ProgramData/miniconda3/python.exe -B tools/shadow_gym/train_recorded_remaining.py `
  --episode $episodePath --expected-sha256 $episodeHash `
  --output artifacts/shadow-gym/adaptive-delta/my-task5-training
```

Use a new output directory. The command writes `checkpoint.json`, `training.json`,
the unchanged original `episode.json`, source/input pins and an artifact index.
Load `checkpoint.json` into a compatible task-5 browser Gym. An optional
`--initial-checkpoint` requires its `--checkpoint-sha256`; otherwise learning
starts from zero weights. The learning rate, discount and error clip are explicit
CLI options. The command uses the existing local training dependencies; it does
not install packages or send geometry to a service.

## Executed verification

The actual React download from
`removal-packaged-browser-01/run/episode.json` has SHA-256
`b6a65893357e8175641fe224b709f226e7323d08b0da9ed30d3f943c18b9c51e`.
`remaining-recorded-training-01` replays its original model/MCTS decision and
final export before one update. The output has 28 nonzero weights and SHA-256
`5ae984d564f8b1cc4634dac8c78d34d1dee08530ef23078f1cab8b717383ed42`.
This synthetic input carries the original `test` split label. Its reuse here is
a pipeline diagnostic, disqualifies it as held-out evidence for these weights,
and does not alter any frozen training/validation/test cohort or label.

`remaining-trained-browser-01` loads those exact bytes into the same generated
task in actual Chrome. All 18 responses match local execution, including model
and MCTS decisions, inspection and exports. Both learned policy modes select
refinement in this test; a completing machining policy has not been demonstrated.
`remaining-training-default-browser-01` separately preserves all 12 responses of
the existing zero-weight/manual-history path. The new trainer is absent from
both worker archives and there is no browser training command.

`remaining-recorded-unit-02` passes five tests with no skips: deterministic
fitting, independent first-update arithmetic, terminal bootstrap, input-model
nonmutation, replay-before-learning, malformed input/contract rejection,
browser refusal and archive exclusion. `remaining-recorded-admission-01` adds
five coherently rehashed inference-record checks, rejecting missing models,
changed search recipes, false qualification flags, nonfinite JSON and duplicate
fields before any update. The first test run is retained as
`remaining-recorded-unit-01`: its expectation incorrectly treated a newly enabled
short tool as masked. The corrected test follows the actual mask and also checks
an identical repeated long-tool action is skipped. Zero new material credit and
the existing action cost remain distinct.

## React delivery

For a task-5 episode containing decisions, the existing decision download also
prepares an optional Markdown training guide. A separate button downloads the
guide for that last decision file. Bind it to the exact UTF-8 decision bytes by
SHA-256 and include the matching local CLI command and checkpoint-loading step.
Keep the decision JSON bytes and existing download name unchanged. The guide is
instructions, not replay evidence or a training operation. A guide for an older
download remains explicitly labelled as such after further actions; a newly
opened case clears it. Cancellation/close must not publish a late download.

Use the verified learned task-5 worker closure for a separate main-app package.
Check actual React weight loading, MCTS, exact downloads, guide hash, reset,
cancellation/recovery and local-reference isolation. Inspect desktop/mobile
layout. Reuse the same downloaded model bytes; do not advertise the diagnostic
model as qualified or automatically load it for users. No public deployment is
authorized by this component verification.

`remaining-trained-package-01` and `remaining-trained-build-01` package the
verified learned worker and build the main React app. Two guide tests verify
the exact UTF-8 hash, command formatting, unsupported/empty rejection and that
untrusted labels cannot enter the shell instructions. The test is included in
the UI's normal `npm test` command.

`remaining-trained-react-01` passes actual Chrome catalogue loading, learned
MCTS, decision/guide downloads, exact recovery after cancellation, reset and
local-reference isolation. Closing the case while the guide digest is
deliberately delayed emits no late download. The guide clears on opening a new
session. Desktop and 390-pixel mobile screenshots were inspected; no horizontal
overflow, obscured controls or theme regression was found.

The captured episode has SHA-256
`0232ad8913bf430c91a359e61cc7863052bc5cc1efaabd7ca4a81236974c69fd`.
`remaining-react-recorded-training-01` successfully replays this exact React
MCTS trace and continues learning with the explicitly supplied loaded weights.
Its checkpoint has 29 nonzero weights and SHA-256
`123d3972987002114f121e7f552f65303373d8e8e38fb4f9d8aa397097083f2b`.
The captured decision is refinement; neither this continuation nor the rendered
test establishes a completing policy. The package remains a local synthetic
component build and has not replaced the broader preview or public deployment.
