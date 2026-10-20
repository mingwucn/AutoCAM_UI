# Regional v3 completion-first objective

Task-local CODE-SGYM-009 development extension following the recorded v2 reward
counterexample. Preserve every v1/v2 task, episode, primitive reward and model.
This contract authorizes an isolated implementation and tests, not deployment or
policy qualification. Geometry, feasibility masks, candidates, completion gates
and charged time remain unchanged.

Let b_t be the existing exact removal-minus-time reward, or the existing invalid
action penalty. Let B_t be its cumulative sum, initially zero. Define the exact
potential F(B)=B/(1+abs(B)). The new transition reward is

    F(B_next) - F(B_before) + 3 * first_completion

Only a transition into successful completion receives the bonus. An initially
completed task has no actions and receives no synthetic removal credit. An
incomplete horizon/resource termination receives no completion bonus. Keep
primitive removal_reward separate from this task-objective reward. A no-change,
zero-cost index has no positive potential credit; it remains geometrically valid.

The undiscounted sum telescopes to F(B_final)+3 for completion and F(B_final)
otherwise. For every finite rational B, -1<F(B)<1. Completed return therefore
lies in (2,4), incomplete return in (-1,1), with a gap greater than one. Three
is the width-two potential range plus a unit separation margin, not an empirical
bonus fitted to the fixture. No upper cost cap or feasibility filtering is needed.
F is strictly increasing, so ranking of deterministic complete trajectories by
their old accumulated removal/cost objective is preserved. For equivalent
removal, lower total charged cost still wins. Partial incomplete trajectories
retain the old ranking. This nonlinear transform does not preserve expected
return rankings under arbitrary stochastic mixtures; no such claim is made.

The objective requires discount=1 in future training/search adapters. Truncated
search leaves remain estimates, not evidence of final completion; this proof
does not guarantee bounded MCTS discovers a completing plan. Float adapters must
preserve the separated completion bands and disclose ties within each band.

Use task/observation/episode version 3 and a pinned objective schema. Include the
exact cumulative base return in the observation and state head; do not hide
reward history from a future model. Replay recomputes both original base rewards
and transformed rewards. Existing v2 readers/models must reject v3. A future
v3 checkpoint feature contract must include this state and objective identity;
do not reuse the existing 48-feature weights silently.

First verification: exact telescoping and deterministic ordering across large
positive/negative costs, no-change steps, the turn/transfer/finishing versus idle
counterexample, partial and invalid-action truncation, reset/fork/stale-head,
tampering and unchanged v2 primitive journal. Independent-family local learning,
new checkpoint/inference adapters and browser parity remain subsequent work.
