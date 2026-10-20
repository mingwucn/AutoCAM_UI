# Choose the correct learning workflow

Training runs in local Python. The browser loads models, selects/searches actions
and records decisions. A model only works with its compatible task and feature
contract; a JSON filename does not establish compatibility.

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
