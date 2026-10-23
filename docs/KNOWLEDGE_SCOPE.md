# Knowledge and constraints: what is delivered

The GYM formalizes constraints as executable input, state, action, tool, setup,
model and evidence contracts. It does not provide a general end-user rule editor
or the complete governed knowledge-control system.

| Delivered check | Example | Meaning and limit |
| --- | --- | --- |
| Shared material and protected samples | Original industrial 00350 three-cut example | Turning/milling use one sampled stock; target/holding samples remain. This is not physical workholding qualification. |
| V2 phase and reach gates | `industrial_reach_00350` drilling after bulk cuts | Phase/setup eligibility and positive sampled removal are mandatory. Short reach can stop before the bore; logical source-bore guides do not certify physical drill/holder clearance. |
| Checked action and accepted-state binding | A current enabled action can execute; a stale candidate cannot | The check applies to the exact candidate, setup and accepted state. A preview or stale result cannot authorize another state. |
| Finite-tool/holder and declared motion constraints | Compatible long-tool action versus a blocked short-tool attempt in task-6 | The explicit bounded geometric check decides; rejected attempts stay recorded and do not become enabled training samples. |
| Model/episode compatibility | Separate 00350/00289 industrial models and mixed versus task-5/task-6/cylindrical checkpoints | Different feature/task contracts reject rather than being silently converted. |
| Replay before training | Altered episode with a recomputed file hash still fails replay | Byte identity alone does not establish a valid history. |
| Evidence scope | Point shadow, finite-tool access and restricted motion are displayed separately | A point-shadow view does not certify finite-tool clearance, general machine motion or manufacturing. |

Reproduce the allowed/blocked examples in
[recorded training](RECORDED_TRAINING_QUICKSTART.md) and
[rejections](../examples/rejections/README.md). Read the actual reason and
unresolved properties; do not treat an absent check as a pass.

## Industrial baseline rules and learned preferences

The [original two-case industrial workflow](INDUSTRIAL_LEARNING_QUICKSTART.md) declares a
small baseline heuristic: use productive turning before milling, choose greatest
current sampled removal, and break ties by shorter reach then action ID. Each
step records its state and decision reason. This derives from the supplied
staged geometric comparator and the [industrial software contract](INDUSTRIAL_LEARNING_CONTRACT.md);
it is not a company-admitted manufacturing-rule snapshot.

Whole-sequence and turning/milling labels are explicit soft preferences with
exact case/state or episode scope. Reward learning may change scores and RL
may change suggestions. The same mandatory availability, stock, target and
holding checks still decide which actions can execute. Learning a reward does
not author a hard rule or qualify a physical manufacturing process.

[Reusable Results V2 — Module 3](../rrv2_module3/guide/index.html) keeps Path 1
and Greedy as distinct baselines and Path 2 as an explicitly preferred
alternative. Its saved feedback and learned model remain bound to its exact
Reach case and hard gates; the original two-case rules are not silently applied
as V2's named-plan contract.

## Separate knowledge-control work

The broader Master project has a task-local knowledge-control prototype with
closed schemas, source/review boundaries and a deterministic controller. Its
owner documents explicitly do not claim real company source admission,
reviewer credentials, trusted-time/revocation services, policy qualification,
shop activation or machine execution. That prototype is not imported into this
standalone GYM package by describing it here.

The review's delivery boundary is this single `mingwucn/AutoCAM_UI` repository,
as confirmed by its owner. Knowledge formalization here means the executable
contracts and constraint checks listed above. There is no separate partner
repository needed to execute them. General company-rule authoring, import,
human review, qualification and activation are unavailable in this delivery;
neither the browser nor local trainers claim to provide those interfaces.

Use the [complete workflow catalogue](WORKFLOW_CATALOGUE.md) and its positive
and rejection paths to assess the delivered checks. A passing geometric or
model-compatibility check does not establish a missing company-policy service.

The source of this inventory is the Master `DOC-KNW-001` owner packet and
`CODE-KNW-001`, consulted for scope only. Standalone GYM operation does not
require those files. No quarantined or synthetic example is a qualified company
policy, and no software check grants manufacturing or runtime authority.
