# Independent-user acceptance

This checklist records whether the delivered scenarios can be completed using
the package alone. It is not an approval record until a named acceptance owner
makes that decision. Software tests do not substitute for an independent user.

Record: participant, date, candidate commit/build identity, operating system,
browser, starting environment, input/model versions and any assistance received.

Use the [workflow catalogue](WORKFLOW_CATALOGUE.md) for exact inputs, controls,
expected observations and limits. A1–A8 are assessment themes; the F01–F24 matrix
below defines the complete advertised family denominator. One family does not
stand in for another, and a description of an unavailable stage is not a positive
execution test. The source, platform, subcase and tested stages must stay explicit.

| Scenario | User task | Evidence for a pass |
| --- | --- | --- |
| A1 — Find scope | Start at README/UI, identify version and choose the correct route | User distinguishes industrial rules/preferences/RL, synthetic learning and supported STEP stages, including unavailable functions |
| A2 — Install | Use a fresh candidate copy and the published installation commands | Only declared dependencies used; release build and local page work; logs retained |
| A3 — Industrial | Reset, perform the three 00350 cuts, switch process and replay | Expected sampled residuals match, protected material remains, and the user correctly interprets zero sampled excess |
| A4 — Supplied learning | Train A/B, load a compatible result and request policy/MCTS | Verified outputs; same-state comparison; user understands unchanged recommendations are not a claimed improvement |
| A5 — New recording | Record a new compatible episode, train and use its checkpoint | Input/replay/checkpoint/result chain retained; correct family and explicit state-changing action used |
| A6 — STEP and recovery | Prepare classic and adaptive examples; try invalid input and cancellation | Accepted state preserved on failure; user distinguishes preparation, face inspection and machining; each profile/subcase below has a separate result |
| A7 — Other promised training | Reproduce each packaged family advertised for this candidate | Exact family inputs, compatible model loading/use and rejection cases pass; omitted families stay untested |
| A8 — Knowledge boundary | Find the constraint examples and describe the knowledge workflow | User distinguishes delivered checks from external/missing authoring, review or activation interfaces |

For every attempt record elapsed time, exact failed step, actual/expected result,
receipt location and every intervention. Developer coaching makes that attempt
a diagnostic run. Keep it, fix the blocker, and repeat the affected scenario
with independent use; do not erase failed attempts.

## Family and function matrix — blank assessment

Every row starts **not assessed**. Use `pass`, `partial`, `failed`, `blocked` or
`not attempted`, with assistance recorded separately. A named acceptance owner
decides whether the reported outcome meets the intended scope. A pending input
or unavailable dependency is not an unassisted pass.

