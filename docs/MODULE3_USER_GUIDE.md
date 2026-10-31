# Reusable Results V2 — Module 3: user guide

This guide is for people using the **Reusable Results V2 — Module 3** app with case 3-29-00350. It explains what to do in the browser. The hosted app needs no local installation.

## How to use the documentation

1. Open the [hosted application](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/?case=industrial_reach_00350#gym) and keep this guide beside it. Follow sections 1–2 to inspect stock and record a baseline.
2. Continue with sections 3–4 to provide feedback, train or use a compatible model. You can inspect and apply actions without training.
3. For each recorded decision and training screen, follow the [detailed illustrated walkthrough](ILLUSTRATED_MODULE3_MANUAL.md#fresh-training-workflow). For full-sequence inference, use its [separate illustrated steps](ILLUSTRATED_MODULE3_MANUAL.md#full-sequence-inference).
4. For installation, code, contracts or validation, use the [developer guide](MODULE3_DEVELOPER_GUIDE.md). For other cases, see section 5 below.

The screenshots document dated example runs, so current screens may differ. Click a screenshot to see it at full size. For current controls, see the [drilling and sequence guide](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/guide/#drilling-controls).

The app is a research demonstrator using sampled material. Its results are not an approved manufacturing plan. The modeled reach is not a physical tool or holder model.

## 1. Open the case and inspect the stock

Open [Reusable Results V2 — Module 3](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/?case=industrial_reach_00350#gym). Select the 3-29-00350 case and inspect the stock, target and holding material. Use **Reset stock** if you want to start again from the original stock.

Choose **Turning**, **Outside turning** and **Tool reach 40 mm**. Preview the action: orange shows the proposed removal. Preview does not change accepted stock. When you are ready, select **Apply to 3-29-00350**.

[![Original stock and turning controls](images/industrial-reach/01-original-stock.jpg)](images/industrial-reach/01-original-stock.jpg)

*Original stock and the process, direction and reach controls. Select a screenshot to open it at full size.*

## 2. Follow and save a baseline

1. In **Baseline and model → Record and replay**, choose **Path 1 — user plan**, then **Load selected baseline**.
2. Select **Preview next baseline action**, inspect the proposed cut and choose **Apply**. Repeat until the sequence is complete. The recorded example contains 11 accepted decisions, including drilling and final profiling.
3. Expand **Feature progress** to inspect the listed checks. Select **Download industrial decisions** to save your actual recording. **Download baseline** saves the named reference separately.
4. Use **Reset stock** and **Restore industrial decisions** to check a saved recording. During replay, use **Return to my stock** to return to your accepted stock.

[![Completed Path 1 example](images/industrial-reach/14-path1-complete.jpg)](images/industrial-reach/14-path1-complete.jpg)

*The recorded example after its final Apply. The displayed zero is sampled residual, not proof of a finished physical part.*

See [all 11 illustrated decisions](ILLUSTRATED_MODULE3_MANUAL.md#2-apply-and-record-all-11-path-1-decisions) and [the current drilling controls](https://mingwucn.github.io/AutoCAM_UI/rrv2_module3/guide/#drilling-controls).

## 3. Record a preference and train

A recorded sequence and a preference are separate inputs. To reproduce the example, compare Path 1 and Path 2, select Path 2 and use **Add whole-sequence preference**. Confirm the saved feedback shows Path 2 preferred over Path 1. Load **Greedy — maximum current removal** to include the third reference episode, then download the training input.

[![Saved sequence preference](images/industrial-reach/16c-path2-preference-confirmed.jpg)](images/industrial-reach/16c-path2-preference-confirmed.jpg)

*One explicit whole-sequence preference saved in the recorded example.*

Choose **Initial model** as the starting model and select **Train model**. Save the training report and the before and after checkpoints. For a comparison with random experience, generate and save a random sequence, retain the new training input, and train again from the same Initial model. Keep the two runs' files separate. See the [complete preference and training walkthrough](ILLUSTRATED_MODULE3_MANUAL.md#fresh-training-workflow) for each screen and the recorded results.

Training updates a compatible model; applying an action alone does not train it. A changed model is not by itself evidence of improved decisions.

## 4. Use a model and inspect results

- Use **Use initial model** or **Load industrial model** to select a compatible V2 checkpoint.
- **Suggest industrial policy** suggests a next action for the current accepted stock. Preview it and explicitly apply it if desired.
- **Search industrial MCTS** searches for a next action using the chosen search settings. Inspect its suggestion before applying it.
- **Run full-sequence inference** generates a sequence from original stock using the loaded model without training. Inspect the actions and remaining material, replay the result, and download the sequence and its associated model. A guard-limited result can be partial.
- **Run inference and compare** compares the exact before/after pair retained from the last successful training. Keep the task and starting conditions consistent when comparing results.

[![Full-sequence inference controls](images/industrial-reach/full-01-controls-initial.jpg)](images/industrial-reach/full-01-controls-initial.jpg)

*Model selection and inference controls in the recorded example.*

For the illustrated sequence, replay and downloads, see [full-sequence inference](ILLUSTRATED_MODULE3_MANUAL.md#full-sequence-inference). V2 checkpoints are specific to this workflow; do not substitute checkpoints from the classic industrial or synthetic cases.

## 5. If you need another workflow

The root application includes other industrial and synthetic examples and supported STEP routes. Their controls, training inputs and model compatibility differ. Consult the [workflow catalogue](WORKFLOW_CATALOGUE.md), [capability matrix](CAPABILITIES.md) and [troubleshooting guide](TROUBLESHOOTING.md). The [original illustrated manual](ILLUSTRATED_MODULE3_MANUAL.md) retains the broader examples and dated verification record.
