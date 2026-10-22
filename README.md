# AutoCAM GYM — Module 3

Explore material removal, record decisions and train compatible synthetic models
locally. This is a software research demonstrator. Sampled zero residual and
changed model weights do not establish a qualified manufacturing plan.

This checkout is the Module 3 remediation candidate, based on GYM V1 commit
`de20f204114767124296542d8d8ecc0361e7666a`. Read
[verification status](docs/VERIFICATION_STATUS.md) for what has actually been
tested, published and accepted.

## Start here

Read the [illustrated Module 3 manual](docs/ILLUSTRATED_MODULE3_MANUAL.md) for
19 application screenshots, step-by-step workflows and linked responses to
reviewer comments 9–12.

Open the [application](index.html) from the published documentation to try
built-in cases without a local installation. In a repository preview, use the
project's deployment link to reach the running website. For local example files, a local build or
training, follow [public source acquisition and installation](docs/INSTALLATION.md).

| What you want to do | Guide | Expected outcome |
| --- | --- | --- |
| Try the industrial 00350 example | [GYM quickstart](docs/GYM_QUICKSTART.md) | Three sampled cuts, shared stock and replay |
| Record choices, train and use a model | [Operator learning](docs/OPERATOR_INPUT_QUICKSTART.md) | Replay-verified updates, compatible checkpoint and policy/MCTS comparison |
| Train task-5/task-6 decision downloads | [Recorded training](docs/RECORDED_TRAINING_QUICKSTART.md) | Separate family-compatible local training and model loading |
| Prepare your own STEP input | [STEP examples](examples/step/README.md) | Supported-profile preparation/actions, or an explained rejection |
| Use regional or cylindrical learning | [Training families](docs/TRAINING_FAMILIES.md) | Exact task/model compatibility, packaged commands and examples |

This repository is the complete Module 3 delivery being reviewed. Use the
[workflow catalogue](docs/WORKFLOW_CATALOGUE.md) for every advertised family,
[what is supported](docs/MODULE3_SCOPE.md) and the
[case/profile table](docs/CAPABILITIES.md) before choosing a workflow. The
industrial greedy baseline, synthetic learning and adaptive STEP routes have
different capabilities.

## Run this checkout

Install Node.js 24 and Python 3.12. From this repository root:

```text
npm ci
npm run build:release
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

On Linux use `python3.12` for the final command. Open
`http://127.0.0.1:8080/?case=industrial&process=turning#gym`.
The release build downloads pinned runtime/CAD assets; the classic catalogue
also requires network access. See [installation](docs/INSTALLATION.md) for
platform commands, source identity and local training dependencies.

## Check the results

[Examples](examples/README.md) include inputs, expected results and limitations.
The existing mixed A/B examples change 28 of 34 weights each; their selected
actions remain unchanged at the published comparison states. This is an expected
result, not a claim of improved performance.

Use the [validation guide](docs/VALIDATION_GUIDE.md) for automated checks and the
[acceptance checklist](docs/ACCEPTANCE_CHECKLIST.md) for independent use.
[Troubleshooting](docs/TROUBLESHOOTING.md) covers dependency, input and model errors.
[Knowledge scope](docs/KNOWLEDGE_SCOPE.md) explains the executable constraints
delivered here and the rule-authoring/activation functions that are unavailable.

Technical details: [functional contract](docs/FUNCTIONAL_CONTRACT.md),
[developer reference](docs/REFERENCE_UI_README.md),
[original V1 provenance](docs/PUBLICATION_PROVENANCE.json).

Owners: Ming Wu (GYM); Daan Maes and Ming Wu (operator input).
