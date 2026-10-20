# Verify the package

Run from a fresh copy of the exact candidate source, following
[installation](INSTALLATION.md). A previous developer environment or populated
cache is not a clean-install check. Record the source/build identity, operating
system, Python/Node versions, commands and output. Keep failed attempts.

## Run all packaged software checks

For a Git checkout, install the declared Node, Python and browser dependencies
using the [installation guide](INSTALLATION.md), then run:

```text
npm run verify:software -- --output runs/software-verification-01
```

Use a new output directory for each attempt. An output inside the checkout must
be Git-ignored (`runs/` is supplied for this); an external directory is also
accepted. The command records the source inventory, individual logs and
`result.json`, stops at the first failed step, and checks that source inputs did
not change. A Git checkout is required for this source-inventory gate; a source
archive can use the individual checks below but cannot claim this gate passed.

The one command runs the capability/documentation checks, unit and release
tests, release build, data acquisition, native geometry checks, classic/STEP
and specified adaptive browser checks, Python rejection tests, all packaged
example verifiers, learned-model browser checks and built-file integrity. The
last learning check consumes that run's newly emitted mixed A/B, regional v2/v3
and cylindrical configuration 1–3 models. It checks model loading, read-only
policy/search and native/browser agreement for the configured production paths.
This is integration with the same runtime owner, not an independent algorithm
oracle or proof of model quality. Read the recorded step list and
receipts for its exact finite coverage. It does not itself perform `npm ci`,
install Python/browser dependencies, or establish unassisted human acceptance.
Retain separate clean-install logs.

It automatically selects the local `.venv`. To select another declared Python
3.12 environment, use:

```text
npm run verify:software -- --output runs/software-verification-02 --python PATH_TO_PYTHON_EXECUTABLE
```

Quote a path containing spaces. `AUTOCAM_PYTHON` is the environment-variable
alternative; explicit `--python` wins. The [interpreter policy](INSTALLATION.md)
also applies to `npm run test:python` and the example catalogue's portable
`node scripts/python-command.mjs ...` commands.

## 1. Install, test and build

```text
npm ci
npm test
npm run test:release
npm run build:release
node scripts/fetch-test-data.mjs
npm run test:core-wasm
npm run test:step-import
npm run test:parity
```

`npm test` expands and verifies committed fixtures before running the unit suite.
The data-acquisition command verifies pinned external assets. Missing files,
identity mismatches, failed tests, skipped cases or cancelled tests are failures,
not permission to substitute developer-local inputs.

V1's recorded reference counts were 592 unit tests and 13 release tests. The
candidate may add checks; use its retained receipt rather than requiring the
old count. These are software checks, not manufacturing validation.

## 2. Check examples and native learning

Run the example verifier after the test data is acquired:

```text
npm run verify:examples
```

Then use the installed Python environment. Windows:

```powershell
./.venv/Scripts/python.exe python/verify_examples.py --output ./runs/verification-01
```

Linux:

```sh
./.venv/bin/python python/verify_examples.py --output ./runs/verification-01
```

Choose a new directory for each attempt. `--family mixed`, `--family task5`,
`--family task6`, `--family regional-v2` or `--family regional-v3` selects a subset;
the default is all five families. A subset pass does
not establish the omitted families. Read the generated machine result for the
exact checked cases and rejections.

The mixed reference checks canonical input/checkpoint/training bytes and parsed
summary values, six updates and 28/34 changed weights for A/B, and initial policy
action 0 versus MCTS action 1 without accepted-state mutation. Summary-field
comparison handles V1's platform-specific newlines honestly.

Task-5/task-6 checks use the separate manual and model/MCTS recordings in
`examples/recorded-training/`. Manual examples retain blocked/repeated decisions;
only the two enabled decisions train. The model/MCTS examples contain one
trained decision and explicitly bound initial checkpoints. Their results are
interoperability diagnostics, not held-out policy-quality evidence.

Regional v2/v3 supplied episodes each make three trained updates and must match
their separate expected checkpoint/training bytes. Cylindrical verification is
separate:

```powershell
./.venv/Scripts/python.exe python/verify_cylindrical_examples.py --output ./runs/cylindrical-verification-01
```

On Linux use `./.venv/bin/python`. This verifies recorded output hashes,
deterministic self-play, native learned-model loading/search and rejection cases
for the specified synthetic profiles. Actual browser-worker agreement remains
a separate check. See [the cylindrical example](../examples/cylindrical-policy/README.md).

Additional training families have their own commands and evidence; see
[training families](TRAINING_FAMILIES.md). The verifier above does not imply
coverage of every model interface in the application.

## 3. Check the built browser

Install the declared browser dependency, then run:

```text
npm run test:browser
npm run test:step-upload
```

These classic tests exercise prepared cases, shared material and the supplied
voxel STEP fixtures. The STEP suite includes invalid input, grid limits,
cancellation and local-file privacy. They do not cover every adaptive profile.
Candidate-specific and adaptive browser checks must be recorded separately with
their tested case/model/runtime identities.

Manually follow the [industrial guide](GYM_QUICKSTART.md),
[operator guide](OPERATOR_INPUT_QUICKSTART.md), and
[STEP guide](../examples/step/README.md). Confirm that suggestions/previews are
read-only, explicit run/apply actions are clear, rejected/stale results do not
commit, and reset/restore/replay have the declared effects.

## Evidence and limits

Use [verification status](VERIFICATION_STATUS.md) to locate retained receipts.
For each result, distinguish:

| Evidence | Establishes | Does not establish |
| --- | --- | --- |
| Hash/schema check | The exact expected bytes or contract were supplied | Geometric correctness |
| Native replay/training | The bounded recorded transitions and numerical updates reproduce | Better policy or industrial generalization |
| Browser/native agreement | The checked interface path agrees for the tested inputs | All geometry/profile coverage |
| Independent-user run | The declared scenario is usable without developer coaching | Other platforms or whole-module acceptance |
| Sampled geometric outcome | The represented samples meet the stated condition | Physical manufacturing qualification |

Do not edit expected outputs merely to accommodate a failure. Record the cause;
an intentional behavior change needs an explicit new-version expectation while
preserving V1 references. A release may only advertise the workflows whose
applicable gates pass. Required whole-module unknowns remain open.
