# Regional recorded training: v2 and v3

Use this route for a compatible regional episode. Version 2 uses its 48-feature
regional contract; version 3 uses its separate 50-feature completion-objective
contract. They do not accept each other's checkpoints or the mixed/task-5/task-6
models. The [family inventory](TRAINING_FAMILIES.md) separates these routes.

Install the [Python environment](INSTALLATION.md), then run a supplied v2 example
from the repository root. Windows PowerShell:

```powershell
$episode = './examples/recorded-training/regional-v2/episode.json'
$episodeHash = (Get-FileHash -LiteralPath $episode -Algorithm SHA256).Hash.ToLower()
./.venv/Scripts/python.exe python/train_recorded_regional.py --episode $episode --expected-sha256 $episodeHash --task-version 2 --output ./runs/regional-v2-01
```

Linux/POSIX shell:

```sh
episode='./examples/recorded-training/regional-v2/episode.json'
episode_hash=$(./.venv/bin/python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$episode")
./.venv/bin/python python/train_recorded_regional.py --episode "$episode" --expected-sha256 "$episode_hash" --task-version 2 --output ./runs/regional-v2-01
```

For v3, select `regional-v3/episode.json`, `--task-version 3`, and a new output
directory. Both supplied examples have three trained updates. Compare
`checkpoint.json` and `training.json` to the matching expected files; the portable
verifier in [validation](VALIDATION_GUIDE.md) performs the comparison.

The default is zero starting weights. To continue an explicit compatible model,
provide both `--initial-checkpoint PATH` and `--checkpoint-sha256 HASH`. Defaults
are learning rate 0.05, discount 1 and error clip 1. Every episode is replayed
before fitting, and the exact original episode and source/input records are kept.
An existing output directory refuses overwrite.

## Use a learned model

The supplied regional folders include the exact prepared pair. For v2:

1. Open the built candidate and select **Run the adaptive shadow gym**. Expand
   **Open your prepared task and stock**.
2. Set **Task JSON** to `examples/recorded-training/regional-v2/task.json` and
   **Initial stock snapshot** to `examples/recorded-training/regional-v2/initial.bin`.
   Choose **Open local prepared case**. Use both files from the same version.
3. In **Mill-turn shadow gym**, use **Model weights** to load the newly trained
   `runs/regional-v2-01/checkpoint.json`. A rejected model must leave the accepted
   stock intact. The example's `expected-checkpoint.json` is the reference for
   comparison, not a substitute for the result of your training run.
4. Choose **Suggest with model + MCTS**. The suggestion changes the selected
   candidate; stock, elapsed time and recorded action count must stay unchanged.
   **Preview selected action** is also read-only. This UI exposes the combined
   model/MCTS suggestion, not a separate policy-only button.
5. Only **Apply mill-turn action** executes a checked selected action. If the
   selected action is blocked, the UI instead offers **Record rejected attempt**;
   that recording is not machining progress. **Reset stock** returns to the
   initial state. **Download decisions** retains the actual result.

For v3, use both files under `regional-v3/` and the checkpoint produced with
`--task-version 3`. These task files are deterministic projections of their
committed episodes; each folder's `prepared-inputs-provenance.json` records the
source episode hash, canonical serialization owner, derivation and output hashes.
No Master checkout or external CAD file is required for these synthetic cases.

The versioned native and worker interfaces support compatible model inference.
Fresh verification must still identify the exact prepared input and UI path;
native replay alone is not a browser acceptance receipt. A model trained on these
synthetic examples is not a model for an arbitrary uploaded industrial part.

The packaged native training wrapper does not emit a material-transition
supplement. This is separate from the browser's **Download transitions** control.
Retain incomplete/truncated outcomes; successful replay and numerical updates
do not establish whole-task completion, policy improvement or qualification.
