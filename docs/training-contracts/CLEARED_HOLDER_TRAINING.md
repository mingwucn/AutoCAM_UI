# Task6 recorded-decision training

Task-local CODE-SGYM-009 implementation contract, dependent on the task6
reference/worker replay proof. Browser execution remains inference and recording;
training executes in the existing local CLI. This does not qualify a policy or
approve manufacturing decisions.

Extend the existing recorded-episode trainer through an explicit task-schema
dispatch to the matching reference session, checkpoint validator and checkpoint
constructor. Keep the replay loop, action features, masked-sample handling,
normalized clipped linear-Q update and numerical validation unchanged. Task5
retains its existing output bytes and record schema; task6 selects its separate
checkpoint6 feature identity and a version2 training record. No mixed-schema
model archive or initial checkpoint is admitted.

Validate the exact downloaded episode hash, initial snapshot, closed task and
regenerated candidate order, all archived models, initial observation and every
manual or inference decision. Replay model/MCTS with the actual recorded model
and seed. Compare the complete final export before the first learner update.
Masked rejected attempts and already-applied actions remain recorded but do not
become enabled training samples. A failure must produce no trained checkpoint.

Use the generated task6 manual episode (blocked short, opening, new short,
repeat) and its model/MCTS episode. Prove task5 compatibility and mutual model
rejection, and test rehashed corruption before any update. Run the unchanged
CLI against an actual browser download; bind its guide to the episode bytes and
matching task family. Load the resulting checkpoint in the corresponding
browser worker, execute inference and compare its export with native replay.
The UI may then offer the existing local-training guide for task6. Retain all
failed runs and distinguish successful interoperability from held-out policy
quality, which needs its own qualification.

## Executed local and browser loop

The existing trainer now dispatches task5/task6 explicitly while preserving its
replay loop and numerical update. Eight tests pass, including actual manual and
MCTS recordings, corruption rejection before the first update, separate model
families, and exact legacy checkpoint and complete training-record bytes.
The first run's legacy fixture omitted the original explicit integer-zero
checkpoint; its record differed from the float-zero default. Retaining that
initial checkpoint corrected the test without changing the learner. Both runs
remain in `cleared-holder-training-01` and `cleared-holder-training-02`.

The manual episode admits only the opening and new short cut as training
samples. The new short cut has positive material credit, but its net Gym reward
is -0.01175 after action costs. A blocked attempt and repeated action remain in
the recording and are excluded from enabled samples. No reward was relabeled.

The production React build now offers task6 decision and inspection downloads
and a guide bound to the exact episode hash. `cleared-holder-react-02` passes
catalogue loading, model/MCTS, inspection, recovery, local reference reopening,
and desktop/mobile checks. An audit of the first passing harness found an
unasserted legacy catalogue 404. The corrected harness resolves the inherited
catalogue from the pinned Data Git commit and requires its initial block to
load. This was a verification-package fix; UI/runtime source was unchanged.
Both downloads are byte-identical across the two runs.

`cleared-holder-react-training-01` fully replays that actual React download
locally before one update. Its checkpoint has 29 nonzero weights and SHA-256
`ae73ae971015cde7341ac9bc6173896945ef1cd8a4796f3557b61228cd4e5459`.
`cleared-holder-learned-worker-01` then loads those exact bytes in Chrome and
compares eight responses per backend with native Python: reset, model loading,
inference and export for both direct model and model-plus-MCTS. All 24 match in
reference, materialized WASM and packed modes. The runtime archive excludes the
recorded-decision trainer. Training remains local.

The older actual task5 download was also rerun through the current local CLI
(`packed-recorded-training-02`); its complete model and training-record bytes
match `packed-recorded-training-01`. `packed-learned-worker-01` uses the current
shared browser runtime with that separately pinned task5 case and learned
checkpoint. It passes another24exact browser/native response comparisons for
both policies across all three backends. This closes the earlier task5 learned
checkpoint interoperability gap as well, without changing its model contract.

This establishes interoperability on the finite synthetic case and a single
learned update. It does not establish held-out policy quality, industrial
geometry coverage, mill-turn route completion, interactive latency, a winning
material-removal algorithm, or public deployment of this profile. The complete
87 + 8 implementation goal remains open.
