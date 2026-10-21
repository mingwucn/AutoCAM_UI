# Local learning from downloaded regional decisions

CODE-SGYM-009, implementing the owner's request to download Gym actions and use
them for local training. This bounded path accepts the current regional v2
episode format and produces the existing 48-feature regional checkpoint. It does
not relabel v4, indexed-only or combined-v1 weights or promise generalization.

Require caller SHA-256 of the complete episode bytes, strict canonical decoding
and full RegionalCombinedGym replay before exposing learned output. Restore a
fresh initial state from that verified episode and follow exactly its recorded
actions. Compare every reproduced record and the final export with the source.
Use the same normalized clipped linear-Q update and feature/weight validation as
the existing local trainer. Defaults are zero initial weights, learning rate
0.05, discount 1 and error clip 1. No exploration, action reselection, shuffling,
MCTS-generated replacement labels or geometry modification occurs during this
recorded-action pass. Hyperparameters remain explicit and bounded.

Record invalid/masked actions as skipped learning updates while retaining their
verified transitions. Do not silently discard them from the episode. A terminal
or truncated successor has zero bootstrap. Compatible optional starting weights
must remain unchanged. Output records bind the original episode SHA and export
identity, task/context, initial/final checkpoints and per-transition update data.
No checkpoint is returned after a replay or record mismatch; all work is local
and isolated from an active browser state. Limit training record to 128 MiB.

The CLI retains the original episode beside checkpoint.json and training.json,
records file hashes and source pins, and refuses an existing output directory.
Tests cover byte-for-byte determinism, independent update arithmetic, exact
recorded actions, altered download/replay rejection, checkpoint incompatibility,
parameter rejection and preservation of the source episode/initial weights.
This provides usable training data and local learning, not a qualified corpus,
held-out evaluation or industrial policy. Dataset splits remain the caller's
responsibility; this command does not claim any test-set performance.
