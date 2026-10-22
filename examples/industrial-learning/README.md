# Two-case industrial preference-learning examples

These are selected reproducible software examples for pinned sampled
**3-29-00350** (`industrial`) and **3-29-00289** (`industrial_00289`). The second
case is the working choice from the existing industrial catalogue. The
[industrial learning guide](../../docs/INDUSTRIAL_LEARNING_QUICKSTART.md) is the
main user workflow; the [contract](../../docs/INDUSTRIAL_LEARNING_CONTRACT.md)
defines schemas, features, numerical defaults and algorithms.

The supplied labels are **illustrative scripted preferences**, selected to
oppose the initial removal model's first action where legal alternatives exist.
They are not a human's feedback or an independent-user acceptance result.
Actual UI-downloaded feedback and browser-training receipts are recorded
separately. You can make your own labels through the application's explicit
whole-sequence and turning/milling controls.

## Select one exact-case input set

| File | 00350 | 00289 | Purpose |
| --- | --- | --- | --- |
| Rule baseline | [baseline.json](industrial/baseline.json) | [baseline.json](industrial_00289/baseline.json) | Complete turning-before-milling sequence, built action by action with state identities and rule reasons |
| Complete alternative | [alternative.json](industrial/alternative.json) | [alternative.json](industrial_00289/alternative.json) | Complete milling-before-turning comparator; load with **Load sequence alternative** without changing live stock |
| Explicit feedback | [feedback.json](industrial/feedback.json) | [feedback.json](industrial_00289/feedback.json) | Exact episodes, whole-sequence preference and case-scoped action-kind label |
| Initial checkpoint | [initial-checkpoint.json](industrial/initial-checkpoint.json) | [initial-checkpoint.json](industrial_00289/initial-checkpoint.json) | Compatible initial normalized-removal reward and action-value model |
| Fine-tuned checkpoint | [checkpoint.json](industrial/checkpoint.json) | [checkpoint.json](industrial_00289/checkpoint.json) | Learned preference reward and TD-Q-fine-tuned action values for this case |
| Comparison | [comparison.json](industrial/comparison.json) | [comparison.json](industrial_00289/comparison.json) | Baseline/alternative, initial/updated policy sequences and model-guided MCTS under stated budgets |

Models, feedback and episodes are case-specific. A 00350 checkpoint cannot load
into 00289 or a synthetic case. The raw sampled datasets and original CAD are
not bundled in this example directory. Acquire exact original bytes with:

```text
node scripts/fetch-industrial-learning-data.mjs --case all
```

The downloader pins AutoCAM_Data catalogue commit
`a2965f894440d202fad749be9a8ef1205a25d50d` and verifies raw byte hashes/sizes.
Parsed dataset and action-catalogue identities independently bind the model.
Do not exchange same-named files between the two case directories.

## Reproduce and inspect

From the source checkout with Node.js 24, generate each example into a new
output directory:

```text
npm run prepare:industrial-example -- --case industrial --output runs/industrial-example-00350
npm run prepare:industrial-example -- --case industrial_00289 --output runs/industrial-example-00289
```

The generator replays both complete sequences, creates explicit illustrative
labels, fits a bounded pairwise preference reward, then fine-tunes a linear
Q model using demonstrations and simulator exploration. Keep the original
feedback, recipe, initial/updated models and local training report. The selected
public files above omit local training reports and test-output directories.
Never overwrite an existing output or edit a reference to make replay pass.

In the matching industrial case:

1. Reset stock and select **Generate rule baseline**. Inspect each rule reason.
2. Use **Load sequence alternative** with that case's `alternative.json`.
3. Select your preferred whole sequence and **Add whole-sequence preference**.
   At initial stock, select turning or milling and **Add action-kind preference**.
