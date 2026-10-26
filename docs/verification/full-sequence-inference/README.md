# Fresh full-sequence inference recording — 26 October 2026

Actual **Run full-sequence inference** executions in the integrated Reusable Results V2 — Module 3 UI produced Initial **11 cuts** and imported Run B **24 cuts**, each sampled complete with zero sampled residual. The manual includes 12 untouched JPEG captures at their native 1265 × 712 size.

The [capture inventory](recording.json) pins the current combined runtime closure, screenshot bytes and raw JSON downloads. This closure preserves the previously published drilling/recovery fixes. Historical v10 and earlier drilling v11 source closures remain separately identified by the app.

No Train model click occurred. One accepted turning cut was retained while inference started from original stock. See the [current manual](../../ILLUSTRATED_MODULE3_MANUAL.md#full-sequence-inference) and [V2 guide](../../../rrv2_module3/guide/index.html#full-sequence-inference) for the complete sequence, finishing, replay and download steps. This is prototype verification, without independent human acceptance or manufacturing qualification.

The [independent replay receipt](replay-verification.json) checks the actual downloads against the sampled simulator and regenerates both episodes from their exact model snapshots. All 35 action rows are available as a [readable table](action-rows.md) and [JSON projection](action-rows.json).

| Check | Observed result |
| --- | --- |
| Initial / imported B full sequences | 11 / 24 positive cuts; both sampled complete, zero residual and no missing target samples |
| Finishing | Four final-profile action rows per sequence; nine positive final-profile feature checks |
| Accepted stock before / after | Byte-identical downloads; one cut and 308,279.25 mm³ residual |
| Saved input before / after | Byte-identical downloads; two saved episodes, 24 decisions and one explicit preference label |
| Model snapshot | Each result model equals its input; the Initial result model remains unchanged after loading B |

The displayed checkpoint hash uses canonical JSON, while the inventory hashes the downloaded file bytes. These two hashes describe different byte encodings of the same validated model.
