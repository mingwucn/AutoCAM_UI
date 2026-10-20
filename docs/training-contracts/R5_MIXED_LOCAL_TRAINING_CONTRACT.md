# R5 local training adapter

CODE-SGYM-009-R5 WP7 bounded implementation contract, 14 September 2026.
Prerequisite: the [passing constructed-profile G6 assessment](R5_G6_REFERENCE_RESULTS.md).
This slice implements local learning and records its actual limits. It does not
complete the fair experiment report in R5 sections 72–73 and 101.

## Reuse and ownership

Reuse `combined_training._train_episode` for seeded online linear Q learning
and `regional_recorded_training._train_recorded_episode` for learning from
canonical downloaded episodes. Both already use normalized clipped updates,
finite weights and masked successor bootstrapping. Reuse existing mixed MCTS
for the optional online policy. Do not copy any of these numerical loops.

A private protocol view wraps the exact `MixedLearningGym`. Reset reconstructs
its original configuration, snapshot and all manifest parameters; it verifies
the manifest remains identical. Fork owns an isolated gym branch. The view's
task ID is the manifest ID. Numeric callbacks unwrap the view and use the
existing mixed feature/checkpoint validation. Accepted records, state changes,
rewards, candidate exposure, writer and planner are unchanged.

The online view translates a successful checked `step` response into the older
trainer's `outcome.valid` protocol. The recorded view returns the contained
canonical decision record. Neither translation changes exported episodes.
Failed checked steps propagate exceptions, never become valid training rows.

## Inputs and outputs

Two APIs are exposed: `train_episode` with a compatible initial checkpoint,
seed and `epsilon_greedy` or `mcts` policy; and `train_recorded_episode` with
canonical episode bytes and caller-supplied SHA-256. The latter fully replays
the episode before updates. Both successful and truncated genuine episodes
can train; truncation has zero successor bootstrap. This does not turn a failed
episode into a completed task or give it a completion bonus.

Discount is exactly one under the accepted reward contract. Existing bounded
learning-rate, epsilon, error-clip and seed checks apply; MCTS simulations are
1–128 and depth 1–8. Unknown policies, incompatible checkpoints, nonfinite
weights, bad byte identity and altered transitions reject. Outputs include
recipes, initial/final checkpoint hashes, every numerical update and episode
identity. Record size remains bounded at 128 MiB. Returned checkpoints use the
existing mixed schema; training records have separate versioned schemas.

Online outputs undergo a complete independent learning replay before return.
Input gym export and input checkpoint must remain unchanged. Training runs
locally in Python; no training code enters the browser runtime through this
slice. `qualified_model` remains false even if weights change.

## First verification cohort and budgets

Use the existing constructed faced-box/hole fixture with the exact six-step
manifest from the admitted feasible demonstration. Recorded training uses its
six real actions, zero initial weights, learning rate 0.05, discount 1 and
error clip 1. Confirm nonzero updates, exact recorded replay, repeat-run
determinism, compatible returned weights and unchanged input bytes.

An online protocol test uses the same fixture with horizon 2, seed 7,
epsilon 0, learning rate 0.05, discount 1, error clip 1. Run both epsilon-greedy
and MCTS (two simulations, depth one). This intentionally tests truncated
training and reproducibility at a small compute budget; it cannot establish
full-sequence learning. Each policy must call the shared learner; MCTS must
call the existing search. Verify actual weights change and terminal bootstrap
is zero. Also test incompatible input and forged downloaded records, without
using mocks to claim actual trained task completion.

The horizon-2 profile is an integration diagnostic with the same accepted
feature/reward code, not the horizon-6 reference experiment. Never compare its
completion rate against the six-step demonstration as a policy verdict.
Before a fair WP7 comparison, pin a common horizon/source/catalog/candidate
manifest, seeds, training budget and all section-73 counters. Separate observed
counts from unavailable instrumentation; no estimate may stand in for a
measured stage count. Browser model loading, nonzero-weight browser parity,
industrial applicability and full-plan acceptance remain later work.

## Retained verification outputs

When `ADAPTIVE_TRAINING_EVIDENCE_DIR` names the verifier working directory
containing its producer and source pins, tests emit the recorded-training and
two online-policy records once per Python mode. Existing files refuse overwrite;
without that variable tests write nothing. Compare corresponding normal and
optimized record bytes after both modes finish. These records contain actual
updated weights and traceable updates, not timing or model-quality claims.
