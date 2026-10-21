# Operator demonstration results

Two six-step demonstrations use the same synthetic task, initial checkpoint and fixed learning recipe. Both complete the constructed material requirements. Costs below are synthetic seconds; they are not manufacturing measurements.

| Demonstration | Facing stepover | Facing cost | Full demonstrated cost | Changed weights | Replay |
| --- | --- | --- | --- | --- | --- |
| A | 9 mm | 65.4 s | 161.6 s | 28/34 | verified |
| B | 4 mm | 132 s | 228.4 s | 28/34 | verified |

Starting checkpoint SHA-256: `b84e9c965bacf7249a84093c77c070391130a02ab0fa5bfed7cc75ca5c5cc5f4`. Recipe: one pass, learning rate 0.05, discount 1, error clip 1. The existing local TD Q learner replays the input before updating weights.

## Suggestions at identical states

Compare the starting model with the A and B checkpoints at initial stock and the common state after turning, transfer and indexing. MCTS uses 16 simulations, depth 2 and exploration 1. These are selected suggestions, not a full rollout or policy evaluation.

| State | Model | Policy suggestion | MCTS suggestion |
| --- | --- | --- | --- |
| initial-stock | starting | turn, 10.5 s (action 0) | turn, 10.25 s (action 1) |
| initial-stock | A | turn, 10.5 s (action 0) | turn, 10.25 s (action 1) |
| initial-stock | B | turn, 10.5 s (action 0) | turn, 10.25 s (action 1) |
| before-facing | starting | face, 132 s (action 8) | face, 132 s (action 8) |
| before-facing | A | face, 132 s (action 8) | face, 132 s (action 8) |
| before-facing | B | face, 132 s (action 8) | face, 132 s (action 8) |

Weights and action scores can change without different selected actions. Operator input enters as demonstrated action choices; the fixed reward still scores progress and synthetic time. This does not establish preference learning, improved performance, or qualification for industrial parts.

## Retained files

- `operator-A.json`, `operator-B.json`: canonical decision episodes.
- `before-facing.json`: common three-step prefix for replay and comparison.
- `starting-checkpoint.json`: shared published model.
- `trained-A/`, `trained-B/`: input copies, updated checkpoint, training record and replay summary.
- `inference-comparison.json`: exact heads, candidate identities, scores and search traces.
- `demonstration-comparison.json`: measured demonstration and training projection.

The native materialization of A matches the manually exercised browser episode head exactly (`af32a59e43dadfaf6b47fe27d7f7d6fcc4e5136aa4061def4b74e7d3068c1854`). Both episodes are generated through the preserved checked transition owner, then independently replayed by the local trainer. Browser actions and saved/replayed state are also exercised for B.

Run the training launcher with a freshly computed file hash, following [the quickstart](../../docs/OPERATOR_INPUT_QUICKSTART.md).
