# Two-case industrial browser verification

The [machine-readable summary](result.json) selects results from the passing
23 October 2026 automated Windows/Edge browser run. It pins the exact tested
**development execution build**, six source files, original dataset identities,
actual UI-downloaded feedback, newly trained checkpoints and all twelve images.
Absolute local/site paths are omitted. The summary records the original raw
receipt's byte hash; source paths in it are repository-relative.

The test generated the rule baseline, accepted a complete alternative through
existing controls, downloaded actual feedback, trained locally, loaded the
resulting exact-case model, compared initial/updated policy and MCTS, previewed
and explicitly applied one suggested action in each case. It checked cancelled
search, failed-import recovery and protected stock. Complete policy/MCTS
sequences were additionally replayed by the same shared simulator; those full
sequences were not all manually accepted through the UI.

| Case | Initial policy | Fine-tuned policy | Fine-tuned MCTS sequence | Unchanged baseline prefixes |
| --- | --- | --- | --- | --- |
| 00350 | Milling, −Z, 80 mm; 2 actions | Outside turning, 40 mm first; 3 actions | 8 actions, 0 mm³ excess | 1 and 2 actions |
| 00289 | Milling, −X, 80 mm; 3 actions | Outside turning, 20 mm first; 3 actions | 6 actions, 0 mm³ excess | 2 actions |

Both cases show an actual initial choice change against matched-experience TD
without preference fitting. Each MCTS request used 16 simulations, depth 2 and
exploration 1; only 4 of 136 eligible initial root actions were expanded.
The full actions, completion/residuals, same-updated-reward episode returns,
per-action budgets and unchanged recommendations are retained in `result.json`.
00350 MCTS scores below its rule baseline; 00289 MCTS scores below its fine-tuned
policy. The selected illustrative labels are not human feedback or held-out
quality evidence.

| Stage | 00350 | 00289 |
| --- | --- | --- |
| Rule baseline | [Image](../../images/module3/industrial-00350-baseline.png) | [Image](../../images/module3/industrial-00289-baseline.png) |
| Explicit feedback | [Image](../../images/module3/industrial-00350-feedback.png) | [Image](../../images/module3/industrial-00289-feedback.png) |
| Local training report projection | [Image](../../images/module3/industrial-00350-training.png) | [Image](../../images/module3/industrial-00289-training.png) |
| Matching model loaded | [Image](../../images/module3/industrial-00350-model-loaded.png) | [Image](../../images/module3/industrial-00289-model-loaded.png) |
| Read-only MCTS suggestion | [Image](../../images/module3/industrial-00350-search.png) | [Image](../../images/module3/industrial-00289-search.png) |
| First explicit suggested Apply | [Image](../../images/module3/industrial-00350-applied.png) | [Image](../../images/module3/industrial-00289-applied.png) |

The [manual](../../ILLUSTRATED_MODULE3_MANUAL.md#industrial-browser-walkthrough)
explains the images. Training images are browser-rendered projections of exact
saved local reports, not a training screen in the application. Other images
are cropped tested application states with their original pixels retained.

This development build identity is not the final released build hash. Later
documentation and screenshots change the build record; matching actual final
production bytes is a separate delivery check. Historical 23-family/platform
results retain their original scope. Independent human acceptance and
manufacturing qualification remain unperformed. Video is deferred.
