# Workflow catalogue: inputs, controls and acceptance

This manual maps all 23 families in the [capability registry](../config/module3-capabilities.json)
to user tasks. The scope is the advertised functions of `mingwucn/AutoCAM_UI`.
Read [installation](INSTALLATION.md) first and save the served `release.json`.
The [capability table](CAPABILITIES.md) states the supported stages; the
[verification status](VERIFICATION_STATUS.md) identifies actual executed checks.
An entry below is an instruction, not a claim that a person has completed it.

Paths below are relative to the repository root. File pickers use the local
source checkout, not a path typed into the web page. Do not exchange same-named
files between example directories. Downloaded recordings, preparation records,
trained models and transition exports are different file types.

## Obtain the inputs

The prepared case menu is available in the
[hosted application](https://mingwucn.github.io/AutoCAM_UI/) without a local
build or fixture extraction. You can also [build and serve locally](INSTALLATION.md).
For local-file examples, first obtain the public source using
[installation](INSTALLATION.md). After installing its Node dependencies, run
this command from the repository root:

```text
node scripts/prepare-workflow-examples.mjs --output runs/workflow-examples-01
```

Use a new directory below `runs/` for each invocation. The script verifies the
source manifests and compressed/raw file hashes, exports the original bytes and
writes `receipt.json`. It refuses overwrite. Optional `--groups task4,indexed`
selects a subset. The exact source/output mapping is
[workflow-examples.json](../config/workflow-examples.json). In this manual,
`W/` means `runs/workflow-examples-01/`; replace that prefix if you chose another.
The exporter does not train models or derive geometry. Its task-4 model is an
explicitly untrained demonstration fixture.

Spherical inputs have a separate pinned release. After installing the Node
dependencies, run:

```text
node tests/spherical-bands-browser.mjs --check-fixtures-only
```

The command prints `Spherical band evidence: test-results/spherical-bands-...`.
Use the `fixtures/` directory inside that printed directory, called `S/` below.
It contains `inputs.json` and four named case directories. This command checks
27 input files and their recorded expectations; it does **not** run a browser.
There is no `--output` option for this command. Its source is pinned in
[spherical-bands-fixtures.json](../tests/spherical-bands-fixtures.json).

## Shared user procedures

### P1 — Open a prepared case

Expand **Run the adaptive shadow gym**. For a menu case, select the exact title
listed below in **Prepared case**, then **Open case**. The case IDs in this
manual identify the configuration; the menu shows their titles.

For a local pair, expand **Open your prepared task and stock**, choose **Task
JSON** and **Initial stock snapshot** from the indicated directory, then **Open
local prepared case**. Task JSON is limited to 32 MiB and the stock file to
64 MiB. Wait until loading ends. A failed or cancelled load must not replace an
already accepted case. **Cancel case loading** is available while loading.
**Close live case** returns to the input controls.

### P2 — Inspect without accepting material changes

Record the displayed state identity, decision count and remaining-material
values before inspection. Rotate, use **Home view**, layers, **Cutaway**, section
axis/position and **Select a cell**. These are display controls. For CAD-derived
stock, select **3D picking → Original CAD faces** and an **Original face**;
where available, **Load original CAD faces** retrieves a selected cell's source
associations. Read the uncertainty and scope explanations. A display mesh,
highlighted face or directional shadow does not establish cutting clearance.

For CAD stock, expand **Original faces and import record** and save **Download
face provenance**. After querying a cell's faces, inspect **Import records for
selected faces** and **Download selected face references**. These identify the
import and selected source faces; they do not grant manufacturing authority.
**Cancel face query** must leave accepted material unchanged.

Where **Explore connected cells** appears after selecting a cell, choose Query:
Face neighbors, Remaining material, Eligible material, Free space, Directional
shadow, and Remaining-region shadow. Select the requested face/travel direction
or Possible/Definite certainty, then **Query connected cells**. Browse returned
cells; use **Previous graph page**/**Next graph page** for the directional graph.
Record complete/partial coverage and unresolved results. These are bounded
cell queries, not machining features or finite-tool clearance. Confirm state
and recorded history remain unchanged for each available query type.

**Export inspection PNG** saves the current inspection view; **Export display
metadata** identifies its displayed frame and settings. Keep both when reporting
a visual observation. Neither export performs geometric replay or machining.
Expand **Partition and recorded transition** to distinguish the producer's
partition stopping condition, displayed bounds and separately recorded credited
removal. Subtracting displayed bounds is not a substitute for that record.

Use the route's Preview or suggestion control and check accepted state is
unchanged. In contrast, **Run model** and **Run model + MCTS** in F08–F10 execute
one checked choice immediately. Tool exchange, index and setup actions can
change a recorded head/time while leaving material unchanged. Preparation can
record proposals without accepting a cut. Compare both material and history.

### P3 — Retain, restore and recover

Where offered, save **Download decisions** (F19: **Download learning decisions**),
**Download run details** and **Download transitions** together at the same head.
The transition file is a supplement bound to its decisions, not a replacement
recording. An unavailable or failed export is not proof of no material change.
Use the route's Reset button and check the initial state returns. Where a
**Restore … decisions** file picker is present, restore your own download and
check the accepted state/history returns. Do not load a transition file there.

F15–F19 also offer **Save in this browser** and **Forget local save**. Save,
close/reopen the same exact case and follow the displayed recovery prompt;
confirm the restored head. Forget the save and confirm it is no longer offered.
Browser-local storage is optional and is not a portable recording or backup.

Start a calculation, then use **Cancel computation** while it is still active.
If recovery is offered, use **Restore last completed state** or F19's **Recover
completed actions**. If the view is stale, use its displayed Refresh control.
An interrupted computation must not silently publish a late result. Record a
run that completed before Cancel as cancellation **not exercised**, then retry
or leave that check untested. Do not describe a vanished accepted state or a
browser exception as a successful rejection.

### P4 — Prepare adaptive STEP stock and machining

Expand **Prepare stock from your STEP file**, choose **STEP file**, the stated
**Part geometry**, **Stock shape**, **Stock margin**, **Finishing allowance**,
**Spindle direction** and **Partition detail**, then **Prepare STEP stock**.
The corresponding file input's accessible label is **Adaptive STEP file**.
Retain **Download initial stock**, **Download target certificate** and **Download
stock proposal**. Inspect original faces and uncertainty using P2.

For supported non-rational profiles, choose **Machine and tools** (accessible
label **Machining setup file**) and **Roughing requirements** (**Machining
requirements file**) from the exact pairing below. Select **Prepare machining
actions**. Retain **Download machining task** and **Download preparation record**,
then **Open machining gym**. This opens a regional objective task (F13). Inspect
the face proposals, select a **Mill-turn action**, preview it, and explicitly
Apply only an available checked action. Unsupported faces stay listed in the
preparation record; opening the gym does not mean all faces are machinable.

**Cancel STEP preparation** and **Cancel machining preparation** are separate
operations. Test each only while busy and retain the preceding accepted state.
An invalid STEP or an incompatible setup must report its reason. Newly prepared
geometry has no automatically trained model; F12/F13 synthetic checkpoints are
not interchangeable with a new CAD context.

## Family scenarios

### F01 — Classic sampled GYM (`classic-sampled`)

Open `?case=industrial&process=turning#gym` and select industrial **3-29-00350**.
Follow the [three-cut guide](GYM_QUICKSTART.md): outside turning with 40 mm reach,
milling −Z with 80 mm, then milling +Z with 40 mm. Expected sampled excess is
388600 → 286750 → 33236 → 0 mm³. Switching process preserves stock/history;
**Replay my steps** is read-only; **Reset stock** restores the initial state.
Compare **Play greedy baseline** without calling it a learned policy. Repeat an
exhausted action: it must not invent progress. Target/holding samples remain.
Zero sampled excess is not tolerance, physical accessibility or qualification.
Inputs/results: [industrial example](../examples/industrial-00350/README.md).
Browser scenario source: [browser.cjs](../tests/browser.cjs).

### F02 — Classic STEP B-Rep (`classic-step-brep`)

Use `core/tests/fixtures/box.step`. Expand **Open your STEP file**, select
**OpenCascade B-Rep**, and keep the default display deflection 0.2 mm, stock
allowance 5 mm, tool reaches `5, 10, 20`, spindle Z, negative held end, holding
length 5 mm and inferred spindle origin. Select **Prepare shadow gym**.
Use **Preview next action**, then **Apply action** for an available outside
turning action. Switch to Milling and apply an available action. The process
switch must retain the committed stock. Replay, **Return to my stock**, then
**Download actions** and **Download original STEP**; retain both files. Reset
returns to the prepared initial stock. Test **Cancel calculation** during a
preview and recovery to the last committed stock. No local policy/trainer is
advertised. B-Rep geometry remains limited to supported STEP operations and
declared tool/setup assumptions. Browser scenario: [brep-browser.cjs](../tests/brep-browser.cjs).

### F03 — Classic STEP voxel (`classic-step-voxel`)

Use `core/tests/fixtures/{box,overhang,stepped-shaft}.step` and the exact per-file
pitch/axis and shared settings in [the STEP guide](../examples/step/README.md).
Select the voxel comparison engine, prepare, apply an available turning action,
switch to milling and replay/reset. The sampled stock must persist across the
process switch. Exercise the guide's malformed file, excessive-grid rejection
and cancellation while retaining an accepted case. This sampled comparison has
manual/greedy actions, not learned inference or a local trainer. Browser
scenario: [step-upload.cjs](../tests/step-upload.cjs).

### F04 — Adaptive planar STEP (`step-rectilinear`)

Input: `W/adaptive-planar/box.step`; reference stock/proposal:
`box-allowance.bin` and `box-allowance-proposal.json` in the same directory.
Use P4 with **Axis-aligned planar solid**, Box, margin 2.5 mm, allowance 0.5 mm,
spindle Z and Coarse (depth 4). Inspect source planar faces, uncertainty and the
prepared allowance, and retain the three stock-stage downloads. Positive
allowance must stay within the margin.

For the separate complete machining recipe, use
`W/adaptive-planar-machining/{box.step,setup.json,policy.json}`. Prepare that STEP
as Axis-aligned planar solid, **Cylinder**, margin 2.5 mm, **zero allowance**,
spindle Z, **Finer (depth 6)**. Upload this directory's setup and policy through
P4, retain stock/task/preparation outputs, and open the machining gym. The
retained owner reference uses ordered action IDs **0, 1, 3, 5, 7, 9**. Preview
before Apply and record the actual state/outcome at every step; reset and restore
your decisions. Do not combine this recipe with the shallow positive-allowance
stock-only example above. Source recipe custody is in the export receipt;
current-runtime comparisons have [separate browser receipts](verification/repository-continuation/README.md). The group's
`expected/` directory retains `stock-proposal.json`, `configuration.json`,
`preparation.json`, `checks.json` and `final-completion.json` from the original
owner reference. After its six actions, completion is true: remaining material
is bounded at **320–750 mm³** within the **1500 mm³** global residual budget, and all
five regional upper bounds are zero. This is not an empty stock or proof that
all material is gone. See the [recipe fixture manifest](../tests/fixtures/workflow-inputs/adaptive-planar-machining/manifest.json).
Reference scope:
[allowance fixtures](../tests/fixtures/allowance/manifest.json),
[preparation client checks](../tests/adaptive-cad-machining-client.test.mjs).

### F05 — Adaptive coaxial STEP (`step-periodic_nominal`)

Use `W/adaptive-coaxial/annular/coaxial-tube.step`. P4 settings are **Coaxial
cylindrical part**, Cylinder, margin 2.5 mm, allowance 0.5 mm, spindle Z, Coarse
(depth 4). Inspect cylindrical/annular source associations and the through-bore;
uncertainty must not be relabelled free space. Use
`W/adaptive-coaxial/refined/setup.json` and `policy.json` for machining
preparation. The same directory retains reference `configuration.json` and
`preparation.json`; the annular directory retains the stock/certificate/proposal.
Follow P4 through the regional gym. The supplied preparation has three actions:
one turn and two tool transfers. Cylindrical faces report `coaxial_turning_region`;
the end planes report `no_normal_aligned_declared_pose`, with no direct face-cut
proposal. Read those limits, select **Mill-turn action 0** (turn), preview,
explicitly Apply and download/reset. Do not expect a face cut from this setup.
Reject incompatible profile/setup inputs
without replacing accepted stock. Reference scope:
[shadow fixture manifest](../tests/fixtures/shadow/manifest.json) and
[annular client checks](../tests/cad-annular-client.test.mjs). A fixture or client
check alone does not prove the complete fresh UI route passed; the additional
workflow receipts record the actual preparation, action and restore probe.

### F06 — Adaptive spherical STEP (`step-spherical_nominal`)

Use all four entries in `S/inputs.json`: `sphere-origin-allowance`,
`sphere-origin-auto`, `sphere-translated-allowance`, `sphere-translated-auto`.
For each, the entry's `step` is the exact relative STEP filename and `allowance`
the finishing allowance. P4 uses **Complete principal-frame sphere**, Box,
margin 2.5 mm, spindle Z and Coarse (depth 4); use the entry's allowance.
Select `S/<case>/setup.json` and `policy.json`, prepare machining and open the
gym. Select original face 1 and inspect its proposals. Preview without mutation;
the entry's `actions` list gives the exact ordered **Mill-turn action** IDs and
expected material hashes. Apply those actions, compare the final completion
report with the entry's `completed`/`completion`, download, reset and restore.
Some supplied outcomes retain unmet completion conditions: do not report all
four as complete. The browser scenario checks 27 actions across these cases:
[spherical-bands-browser.mjs](../tests/spherical-bands-browser.mjs). Other sphere
arrangements are not implied by complete principal-frame sphere support.

### F07 — Adaptive rational STEP (`step-rational_nominal`)

Use `W/adaptive-rational/rational-prism.step`, select **Rational surface prism ·
experimental** in P4, with Box, margin **1 mm**, spindle Z and **Initial check
(depth 1)**. Allowance is fixed at zero; the alternative partition choice is
More detail (depth 2).
Only compatible rational-prism STEP input is admitted. Preparation/inspection
may report unresolved boundaries; source-face candidates are not proven
contacts. Machining, recording, policy, MCTS and training are unavailable on
this route. Confirm the scope panel and disabled/absent machining continuation.
Retain the stock/certificate/proposal and face-provenance downloads. Select an
original face and inspect cell/source associations. Try an incompatible planar
box only as a separate rejection check. The exported original file is pinned by
the fixture/export manifests; positive input availability alone is not a passed
browser check. Unit checks cover [asset selection](../tests/cad-rational-assets.test.mjs),
[face interpretation](../tests/cad-rational-faces.test.mjs) and
[scope UI](../tests/module3-workflow-browser.mjs). The additional workflow
receipts record the fresh positive rational preparation and face-inspection run.

### F08 — Adaptive task 4 (`task-4`)

Use P1 with `W/task4/task.json` and `initial.bin`. Use Operation, Tool, Region
and Direction to select an allowed choice; **Apply action** executes it.
**Refine cells** is also a recorded state operation. Download decisions,
transition supplement when available, run details and reset. A repeated/blocked
choice may offer **Record repeated action** or **Record rejected attempt**;
that does not imply removal. For model-control checks, load
`W/task4-model/untrained-checkpoint.json` with **Load model weights**, then use
**Run model** and **Run model + MCTS** from separate reset states. Both execute
a checked choice, not merely suggest one. The zero-weight fixture establishes
compatibility/control behavior, not learned quality. Reject a mixed or task-5
checkpoint without changing accepted stock. No standalone task-4 trainer is
advertised. Scenario sources: [adaptive-live-browser.cjs](../tests/adaptive-live-browser.cjs)
and [transitions-browser.mjs](../tests/transitions-browser.mjs).

### F09 — Remaining-stock task 5 (`task-5`)

Use P1 with `examples/recorded-training/task5/manual/{task.json,initial.bin}`.
Follow F08 manual controls and the [recorded training guide](RECORDED_TRAINING_QUICKSTART.md).
Choose the tool by its exact ID and flute length: **long-flute** has a 20 mm
cutting flute and **short-flute** has a 4 mm cutting flute; both have 20 mm usable
reach. The Tool picker shows these separately. Equal reach does not make their
cutting and shank geometry interchangeable; read the checked action's actual result.
Train `episode.json` from that directory into a new output, load its resulting
checkpoint and execute each model control from a reset state. Repeat with the
separate `task5/model-mcts/` pair and its explicit starting-checkpoint recipe
when assessing recorded model decisions. Keep downloads and inspect skipped
versus trained decisions. Task-6/mixed models must reject. Current shank/holder
clearance uses this family's remaining-stock contract; it is not task-6's full
cleared-holder sweep. Native and actual UI sources:
[verify_examples.py](../python/verify_examples.py),
[recorded-training-ui-browser.mjs](../tests/recorded-training-ui-browser.mjs).

### F10 — Cleared-holder task 6 (`task-6`)

Repeat F09 with `examples/recorded-training/task6/manual/` and the separate
`task6/model-mcts/` pair/recipe. This family has its own task/model contracts and
checks complete shank/holder sweeps against current stock, including earlier
cleared space. Do not reuse task-5 weights. The two Run buttons execute a checked
choice immediately. Preserve incomplete/truncated outcomes instead of treating
training or an action as whole-part completion. Same verifier/UI sources as F09;
the exact task-6 scenario must appear in the receipt.

### F11 — Combined configuration 1 (`combined`)

Use P1 with `W/combined/{task.json,initial.bin}`. Select **Mill-turn action**,
enable **Preview selected action**, then **Apply mill-turn action** (or record
the displayed rejection). Load `W/combined/model.json` using **Model weights**
(accessible **Mill-turn model weights**) and **Suggest with model + MCTS**.
Suggestion/preview preserve state; Apply is explicit. The supplied model is a
compatible **untrained** fixture. No separate policy button or standalone
trainer is promised. Perform P3, including **Restore mill-turn decisions**.
Wrong-family model/history must reject without replacing the accepted head.
`W/combined/expected.json` retains reference actions/exports. Scenario sources:
[combined-react-browser.cjs](../tests/combined-react-browser.cjs),
[journal-transitions-browser.mjs](../tests/journal-transitions-browser.mjs).

Also assess the menu case **Turn, then mill four indexed faces**
(`turn_four_faces`). Its retained sequence is action IDs **0, 1, 2, 4, 6, 8**:
turn, transfer and four face choices. Preview before applying; inspect the
change from turning to indexed milling and the four distinct workpiece
orientations. Read actual completion, download, reset and restore. Do not apply
the exported combined fixture's model or expected bytes to this different
context. The original scenario source is
[turn-four-faces-react-browser.cjs](../tests/turn-four-faces-react-browser.cjs);
its historical harness is not an additional passed candidate receipt.

### F12 — Regional configuration 2 (`combined-regional-v2`)

Use `examples/recorded-training/regional-v2/{task.json,initial.bin}` with P1.
Follow the [regional guide](REGIONAL_TRAINING_QUICKSTART.md) with task version 2
to train its episode, then load the new 48-feature checkpoint. Follow F11's
suggestion/preview/Apply and P3 restore/download/reset controls. Each supplied
reference has three trained updates; no performance improvement is inferred.
Wrong version/context rejects, even if its filename looks correct. Native
reference verification and learned-worker parity are described in
[verification status](VERIFICATION_STATUS.md); fresh STEP preparation is a
separate scenario. UI source: [regional-model-react-browser.cjs](../tests/regional-model-react-browser.cjs).

### F13 — Regional objective configuration 3 (`combined-regional`)

Use the matching `examples/recorded-training/regional-v3/` task/stock/episode
and task-version-3 training command. Its model has the separate 50-feature
completion-objective contract. Follow F12 with its own files; read the
**Regional completion** conditions, not just the action count. P4's supported
CAD machining path also ends in this family, but requires that CAD task's exact
context. The supplied synthetic model does not establish model compatibility
or industrial training for newly prepared STEP. Reference UI source and P3
rejection/recovery controls are the same as F12; record v3 separately.

### F14 — Indexed configuration 1 (`indexed`)

Use P1 with `W/indexed/{task.json,initial.bin}`. Select **Indexed action**, use
**Preview selected action**, then **Apply indexed action**. Load
`W/indexed/model.json` with **Indexed model weights**, then
**Suggest with model + MCTS**; suggestion is read-only. This supplied fixture is untrained. Use
**Restore indexed decisions** for P3, and reject a combined/regional checkpoint
without replacing accepted state. There is no separate policy button or
packaged trainer. `W/indexed/expected.json` holds reference actions/exports.
Scenario sources: [indexed-react-browser.cjs](../tests/indexed-react-browser.cjs),
[journal-transitions-browser.mjs](../tests/journal-transitions-browser.mjs).

### F15 — Prepared finite drill (`drill`)

P1 menu choices: **R5 synthetic drill: prepare, preview and execute**
(`r5-drill-synthetic`) and **R5 drill choice: 8 mm or 20 mm reach**
(`r5-drill-two-lengths`). Select a **Physical tool**, **Change tool**, choose a
**Workpiece index**, **Index workpiece**, then the **Depth reference**.
**Prepare drill candidates** creates proposals. Select a **Saved candidate**,
**Preview saved candidate**, and **Execute prepared drill** only when enabled.
Inspect **All saved proposals**, reach/cutting-length/shadow layers and blocked
reasons. Compare the two tool reaches without interpreting a blocked proposal
as a cut. Use P3, **Restore drill decisions**, browser-local save/forget and
reset. No model/trainer is advertised. Scenario sources:
[prepared-transitions-browser.mjs](../tests/prepared-transitions-browser.mjs),
[drill-local-save-browser.mjs](../tests/drill-local-save-browser.mjs).

### F16 — Prepared finite face milling (`face`)

P1 menu: **Synthetic planar face: 40 × 30 mm; 15 or 25 mm reach**
(`r5-face-two-lengths`). Choose Physical tool/Change tool, Workpiece index/Index
workpiece, Engage direction, Feed axis and Proposed spacing. **Prepare face
candidates**, select a Saved candidate, **Preview saved candidate**, then
**Execute prepared face mill** when enabled. Inspect saved rejected proposals,
tool assembly and motion segment; use P2/P3 including **Restore face decisions**.
Preview is read-only, while tool/index choices are recorded context changes.
No policy/trainer is advertised. Scenario source:
[prepared-transitions-browser.mjs](../tests/prepared-transitions-browser.mjs).

Also open all four diagnostic menu cases: **Shadow demonstration: upstream
fixture blocks face milling** (`r5-upstream-fixture-shadow`), **Curved shadow:
round fixture blocks face milling** (`r5-curved-fixture-shadow`), **Hollow fixture:
bore along engagement leaves an open centre** (`r5-annular-axial-shadow`), and
**Hollow fixture: upstream wall blocks the transverse bore**
(`r5-annular-transverse-shadow`). Prepare/preview a candidate, inspect **In
shadow**, **Unresolved shadow cells**, Cutting band/Carrier/Arbor/Holder/Fixed obstacles
layers and **Motion segment**. Record the actual accepted/blocked reason and
unchanged stock during inspection. Point-shadow visualization does not prove
finite-tool access; an unresolved cell is not clear space.

### F17 — Mill-turn after turning transfer (`mill-turn`)

P1 menu: **Synthetic mill-turn: turning, facing, drilling; two tool lengths**
(`r5-mill-turn-two-lengths`). This opens at the retained turning-transfer state.
Choose **Tool operation** (Face milling or Drilling), then follow F16's tool,
index, direction and spacing/depth controls. Prepare a candidate for each
operation, preview and **Execute prepared cut** when enabled. Preserve a
blocked proposal's reason; do not force an unavailable cut. P3 uses **Restore
mixed decisions** and **Reset to turning transfer**. There is no policy/trainer
in this family. Scenario source:
[mill-turn-transitions-browser.mjs](../tests/mill-turn-transitions-browser.mjs).

### F18 — Full mill-turn from stock (`full-mill-turn`)

P1 menu: **Synthetic mill-turn from initial stock: turning, facing, drilling;
two tool lengths** (`r5-full-mill-turn-two-lengths`). Choose an **Initial action**,
**Prepare initial action**, **Preview initial action**, then **Execute prepared
initial action**. **Inspect turning shadow** is read-only for a turning choice.
Use the configured transfer action to enter the face/drill stage, then follow
F17. Do not assume a transfer is available from every head. P3 uses **Restore
mixed decisions** and **Reset to initial stock**. Prepare/preview must not
silently execute. There is no model/trainer in this manual family; F19 is a
separate learning task. Scenario source:
[mill-turn-transitions-browser.mjs](../tests/mill-turn-transitions-browser.mjs).

### F19 — Mixed learning (`mixed-learning`)

P1 menu: **Synthetic learning gym: turning, face milling and drilling; local
weights and recorded actions** (`r5-mixed-learning-two-lengths`). Follow the
[operator guide](OPERATOR_INPUT_QUICKSTART.md) for exact A/B commands, the
six-choice reference and newly recorded episodes. **Checked action → Preview
checked action → Accept checked action** is the execution sequence.
**Load learning model**, **Suggest with policy** and **Search with MCTS** use
the compatible 34-weight model. Suggestions/preview leave accepted stock
unchanged. Retain search settings for comparisons. Follow P3 with **Restore
learning decisions**, browser-local save/forget and **Reset to initial stock**.
Wrong-family weights reject. A/B change weights but retain the documented
same-state recommendations; this is not policy improvement evidence. Native
and learned-worker checks are in [verification status](VERIFICATION_STATUS.md);
record a participant's new recording/train/reload separately.

<a id="cylindrical-choice"></a>

### F20 — Cylindrical choice (`cylindrical-choice`)

Use P1 with `W/cylindrical-choice/{task.json,initial.bin}`. Select **Next machining
choice** (accessible **Machining choice**) by its physical tool profile and
exact tool ID as well as region, method, reach and angle. For example, **Ball end
mill (BALL_END-long)** and **Flat end mill (FLAT_END-long)** are different tools
even when their reach and other displayed settings match. The same descriptions
appear in the dependency selectors. Select **Preview machining choice**, then
**Apply machining choice** when allowed. Record the actual rejection for a
blocked choice. Download decisions/transitions when offered, and **Reset stock**.
`episode.json` and `initial-episode.json` retain reference history in the same
directory. Use **Restore decisions** (accessible **Restore machining decisions**)
to restore your own download. **Save locally** stores one checkpoint per browser
site and replaces the previous one; subsequent changes are not autosaved.
Reopen the same prepared case before **Restore local save**, which is only
enabled with an empty current journal, then verify the saved head. **Delete
local save** removes that optional local checkpoint.

Expand **Compare operation dependency**, choose First action and Following
action, then **Compare actions**. Expand **Explore operation dependencies**,
**Load dependency graph**, and page with **Previous pairs**/**Next pairs**.
These calculations use temporary copies; neither history nor elapsed time may
change. Record partial coverage and unresolved/disabled/enabled outcomes.
Enabling can reflect a setup change; this is not a complete workplan or physical
feasibility approval. For an accepted preview, **Measure preview removal**
reports an exact/conservative interval and query limit; it must not commit a
cut or change recorded reward. Perform P2's connected-cell queries where shown.

This choice configuration has no compatible policy/training route;
do not substitute F21's weights. Scenario source:
[cylindrical-transitions-browser.mjs](../tests/cylindrical-transitions-browser.mjs).

### F21 — Cylindrical policy configurations 1–3 (`cylindrical-policy`)

Follow [the cylindrical guide](../examples/cylindrical-policy/README.md). It
supplies the v1 pair and exact command, and generates matched v2/v3 input/model
files via the verifier. Assess each version separately. Load the **newly trained**
weights through **Model weights** (**Machining model weights**), use **Suggest
with model + MCTS**, preview, then explicitly Apply. There is no separate
policy-only button. Suggestions/preview must preserve state. Versions 2 and 3
filter previously accepted choices; v3 additionally filters choices rejected
at the current head. Wrong task/model versions reject. Reset/download as F20.
V1 recorded has an expected model hash; derived v2/v3 have replay/compatibility
checks, not historical model goldens. Native training lacks the later material
transition supplement, independently of browser transition downloads. See
[verify_cylindrical_examples.py](../python/verify_cylindrical_examples.py) and
the exact learned-worker cases in [verification status](VERIFICATION_STATUS.md).

### F22 — Recorded inspection (`inspection`)

Expand **Inspect an adaptive Shadow Gym episode**, choose **Adaptive episode
file** `W/inspection/legacy.json`, then use **Play recorded steps**, Previous/Next
and P2's layers, section and cell selection. This six-frame fixture has no tool
catalogue. Then open `W/inspection/tools.json`, select a recorded tool action,
toggle **Show recorded tool**/**Show cutting sweep** and move **Tool position**
(accessible **Recorded tool position**). Only the displayed tool pose changes;
the selected recorded material state stays fixed. Read the
cell predicate, material bounds, recorded outcome and scope checks. The browser
checks bundle/partition/cell identities; replay status is producer-reported.
This viewer does not execute a new replay, Apply, model or training operation.
Try a malformed JSON file while the accepted bundle is visible: the failure
must not replace it. Input limit is 64 MiB. Reference checks:
[adaptive-provider.test.mjs](../tests/adaptive-provider.test.mjs),
[adaptive-scope.test.mjs](../tests/adaptive-scope.test.mjs). A contract test does
not establish a completed UI inspection trial.

### F23 — Equivalent groove comparison (`equivalent-groove`)

P1 menu: **Curved groove: ball tip or indexed flank** (`common_groove`). Inspect
the two initial time estimates and **Why the geometry is comparable**. Select
**Indexing cost scenario** at 2 seconds, follow F14's explicit indexed action
preview/Apply/download/reset controls, then save the recording **before**
switching to 50 seconds. Changing scenario deliberately starts a **new episode**;
it is not a failed restore. Both methods retain a 0.25 mm profile allowance.
The rates are illustrative; roughness, deflection and qualified productivity
are not assessed. A model/training workflow is not supplied for this comparison;
do not infer one from the shared indexed interface. Reference:
[prepared-comparison.test.mjs](../tests/prepared-comparison.test.mjs).

## Evidence and unresolved steps

The sources linked above describe test scope; their existence is not a passed
receipt. The retained 19-step Windows/Linux checks cover the scenarios listed
in [verification status](VERIFICATION_STATUS.md), including learned-worker
cases and actual task-5/task-6 React use. The inherited publication workflow
has additional classic, transition and spherical browser suites; claim their
pass only from that run's final receipt and source identity. Do not convert a
client mock, prepared-task import or native test into fresh STEP UI evidence.

F04's complete machining recipe and F07's positive rational STEP now have
manifest-pinned input acquisition. Their current-runtime execution and human
acceptance remain separate evidence requirements. F08/F11/F14 untrained
fixtures test compatible model use; no standalone trainer is promised for those
families. These boundaries must remain visible in the acceptance record.

Use [the acceptance checklist](ACCEPTANCE_CHECKLIST.md) to record every family,
including subcases and failed/assisted attempts. No automated check substitutes
for an independent user's observation. Video and slides are deferred.
