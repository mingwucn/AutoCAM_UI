# Regional v3 local learning and inference

CODE-SGYM-009 task-local extension of the completion-objective v3 contract.
Preserve the v2 inference/training interface and exact output bytes. Share the
regional geometric feature projection and recorded-action learning algorithm;
do not reclassify geometry, fabricate actions or silently upgrade old episodes.

The v3 feature contract contains the existing 48 regional features followed by
the exact cumulative base-return potential projected to float, and the proposed
candidate's potential difference divided by two. The second feature is zero for
a masked candidate. These 50 bounded features include the history-dependent
objective state and its immediate candidate effect. The existing feature order
and normalizers are unchanged; new schema/contract identities prohibit loading
48-feature checkpoints. Bind the objective identity into checkpoint context.

Use the existing fork-only PUCT with a distinct trace schema and discount exactly
one. Training also requires discount one. Learned values remain estimates;
finite search is not a completeness proof or manufacturing qualification.
The mathematical objective separation concerns exact complete trajectories;
float projections may tie close costs within a completion class.

Local training must verify the entire v3 episode before any update, retain the
recorded actions including masked attempts, recompute rewards and exact replay,
and zero bootstrap for completed/truncated successors. Share the normalized
clipped linear-Q update with v2. New training-record schema identifies v3; do not
use the old fixture or a rewritten reward file as a claimed browser download.
The CLI selects v3 explicitly and freezes both objective and inference contracts.

Verify the learned completing-action counterexample, unchanged accepted state
during search, exact replay/deterministic learning, feature effects after invalid
actions, old/new checkpoint and episode rejection, and discount enforcement.
Retain the failed v2 learned-model run. This small-fixture regression is not
independent-family evaluation; that evaluation and actual browser parity remain.
