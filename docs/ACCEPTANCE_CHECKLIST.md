# Independent-user acceptance

This checklist records whether the delivered scenarios can be completed using
the package alone. It is not an approval record until a named acceptance owner
makes that decision. Agent-run tests do not substitute for an independent user.

Record: participant, date, candidate commit/build identity, operating system,
browser, starting environment, input/model versions and any assistance received.

| Scenario | User task | Evidence for a pass |
| --- | --- | --- |
| A1 — Find scope | Start at README/UI, identify version and choose the correct route | User distinguishes industrial baseline, synthetic learning and supported STEP stages, including unavailable functions |
| A2 — Install | Use a fresh candidate copy and the published installation commands | Only declared dependencies used; release build and local page work; logs retained |
| A3 — Industrial | Reset, perform the three 00350 cuts, switch process and replay | Expected sampled residuals match, protected material remains, and the user correctly interprets zero sampled excess |
| A4 — Supplied learning | Train A/B, load a compatible result and request policy/MCTS | Verified outputs; same-state comparison; user understands unchanged recommendations are not a claimed improvement |
| A5 — New recording | Record a new compatible episode, train and use its checkpoint | Input/replay/checkpoint/result chain retained; correct family and explicit state-changing action used |
| A6 — STEP and recovery | Prepare supported examples; try invalid input and cancellation | Accepted state preserved on failure; user identifies unsupported preparation/machining stages |
| A7 — Other promised training | Reproduce each packaged family advertised for this candidate | Exact family inputs, compatible model loading/use and rejection cases pass; omitted families stay untested |
| A8 — Knowledge boundary | Find the constraint examples and describe the knowledge workflow | User distinguishes delivered checks from external/missing authoring, review or activation interfaces |

For every attempt record elapsed time, exact failed step, actual/expected result,
receipt location and every intervention. Developer coaching makes that attempt
a diagnostic run. Keep it, fix the blocker, and repeat the affected scenario
with independent use; do not erase failed attempts.

## Criteria 9–12

| External criterion | Required closure evidence |
| --- | --- |
| 9 — Understandable documentation | A1 plus successful task completion and interpretation using the linked manual |
| 10 — Validation information | Discoverable input/expected-output catalogue and reproducible checks with evidence scope stated |
| 11 — Boundaries for use | Stage-specific capability table, positive/rejected examples and actual knowledge/training-family limits |
| 12 — Execute without developer support | Unassisted scenarios on the declared platforms using only packaged or explicitly pinned dependencies |

Completion of this checklist establishes only the declared package scope.
Unknown whole-Module-3 requirements, required industrial integration and
partner interfaces remain open until their owner supplies and accepts evidence.
Publication, Linux/Windows verification, and human acceptance are independently
reported in [verification status](VERIFICATION_STATUS.md). Video is deferred.
