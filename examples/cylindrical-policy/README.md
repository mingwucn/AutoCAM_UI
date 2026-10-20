# Cylindrical policy training

This bounded synthetic full-cycle example includes the exact configuration,
initial snapshot, starting checkpoint and browser decisions. The
[manifest](manifest.json) pins their bytes and original fixture provenance.
The [expected results](expected.json) record the preserved recorded-training
output hashes. It is not an industrial dataset or held-out quality evaluation.

## Train the recorded decisions

Install [the local Python environment](../../docs/INSTALLATION.md). In PowerShell,
from the repository root:

```powershell
$base = './examples/cylindrical-policy'
$configurationHash = (Get-FileHash "$base/task.json" -Algorithm SHA256).Hash.ToLower()
$initialHash = (Get-FileHash "$base/initial.bin" -Algorithm SHA256).Hash.ToLower()
$weightsHash = (Get-FileHash "$base/checkpoint.json" -Algorithm SHA256).Hash.ToLower()
$decisionsHash = (Get-FileHash "$base/download.json" -Algorithm SHA256).Hash.ToLower()
./.venv/Scripts/python.exe python/train_cylindrical_policy.py --configuration "$base/task.json" --configuration-sha256 $configurationHash --initial "$base/initial.bin" --initial-sha256 $initialHash --weights "$base/checkpoint.json" --weights-sha256 $weightsHash --decisions "$base/download.json" --decisions-sha256 $decisionsHash --epochs 4 --learning-rate 0.05 --output ./runs/cylindrical-recorded-01
```

POSIX shell:

```sh
base='./examples/cylindrical-policy'
hash_file() { ./.venv/bin/python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
./.venv/bin/python python/train_cylindrical_policy.py --configuration "$base/task.json" --configuration-sha256 "$(hash_file "$base/task.json")" --initial "$base/initial.bin" --initial-sha256 "$(hash_file "$base/initial.bin")" --weights "$base/checkpoint.json" --weights-sha256 "$(hash_file "$base/checkpoint.json")" --decisions "$base/download.json" --decisions-sha256 "$(hash_file "$base/download.json")" --epochs 4 --learning-rate 0.05 --output ./runs/cylindrical-recorded-01
```

Use a new output directory. Decisions alone do not provide the task contract;
the configuration and original initial snapshot are required. Do not replace
initial material with a later post-turn state.

The expected recorded run has three samples and weights SHA-256
`6e2940e41106d5809acde6a7774d46583b22ba491cfcdec1c0152c983c54455a`.
Outputs include `weights.json`, `training-record.json`, ordinary
`training-decisions.json`, source/input custody, recipe and `result.json`.
Require exit code zero, `status: passed`, `replay_verified: true` and
`inputs_unchanged: true`.

## Self-play and model use

For one seeded MCTS self-play episode, omit both `--decisions` arguments and add
`--seed 19 --simulations 4 --depth 2 --epochs 4`. Retain the same exact input tuple
and choose a new output path. This is a small reproducibility experiment, not
evidence of a better or completing policy.

## Open the prepared case and use your trained model

For the version-1 recorded example, first complete the training command above
and require a passed `result.json`. Then:

1. Open the built candidate in the browser. Expand **Run the adaptive shadow
   gym**, then **Open your prepared task and stock**.
2. Set **Task JSON** to `examples/cylindrical-policy/task.json` and **Initial
   stock snapshot** to `examples/cylindrical-policy/initial.bin`. Choose **Open
   local prepared case**. These are the original configuration and stock used
   for training; do not replace the stock with a later machined state.
3. Use **Model weights** to load the newly produced
   `runs/cylindrical-recorded-01/weights.json`. The file input's accessible label
   is **Machining model weights**. Wait for **Compatible weights loaded.** A
   model from another configuration must reject without changing accepted stock.
4. Choose **Suggest with model + MCTS**. It selects a proposed **Next machining
   choice**; accepted stock, elapsed time and recorded attempts must remain
   unchanged. This route has no separate policy-only button.
5. Choose **Preview machining choice** to inspect the proposed result. Preview
   is read-only. **Apply machining choice** is the explicit action that attempts
   execution; stock changes only if the required checks accept it. A rejected
   attempt can be recorded without removing material.
6. Use **Download decisions** to retain the resulting history. **Reset stock**
   returns to the prepared initial state. An attempt limit or incomplete result
   does not establish whole-part completion.

Use the same sequence for a version-1 self-play result, substituting the
`weights.json` from that successful run. The supplied `checkpoint.json` is a
starting model; it is not the newly trained output.

## Use the verified version-2 and version-3 profiles

Run the cylindrical verifier with its default `--profiles all`, using a new
directory, for example `runs/cylindrical-verification-01`, as shown below. Require
its final `result.json` to pass. `--profiles v1` does not generate or verify the
version-2/version-3 cases.

For each version, repeat the browser steps above with the matching row:

| Version | Task JSON | Initial stock snapshot | Newly trained Model weights |
| --- | --- | --- | --- |
| 1, recorded | `examples/cylindrical-policy/task.json` | `examples/cylindrical-policy/initial.bin` | `runs/cylindrical-verification-01/recorded/weights.json` |
| 2 | `runs/cylindrical-verification-01/profile-2-inputs/task.json` | `runs/cylindrical-verification-01/profile-2/initial.bin` | `runs/cylindrical-verification-01/profile-2/weights.json` |
| 3 | `runs/cylindrical-verification-01/profile-3-inputs/task.json` | `runs/cylindrical-verification-01/profile-3/initial.bin` | `runs/cylindrical-verification-01/profile-3/weights.json` |

Replace the run prefix if you chose another directory. Versions 2 and 3 retain
their original stock as `initial.bin` inside each training run; for these exact
synthetic profiles it is byte-identical to
`examples/cylindrical-policy/initial.bin`. Their `profile-N-inputs/recipe.json`
records the configuration/checkpoint derivation. The matching training run also
retains the exact configuration bytes as `configuration.bin` for custody; use
the `.json` copy in the Task JSON picker.

Version 2 excludes previously accepted choices; version 3 also excludes choices
rejected at the current head. Their task and model contracts must
stay paired. Do not use the version-1 trained weights for a version-2/version-3
task or exchange models merely because the files have the same name.

The version-1 recorded output has a committed expected hash. The derived
version-2/version-3 runs establish the stated replay, input custody and compatible
model-use checks; they do not have committed expected model-output hashes.
These synthetic examples do not establish improved policy quality, industrial
generalization, whole-plan completion or manufacturing qualification.

## Reproduce verification

Windows:

```powershell
./.venv/Scripts/python.exe python/verify_cylindrical_examples.py --output ./runs/cylindrical-verification-01
```

Linux uses `./.venv/bin/python`. The verifier runs the exact recorded reference,
two deterministic seed-19 self-play runs, native learned model loading/read-only
search and rejection checks. It also derives policy configurations 2 and 3 with
the existing checkpoint owner, retains the exact generation recipe and exercises
their self-play/search paths. `--profiles v1` selects only the original profile;
it does not establish versions 2/3. Read the final result and retained failures.

Wrong input hashes, mixed-family weights, coherently rehashed altered decisions
and output overwrite must reject before successful model publication. Native
verification is not an actual browser-worker parity check; that needs its own
receipt.

The packaged native training source and wrapper do **not** emit the later Master
material-transition supplement. The native result's `material_transition_export`
field retains the value `unavailable_in_preserved_v1_runtime`; ordinary replay is
verified. This limitation does not describe the browser's separate **Download
transitions** control. Native training does not establish a transition supplement,
whole-plan completion, model qualification or held-out quality.
