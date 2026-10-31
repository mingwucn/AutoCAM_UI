# AutoCAM GYM — Module 3

Explore material removal, build industrial rule baselines, give sequence/action
preferences and fine-tune compatible models locally. This is a software research demonstrator. Sampled zero residual and
changed model weights do not establish a qualified manufacturing plan.

This checkout is the Module 3 remediation candidate, based on GYM V1 commit
`de20f204114767124296542d8d8ecc0361e7666a`. Read
[verification status](docs/VERIFICATION_STATUS.md) for what has actually been
tested, published and accepted.

## Start here

**Using the app?** Start with the [user guide](docs/MODULE3_USER_GUIDE.md). It
explains how to open the app, apply actions, save a sequence, give feedback and
use a model. Then follow the [detailed screenshot walkthrough](docs/ILLUSTRATED_MODULE3_MANUAL.md#fresh-training-workflow)
to reproduce the recorded example step by step.

**Developing or validating?** Start with the [developer guide](docs/MODULE3_DEVELOPER_GUIDE.md)
for the source map, setup, contracts and checks. Read the user guide first to see
the operator workflow.

**Try it now:** open the [hosted Reusable Results V2 — Module 3 app](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/?case=industrial_reach_00350#gym).
The app runs in the browser; GitHub displays the source and documentation. A
separate [hosted illustrated workflow](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/guide/)
accompanies the app.

The guides focus on V2 case 3-29-00350. Its recordings and checkpoints are
specific to that workflow. The detailed manual also contains older root and
synthetic examples; use their own guides and compatible models. Screenshots and
results describe the dated versions identified in the manual, so current
screens may differ. For current controls and status, read the [drilling milestone](docs/MILESTONES.md),
[documentation consistency review](docs/DOCUMENT_CONSISTENCY_REVIEW.md) and
[verification status](docs/VERIFICATION_STATUS.md).

Open the [application](index.html) from the published documentation to try
built-in cases without a local installation. In a repository preview, use the
project's deployment link to reach the running website. For local example files, a local build or
training, follow [public source acquisition and installation](docs/INSTALLATION.md).

| What you want to do | Guide | Expected outcome |
| --- | --- | --- |
| Use Reusable Results V2 — Module 3 | [V2 user guide](docs/MODULE3_USER_GUIDE.md) | Phase-gated 00350 cuts, explicit drilling/finishing, local training, loaded-model full-sequence inference and one-step policy/MCTS |
| Try the original industrial 00350 example | [GYM quickstart](docs/GYM_QUICKSTART.md) | Classic three-cut sequence, shared stock and replay |
| Fine-tune the original two industrial cases with feedback | [Industrial learning](docs/INDUSTRIAL_LEARNING_QUICKSTART.md) | Classic rule baseline, sequence/action-kind preferences, learned reward, RL checkpoint and policy/MCTS comparison |
| Record synthetic choices, train and use a model | [Operator learning](docs/OPERATOR_INPUT_QUICKSTART.md) | Separate fixed-reward synthetic workflow and compatible checkpoint |
| Train task-5/task-6 decision downloads | [Recorded training](docs/RECORDED_TRAINING_QUICKSTART.md) | Separate family-compatible local training and model loading |
| Prepare your own STEP input | [STEP examples](examples/step/README.md) | Supported-profile preparation/actions, or an explained rejection |
| Use regional or cylindrical learning | [Training families](docs/TRAINING_FAMILIES.md) | Exact task/model compatibility, packaged commands and examples |

This repository is the complete Module 3 delivery being reviewed. Use the
[workflow catalogue](docs/WORKFLOW_CATALOGUE.md) for every advertised family,
[what is supported](docs/MODULE3_SCOPE.md) and the
[case/profile table](docs/CAPABILITIES.md) before choosing a workflow. The
industrial rule baseline, preference learning, synthetic learning and adaptive STEP routes have
different capabilities.

## Run this checkout

Install Node.js 24 and Python 3.12. From this repository root:

```text
npm ci
npm run build:release
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

On Linux use `python3.12` for the final command. Open
`http://127.0.0.1:8080/rrv2_module3/?case=industrial_reach_00350#gym`
for V2. The original application remains at the server root.
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
