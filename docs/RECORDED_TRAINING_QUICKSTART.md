# Train task-5 or task-6 decisions locally

Use this route for `adaptive-browser-episode-1` downloads containing
`adaptive-mill-turn-core-roughing-task-5` (remaining-stock) or
`adaptive-mill-turn-core-roughing-task-6` (cleared-holder). For
`adaptive-mixed-learning-episode-1`, use [the mixed guide](OPERATOR_INPUT_QUICKSTART.md).

## Record and identify the input

For a supplied case, open **Run the adaptive shadow gym**, expand
**Open your prepared task and stock**, and select **Task JSON** plus
**Initial stock snapshot** from the same example folder, for example
`examples/recorded-training/task5/manual/task.json` and `initial.bin`.
Choose **Open local prepared case**. Never mix the manual and model-MCTS file
pairs even if their file sizes match. The supplied local upload uses the
reference runtime; this guide does not claim optional packed/materialized modes.

In a compatible prepared case, make a checked decision, then download its
decisions. The optional generated guide is bound to the exact last download;
after making more decisions, download again to obtain a matching file and guide.
Keep the actual filename, including any suffix your browser added.

Install [the local environment](INSTALLATION.md). From the repository root,
Windows PowerShell:

```powershell
$episode = './shadow-gym-decisions.json'
$episodeHash = (Get-FileHash -LiteralPath $episode -Algorithm SHA256).Hash.ToLower()
./.venv/Scripts/python.exe python/train_recorded_remaining.py --episode $episode --expected-sha256 $episodeHash --output ./runs/recorded-01
```

Linux/POSIX shell:

```sh
episode='./shadow-gym-decisions.json'
episode_hash=$(./.venv/bin/python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$episode")
./.venv/bin/python python/train_recorded_remaining.py --episode "$episode" --expected-sha256 "$episode_hash" --output ./runs/recorded-01
```

Replace the episode path with your actual download. Choose a **new** output
directory each time. The launcher refuses overwrite, validates the family and
replays the complete recorded history before producing a checkpoint.

By default, training starts from zero weights. Models archived in the episode
are used to replay recorded inference; they are not silently adopted as initial
training weights. To continue a chosen compatible model, supply both
`--initial-checkpoint PATH` and `--initial-checkpoint-sha256 HASH` with that
file's freshly computed SHA-256.

To reproduce the supplied manual fixture, point `--episode` at
`examples/recorded-training/task5/manual/episode.json` (or `task6/manual/episode.json`).
The `model-mcts/` examples instead have an explicitly supplied
`initial-checkpoint.json`; include that file and its hash when comparing against
their expected checkpoint/training records. The portable verifier supplies the
correct recipe for each row automatically.

## Inspect and use the output

Retain `checkpoint.json`, `training.json`, `summary.json` and the input/source
provenance emitted in the new directory. Inspect the count of trained versus
masked/skipped decisions and the final-state status. A skipped blocked or
repeated action is not evidence of new material removal.

Return to the same compatible case, reset as required by its instructions and
load `checkpoint.json` using **Load model weights**. **Run model** and
**Run model + MCTS** are explicit run actions: they select and execute a checked
choice. They are different from the mixed case's suggestion-only controls.
Inspect the resulting accepted state and recording.

Task-5 and task-6 use different checkpoint contracts. Neither accepts the mixed
34-weight model. Incompatibility must reject without replacing accepted stock
or silently substituting a model.

## Verify before using a new download

The committed `examples/recorded-training/` fixtures and portable verifier
exercise both families and their rejection cases:

```powershell
./.venv/Scripts/python.exe python/verify_examples.py --output ./runs/verification-01
```

On Linux use `./.venv/bin/python`. See [validation](VALIDATION_GUIDE.md) for the
full check sequence and [verification status](VERIFICATION_STATUS.md) for retained
candidate results. Synthetic diagnostic training is not held-out evidence for
the produced model and does not establish a completing industrial policy.
