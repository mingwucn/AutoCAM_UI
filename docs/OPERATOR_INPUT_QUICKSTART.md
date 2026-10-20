# Mixed operator learning: record, train and load

This route uses a synthetic turning/face-milling/drilling task and a compatible
34-weight model. The industrial 00350 sampled view is a separate manual/greedy
demonstration. See [the training family guide](TRAINING_GUIDE.md) if your download
comes from task-5 or task-6.

## Record choices in the browser

1. Build and serve the candidate using [installation](INSTALLATION.md). At
   <http://127.0.0.1:8080/>, select **Synthetic learning gym: turning, face milling
   and drilling; local weights and recorded actions**, then **Open case**.
2. Choose an available action, select **Preview checked action**, inspect the
   preview, then **Accept checked action**. Preview alone does not change stock.
3. For the six-step reference: turn to radius 13.5 mm, transfer to the 15 mm face
   tool, index 180 degrees, face mill, exchange to the long drill, then drill.
4. Example A uses 9 mm facing stepover; B uses 4 mm. These are different motion
   choices, not a surface-quality or safety comparison.
5. Select **Download learning decisions**. Keep the exact downloaded file; its
   schema must be `adaptive-mixed-learning-episode-1`. Download run details too
   when retaining a browser verification record.

Preparation/replay can take time. Wait for the status message to clear before
the next action. If cancelled, use **Recover completed actions** when offered;
an interrupted result must not become an accepted cut.

## Reproduce supplied example A

Install the local Python environment in [installation](INSTALLATION.md).
Run from this repository root. Windows PowerShell:

```powershell
$episode = './examples/operator-input/operator-A.json'
$model = './examples/operator-input/starting-checkpoint.json'
$episodeHash = (Get-FileHash -LiteralPath $episode -Algorithm SHA256).Hash.ToLower()
$modelHash = (Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLower()
./.venv/Scripts/python.exe python/train_operator_episode.py --episode $episode --expected-sha256 $episodeHash --initial-checkpoint $model --checkpoint-sha256 $modelHash --output ./runs/operator-A-01
```

Linux/POSIX shell:

```sh
episode='./examples/operator-input/operator-A.json'
model='./examples/operator-input/starting-checkpoint.json'
episode_hash=$(./.venv/bin/python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$episode")
model_hash=$(./.venv/bin/python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$model")
./.venv/bin/python python/train_operator_episode.py --episode "$episode" --expected-sha256 "$episode_hash" --initial-checkpoint "$model" --checkpoint-sha256 "$model_hash" --output ./runs/operator-A-01
```

For B, change `operator-A.json` to `operator-B.json` and use a new output directory.
For your own recording, set the episode path to its actual downloaded filename
and recompute the hash. Use the same initial checkpoint when comparing inputs.
Its SHA-256 is `b84e9c965bacf7249a84093c77c070391130a02ab0fa5bfed7cc75ca5c5cc5f4`.

The launcher replays before updating with learning rate 0.05, discount 1 and
error clip 1. It retains `episode.json`, `initial-checkpoint.json`,
`checkpoint.json`, `training.json` and `summary.json`. Existing output directories
refuse overwrite. Expected A/B results are in
[the results guide](../examples/operator-input/README.md); the portable verifier
in [validation](VALIDATION_GUIDE.md) checks them.

## Load and compare

Use **Reset to initial stock**, then **Load learning model** to select the new
`checkpoint.json`. Request **Suggest with policy** or **Search with MCTS**.
For the published comparison use 16 simulations, depth 2 and exploration 1 for
each model. Suggestions leave accepted stock unchanged; preview and explicitly
accept a checked action if you want to execute it.

At initial stock the reference policy selects action 0 and MCTS selects action 1.
At the common before-facing state, both select action 8. Starting, A and B models
have identical selected actions at those two states despite changed weights.
This is the documented outcome; do not infer a better policy from weight changes.

The learner uses a fixed progress/time reward. Demonstrations express action
choices, not free-text intent. Models use `adaptive-mixed-linear-q-1`; task-5,
task-6 and other checkpoint families are incompatible. Results remain synthetic
and unqualified for industrial parts.
