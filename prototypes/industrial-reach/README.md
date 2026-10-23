# Reusable Results V2 — Module 3

This isolated prototype uses process, engagement direction and tool reach for
one accepted material transition. Path 1 and a separate greedy sequence are
baselines; Path 2 is the explicitly preferred complete alternative. Drilling,
stock-end cleanup and final finishing remain explicit. Continuous holding is a
prototype assumption, with zero setup changes.

The main application's original industrial and synthetic routes remain
available. The 00289 link opens its existing main application route.

Run the normal repository build. The release contains `rrv2_module3/index.html`, the
illustrated `rrv2_module3/guide/index.html`, exact case data and example downloads.
The former `reach/` address remains compatible. Internal `industrial-reach`
source, dataset and model identifiers are unchanged.
All navigation and screenshot links in the illustrated guide are relative.

The [recorded v10 walkthrough](guide/index.html#fresh-recording) includes
untouched live screenshots, the two actual browser trainings, model file round
trips, checked policy/MCTS episode restores and separately labelled derived
numerical tables. Its [downloads](guide/index.html#fresh-downloads) retain the
raw browser files, path-free comparison and a file inventory with exact hashes.

Current controls are described [before the recording](guide/index.html#drilling-controls).
**Preview next action** selects an executable cut from accepted stock without
applying it. Apply requires positive removal and the current phase gates;
short selected reaches remain visible with an explanation. Sequence replay and
loading alternatives preserve accepted stock; **Restore industrial decisions**
explicitly adopts a checked recording. The source bore is `00350-bore-z-24`,
Ø24 mm and 23 mm deep; modeled reach is measured from the original stock
reference. The logical bore guide does not model a physical cutter or holder.

## Browser training

In **Train from saved sequences**, check the saved sequences and explicit
preference labels, leave **Starting model → Initial model**, then choose
**Train model**. Training runs locally in the browser; sequences and preferences
are not uploaded. Progress reports each stage. Cancel preserves the previous
model, accepted stock and saved feedback. A successful checked model loads
automatically as **Browser-trained model**. Download its loaded checkpoint,
training report and exact training input before comparing fresh rollouts.

Reset stock before each baseline, initial-policy, trained-policy or trained-MCTS
rollout. Use **Load industrial model** to reload the downloaded result.

For a controlled experience comparison, first train Run A from Initial using
Path 1, Greedy, Path 2 and the explicit Path 2-over-Path 1 preference. Download
its exact input, checkpoints, report and inference comparison. Then generate
random seed 350289 as separate saved experience, preserve those labels, and
train Run B from Initial again. Keep Run B downloads separately. Random
generation does not add a preference. **Compare before / after** retains the
exact model pair for each completed training; the same-state rows compare
choices along the before policy. The Run B view compares Initial to Run B,
while A-versus-B policy results isolate the added experience.

## Optional Node.js reproduction

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

The supplied historical labelled example uses 140 simulated cutting transitions and 28,000
TD updates. Path 1/greedy/initial policy use 11 decisions, the labelled policy
uses 20, and trained-model MCTS with 16 simulations and depth 3 uses 18. All reach
the sampled target and listed feature checks. The learned preference ranking
changes; these results do not establish efficiency improvement or exact Path 2
imitation. This is sampled shadow planning, without physical cutter, fixture,
machine-motion or continuous-surface qualification.

`source-pins.json` identifies the 43 current runtime, trainer and dataset inputs,
with the v11 drilling display and next-action corrections. `source-pins-v10.json`
retains the recording closure for the illustrated random-experience walkthrough;
its screenshots and numerical records have not been rebound to the current UI.
`source-pins-v9.json`
retains the browser Train version before random experience. `source-pins-v8.json`
retains the earlier runtime identity used for the historical supplied example. Packaging entry, build hook and guide are separately versioned. The
published training-report projection replaces its machine-specific dataset
path with a relative path; model, feedback and case bytes remain unchanged.
