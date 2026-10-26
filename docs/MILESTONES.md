# Important milestones

## 26 October 2026 — V2 full-sequence inference recorded locally

The integrated **Reusable Results V2 — Module 3** UI now has **Run full-sequence
inference**, separate from **Train model**, **Run inference and compare**, and
one-step policy suggestions. It uses the loaded compatible checkpoint to
generate successive actions from original stock without training again.

Fresh local browser executions produced **11 cuts with Initial** and **24 cuts
with the imported Run B checkpoint**, both sampled complete with zero sampled
residual. The recording shows every action, the finishing markers, read-only
replay at 12 and 24 events, and episode/model downloads. One accepted turning
cut remained unchanged before and after inference. The [current workflow](ILLUSTRATED_MODULE3_MANUAL.md#full-sequence-inference)
and [capture inventory](verification/full-sequence-inference/recording.json)
retain 12 fresh screenshots and the raw downloads. The earlier 23 October
training recording remains a separate historical record.

The integrated candidate passed 51 focused checks with no failures or skips.
These checks cover worker/model compatibility, frozen-model and original-stock
behavior, replay/partial-result validation, and retained regression cases;
the browser recording provides the visible workflow observations. These are
pre-publication candidate checks; the deployed revision and its terminal
production checks are identified separately by generated build provenance
and the repository's Actions results.
These local checks do not establish independent human acceptance or
manufacturing qualification.

## 23 October 2026 — V2 Module 3 drilling and action recovery

The project owner designated this delivery an **important milestone**: the
published drilling repair in **Reusable Results V2 — Module 3**.

The exact milestone is [commit d2add3f](https://github.com/mingwucn/AutoCAM_UI/commit/d2add3f3b77b7f822a1c228fb47e0e31a06a07b0),
“Fix Reach drilling visibility and next-action recovery”. All four jobs in
[production run 40023829683](https://github.com/mingwucn/AutoCAM_UI/actions/runs/40023829683)
passed. Pages deployment completed on 23 October 2026 at **21:29:27 UTC**
(23:29:27 in Paris).

The delivery made the source-derived logical bore visible in the default 3D
and section views, distinguished its 23 mm source depth from modeled tool
reach, and repaired next-action recovery after replay and restored sequences.
Apply still requires an eligible positive cut. Preview chooses an executable
next action without changing accepted stock; unavailable actions explain their
state.

Verification at that exact commit passed 704 fixture-backed unit tests with no
failures, skips or cancellations, 13 release tests, documentation checks and
integrity checks for 594 built files. Delivery checks verified 118 hosted V2
files: 117 byte comparisons and the generated provenance's clean commit and
runtime pins. They also inspected the actual hosted browser. The
00350 drilling scenario removed 10,373 mm³ after three preparatory cuts, with
replay exit returning to the accepted four-cut stock.

This milestone was originally published at `reach/`. Its current address is
[Reusable Results V2 — Module 3](../rrv2_module3/index.html?case=industrial_reach_00350#gym);
the old address remains a compatibility route. The address and documentation
successor is described in the [consistency review](DOCUMENT_CONSISTENCY_REVIEW.md).
Historical training captures and results retain their original source closures.

This records software delivery and the owner's milestone designation.
Independent manufacturing qualification and normative baseline approval are
not established by these software checks.
