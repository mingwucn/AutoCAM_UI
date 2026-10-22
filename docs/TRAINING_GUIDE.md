# Choose the correct learning workflow

Start with [industrial rules, preferences and RL](INDUSTRIAL_LEARNING_QUICKSTART.md)
for the two pinned sampled cases, 3-29-00350 and 3-29-00289. Generate a rule
baseline, retain a complete alternative and label which whole sequence or action
kind you prefer. Fine-tune locally with Node.js 24, load the matching case model,
then preview and explicitly Apply a policy/MCTS suggestion.

Synthetic and adaptive trainers remain available in local Python with their own
fixed reward and model contracts. A model only works with its compatible task,
features and context. Industrial checkpoints are separate for each exact case.

## What the industrial learning stages do

| Stage | Input and purpose | What changes |
| --- | --- | --- |
| Hard checks | Current stock, available catalogue actions, target and holding masks | Only eligible positive-removal actions can be used; preferences cannot relax checks |
| Rule baseline | Productive turning before milling, greatest sampled removal, shorter-reach/action-ID ties | A full sequence is built action by action with state and reason records; no weights are trained |
| Demonstration | Accepted actions you chose in the simulator | Supplies experience; your choices alone do not create an A-versus-B label |
| Explicit feedback | Two complete sequences with a preferred one, or turning/milling preference at a valid case/state | Creates scoped preference labels; no free-text, general or cross-case preference is inferred |
| Reward learning | Replay-verified feedback and declared reward features | Pairwise logistic fitting updates a bounded soft reward, starting from normalized sampled removal |
| RL fine-tuning | Demonstrations and simulated exploration under that reward | TD Q updates change a linear action-value checkpoint |
| Browser policy | Compatible case checkpoint and current accepted state | Scores eligible actions and suggests one; accepted stock stays unchanged |
| Model-guided MCTS | Same simulator, compatible reward/value model and bounded budget | Searches sequences and suggests one action; it does not train weights or accept a cut |
| Preview and Apply | Current suggested action, inspected by the user | Preview is read-only; explicit Apply uses the existing checked cut path |

A kind label is validated at its recorded anchor; learned coefficients may
affect other states of that same case. The
[industrial contract](INDUSTRIAL_LEARNING_CONTRACT.md) specifies feature order,
loss, updates and numerical defaults. No measured machining-time, surface-finish
or tool-life objective is supplied. A preference can affect order or choice
where legal alternatives exist. Hard constraints can leave the recommendation
unchanged. The comparison report separates changed weights, changed selected
actions and unchanged choices; none alone establishes general plan quality.

## Synthetic workflow: what you choose, what the rules control, and what learns

**You choose the demonstration. Existing checks determine which actions are
allowed. The selected task's reward defines what training tries to improve.**
These roles are separate:

| Part | Meaning for the mixed operator-learning workflow |
| --- | --- |
| Geometric/tool checks | Determine available actions. Learned scores cannot authorize a blocked action. |
| Your recording | Supplies the checked actions you chose and their actual simulated outcomes. You can choose tools, order and exposed parameters such as facing stepover. |
| Fixed reward | Rewards progress/completion and charges synthetic time, with repeat/no-op/excess penalties. Choosing a demonstration does not redefine that objective. |
| Local training | Replays the recording and updates a 34-weight linear action-value model. It learns action scores under the fixed reward; it does not simply copy every choice. |
| Browser model use | Loads the resulting checkpoint to score/search available actions. In the mixed UI, you still preview and explicitly accept the suggestion. |

**Recording is not training.** Accept actions in the browser, download the
episode, run the compatible local trainer, then load its new checkpoint.
The browser does not update the weights just because you accepted a cut.

You may demonstrate the solution you prefer **within the exposed checked
choices**. There is currently no A-versus-B preference label, free-text intent
input, or user setting that makes surface quality or tool life the training
objective. These features must not be inferred from the ability to choose an
action. Different task families have their own reward and model contracts; do
not apply the mixed reward or checkpoint to every row below.

For a concrete example, mixed demonstration A uses 9 mm facing stepover and B
uses 4 mm. Their synthetic whole-sequence costs are 161.6 and 228.4 seconds.
Recording B does not teach that smaller stepover is inherently better: the
existing reward still charges its longer time, and this example has no measured
surface-quality objective. Both training runs changed weights, but the tested
recommendations remained the same. See [the A/B results](../examples/operator-input/README.md).

For the full illustrated explanation and exact five-step flow, read
[Section 5 of the illustrated manual](ILLUSTRATED_MODULE3_MANUAL.md#training-overview).

## Select the matching trainer

| Your downloaded episode | Local route | Browser use |
| --- | --- | --- |
| Industrial 00350 or 00289 feedback bundle, exact pinned case | [Industrial learning](INDUSTRIAL_LEARNING_QUICKSTART.md), Node.js 24 `scripts/train-industrial-episode.mjs --feedback ...` | Load the matching case model, request policy/MCTS, preview, then explicitly Apply |
| `adaptive-mixed-learning-episode-1` | [Mixed operator learning](OPERATOR_INPUT_QUICKSTART.md), `python/train_operator_episode.py` | Load learning model, request policy/MCTS suggestion, preview, then accept |
| `adaptive-browser-episode-1` containing task-5 | [Recorded training](RECORDED_TRAINING_QUICKSTART.md), `python/train_recorded_remaining.py` | Load compatible task-5 weights; Run model / Run model + MCTS explicitly executes a checked choice |
| `adaptive-browser-episode-1` containing task-6 | [Recorded training](RECORDED_TRAINING_QUICKSTART.md), same launcher with task dispatch | Load compatible task-6 weights; Run model / Run model + MCTS explicitly executes a checked choice |
| Regional v2 or v3 recorded episode | [Regional training](REGIONAL_TRAINING_QUICKSTART.md), `python/train_recorded_regional.py` with explicit task version | Load only the matching prepared-task/model family; search then explicitly apply |

For cylindrical learning and other prepared families, consult
[the training-family inventory](TRAINING_FAMILIES.md) and
[the capability table](CAPABILITIES.md).
Model inference in a case does not imply that its local training route is
packaged here. A separately required trainer must have its own exact source,
dependencies and compatible examples; the mixed/task-5/task-6 launchers do not
accept unrelated episode schemas.

First follow [installation](INSTALLATION.md), then reproduce a supplied example
before training a new download. Preserve the original episode, its SHA-256,
starting checkpoint, recipe and result. Do not modify the reference episodes.

## How to interpret learning

The learner replays the recorded history before updating weights and respects
the pre-action mask. Recorded rejected or repeated actions are not automatically
enabled learning samples. A truncated episode is not a completed plan.

For the synthetic routes, operator choices demonstrate actions; they do not
redefine the fixed reward or express free-text preferences. Industrial explicit
labels use the separate reward-learning path described above. Weights and scores can change while the selected
action stays the same. The supplied mixed A/B comparison intentionally records
that outcome. Held-out model quality, industrial generalization and manufacturing
qualification require separate evidence.
