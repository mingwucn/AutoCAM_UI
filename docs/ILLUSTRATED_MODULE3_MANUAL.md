# AutoCAM Module 3 — illustrated user manual and verification record

**Draft · 21 October 2026 · agent-tested software demonstrator.** This document covers the single [AutoCAM_UI repository](https://github.com/mingwucn/AutoCAM_UI) and its [hosted application](https://mingwucn.github.io/AutoCAM_UI/). It explains the workflow, the observed results and the remaining limits. It is not an independent human acceptance record or manufacturing approval. Video is deferred.

<a id="verification-identity"></a>

The initial walkthrough used public source `c602567afb005777315ee6ecdd3696ffafb26dd6`. The [tested source revision](https://github.com/mingwucn/AutoCAM_UI/tree/c602567afb005777315ee6ecdd3696ffafb26dd6) identifies that historical walkthrough; its detailed execution records are retained separately from this product manual. One Windows training-packaging defect was found and repaired in a separate candidate checkout. Candidate checks are identified below; they do not retroactively change the original public result.

<a id="scope"></a>

## 1. What Module 3 does

GYM is the interactive environment: load a supported case, inspect material and tools, choose a checked action, apply it, and retain the resulting history. Learning uses compatible recorded decisions or the advertised self-play routes. The resulting model can rank choices or guide bounded MCTS search in its own task family. Knowledge formalization consists of executable input, state, action, tool and model contracts.

| Function | User input → output | Boundary |
| --- | --- | --- |
| Industrial and teaching GYM | Prepared case + action → changed shared stock, sequence and replay | Sampled geometry and a staged greedy baseline; no trained industrial policy |
| Local STEP | STEP + engine/profile + stock/tool settings → prepared stock, inspection and eligible actions | Import, inspection and machining are separate stages; support depends on the chosen profile |
| Mixed operator learning | Recorded turning/face/drill decisions + starting checkpoint → replay-verified learning and 34-weight checkpoint | Synthetic task; fixed reward; policy/MCTS suggestions require explicit preview and acceptance to execute |
| Task-5/task-6 learning | Family-compatible recorded episode → separate learned checkpoint | Their **Run model** controls execute a checked choice; task-5 and task-6 contracts differ |
| Regional v2/v3 learning | Compatible episode/task context → 48-/50-feature family model | Exact version and prepared context must match |
| Cylindrical v1–v3 learning | Configuration + initial state + model, optionally decisions → learned weights and replay record | Bounded MCTS and explicit Apply; no separate policy button |
| Other model consumers | Compatible task-4, combined or indexed model → supported inference/search | No standalone trainer for these families is promised by this package |
| Knowledge constraints | Exact schemas, state identities and geometric/model checks → accepted operation or stated rejection | No general company-rule authoring, review, qualification or activation service |

The [public workflow catalogue](https://mingwucn.github.io/AutoCAM_UI/docs/WORKFLOW_CATALOGUE.html) lists all 23 advertised families and their exact inputs. This manual groups related functions for readability; it does not mark all 23 browser routes passed.

<a id="figure-1"></a>

![Workflow guide and supported stages](images/module3/01-workflow-scope.jpg)

*Figure 1 — Start by reading the workflow capability banner and opening **Supported stages and restrictions**. Select the route that supports the intended stage. The STEP section identifies its supported geometry boundary.*

<a id="figure-2"></a>

![Published capability matrix with supported-stage legend](images/module3/12-capability-matrix.jpg)

*Figure 2 — The public capability matrix separates import, stock preparation, inspection, machining, recording/replay, policy, MCTS and local training. Its legend distinguishes supported, restricted, external and unavailable. Read the selected profile across the row; an available import or inspection stage does not promise every later stage. [Public matrix](https://mingwucn.github.io/AutoCAM_UI/docs/CAPABILITIES.html).*

<a id="installation"></a>

## 2. Open the app or install the local trainer

For browser use, open the [hosted application](https://mingwucn.github.io/AutoCAM_UI/) and its **Build identity** link. Record the displayed source revision. A hosted build and an unpublished repair checkout are different versions.

For local installation, acquire the public source matching the currently served build and record its identity:

```powershell
$publishedRevision = (Invoke-RestMethod -Uri 'https://mingwucn.github.io/AutoCAM_UI/release.json' -ErrorAction Stop).source_repository.revision
if ($publishedRevision -notmatch '^[0-9a-f]{40}$') { throw 'The served release has no valid source revision.' }
git clone https://github.com/mingwucn/AutoCAM_UI.git
if ($LASTEXITCODE -ne 0) { throw 'Clone failed.' }
Set-Location -LiteralPath AutoCAM_UI -ErrorAction Stop
git checkout --detach $publishedRevision
if ($LASTEXITCODE -ne 0) { throw 'Published checkout failed; stop here.' }
git rev-parse HEAD
git status --short
node --version
npm --version
npm ci
npm run build:release
```

**Historical reproduction only:** the walkthrough's exact source was `c602567afb005777315ee6ecdd3696ffafb26dd6`. Checking out that fixed revision reproduces the initial observations, including the cylindrical issue; it does not acquire a later repair. The primary recipe above selects the served source, which may still contain that issue until the correction is published.

Select an installed **Python 3.12** interpreter as `python` before the next commands; confirm the version. The walkthrough machine default was 3.13, so an installed 3.12 interpreter was explicitly selected. Use a fresh checkout-local environment:

```powershell
python --version
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r python/requirements.txt
node scripts/python-command.mjs --version
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8080/`; keep the server terminal open. On Linux, the [installation guide](https://mingwucn.github.io/AutoCAM_UI/docs/INSTALLATION.html) uses `python3.12` and `.venv/bin/python`. The initial installation passed with Node 24.14.0, npm 11.9.0 and Python 3.12.13. Only declared Python requirements were installed. No Master checkout or custom `PYTHONPATH` was used. The build and local HTTP checks passed.

The release build downloads pinned runtime/CAD dependencies. Classic catalogue data and some runtime requests also need network access. Opening `dist/index.html` directly does not replace serving it over HTTP. Follow the repository [installation guide](INSTALLATION.md) for prerequisites and [validation guide](VALIDATION_GUIDE.md) to reproduce the build checks.

<a id="industrial-workflow"></a>

## 3. Industrial GYM: three actions on shared stock

1. Select **Industrial · 3-29-00350**. Choose **Reset stock** if an earlier sequence exists. Inspect the target, holding material and excess stock.
2. Select **Turning**, **Outside turning**, **40 mm** tool reach; apply the action.
3. Switch **Process** to **Milling** without resetting. Choose **From above (−Z)**, **80 mm** reach; apply.
4. Choose **From below (+Z)**, **40 mm** reach; apply.
5. Select **Replay my steps**. Review the same recorded sequence, then return to live stock. Use **Reset stock** for a new run.

| State | Expected sampled excess | Observed |
| --- | ---: | --- |
| Initial | 388,600 mm³ | Reference start |
| After outside turning | 286,750 mm³ | Recorded browser action |
| After milling −Z | 33,236 mm³ | Recorded browser action |
| After milling +Z | 0 mm³ | Three actions; target and holding material preserved |

<a id="figure-3"></a>

![Industrial result after the three documented actions](images/module3/02-industrial-complete.jpg)

*Figure 3 — The result screen shows **0 mm³ excess**, **3 applied actions** and the turning/milling sequence. The final action removes 33,236 mm³. This demonstrates shared sampled stock; it does not establish a qualified machining plan.*

<a id="figure-4"></a>

![Industrial target and holding material in linked 3D and section views](images/module3/02a-industrial-material-view.jpg)

*Figure 4 — The linked 3D material and 2D section views show the retained target and holding material after the three cuts. Camera and cutaway controls affect inspection, not accepted stock.*

**Play greedy baseline** demonstrates staged removal: turning first, then milling. It is not trained RL or an optimal plan. View rotation, cutaway and section controls change the display, not the accepted material. An exhausted action must not fabricate further progress. [Guide](https://mingwucn.github.io/AutoCAM_UI/docs/GYM_QUICKSTART.html).

<a id="step-input-boundaries"></a>

## 4. Your own STEP: select the supported route first

| Route | Starting example/settings | Supported boundary |
| --- | --- | --- |
| Classic voxel | `core/tests/fixtures/box.step`; pitch 2 mm, stock allowance 2 mm, reaches `2, 4`, spindle Z, negative held end, holding length 2 mm | Sampled stock and turning/milling actions; resolution has a cell budget |
| Classic B-Rep | Same box; OpenCascade B-Rep, deflection 0.2 mm, allowance 5 mm, reaches `5, 10, 20`, spindle Z, negative held end, holding length 5 mm | Supported STEP operations and checked actions; not every imported shape guarantees all operations |
| Adaptive planar | Axis-aligned planar profile; box stock, margin 2.5 mm, allowance 0.5 mm, spindle Z, Coarse depth 4 | Stock/allowance preparation and original-face inspection; machining needs its separate setup/policy |
| Adaptive coaxial or spherical | Exact profile and fixture/setup pairing in the catalogue | Supported coaxial parts or complete principal-frame spheres; not arbitrary curved solids |
| Adaptive rational prism | Exact supported experimental input and settings | Preparation and inspection only; machining unavailable |

<a id="step-workflow"></a>

### Classic STEP screen sequence

Expand **Open your STEP file**, select the engine, choose the file and enter its settings. Select **Prepare shadow gym** and wait for completion. Apply an available turning action, then switch to milling and apply an available milling action. Inspect the persistent history and remaining stock. Replay and reset have the same explicit meanings as the industrial route.

The manual-only browser run used box input on both classic engines. The voxel run retained two actions across the process switch, with 352 mm³ and 256 mm³ removed and 384 mm³ excess remaining. The B-Rep run retained two actions, with approximately 3,689.8 mm³ and 274.952 mm³ removed and 48.805 mm³ excess remaining. These are different representations and settings, not equivalent accuracy claims.

<a id="figure-5"></a>

![B-Rep STEP input settings](images/module3/03a-step-input-settings.jpg)

*Figure 5 — B-Rep setup for `box.step`: display deflection 0.2 mm, stock allowance 5 mm, reaches 5/10/20 mm, spindle Z, negative held end and holding length 5 mm. Set these before **Prepare shadow gym**.*

<a id="figure-6"></a>

![STEP case after turning and milling](images/module3/03-step-shared-stock.jpg)

*Figure 6 — The B-Rep case retains two 10 mm-reach actions across the process switch: turning removes approximately 3,689.8 mm³ and milling 274.952 mm³. The remaining 48.805 mm³ is still excess; this screen does not claim completion.*

<a id="step-replay"></a>

Select **Replay my steps**, then **Previous**, **Play** or **Next** to inspect recorded states. Select **Return to my stock** to leave replay and resume the live accepted state. Keep **Download actions** and **Download original STEP** together for local reproduction.

<a id="figure-7"></a>

![B-Rep replay at the first of two recorded steps](images/module3/13-step-replay.jpg)

*Figure 7 — Replay is at **1 / 2**: it shows the turning step's **3,689.8 mm³ removed**, **323.757 mm³ excess** and one applied action at that historical point. Both saved history entries remain listed. This is inspection of a recorded state, not another committed cut. **Return to my stock** returns to the live two-action state.*

<a id="failure-recovery"></a>

### Failure recovery is part of the workflow

After a valid case exists, try the guide's rejection examples. `broken.step` containing `not a STEP model` must fail import. Box pitch `0.01` must reject the excessive grid. Cancel a preparation and retain the previous accepted stock. Do not interpret an error as a new valid empty case.

The browser record shows **1,680,000,000 cells; limit 300,000** for the tiny-pitch attempt, while the prior two-action stock remains visible. Malformed-input and cancellation observations also retain that prior case.

<a id="figure-8"></a>

![B-Rep malformed STEP import rejection](images/module3/04-step-rejection.jpg)

*Figure 8 — A separate B-Rep malformed-input attempt reports **OpenCascade could not read the STEP input** in the preparation form. This screenshot shows the error, not the earlier history in the same frame. Prior-state retention must be assessed from the corresponding state record.*

<a id="adaptive-stock-faces"></a>

### Adaptive stock and original faces

Expand **Prepare stock from your STEP file**. Choose the supported profile, stock shape, margin, allowance, spindle direction and partition detail, then **Prepare STEP stock**. Retain **Download initial stock**, **Download target certificate** and **Download stock proposal**. Open **Original faces and import record** and inspect its exact record.

The tested planar allowance example produced stock bounds **15 × 13 × 11 mm**, allowance **0.5 mm**, **2,976 partition cells** and **6 original faces**. Its message explicitly says boundary uncertainty remains. Face provenance records the imported source and frame; `machining_features_assigned` and `contact_assessed` are false. Face inspection therefore does not imply recognized machining features or qualified contact.

<a id="figure-9"></a>

![Prepared adaptive planar stock and original-face import record](images/module3/05-original-face-record.jpg)

*Figure 9 — The completed preparation/inspection screen reports **2,976 partition cells**, continuing boundary uncertainty, **6 original faces** and **OpenCascade 7.8.1**. The import record and stock-stage downloads are available, while machining setup is a separate next stage. Original faces are not automatically machining features or proof of tool access. This demonstrates preparation and inspection only; it does not close planar machining.*

The saved planar machining receipt at this draft's cutoff still says **Preparing source-derived machining candidates**. It is not counted as a completed machining run. Coaxial, spherical, rational and other uncompleted browser scenarios remain open in this particular walkthrough; available native fixture results do not close those UI checks.

<a id="operator-learning"></a>

## 5. Operator decisions → local learning → browser model use

<a id="training-overview"></a>

### Read this first: what does training mean here?

**You choose the demonstrated actions. Fixed geometric and tool checks determine which actions are available. A fixed reward determines what the learner scores as useful.** These are three separate parts of the system.

The learning route described here is **Synthetic learning gym: turning, face milling and drilling; local weights and recorded actions**. It uses a small linear action-value model with **34 learned weights**. The model scores available actions for the current state. The classic industrial GYM uses its separately labelled greedy baseline; it does not use this training route.

<a id="rules-and-learning"></a>

| Part | Who or what controls it? | What happens in this release? |
| --- | --- | --- |
| Allowed actions and constraints | Existing geometric/tool checks and the selected task | Check the available tool, stock, setup and action. The learned model cannot override an unavailable action. |
| Demonstration | You | Choose among the exposed checked actions: tool, turning radius, facing stepover, workpiece index and operation order where offered. Accepted choices and their outcomes form the recording. |
| Learning objective | The existing task's fixed reward | Score progress toward the constructed face/hole requirements and completion; charge synthetic time and apply repeat, no-op and excess penalties. Recording a choice does not change this reward. |
| Training | Local Python trainer | Replay and verify the recording, then adjust the model's weights using the recorded rewards and estimated future action values. |
| Policy suggestion | Loaded model | Score the currently available actions and suggest one. |
| MCTS suggestion | Search using the simulator and loaded model | Explore a bounded set of possible next actions and suggest one. In this mixed-learning UI, suggestions require your explicit Preview/Accept to execute. |

**Accepting actions in the browser records training data. It does not train or update the model. Running the Python training command creates the updated checkpoint.** You then load that checkpoint back into the browser.

<a id="choosing-preferred-solution"></a>

### Can I teach the solution I prefer?

**You can demonstrate your preferred available sequence, but this release has no “prefer solution A over B” training control.** The recording supplies the chosen actions and their outcomes. The learner updates action values under its existing reward; it does not simply copy the operator or treat every demonstrated choice as best.

You can choose a different exposed tool, action order, turning radius or facing stepover when the task offers it. You cannot use this workflow to teach a new geometric rule, authorize a blocked action, supply a new unexposed toolpath, or select a new learning objective such as surface finish or tool life. Those preferences are not represented by a user preference setting in the current trainer. No free-text preference or good/bad solution label is consumed.

For example, the supplied demonstrations use the same task and starting model:

| Your chosen demonstration | Facing stepover | Synthetic facing cost | Synthetic whole-sequence cost |
| --- | --- | --- | --- |
| A | 9 mm | 65.4 s | 161.6 s |
| B | 4 mm | 132 s | 228.4 s |

Both complete the constructed requirements. Choosing B records the 4 mm choice; it does not tell the learner that a smaller stepover is preferable or should outweigh time. The model has no measured surface-quality objective in this example. The fixed reward still charges B's longer simulated time. These are synthetic costs, not measured machining times.

**A demonstration is not a guarantee of imitation or improvement.** Both A and B changed 28 of 34 weights, yet the tested starting/A/B models produced the same suggestions at the two comparison states. At the common before-facing state they all selected the 4 mm action. See the [actual A/B results](../examples/operator-input/README.md).

<a id="training-steps"></a>

### Training in five steps

1. **Record in the browser:** open the synthetic learning case; choose, preview and accept checked actions. Use your chosen valid sequence. See [the six-step example](#record-decisions).
2. **Download the data:** select **Download learning decisions**. Keep that actual file; it is an episode, not a trained model.
3. **Train in local Python:** run [the command below](#replay-and-training) with your downloaded episode and the compatible starting checkpoint. A successful run produces a new `checkpoint.json` and replay/training reports.
4. **Load the result:** reset the same compatible case, select **Load learning model**, and choose your new checkpoint. See [load and use](#load-and-use-model).
5. **Evaluate before accepting:** request policy/MCTS suggestions at the same state and compare completion, synthetic cost and chosen actions. Preview and explicitly accept to execute. Changed weights alone do not demonstrate better decisions.

For a controlled A/B comparison, keep the task, starting stock, starting checkpoint and training recipe the same; change only the demonstrated choice. This route verifies a learning workflow for its compatible task. It does not automatically train a policy for a new uploaded industrial part. Other supported training families use [their own commands and compatible inputs](#validation-examples).

<a id="record-decisions"></a>

### Record a new six-step example

Under **Run the adaptive shadow gym**, select **Synthetic learning gym: turning, face milling and drilling; local weights and recorded actions**, then **Open case**. For each choice, use **Preview checked action**, inspect the preview, and explicitly **Accept checked action**. Preview alone must not change stock.

Follow example A: turn to radius **13.5 mm**; transfer to the **15 mm face tool**; index **180°**; face mill with **9 mm stepover**; exchange to the **long drill**; drill. Example B uses **4 mm** facing stepover instead. Wait for each computation to finish before continuing.

At the end select **Download learning decisions** and **Download run details**. Keep the exact files. The decisions schema is `adaptive-mixed-learning-episode-1`; the paired run details retain software/input identities.

The actual new browser sequence reached **Step 6 / 6**, **161.6 s**, with the long drill mounted. Decisions and run details were downloaded from this state. [Matching supplied A decisions](../examples/operator-input/operator-A.json).

<a id="recording-restoration"></a>

After training and model checks, select **Restore learning decisions** and choose the actual downloaded recording. Wait for reconstruction to finish before interpreting the result. The observed restoration reproduced the completed six-step sequence and **161.6 s** elapsed cost.

<a id="figure-10"></a>

![Restored actual downloaded recording reproduces the completed six-step episode](images/module3/06b-recording-replay-complete.jpg)

*Figure 10 — **Restoring the actual downloaded recording** reproduced **Step 6 / 6 · 161.6 s · mixed-drill-long** and **Episode ended: COMPLETE**. The download controls remain available. This image captures successful restoration after the training/model checks; it is not a screenshot of the initial recording session.*

<a id="figure-11"></a>

![Public training workflow guide separating browser and local Python roles](images/module3/06-training-workflow-guide.jpg)

*Figure 11 — The public training guide separates browser recording/model use from local Python training. Choose the guide for the episode's family before running a trainer. This screenshot illustrates the instructions; the actual new recording and model use are illustrated in this section.*

<a id="replay-and-training"></a>

### Train the actual downloaded file

From the repository root, after installing the fresh Python environment, substitute the downloaded filename and choose a new output directory. Use the same training options as the walkthrough:

```powershell
$episode = Read-Host 'Full path to your downloaded decisions JSON'
$model = './examples/operator-input/starting-checkpoint.json'
$episodeHash = (Get-FileHash -LiteralPath $episode -Algorithm SHA256).Hash.ToLower()
$modelHash = (Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLower()
./.venv/Scripts/python.exe python/train_operator_episode.py --episode $episode --expected-sha256 $episodeHash --initial-checkpoint $model --checkpoint-sha256 $modelHash --output ./runs/operator-new-01
```

When prompted, enter the actual absolute or checkout-relative path of your downloaded decisions file. Never reuse a run directory: the trainer rejects overwriting it.

The launcher verifies exact input bytes, reconstructs the episode, checks replay and applies the published fixed TD-Q update: learning rate **0.05**, discount **1**, error clip **1**. The supplied checkpoint has 34 weights. Demonstrated choices provide the operator input; this is not free-text intent learning.

<a id="measured-training-results"></a>

| New recording result | Observed |
| --- | --- |
| Runtime | 189.33 seconds |
| Replay | Verified |
| Updates | 6 |
| Changed weights | 28 of 34 |
| Download SHA-256 | `2b250ff9d4b1f7705482d9c7a86865d8f5e4a87c69542edba5e09548d92fc092` |
| New checkpoint SHA-256 | `f8048a9f5c51a993c5cbfe65ac02776693e388397fbe95f2113397c9dcaa0f22` |

The actual new download happens to match supplied A bytes exactly; the trained checkpoint also matches its reference. The input was the newly downloaded file, not a substituted fixture. The run retains episode, starting checkpoint, recipe, source snapshot, execution environment, learned checkpoint, training report, summary and file inventories. [Matching reference checkpoint](../examples/operator-input/trained-A/checkpoint.json).

<a id="load-and-use-model"></a>

### Load and request a suggestion

Use **Reset to initial stock**. Select **Load learning model** and choose the new `checkpoint.json`. Wait until controls are ready. Choose **16 simulations**, **depth 2**, **exploration 1** for the published comparison; request **Suggest with policy** or **Search with MCTS**. A suggestion does not execute a cut. Use Preview and Accept for an explicit subsequent action.

The saved browser sequence shows the new checkpoint loading followed by ready model controls.

<a id="figure-12"></a>

![Newly trained checkpoint loaded in the hosted application](images/module3/07-new-model-loaded.jpg)

*Figure 12 — The checkpoint produced from the actual new recording (`f8048a9f…aa0f22`) is reimported into the hosted application. The screen confirms **Compatible model loaded**, **Step 0 / 6 · 0 s**, and search settings **16 / 2 / 1**. Loading the model has not accepted a machining action.*

<a id="figure-13"></a>

![Completed policy suggestion from the newly trained model](images/module3/08-model-policy-result.jpg)

*Figure 13 — Selecting **Suggest with policy** completes successfully and selects **Turning · turning-blade-long · 20 mm reach · 0° · 10.5 s**. The message says **Policy suggestion ready. Preview and accept the selected action to apply it.** The screen remains at **Step 0 / 6 · 0 s**: the suggestion has not committed a cut. This completes the observed new-recording → local training → model reload → policy-suggestion sequence.*

The new-model MCTS request subsequently completed with **16 simulations**, **depth 2** and **exploration 1**, selecting a **10.25 s turning action** while the stock remained at Step 0. This completes the observed bounded-search step for the newly trained checkpoint.

<a id="figure-14"></a>

![Completed MCTS suggestion from the newly trained model](images/module3/09-new-model-mcts-result.jpg)

*Figure 14 — The screen reports **MCTS used 16 simulations. Preview and accept the selected action to apply it.** The selected action is **Turning · turning-blade-long · 20 mm reach · 0° · 10.25 s**. Step 0 / 6 and 0 s remain unchanged: search suggests a choice and does not commit the cut.*

Reference A/B learning changes weights, but the published starting/A/B models select the same actions at the two comparison states. Initial policy selects action 0; initial MCTS selects action 1; both select action 8 before facing. Changed weights alone are not evidence of better policy quality. [Mixed guide](https://mingwucn.github.io/AutoCAM_UI/docs/OPERATOR_INPUT_QUICKSTART.html).

<a id="validation-examples"></a>

## 6. Other training families and repository examples

Choose the guide matching the task. A filename or weight-array length cannot establish compatibility.

| Recipe followed in the fresh clone | Actual local outcome | Source guide/example |
| --- | --- | --- |
| Mixed supplied A/B | Both passed; 6 updates and 28 changed weights; checkpoint/training bytes match references | [Operator examples](https://mingwucn.github.io/AutoCAM_UI/examples/operator-input/README.html) |
| Task-5/task-6 manual recordings | Both passed; 2 updates and 2 skipped decisions each | [Recorded training](https://mingwucn.github.io/AutoCAM_UI/docs/RECORDED_TRAINING_QUICKSTART.html) |
| Task-5/task-6 model-MCTS recordings | Both passed; 1 update each; reference outputs match | [Recorded examples](https://mingwucn.github.io/AutoCAM_UI/examples/recorded-training/README.html) |
| Regional v2/v3 | Both passed; 3 updates each; 41/43 changed weights; reference outputs match | [Regional guide](https://mingwucn.github.io/AutoCAM_UI/docs/REGIONAL_TRAINING_QUICKSTART.html) |
| Cylindrical v1 recorded | Passed; 3 samples, replay and input custody verified | [Cylindrical examples](https://mingwucn.github.io/AutoCAM_UI/examples/cylindrical-policy/README.html) |
| Cylindrical all-profile command | Initial Windows path-length failure; repaired candidate passed 5 training cases, 4 learned-model searches and 7 rejection checks | [Cylindrical example and verification recipe](../examples/cylindrical-policy/README.md) |

<a id="figure-15"></a>

![Public examples index linking inputs and expected outcomes](images/module3/14-validation-examples.jpg)

*Figure 15 — The public examples index exposes inputs and expected outcomes for industrial, mixed, recorded, regional and cylindrical workflows. Choose the example matching the task family, then compare actual outputs with its stated reference. A listed example is a reproducibility entry point, not proof that every UI route was executed in this session.*

The public cylindrical acquisition/verification recipe is:

```powershell
./.venv/Scripts/python.exe python/verify_cylindrical_examples.py --output ./runs/cylindrical-verification-01
```

On the original deep Windows checkout, retaining one producer file created a 261-character path and failed before self-play. The focused repair changes filesystem path handling, not learning or geometry. Its regression failed before and passed afterward; six source/output boundary tests passed. Repeating the documented command with a fresh output name produced a 264-character equivalent path and passed, including v2/v3 models. This is candidate repair evidence until the corrected release is published and identified.

Public fixture acquisition also passed:

```text
node scripts/prepare-workflow-examples.mjs --output runs/workflow-examples-01
node tests/spherical-bands-browser.mjs --check-fixtures-only
```

The workflow export produced **37 files across 10 groups**, all matching its receipt. The spherical command produced **4 input cases and 27 native reference actions**, without running a browser. Three cases report complete. Origin sphere with 0.5 mm allowance remains incomplete because regional upper residual 664 exceeds a zero regional budget. That is the recorded outcome, not a silently relabelled pass. [Fixture acquisition instructions](WORKFLOW_CATALOGUE.md).

Browse [examples and expected outcomes](https://mingwucn.github.io/AutoCAM_UI/examples/README.html), [validation instructions](https://mingwucn.github.io/AutoCAM_UI/docs/VALIDATION_GUIDE.html) and the [repository verification status](VERIFICATION_STATUS.md). Canonical checkpoint/training files were compared byte-for-byte. Human-readable summary JSON was compared by values where serialization order/newlines differed.

<a id="knowledge-boundaries"></a>

## 7. Knowledge formalization and use boundaries

| Contract/check | Concrete user-visible meaning |
| --- | --- |
| Shared material and protected regions | Switching turning/milling preserves accepted stock; target/holding samples remain in the industrial example |
| State-bound action acceptance | Preview and suggestion are read-only; acceptance applies a current checked action, not a stale result |
| Finite tool and holder constraints | Family-specific clearance may block a short tool; an unresolved check is not permission |
| Mixed schema pair | `adaptive-mixed-learning-episode-1` and `adaptive-mixed-linear-q-1` belong together |
| Task-5/task-6 schemas | `adaptive-browser-episode-1` embeds the appropriate task-5/task-6 contract; their checkpoints cannot be silently interchanged |
| Regional/cylindrical context | Task version, feature contract, configuration and initial state must match the model |
| Hash and replay checks | Hashes bind bytes; replay also checks valid history. Recomputing a hash after corrupting history does not make it valid |
| Completion and evidence scope | Complete, blocked, truncated, unresolved and failed retain separate meanings; geometric display is not physical qualification |

The delivered knowledge layer is these executable bounded contracts. General company-rule authoring/import, human review, qualified policy activation and machine execution are unavailable here. A point-shadow display does not establish finite-tool clearance. Original CAD faces are import metadata, not automatically assigned machining features. [Knowledge scope](https://mingwucn.github.io/AutoCAM_UI/docs/KNOWLEDGE_SCOPE.html) · [Functional contract](https://mingwucn.github.io/AutoCAM_UI/docs/FUNCTIONAL_CONTRACT.html) · [Training-family compatibility](https://mingwucn.github.io/AutoCAM_UI/docs/TRAINING_FAMILIES.html).

<a id="reviewer-comments-9-12"></a>

## 8. Direct response to reviewer comments 9–12

The concerns below are paraphrased to keep the response tied to observable evidence, rather than presented as verbatim reviewer quotations.

| Comment / original concern | Actual response and verification | Status / remaining work |
| --- | --- | --- |
| **9 — Documentation is difficult to understand or follow.** | Follow [installation](#installation), the [industrial steps](#industrial-workflow), [STEP preparation](#step-workflow), [what training means](#training-overview) and [training in five steps](#training-steps). The [rules/learning table](#rules-and-learning) and [preferred-solution explanation](#choosing-preferred-solution) distinguish operator choice from the fixed learning objective. See the [industrial result](#figure-3), [STEP settings](#figure-5), [policy suggestion](#figure-13) and [MCTS result](#figure-14). The manual-only exercise also identified missing acquisition information, a mismatched import label, reference/new-model ambiguity and discount formatting. | Concrete instructions, screenshots and agent walkthrough evidence are provided. Incomplete UI coverage remains explicit. Independent human comprehension has not been measured. |
| **10 — Validation examples and outcomes are insufficiently visible in Git.** | See the [repository example-index screenshot](#figure-15), [family-by-family validation examples](#validation-examples) and [measured new-recording results](#measured-training-results), including command receipts, hashes and the original/corrected cylindrical result. The [public example index](https://mingwucn.github.io/AutoCAM_UI/examples/README.html) and [validation guide](https://mingwucn.github.io/AutoCAM_UI/docs/VALIDATION_GUIDE.html) provide the repository entry points. Fresh runs reproduced reference checkpoints/training outputs. | Repository examples and reproducible outcomes are demonstrated for the listed routes. Their presence is not a pass for every advertised UI family, held-out model quality or manufacturing validation. |
| **11 — It is unclear what the system can be used for and where its boundaries lie.** | Read the [function/scope map](#scope), [stage-by-stage capability matrix](#figure-2), [supported STEP input boundaries](#step-input-boundaries) and [knowledge/model contracts](#knowledge-boundaries). The [rejection example](#failure-recovery) and [adaptive stock/face limits](#adaptive-stock-faces) show why importing, inspecting, machining and completing are separate claims. | Boundaries are documented and selected positive/rejection cases observed. Arbitrary STEP machining, general knowledge activation and industrial learned-policy quality remain outside the demonstrated scope. |
| **12 — Another user cannot execute the system without developer support.** | The [fresh-install commands](#installation), [replay-before-training recipe](#replay-and-training), [actual model reload and use](#load-and-use-model), [replay controls and recorded-state example](#step-replay), and [failure recovery instructions](#failure-recovery) give executable steps and observed outcomes. The newly recorded episode produced a checkpoint, a [completed policy suggestion](#figure-13) and a [completed bounded MCTS suggestion](#figure-14). The [actual downloaded recording also restored to completion](#recording-restoration). Prerequisite selection, acquisition assistance and the separate Windows repair remain disclosed. | Software execution is demonstrated by an agent. The original guide needed the supplied public repository URL, and the Windows defect needed a code repair. A final corrected release walkthrough and an unassisted human trial are distinct remaining evidence; neither is claimed from this draft. |

<a id="comment-11-subpoints"></a>

### Comment 11: each technical subquestion

| Subquestion | Direct place to read or inspect | Answer and boundary |
| --- | --- | --- |
| What is the GYM and what does it do? | [Function map](#scope), [industrial workflow](#industrial-workflow), [capability matrix](#figure-2) | A stateful material-removal environment with checked actions, shared stock and replay. Supported stages depend on the selected family. |
| What is the RL training pipeline? | [What training means](#training-overview), [training in five steps](#training-steps), [record decisions](#record-decisions), [replay and train](#replay-and-training), [measured results](#measured-training-results), [load/use model](#load-and-use-model), [restore recording](#recording-restoration) | Actual decisions were downloaded, replayed and trained locally; the resulting checkpoint was reloaded for policy/MCTS suggestions; the actual recording restored to completion. Browser recording and local weight training are separate operations. |
| Is training rule guided, and can I choose a preferred solution? | [Rules, demonstrations and learning](#rules-and-learning), [preferred solutions and the A/B example](#choosing-preferred-solution) | Checks constrain action availability; you choose the demonstrated actions; the trainer updates action values using a fixed reward. There is no pairwise preference label, free-text intent input or configurable surface-quality/tool-life learning objective. Demonstration does not guarantee imitation or improved recommendations. |
| Is the agent learned or greedy? | [Industrial baseline explanation](#industrial-workflow), [learning and model use](#operator-learning), [family-specific training](#validation-examples) | Industrial classic uses a staged greedy baseline. Mixed uses a compatible learned checkpoint; MCTS searches bounded choices using its model. Their roles are separate, and changed weights do not establish improved policy quality. |
| How much knowledge is formalized? | [Knowledge contracts and limits](#knowledge-boundaries) | Executable input/state/tool/action/model/replay constraints. General company-rule authoring, review, qualification and activation are unavailable. |
| Can it handle any case, or only demonstrations? | [STEP input boundaries](#step-input-boundaries), [adaptive stock limits](#adaptive-stock-faces), [rejection/recovery](#failure-recovery) | Supplied cases and declared supported profiles can be exercised. Arbitrary STEP machining and automatic learned policies for a new industrial part are not established. |
| What must be installed or supplied? | [Installation and dependencies](#installation), [STEP settings](#step-workflow), [family inputs](#validation-examples) | Browser/network for hosted use; Node 24 and Python 3.12 plus declared packages for local build/training; compatible input/setup/model files for the selected route. No Master implementation checkout is required. |
| What is the delivered Module 3/version extent? | [Exact tested source identity](#verification-identity), [function map](#scope), [family outcomes](#validation-examples), [remaining evidence](#evidence-status) | The reviewed delivery is this single repository at the recorded revision, with candidate repairs identified separately. Regional v3 and cylindrical configuration 3 have the listed local results; those profile names do not imply universal feature or industrial coverage. All 23 advertised browser families are not claimed passed by this walkthrough. |

<a id="evidence-status"></a>

## Evidence and draft status

The original walkthrough records and downloads are retained separately; internal execution logs, private machine paths and submission packages are not part of this product documentation. Use the [repository verification status](VERIFICATION_STATUS.md), [validation guide](VALIDATION_GUIDE.md) and [example inputs and outcomes](../examples/README.md) for the reproducible software checks supplied here. No source inspection was used to discover initial user steps; implementation diagnosis followed recorded reproducible problems. Screenshots are illustrative captures of recorded states; they must not be used to claim an unobserved family or completion.

**Still explicit at this draft cutoff:** planar machining preparation lacks a completed saved receipt; other uncompleted catalogue UI routes are not marked passed; candidate fixes are separate from the original public revision; no independent human trial or manufacturing qualification is asserted. The newly trained mixed model has completed both policy and MCTS suggestion checks as illustrated above.
