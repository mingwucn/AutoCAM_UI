# Knowledge and constraints: what is delivered

The GYM formalizes constraints as executable input, state, action, tool, setup,
model and evidence contracts. It does not provide a general end-user rule editor
or the complete governed knowledge-control system.

| Delivered check | Example | Meaning and limit |
| --- | --- | --- |
| Shared material and protected samples | Industrial 00350 three-cut example | Turning/milling use one sampled stock; target/holding samples remain. This is not physical workholding qualification. |
| Checked action and accepted-state binding | A current enabled action can execute; a stale candidate cannot | The check applies to the exact candidate, setup and accepted state. A preview or stale result cannot authorize another state. |
| Finite-tool/holder and declared motion constraints | Compatible long-tool action versus a blocked short-tool attempt in task-6 | The explicit bounded geometric check decides; rejected attempts stay recorded and do not become enabled training samples. |
| Model/episode compatibility | Mixed versus task-5/task-6/cylindrical checkpoints | Different feature/task contracts reject rather than being silently converted. |
| Replay before training | Altered episode with a recomputed file hash still fails replay | Byte identity alone does not establish a valid history. |
| Evidence scope | Point shadow, finite-tool access and restricted motion are displayed separately | A point-shadow view does not certify finite-tool clearance, general machine motion or manufacturing. |

Reproduce the allowed/blocked examples in
[recorded training](RECORDED_TRAINING_QUICKSTART.md) and
[rejections](../examples/rejections/README.md). Read the actual reason and
unresolved properties; do not treat an absent check as a pass.

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
