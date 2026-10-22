# Two industrial cases: rules, preferences, RL and MCTS

Build a baseline sequence action by action, compare it with another complete
sequence, and tell the learner which you prefer. You can also prefer turning or
milling at a state where both kinds have eligible actions. Train locally, load
the resulting case model in the browser, and compare policy and MCTS suggestions.
Preview and explicit Apply remain separate from learning and search.

The working pair is **3-29-00350** (`industrial`) and **3-29-00289**
(`industrial_00289`). The second case comes from the existing two-entry
industrial catalogue; only 00350 was originally named. Both use pinned sampled
geometry. This route does not accept arbitrary industrial CAD. The
[synthetic learning workflow](OPERATOR_INPUT_QUICKSTART.md) remains available
with its separate fixed reward, task and checkpoints.

## 1. Open a case and generate the rule baseline

Open [00350](../index.html?case=industrial&process=turning#gym) or
[00289](../index.html?case=industrial_00289&process=turning#gym), or
[build and serve locally](INSTALLATION.md). Record the displayed build identity.
Select **Reset stock**, then **Generate rule baseline** in the industrial
learning panel. The baseline is built from initial stock through the same simulator,
one accepted action at a time. Retain the sequence and each decision reason.

The baseline first uses productive turning, then milling. Within that process
it selects the greatest current sampled removal, breaking ties by shorter reach
then action ID. These are software heuristics based on the existing staged
geometric comparator. The simulator still checks availability, current stock,
target and holding masks. These heuristics are not company-qualified rules.

Use **Download rule baseline** to retain its replayable episode. **Show rule
baseline** opens replay only. **Preview next baseline action** selects the next
checked action; use the existing Apply control to accept that one action.
A baseline calculation does not apply cuts to live stock. **Play greedy
baseline** is the existing playback comparator. Camera changes, preview and
playback are not new accepted actions. A replayed or generated sequence is not
itself a preference label or a trained model.

## 2. Keep a complete alternative and give explicit feedback

Create the supplied alternatives first if you want a ready-to-load comparison:
run the two `prepare-industrial-learning-example.mjs` commands in Section 3.
Each new output directory contains `baseline.json` and `alternative.json`.
In the matching case select **Load sequence alternative** and choose that case's
`alternative.json`. Loading an alternative validates it without replacing live
stock. Alternatively, record your own completing sequence through the existing
Apply controls and select **Save my sequence as alternative**.

With a baseline and complete alternative retained, choose **Preferred whole
sequence**: **My alternative sequence** or **Rule baseline**. Then select
**Add whole-sequence preference**. The label binds those exact alternatives;
it does not declare every constituent action generally preferable.

For an action-kind label, return to a state with productive turning and milling
choices (Reset stock provides the reference starting state). Choose **Preferred
action kind**: **Milling over Turning** or **Turning over Milling**. Select
**Add action-kind preference**. This label binds the current accepted prefix
and case. It cannot make an unavailable, exhausted or protected-stock action
eligible. The label is checked at this anchor, but the shared case model can
affect suggestions at other states of the same case. There is no free-text,
general-purpose or cross-case preference.

Select **Download industrial feedback**. Retain the original JSON unchanged;
for the commands below save it as `runs/industrial-input/feedback.json` in the
local checkout. Demonstrations supply experience; the explicit comparison
controls supply preference labels. The trainer validates both separately.
**Clear preference labels** removes current labels. Reset stock preserves
baseline, alternative, labels and model so you can compare from initial stock;
changing case starts separate case-specific learning-panel state.

The existing 00350 three-cut geometry reference remains useful: outside turning
40 mm, milling −Z 80 mm, then milling +Z 40 mm gives sampled excess
**388600 → 286750 → 33236 → 0 mm³**. A different completing sequence can be a
valid feedback alternative. Sampled zero excess is not a physical part-release
or quality certificate.

<a id="industrial-local-training"></a>

## 3. Acquire exact inputs and fine-tune locally

Use Node.js 24 and the source checkout from [installation](INSTALLATION.md).
This industrial trainer uses the same JavaScript simulator as the browser.
The Python environment is for the separate Python learning families.

```text
node --version
node scripts/fetch-industrial-learning-data.mjs --case all
```

The downloader checks original byte hashes and sizes before accepting a cache:

| Case | Dataset file | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| 00350 | `.test-data/cases/industrial/case.json` | `f20d5673d8cfd9021604b6b80dda59384a7e65ef5ef45adc54162308ff53245a` | 8,058,296 |
| 00289 | `.test-data/cases/industrial_00289/case.json` | `0f375401f5cfe0e19e00aed12e235810ec8f54e928fb5c774fc8ffbdcea0dbb0` | 4,476,422 |

On PowerShell:

```powershell
$feedbackHash = (Get-FileHash -LiteralPath './runs/industrial-input/feedback.json' -Algorithm SHA256).Hash.ToLower()
node scripts/train-industrial-episode.mjs --feedback ./runs/industrial-input/feedback.json --expected-sha256 $feedbackHash --output ./runs/industrial-trained-01
```

On Linux:

```sh
feedback_hash=$(sha256sum ./runs/industrial-input/feedback.json | cut -d ' ' -f 1)
node scripts/train-industrial-episode.mjs --feedback ./runs/industrial-input/feedback.json --expected-sha256 "$feedback_hash" --output ./runs/industrial-trained-01
```

Always use a new output directory. Optional `--dataset FILE` must contain the
selected case's exact pinned bytes. To continue from an existing model, supply
both `--initial-checkpoint FILE` and `--initial-checkpoint-sha256 HASH`. The
checkpoint must match the case and model contract; 00350, 00289 and synthetic
checkpoints are incompatible with one another.

Successful output contains `feedback.json`, `initial-checkpoint.json`,
`checkpoint.json` and `training-report.json`. Preserve them together. The trainer
verifies byte identity, schemas, scope and complete replay before any learning.
A new hash does not make a tampered or impossible history valid. Failure must
publish no usable checkpoint; an existing output directory is never overwritten.
The trainer records source hashes before loading the core and checks them again
after training, before publishing output. Use a fresh Node.js process for each
CLI run. API callers must keep module source files unchanged for the process
lifetime because loaded JavaScript modules are cached.

[Selected two-case example files](../examples/industrial-learning/README.md)
include loadable complete alternatives and initial/updated checkpoints. To
regenerate the supplied comparison locally, generate one case at a time:

```text
node scripts/prepare-industrial-learning-example.mjs --case industrial --output runs/industrial-example-00350
node scripts/prepare-industrial-learning-example.mjs --case industrial_00289 --output runs/industrial-example-00289
```

Each directory includes `baseline.json`, `alternative.json`, the feedback
bundle, initial/updated checkpoints and `comparison.json`. These are
reproducibility inputs/results. They do not establish independent user acceptance.

## 4. What reward learning and RL do

The initial reward starts from sampled excess removed divided by initial excess.
Whole-sequence comparisons use discounted sums of declared per-action features;
action-kind labels compare process indicators. Pairwise logistic fitting learns
a bounded soft reward from those labels. Then TD Q updates fine-tune a linear
action-value model on replayed demonstrations and simulator exploration.
The default recipe uses **200 reward-fitting epochs**, **200 TD-Q epochs**,
**12 simulator exploration episodes**, reward learning rate **0.1**, TD learning
rate **0.05**, discount **0.95**, TD-error clip **1** and seed **350289**. The
[industrial contract](INDUSTRIAL_LEARNING_CONTRACT.md) gives the ordered
features, constraints, loss, equations and allowed parameter ranges. The local
trainer accepts explicit options; retain the exact configuration in its report.

Hard action, holding, target and stock checks apply throughout. Preferences do
not override them. No machining-time, surface-finish or tool-life measurements
are supplied. Learning may change the preferred ordering or selected action
where alternatives exist; it need not change every recommendation. Compare
actual selected actions and sequences, as well as reward/loss and weight changes.
A weight update alone is not evidence of a behavioral improvement.

## 5. Load the matching model and compare policy suggestions

1. Return to the same case and Reset stock to compare from initial stock.
2. Select **Use initial model**, then **Suggest industrial policy**. Retain its
   process, action and current state. You can also load the retained
   `initial-checkpoint.json` through **Load industrial model**.
3. Use **Load industrial model** for the new `checkpoint.json`, then
   **Suggest industrial policy** from the same
   accepted state. Inspect what changed and what remained the same.
4. Select **Preview suggested action**. Stock/history must stay unchanged.
5. Use the existing **Apply** control to accept one current checked action.

Reset before comparing another model at the initial state. Comparing different
accepted stocks does not isolate the effect of feedback. A failed import must
preserve the previous model and accepted history. A correct filename alone
does not establish compatibility.

The [illustrated two-case walkthrough](ILLUSTRATED_MODULE3_MANUAL.md#industrial-browser-walkthrough)
shows the actual feedback, local report, model loading, MCTS and first accepted
action for each case. Its [browser receipt](verification/industrial-learning/README.md)
keeps the tested development build and model identities explicit.

## 6. Use model-guided MCTS and evaluate each case

With the matching model loaded, select **Search industrial MCTS** using the displayed
simulation and depth settings (default **16 simulations**, **depth 2**;
exploration is **1**). MCTS searches through the same
simulator using learned reward/value guidance. It does not update weights or
commit live stock. Preview the suggestion, then explicitly Apply if desired.

**Cancel industrial computation** stops pending work. Reset, case/history/model changes invalidate earlier
results; request a fresh suggestion for the current state. Retain accepted state
identities before and after policy/search to verify that suggestions are read-only.

For each case compare the rule baseline, initial model, fine-tuned model and
model-guided MCTS from the same initial stock with comparable budgets. Retain
sequence identity, completion, sampled removal and preference scores. Include
both changed and unchanged choices. The report must distinguish feedback effect
from plan quality; neither sampled completion nor a changed choice establishes
manufacturing qualification or generalization to another part.

## Recovery and verification

| Situation | Recovery |
| --- | --- |
| Industrial learning controls are absent | Select the exact supported 00350 or 00289 case and check build identity |
| Baseline or comparison is incomplete | Inspect the blocked/truncated state; complete alternatives are required for whole-sequence labels |
| No eligible alternative action kind | Move to a valid comparison state; do not invent or force an action-kind label |
| Dataset/feedback hash or replay mismatch | Return to original files and exact case bytes; do not patch identities to bypass rejection |
| Wrong-case or malformed model | Use the matching case checkpoint; the previous model and accepted stock remain |
| Existing output directory | Keep the old result and choose a new output name |
| Search cancelled or made stale | Confirm accepted stock and request a new suggestion |
| Complete stock or no productive action | Save the result or Reset stock; exhausted actions cannot create progress |

[Verification status](VERIFICATION_STATUS.md) identifies the actual executed
checks for the release. Historical 23-family and three-cut geometry results are
separate from this new two-case learning route. Independent human acceptance and
manufacturing qualification remain unperformed unless explicitly recorded.
