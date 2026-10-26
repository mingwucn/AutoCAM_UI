# GYM functional contract

This contract defines the observable candidate behavior under
`CODE-M3-REMEDIATE-001`. It preserves the existing geometry, replay, learning and
model contracts. The two-case industrial extension adds bounded reward learning and linear RL
over the existing JS GYM, without a second geometry engine or changed removal
rules; see the [industrial learning contract](INDUSTRIAL_LEARNING_CONTRACT.md).
The separate current [Reusable Results V2 — Module 3](../rrv2_module3/guide/index.html)
uses exact case `industrial_reach_00350`, phased drilling/finishing and its own
recording/model contracts. The original two-case rules below retain their
classic scope. The comparison release is GYM V1 at
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
| F-02 | Milling and turning share the accepted material in the original industrial workflow. | Switching process preserves material/history. The classic 00350 reference reaches sampled excess 388600 → 286750 → 33236 → 0 mm³ with turning 40 mm, milling −Z 80 mm, milling +Z 40 mm. Target and holding samples remain. |
| F-03 | Preview, camera changes and suggestion-only policy/search calls are read-only. | Accepted state identity and recorded history are unchanged. An explicitly labelled run/apply action may commit after the required checks; it is not a preview. |
| F-04 | Only a current action whose required acceptance checks pass may commit. | Stale, rejected, cancelled or failed results cannot commit. An unresolved required acceptance check cannot authorize the action. |
| F-05 | No-removal repeats cannot be presented as new machining progress. | Exhausted industrial actions are unavailable; no stock removal or progress is fabricated. |
| F-06 | Reset, restoration and replay have explicit state semantics. | Reset starts a new case state. Read-only replay displays recorded states without replacing accepted stock; an explicitly labelled restoration adopts a validated recording. Cancellation stops pending work and recovery reconstructs the latest acknowledged commands. Failure or cancellation before a command is acknowledged preserves the previous acknowledged head. A command acknowledged before Cancel remains accepted even if its material view is still refreshing; Cancel does not undo it. |
| F-07 | Completion and failure states remain distinct. | Complete, truncated, blocked, unresolved and error outcomes retain their actual meaning. A valid checked transition can still leave completion unresolved. |
| F-08 | Local training checks exact episode identity, replays before updates and validates model compatibility. | Wrong hashes, altered invalid histories and incompatible/nonfinite checkpoints reject. Existing output directories are not overwritten. No undeclared parent repository is required by a promised standalone route. |
| F-09 | Policy and MCTS use a compatible checkpoint and accepted state. | Mixed reference initial policy selects action 0; MCTS with 16 simulations, depth 2 and exploration 1 selects action 1. Suggestion-only inference preserves accepted state. Task-4/task-5/task-6 explicitly labelled Run controls then commit one checked choice, as specified by F-03. |
| F-10 | Numerical learning claims match measured outcomes. | Mixed A/B each have six updates and 28/34 changed weights. Synthetic demonstrated costs are 161.6/228.4 seconds. Starting/A/B select the same actions at the two published comparison states; no improvement is inferred. |
| F-11 | Dependency and example identities are reproducible. | Exact UI/data/runtime/CAD versions are recorded. Missing or changed inputs fail clearly. A fresh standalone checkout can execute every promised scenario. |
| F-12 | Scope and independent execution claims have evidence. | Every advertised family in this single repository has an input route, steps, results, restrictions and recovery. Platform tests and unassisted human acceptance are recorded separately; untested families remain explicit. |
| F-13 | Industrial learning binds the exact 00350 or 00289 case, recording, feedback and model contracts. | Dataset/action identities, versioned schemas and bounded finite reward/Q weights must match. Cross-case, uploaded STEP and synthetic models reject. |
| F-14 | Industrial training separates demonstrations, explicit preferences, reward fitting and RL. | Replay all episodes first; complete-sequence labels bind exact alternatives and action-kind labels remain case/state scoped. Fit pairwise reward preferences, then apply TD Q updates on replayed/explored transitions. Hard gates always apply. Existing output directories are preserved; failed training publishes no usable checkpoint. |
| F-15 | Industrial policy and bounded MCTS suggest without committing stock. | Search uses the same JS GYM, learned reward and model guidance. Explicit Apply commits the selected current checked action. Cancellation, reset, case/model replacement and an applied action invalidate stale work; failed model loading preserves accepted stock, history and the previous model. |

