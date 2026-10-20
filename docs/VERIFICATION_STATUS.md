# Candidate verification status

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
The public integration is [PR 19](https://github.com/mingwucn/AutoCAM_UI/pull/19);
read its checks for the exact tested head. The tables below retain their original
source identities and do not claim every check was rerun after documentation changes.

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
| Public candidate deployment and matching hosted manifest | Separate from local receipts; consult the [Pages workflow](https://github.com/mingwucn/AutoCAM_UI/actions/workflows/pages.yml) and actual hosted `release.json` |
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