| ID / catalogue family | Required subcases and observed functions | A theme | Result / evidence |
| --- | --- | --- | --- |
| F01 classic-sampled | Industrial 00350 three cuts, process preservation, own replay, greedy interpretation, reset and exhausted action | A3, A8 | not assessed |
| F02 classic-step-brep | Box preparation, read-only preview, turning/milling Apply, cancellation/recovery, own replay, both downloads and reset | A6 | not assessed |
| F03 classic-step-voxel | Box, overhang, stepped-shaft; stated settings; apply/process switch; invalid/grid/cancel; replay/reset | A6 | not assessed |
| F04 step-rectilinear | Positive allowance stock-only recipe, plus separate zero-allowance cylinder/depth-6 recipe with exact setup/policy and actions 0,1,3,5,7,9; face/cell/provenance inspection, downloads and reset/restore | A6, A8 | not assessed |
| F05 step-periodic_nominal | Coaxial through-bore preparation, source faces, exact setup/policy, machining proposals, preview/Apply/download/reset; rejected/cancelled preparation | A6, A8 | not assessed |
| F06 step-spherical_nominal | All four origin/translated and allowance/auto cases; exact preparation downloads, source face/proposals, 27 reference actions, actual completion interpretation, reset/restore | A6, A8 | not assessed |
| F07 step-rational_nominal | Exported positive rational-prism STEP preparation and face/cell/provenance inspection; zero allowance and unavailable machining boundaries | A6, A8 | not assessed |
| F08 task-4 | Manual action, refinement, blocked/repeated attempt, untrained compatible model control use, both explicit Run controls, downloads and reset/recovery | A7, A8 | not assessed; no standalone trainer promised |
| F09 task-5 | Manual and model/MCTS supplied pairs; trained checkpoint reload, both explicit Run controls, masked decisions, inspection/decision/transition downloads and reset/recovery | A5, A7, A8 | not assessed |
| F10 task-6 | Same subcases as F09 using task-6-only pairs/model; cleared-holder constraints | A5, A7, A8 | not assessed |
| F11 combined | Combined-v1 pair plus Turn, then mill four indexed faces menu sequence 0,1,2,4,6,8; compatible untrained MCTS only for its exact fixture, preview/Apply, rejection, restore/download/reset | A7, A8 | not assessed; no standalone trainer promised |
| F12 combined-regional-v2 | Recorded training, new 48-feature model use, suggestion/preview/Apply, rejected model, restore/download/reset | A7, A8 | not assessed |
| F13 combined-regional | Recorded v3 training, new 50-feature model use, regional completion, suggestion/preview/Apply, rejected model, restore/download/reset; CAD-generated tasks assessed separately in F04–F06 | A7, A8 | not assessed |
| F14 indexed | Untrained compatible MCTS, preview/Apply, indexed constraints, rejected model/history, restore/download/reset | A7, A8 | not assessed; no standalone trainer promised |
| F15 drill | Both menu cases, tool/index, prepare/preview/execute, short/long reach and blocked proposals, local save/forget, restore/download/reset | A6, A8 | not assessed |
| F16 face | Two-reach case plus all four fixture-shadow cases; prepare/preview/execute, assembly/motion/shadow/uncertainty inspection, local save/forget, restore/download/reset | A6, A8 | not assessed |
| F17 mill-turn | Face/drill stages after transfer, context changes, proposal/preview/execute/rejection, local save/forget, restore/download/reset to transfer | A6, A8 | not assessed |
| F18 full-mill-turn | Initial turn preparation/preview/execute and turning-shadow inspection, configured transfer, face/drill continuation, local save/forget, restore/download/reset to initial | A6, A8 | not assessed |
| F19 mixed-learning | Supplied A and B plus a new participant recording; train/new-checkpoint reload; policy/MCTS same-state comparison; preview/Accept; local save/forget, restore/download/reset | A4, A5, A8 | not assessed |
| F20 cylindrical-choice | Choice-config pair; preview/Apply/rejection, dependency pair/graph paging, preview-removal measurement, connected-cell queries, decisions/transitions/restore/reset and local save/restore/delete; policy/training unavailable | A7, A8 | not assessed |
| F21 cylindrical-policy | v1 recorded and self-play, v2 and v3; newly trained compatible models, read-only MCTS/preview, explicit Apply, wrong-version rejection and F20 diagnostics/retention controls | A7, A8 | not assessed |
| F22 inspection | Legacy and tool-recording bundle imports, Previous/Next/Play, cells/sections/layers, recorded-tool pose/sweep, display exports, producer-reported replay distinction, malformed-file preservation | A6, A8 | not assessed |
| F23 equivalent-groove | Both indexing-cost scenarios, time/geometry interpretation, indexed preview/Apply/download/reset; deliberate new episode on scenario change | A6, A8 | not assessed |
| F24 industrial-preference-learning | Both 00350 and 00289: generate rule baseline, complete alternatives, sequence/action-kind feedback export, local fine-tuning, initial/updated case-model comparison, MCTS, preview/Apply and failed-import/cancellation recovery | A3, A5, A7, A8 | not assessed |

For every live family, exercise the shared catalogue procedures that its UI
offers: inspect without mutation, explicit checked execution, wrong-family or
malformed input rejection, cancellation/recovery, reset, recording and available
restore/export controls. Save exact UI messages and before/after head/history as
well as material: indexing/tool exchange can change history without cutting.
Do not mark unsupported controls failed merely because they are absent; record
whether their documented absence was understood.

CAD provenance downloads and connected-cell/directional query modes are part
of inspection wherever the UI offers them; record partial/unresolved query
coverage and confirm that they do not accept actions. All rows remain
unassessed until actually performed. A complete row requires its listed
subcases; retain partial coverage explicitly instead of collapsing it into pass.

## Criteria 9–12

| External criterion | Required closure evidence |
| --- | --- |
| 9 — Understandable documentation | A1 plus successful task completion and interpretation using the linked manual |
| 10 — Validation information | Discoverable input/expected-output catalogue and reproducible checks with evidence scope stated |
| 11 — Boundaries for use | Stage-specific capability table, positive/rejected examples and actual knowledge/training-family limits |
| 12 — Execute without developer support | Unassisted scenarios on the declared platforms using only packaged or explicitly pinned dependencies |

Completion of this checklist establishes only the declared package scope.
The selected delivery target is all advertised functions in `mingwucn/AutoCAM_UI`.
Separate unidentified partner repositories or every Master research programme
are not prerequisites for this assessment. Industrial model quality, arbitrary
CAD machining and manufacturing qualification are not established by it.
Publication, Linux/Windows verification, and human acceptance are independently
reported in [verification status](VERIFICATION_STATUS.md). Video is deferred.
