# Industrial 00350 reach workflow

This isolated prototype uses process, engagement direction and tool reach for
one accepted material transition. Path 1 and a separate greedy sequence are
baselines; Path 2 is the explicitly preferred complete alternative. Drilling,
stock-end cleanup and final finishing remain explicit. Continuous holding is a
prototype assumption, with zero setup changes.

The main application's original industrial and synthetic routes remain
available. The 00289 link opens its existing main application route.

Run the normal repository build. The release contains `reach/index.html`, the
illustrated `reach/guide/index.html`, exact case data and example downloads.
All navigation and screenshot links in the illustrated guide are relative.

## Local training

Use Node.js 24. From the repository root, save a fresh **Download training input**
file from the app at `runs/reach-feedback.json`, then use PowerShell:

```powershell
node --version
$feedbackHash = (Get-FileHash -Algorithm SHA256 -LiteralPath runs/reach-feedback.json).Hash.ToLowerInvariant()
node prototypes/industrial-reach/scripts/train-industrial-setup-episode.mjs --feedback runs/reach-feedback.json --expected-sha256 $feedbackHash --dataset prototypes/industrial-reach/examples/industrial-reach/00350/case.json --output runs/reach-trained-00350
```

Use a new output directory each time. Load its `checkpoint.json` using
**Load industrial model**, reset to original stock, and compare actual policy
and MCTS decisions with the baseline. Suggestions and previews preserve stock;
Apply commits through the same geometry and phase gates used during training.

The supplied labelled example uses 140 simulated cutting transitions and 28,000
TD updates. Path 1/greedy/initial policy use 11 decisions, the labelled policy
uses 20, and trained-model MCTS with 16 simulations and depth 3 uses 18. All reach
the sampled target and listed feature checks. The learned preference ranking
changes; these results do not establish efficiency improvement or exact Path 2
imitation. This is sampled shadow planning, without physical cutter, fixture,
machine-motion or continuous-surface qualification.

`source-pins.json` identifies the retained local prototype source and dataset
bytes. Packaging entry, build hook and guide are separately versioned. The
published training-report projection replaces its machine-specific dataset
path with a relative path; model, feedback and case bytes remain unchanged.
