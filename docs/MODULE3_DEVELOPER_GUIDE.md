# Reusable Results V2 — Module 3: developer guide

This guide is for developers, maintainers and reviewers of the Module 3 delivery. It maps the V2 workflow to source, setup and verification documents. For the operator's actions and screenshots, read the [user guide](MODULE3_USER_GUIDE.md).

## Reading order

1. **Understand the behavior:** follow the [user guide](MODULE3_USER_GUIDE.md), then the [recorded walkthrough](ILLUSTRATED_MODULE3_MANUAL.md#fresh-training-workflow) for exact steps and dated observations.
2. **Choose the scope:** read the boundaries below and consult the [workflow catalogue](WORKFLOW_CATALOGUE.md) and [capabilities](CAPABILITIES.md).
3. **Run or change the code:** use the source map and setup below; follow [installation](INSTALLATION.md) for platform-specific commands and revision pinning.
4. **Check a result:** use [validation](VALIDATION_GUIDE.md), [verification status](VERIFICATION_STATUS.md) and the manual's [evidence record](ILLUSTRATED_MODULE3_MANUAL.md#evidence-and-draft-status). Match each observation to its revision and case.

The [hosted app](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/?case=industrial_reach_00350#gym) and GitHub's default branch can be at different revisions. Use the served `release.json` as described in the installation guide when reproducing a deployed result.

## Scope and model boundaries

The current V2 route is `rrv2_module3/` and uses the `industrial_reach_00350` case. It has separate phase, action, recording, feedback and model contracts. The classic root application has its own `industrial` and `industrial_00289` routes; the synthetic mixed route uses another fixed-reward model. Do not interchange their episodes or checkpoints. See the [V2 guide](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/guide/), [workflow catalogue](WORKFLOW_CATALOGUE.md), [capabilities](CAPABILITIES.md), and [original industrial contract](INDUSTRIAL_LEARNING_CONTRACT.md).

This is a sampled research demonstrator. Preview, geometric gates and modeled reach do not qualify a physical machining plan or establish physical tool and holder clearance. The documentation and test results do not represent independent human acceptance.

## Source map

| Location | What to read there |
| --- | --- |
| `prototypes/industrial-reach/` | V2 source, recorded examples and illustrated workflow source; read its README in the checkout. |
| [Industrial Reach build script](../scripts/build-industrial-reach.cjs) | Builds the V2 route into the release output. `rrv2_module3/` is a generated route, not a source directory at the repository root. |
| [Module 3 scope](MODULE3_SCOPE.md) | Scope and links to the wider documentation. |
| [Module 3 browser check](../tests/module3-workflow-browser.mjs) | An example of an automated check; select tests for the changed surface and report the actual result. |

## Source, setup and execution

Use [installation](INSTALLATION.md) for the supported platform commands and how to pin a checkout to the revision reported by the served release. Record the source revision when reproducing an observation. The repository README specifies Node.js 24 and Python 3.12. A normal local release build is:

```sh
npm ci
npm run build:release
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8080/rrv2_module3/?case=industrial_reach_00350#gym`. Use the platform-specific Python command in the installation guide. The release build downloads pinned runtime/CAD dependencies; see that guide for network and local training requirements. Opening a built HTML file directly is not equivalent to serving it over HTTP.

## Workflow and data flow

1. **State and action:** a preview proposes a cut against accepted sampled stock; explicit Apply accepts an eligible action. Recording captures decisions and transitions. Replay is distinct from adopting a checked recording; restoring decisions is explicit.
2. **Inputs:** named baselines and saved recordings form training experience. Sequence and action-kind preferences are explicit feedback. Unsaved manual history is excluded from the recorded V2 training input. Preserve the exact downloaded input and model identity.
3. **Training:** the V2 browser workflow trains from the selected compatible starting model and saved input. Save the training report and before/after checkpoints. For a controlled random-experience comparison, start both runs from the same Initial model and change the saved experience as described in the [recorded example](ILLUSTRATED_MODULE3_MANUAL.md#fresh-training-workflow).
4. **Inference:** policy and MCTS suggest a next action from current accepted stock. Full-sequence inference starts from original stock with a snapshot of the loaded model; it does not train. Compare uses the retained pair from the last successful training. Treat partial or guard-limited rollouts as partial.
5. **Evaluation:** compare compatible runs at matching states and conditions; inspect actual decisions and sampled completion. Changed weights or a successful training run do not alone establish improved decisions.

The [full-sequence walkthrough](ILLUSTRATED_MODULE3_MANUAL.md#full-sequence-inference) documents controls, downloads and observed behavior. The [functional contract](FUNCTIONAL_CONTRACT.md), [training guide](TRAINING_GUIDE.md), [training families](TRAINING_FAMILIES.md), and [developer reference](REFERENCE_UI_README.md) cover the wider delivery. Check each document's stated route and version before applying it to V2.

## Verification and troubleshooting

Follow the [validation guide](VALIDATION_GUIDE.md) and [verification status](VERIFICATION_STATUS.md) for the scope and status of existing checks. The repository provides `npm run check:docs`, `npm run test:unit`, `npm run test:module3-workflow`, and `npm run test:python`; these have different prerequisites and coverage. Select checks for the changed surface and report actual results, rather than treating their existence as proof of a pass. Use the [acceptance checklist](ACCEPTANCE_CHECKLIST.md) for independent review and [troubleshooting](TROUBLESHOOTING.md) for installation, input and model issues.

The original manual's [evidence and draft status](ILLUSTRATED_MODULE3_MANUAL.md#evidence-and-draft-status) and [documentation consistency review](DOCUMENT_CONSISTENCY_REVIEW.md) describe dated observations and remaining limits. Do not generalize a historical result to another source revision or case.