## V2 drilling and action controls

V2 **Preview next action** chooses an eligible positive cut from accepted stock,
following the selected plan while its accepted prefix matches, then an eligible
current-phase action for manual paths. Preview and bore focus preserve stock.
Apply retains the accepted result without automatically overlaying another cut.
Phase, setup and positive-removal gates remain mandatory. A selected short
reach stays visible with its blocking reason. Source bore `00350-bore-z-24`
has diameter 24 mm and source depth 23 mm; its axis/cylinder is a logical
removal guide. Modeled reach starts at the original stock reference.

Show/replay and **Load sequence alternative** preserve accepted stock.
**Restore industrial decisions** explicitly adopts a compatible replay-checked
recording. Preview can exit replay against accepted stock or continue a partial
restore; complete stock has no further cut. Case changes initialize the selected
case afresh. See [current controls](../rrv2_module3/guide/index.html#drilling-controls)
and the [drilling milestone](MILESTONES.md).

## V2 training and full-sequence inference

**Train model** learns from a frozen copy of saved compatible sequences and
explicit preferences. **Run inference and compare** uses the exact before/after
checkpoint pair retained from the last completed training; later model loads
do not replace that pair.

**Run full-sequence inference** uses a frozen snapshot of the loaded compatible
checkpoint, including an imported checkpoint without a new training session.
Its successive simulated decisions start from original stock and use the same
material and phase gates. It preserves accepted stock and saved feedback.
The result identifies its model and lists every process, direction, reach and
remaining volume, with finishing markers and actual complete/partial status.
Cancellation or failure preserves the last successful result; stale and
cross-case replies cannot replace it.

**Replay inferred sequence** is read-only. **Download inferred sequence** exports
the episode; **Download inferred sequence model**, inside **Model identity used
for this result**, exports its frozen model. **Download loaded checkpoint**
exports the currently loaded model. One-step policy/MCTS suggestions continue to
use accepted stock and require explicit Apply for a material transition.
See the [full-sequence workflow](../rrv2_module3/guide/index.html#full-sequence-inference).

## Learning families

The original industrial learning route accepts the exact pinned sampled cases 3-29-00350
(`industrial`) and 3-29-00289 (`industrial_00289`). The second case is the working
choice from the existing catalogue; 00350 was originally named. Browser and
local Node.js 24 training share the JavaScript GYM. The rule baseline exhausts
productive turning before milling, chooses greatest current sampled removal,
and breaks ties by shorter reach then action ID. Each decision records its reason.
These are software heuristics, with no company-qualified knowledge implied.

An accepted demonstration supplies experience. A separate whole-sequence label
compares two complete replayed alternatives; a case-scoped action-kind label
compares turning with milling where eligible alternatives exist. Pairwise
logistic fitting learns a bounded soft reward over declared features, starting
from normalized sampled removal. TD Q updates then fine-tune on replayed and
simulator-explored transitions. The model cannot waive action, target, holding
or stock checks. MCTS searches using the model; it does not train weights.
Numerical defaults, features, schemas and update equations belong to the
[industrial learning contract](INDUSTRIAL_LEARNING_CONTRACT.md). There is no
measured machining-time, surface-quality or tool-life objective.

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

For the existing Python families, the numerical owners are the preserved `autocam.adaptive_delta` modules, including
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

Each industrial case needs its own rule-baseline → explicit-feedback → local-training →
model-load → policy/MCTS → explicit-Apply evidence. The existing manual 00350
residual sequence is a regression reference, not proof of learning quality or
of a completed new browser-training check.
