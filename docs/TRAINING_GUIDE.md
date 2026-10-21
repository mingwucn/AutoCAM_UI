# Choose the correct learning workflow

Training runs in local Python. The browser loads models, selects/searches actions
and records decisions. A model only works with its compatible task and feature
contract; a JSON filename does not establish compatibility.

## What you choose, what the rules control, and what learns

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
episode, run the compatible Python trainer, then load its new checkpoint.
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

Operator choices demonstrate actions; they do not redefine the fixed reward or
express free-text preferences. Weights and scores can change while the selected
action stays the same. The supplied mixed A/B comparison intentionally records
that outcome. Held-out model quality, industrial generalization and manufacturing
qualification require separate evidence.
