# Industrial GYM: choose a first run

For **Reusable Results V2 — Module 3**, open the
[V2 application](../rrv2_module3/index.html?case=industrial_reach_00350#gym)
and [illustrated guide](../rrv2_module3/guide/index.html#drilling-controls).
Load **Path 1 — user plan**, then preview and explicitly Apply each eligible
decision. This 11-cut reference includes drilling and finishing; browser
training uses its own compatible dataset and checkpoint.

The instructions and three-cut numerical reference below describe the original
root application, with case ID `industrial`. They do not describe V2's
`industrial_reach_00350` case.

Build and serve this checkout using [installation](INSTALLATION.md), then open
`http://127.0.0.1:8080/?case=industrial&process=turning#gym`.
The existing [public demonstration](../index.html?case=industrial&process=turning#gym)
is a useful reference; check its displayed version before treating it as the
candidate under test.

## Original application: apply three actions

1. Select industrial **3-29-00350**. Inspect the target, holding region and
   remaining stock. If there is earlier history, choose **Reset stock**.
2. Select **Turning**, outside turning and **40 mm** tool reach. Apply the action.
3. Switch **Process** to **Milling** without resetting. Select engagement from
   above (**−Z**) with **80 mm** reach and apply.
4. Select engagement from below (**+Z**) with **40 mm** reach and apply.
5. Use **Replay my steps** to review the recorded choices. Close replay to return
   to the live stock; use **Reset stock** when you want a new run.

| State | Sampled excess (mm³) |
| --- | ---: |
| Initial | 388,600 |
| After outside turning, 40 mm | 286,750 |
| After milling −Z, 80 mm | 33,236 |
| After milling +Z, 40 mm | 0 |

Target and holding material must remain. Changing process must preserve stock
and history. Repeating an exhausted action must not create progress.
The [industrial example package](../examples/industrial-00350/README.md) records
input identity, expected results and validation commands.

## Industrial baseline, preferences and RL

The [industrial learning quickstart](INDUSTRIAL_LEARNING_QUICKSTART.md) uses two
pinned sampled cases, 3-29-00350 and 3-29-00289. The second is the working choice
from the existing catalogue. Generate a rule baseline action by action, keep a
complete alternative, and give explicit whole-sequence or case-scoped
turning/milling feedback. Train locally with Node.js 24, load the matching case
checkpoint, then compare policy and bounded MCTS suggestions. Preview and
explicit Apply remain separate. Synthetic learning remains available through
its [own workflow](OPERATOR_INPUT_QUICKSTART.md).

The baseline rules, feedback labels, learned reward, RL weight updates and MCTS
are distinct operations. Hard geometric and holding checks still decide action
eligibility. These examples measure sampled removal and preference behavior;
they do not measure machining time, finish quality or tool life.

## Compare the baseline

**Play greedy baseline** plays a staged example: positive-removal turning actions
first, then milling. It prefers larger immediate removal within each stage,
with shorter reach and action identity resolving ties. It is not a trained
industrial agent or an optimal process plan.

Rotation, camera and cutaway controls change the view, not machining orientation
or accepted material. Read the displayed engagement direction before applying
an action. A replay is a view of recorded states; it does not commit extra cuts.

## Interpret the result

Volumes are estimates of the sampled geometric representation. Zero sampled
excess does not establish physical accessibility, tolerance, a released part or
manufacturing qualification. The separate [synthetic operator workflow](OPERATOR_INPUT_QUICKSTART.md)
remains available with its own reward, task and model contract.
For a local STEP file, use [the STEP guide](../examples/step/README.md) and check
the selected profile's supported stages first.
