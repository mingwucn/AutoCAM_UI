# GYM functional contract

This contract defines the observable candidate behavior under
`CODE-M3-REMEDIATE-001`. It preserves the existing geometry, replay, learning and
model contracts; it does not introduce a second validator or learning algorithm.
The comparison release is GYM V1 at
`de20f204114767124296542d8d8ecc0361e7666a`.

## Inputs, stages and results

Every advertised case/profile must identify its supported stages, compatible
input/model schemas, dependencies and restrictions. Stages are import, stock
preparation, inspection, machining actions, recording/replay, policy, MCTS and
local training. Status must distinguish supported, restricted, externally
packaged and unavailable functions. Runtime eligibility remains authoritative
for the particular supplied input and accepted state.

| ID | Required behavior | Observable acceptance |
| --- | --- | --- |
| F-01 | Case selection and setup identify the selected profile and its limits. | Unsupported stages are explained; importing a solid does not imply all machining or learning stages are available. |
| F-02 | Milling and turning share the accepted material in the industrial workflow. | Switching process preserves material/history. The 00350 reference reaches sampled excess 388600 → 286750 → 33236 → 0 mm³ with turning 40 mm, milling −Z 80 mm, milling +Z 40 mm. Target and holding samples remain. |
| F-03 | Preview, camera changes and suggestion-only policy/search calls are read-only. | Accepted state identity and recorded history are unchanged. An explicitly labelled run/apply action may commit after the required checks; it is not a preview. |
| F-04 | Only a current action whose required acceptance checks pass may commit. | Stale, rejected, cancelled or failed results cannot commit. An unresolved required acceptance check cannot authorize the action. |
| F-05 | No-removal repeats cannot be presented as new machining progress. | Exhausted industrial actions are unavailable; no stock removal or progress is fabricated. |
| F-06 | Reset, restoration and replay have explicit state semantics. | Reset starts a new case state; successful restore/replay reconstructs the recorded state. Failed import/replay/cancellation preserves prior accepted state. |
| F-07 | Completion and failure states remain distinct. | Complete, truncated, blocked, unresolved and error outcomes retain their actual meaning. A valid checked transition can still leave completion unresolved. |
| F-08 | Local training checks exact episode identity, replays before updates and validates model compatibility. | Wrong hashes, altered invalid histories and incompatible/nonfinite checkpoints reject. Existing output directories are not overwritten. No undeclared parent repository is required by a promised standalone route. |
| F-09 | Policy and MCTS use a compatible checkpoint and accepted state. | Mixed reference initial policy selects action 0; MCTS with 16 simulations, depth 2 and exploration 1 selects action 1. Suggestion-only inference preserves accepted state. Task-4/task-5/task-6 explicitly labelled Run controls then commit one checked choice, as specified by F-03. |
| F-10 | Numerical learning claims match measured outcomes. | Mixed A/B each have six updates and 28/34 changed weights. Synthetic demonstrated costs are 161.6/228.4 seconds. Starting/A/B select the same actions at the two published comparison states; no improvement is inferred. |
| F-11 | Dependency and example identities are reproducible. | Exact UI/data/runtime/CAD versions are recorded. Missing or changed inputs fail clearly. A fresh standalone checkout can execute every promised scenario. |
| F-12 | Scope and independent execution claims have evidence. | Every advertised family in this single repository has an input route, steps, results, restrictions and recovery. Platform tests and unassisted human acceptance are recorded separately; untested families remain explicit. |

## Learning families

The mixed route uses `adaptive-mixed-learning-episode-1` and
`adaptive-mixed-linear-q-1` (34 weights). It uses the existing recorded TD Q
learner with learning rate 0.05, discount 1 and error clip 1. Operator intent is
expressed through demonstrated actions; the fixed reward is not free-text
preference learning.

Task-5 and task-6 browser episodes use `adaptive-browser-episode-1` with their
respective `adaptive-mill-turn-core-roughing-task-5` or
`adaptive-mill-turn-core-roughing-task-6` task. Their trainers/checkpoints must
remain separate from the mixed route and from each other wherever the original
contracts require it. Packaging reuses the applicable existing trainer API.

The numerical owners are the preserved `autocam.adaptive_delta` modules, including
`mixed_learning_training`, `regional_recorded_training` and
`remaining_recorded_training`. Browser controls may call these owners, not reinterpret their
acceptance rules. The Master owner contracts are
`R5_MIXED_LOCAL_TRAINING_CONTRACT.md`, `REMAINING_RECORDED_TRAINING.md` and
`CLEARED_HOLDER_TRAINING.md` in `DOC-SGYM-002`; standalone operation
must not require that Master checkout.

## Verification boundary

Canonical payloads use exact identity checks. Human summary JSON may use parsed
field comparison across operating systems because V1's writer uses platform
newlines. Preserve original V1 references when introducing new candidate output.

Software consistency, native replay, browser parity and physical qualification
are separate evidence levels. This contract requires evidence for the claimed
level only and does not convert one into another. Independent human acceptance,
complete advertised-family coverage and publication status must never be
inferred from a passing test suite for a smaller set of scenarios.