4. **Download industrial feedback**, then fine-tune that actual file using the
   [local trainer](../../docs/INDUSTRIAL_LEARNING_QUICKSTART.md#3-acquire-exact-inputs-and-fine-tune-locally).
5. At the same initial stock, compare **Use initial model** with **Load industrial
   model** for the new checkpoint. Request **Suggest industrial policy** for each.
6. Compare **Search industrial MCTS** using **16 simulations**, **depth 2** and
   **exploration 1**. Inspect expanded versus eligible root actions; the bounded
   search need not expand every eligible action. Preview and explicitly Apply
   only the action you want to accept.

The supplied `comparison.json` holds the complete sequence identities,
completion/residual summaries and actual MCTS budgets. Read actual first-action
and full-sequence differences, including unchanged recommendations. The local
training report additionally compares preference-aware TD with matched-experience
TD that omits preference fitting; this distinguishes a feedback choice effect
from an update caused by TD training alone.

## Recorded example comparison

These selected files use `industrial-removal-process-2` with seven features and
the default 200 reward-fitting / 200 TD-Q epochs, 12 exploration episodes and
seed 350289. Both supplied bundles explicitly prefer the rule baseline and
Turning over Milling at initial stock. These are scripted example labels.

Every sequence below completes with **0 mm³ sampled excess**. Within each case,
all six are evaluated under that case's **same fine-tuned reward** and discount
0.95; returns are rounded to six decimals. Returns from separately fitted cases
are not a common physical-quality scale.

| Sequence | 00350 actions | 00350 learned return | 00289 actions | 00289 learned return |
| --- | ---: | ---: | ---: | ---: |
| Rule baseline | 3 | 1.925897 | 3 | 4.368131 |
| Complete alternative | 2 | 0.947194 | 3 | 0.900728 |
| Initial policy | 2 | 0.947194 | 3 | 0.900728 |
| Fine-tuned policy | 3 | 1.925897 | 3 | 4.369007 |
| Initial-model MCTS | 2 | 0.894685 | 3 | 0.900728 |
| Fine-tuned MCTS | 8 | 1.924920 | 6 | 4.368860 |

Each MCTS choice uses 16 simulations, depth 2 and exploration 1. At initial stock,
only 4 of 136 eligible root actions are expanded in both cases. The 00350 MCTS
sequence takes eight actions and has a lower learned return than its three-action
rule baseline. The 00289 six-action MCTS return is below its three-action policy.
Bounded search does not guarantee a better plan or fewer actions.

At initial stock, both initial policies and matched-experience TD without
preference fitting select milling. With the combined explicit labels, the
fine-tuned policy selects outside turning at **40 mm** for 00350 and **20 mm**
for 00289. Both reports record `actual_feedback_choice_changed: true` against
that matched comparison. Choices remain unchanged after baseline prefixes of
one and two actions in 00350, and after two actions in 00289. Individual feedback
channels or other recipes may leave choices unchanged; the contract records
that limitation.

The exact fine-tuned checkpoint SHA-256 values are:

```text
00350 b9789b503f8381b560f263a7ec2e64a46eb29e1f2b5d221e85c825d87bab60f2
00289 9ff9af4688116ff1489a2f97eb7f5234718327ab46df68ea481d941ff3e04012
```

The per-case `comparison.json` links each return to its episode and reward
checkpoint identity, retains all ordered actions and per-action search budgets,
and records changed and unchanged baseline-prefix recommendations. The actual
UI-download/training walkthrough has its own feedback and checkpoint identities;
these selected examples do not stand in for that browser receipt.

A weight change, increased fitted preference probability or changed choice
alone is not a general improvement claim. Reusing these inputs for fitting
prevents treating them as held-out performance evidence. Baseline rules are
software heuristics; all hard action, target, holding and stock checks remain.
Sampled removal/completion does not measure machining time, surface finish,
tool life, physical part release or manufacturing qualification. Independent
human acceptance remains separate. Synthetic learning stays available in the
[mixed examples](../operator-input/README.md). Video is deferred.
