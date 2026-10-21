# Industrial GYM: first run

Build and serve this checkout using [installation](INSTALLATION.md), then open
<http://127.0.0.1:8080/?case=industrial&process=turning#gym>.
The existing [public demonstration](https://mingwucn.github.io/AutoCAM_UI/?case=industrial&process=turning#gym)
is a useful reference; check its displayed version before treating it as the
candidate under test.

## Apply three actions

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
manufacturing qualification. For learned-model recording and local training,
use the separate [synthetic operator workflow](OPERATOR_INPUT_QUICKSTART.md).
For a local STEP file, use [the STEP guide](../examples/step/README.md) and check
the selected profile's supported stages first.
