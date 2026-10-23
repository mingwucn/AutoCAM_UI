# Verification status and retained records

The current separate workflow is
[Reusable Results V2 — Module 3](../rrv2_module3/index.html?case=industrial_reach_00350#gym).
The [important drilling milestone](MILESTONES.md) records exact published source
`d2add3f3b77b7f822a1c228fb47e0e31a06a07b0`, its successful production run and
the observed software/browser checks. The
[documentation consistency review](DOCUMENT_CONSISTENCY_REVIEW.md) records the
subsequent public-address and documentation changes. Check served `release.json`
for the executing source. Historical platform/training receipts below retain
their original source and finite scope; they are not fresh V2 platform runs.

## Historical candidate platform baseline

The retained Windows and Linux clean-install software runs passed. The
executable source tested in those runs is
`d97adaded7f1e094f562c7759cdc2291e3db4128`, version `1.1.0-rc.1`.
The delivery also includes the separately verified build correction below and
subsequent documentation/receipts. Use `git log` and the built `release.json` for
its final identity; this does not claim another complete numerical test run. V1 commit
`de20f204114767124296542d8d8ecc0361e7666a` remains the comparison release.

The subsequent single-repository continuation documents all 23 advertised
families, exports 37 original workflow files from ten groups and repairs hosted
manual source links. [Additional workflow receipts](verification/repository-continuation/README.md)
cover fresh STEP preparation/machining, task-4 model controls and the older
inspection, diagnostic and comparison controls on the unchanged runtime.
The public integration is GitHub PR 19;
read its checks for the exact tested head. The tables below retain their original
source identities and do not claim every check was rerun after documentation changes.

## Original two-case industrial extension

The new F24 route covers pinned sampled 00350 and 00289, explicit complete-sequence
and case-scoped turning/milling preferences, local reward learning and RL, and
model-guided MCTS. Its current contract and steps are in the
[industrial learning guide](INDUSTRIAL_LEARNING_QUICKSTART.md). The
[selected reproducible examples](../examples/industrial-learning/README.md#recorded-example-comparison)
retain exact-case version-2 models, original scripted feedback and full sequence
comparisons. Combined labels change both initial choices from milling to turning
against matched-experience TD without preference fitting. The fine-tuned policies
complete in three actions each; bounded MCTS completes in eight and six actions,
all with zero sampled excess. The 00350 MCTS learned return is below its rule
baseline, and unchanged state recommendations are retained. These are finite
software examples, not actual human feedback or a general improvement claim.

The [actual two-case browser gate](verification/industrial-learning/README.md)
passed in Windows/Edge with no page errors: actual feedback download, local
training, new model load, initial/updated policy and MCTS, preview and one
explicit suggested Apply per case. Cancellation and wrong-case import preserved
stock/model, with target and holding stock protected. Its public summary pins
the exact tested development build, source files and distinct feedback/model
identities, and links twelve original-pixel screenshots. Complete sequence
comparisons were also replayed by the shared simulator. This is a development
software result; final production-byte verification is a separate delivery gate.
The historical 23-family/platform results below do not verify this extension.
Independent human acceptance and manufacturing qualification remain unperformed.

## Fresh-checkout software checks

| Gate | Linux | Windows |
| --- | --- | --- |
| Full verification command | Passed, 19/19 steps | Passed, 19/19 steps |
| Unit tests | 609 passed; no failures, skips or cancellations | 609 passed; no failures, skips or cancellations |
| Release checks / parity cases | 13 / 916 passed | 13 / 916 passed |
| Python tests | 21 passed | 21 passed |
| Recorded-family reference examples | 8 passed | 8 passed |
| Cylindrical training runs | 5 passed | 5 passed |
| Newly trained-model production-worker cases | 7 passed | 7 passed |
| Actual React task-5/task-6 cases | 4 passed | 4 passed |

Final machine receipts, step logs and installation logs are retained in
[the evidence index](verification/INDEX.json) and [receipt guide](verification/README.md).
They identify the exact source, environment, input/model hashes, configured runtime and checked cases.
Both platforms used the identical source inventory SHA-256
`01b8c6ce74aa9bb49c0bde5ff22b8d691d1faae651bd8de41d2011104818cece`.
Reproduce the checks using
[installation](INSTALLATION.md) and [validation](VALIDATION_GUIDE.md).

The eight reference examples cover mixed A/B, task-5/task-6 manual and model/MCTS
recordings, and regional v2/v3. Mixed A and B each make six updates and change
28 of 34 weights. Unchanged recommendations are recorded without claiming
improvement. The five cylindrical runs cover one recorded reference, two seeded
self-play repetitions and derived profiles 2 and 3. The latter two have
replay/profile/compatibility checks, not committed expected model-output hashes.

The seven newly trained-model worker cases cover mixed A/B, regional v2/v3 and
cylindrical v1/v2/v3. They check loading, read-only inference and agreement with
the same pinned runtime owner in native Python. This is transport/integration
evidence, not an independent algorithm or quality oracle. All seven cases on each
platform were byte-identical; the allowed mixed-prior-only rounding exception was unused.

## Subsequent build correction

Adding the evidence exposed a filename bug: the inventory omitted nested files
named `build-manifest.json`, so publication correctly refused the incomplete
build. Commit `6517909584701ea4bc4ddb64477472e2c595e7a0` excludes only the
output-root manifest. Its regression reproduced the failure before the fix.

[Separate Windows/Linux receipts](verification/BUILD_CORRECTION.json) confirm
12 targeted tests, 13 release checks, two consecutive builds, 296 built-file
integrity checks, and documentation/capability checks on each platform. Runtime
and numerical source stayed unchanged. Of 73 compared runtime assets/entry
files, 72 were identical; the worker differed only in its generated build-record
identity constant. These focused checks do not claim a second full training run.

## Additional UI and delivery observations

Three separate Windows React checks passed for regional v3, cylindrical v3 and
mixed A: prepared input/model loading, available suggestions, read-only preview,
explicit apply and exact reset. [The additional UI receipt](verification/additional-ui/summary.json)
retains these checks. They used the existing candidate environment and are not
additional clean-platform passes or human acceptance.

Loopback HTTP verification matched all 207 files of the executable-source build.
The delivered build's `release.json` identifies the later documentation/receipt
commit; its local HTTP check is retained with the delivery package. Local
served-byte agreement does not establish that the public hosted site contains
this candidate.

## Open acceptance requirements

| Requirement | Status |
| --- | --- |
| Public candidate deployment and matching hosted manifest | Separate from local receipts; consult the [validation guide](VALIDATION_GUIDE.md), the deployment workflow for the tested source and actual hosted `release.json` |
| Independent user completes scenarios without developer coaching | Not performed; [checklist supplied](ACCEPTANCE_CHECKLIST.md) |
| Single-repository scope | Owner confirmed `mingwucn/AutoCAM_UI`; all advertised families are mapped in the [workflow catalogue](WORKFLOW_CATALOGUE.md); coverage is assessed per family |
| Industrial policy quality, whole-plan coverage and manufacturing qualification | Not established or claimed |
| Video | Deferred; no video work used as evidence |

Earlier V1 results and retained failed development attempts are separate from
these final candidate receipts. One corrected rejection test had incorrectly
expected a valid reset seed to fail; this was a test error. Other retained
diagnostics include unsupported material-export/backend attempts and overly
narrow assertion setup. Passing the final finite scenarios does not erase those
records or close the open requirements above.
