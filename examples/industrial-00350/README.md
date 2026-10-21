# Industrial 00350: sampled shared-stock example

This example uses the classic industrial case selected by `site.config.json`.
The case is a sampled geometric dataset from a pinned AutoCAM_Data catalogue;
it is not the raw STEP model and not a trained industrial policy.

Follow [the GYM quickstart](../../docs/GYM_QUICKSTART.md) in the built candidate.
Start from reset stock, then apply these exact actions without resetting between
turning and milling:

| Action | Before (mm³) | Removed (mm³) | After (mm³) |
| --- | ---: | ---: | ---: |
| Outside turning, reach 40 mm | 388,600 | 101,850 | 286,750 |
| Milling from above, −Z, reach 80 mm | 286,750 | 253,514 | 33,236 |
| Milling from below, +Z, reach 40 mm | 33,236 | 33,236 | 0 |

All volumes are sampled excess. Check that target and holding samples remain,
process switching preserves current material, exhausted repeats are disabled,
and replay shows the same sequence. Camera controls must not remove material.

The machine-readable [expected results](expected.json) and parent
[example manifest](../manifest.json) bind the scenario to its input source.
Acquire the pinned test data from the repository root:

```text
node scripts/fetch-test-data.mjs
```

This verifies referenced asset hashes and writes a disposable `.test-data` cache.
Network access is required; an existing cache alone is not delivery evidence.
Run the [validation checks](../../docs/VALIDATION_GUIDE.md) to compare results.

Zero excess only describes this sampled representation. It does not certify
whole-tool access, machine motion, tolerance, release from holding stock or a
manufacturing-ready plan. Do not extrapolate the three-cut sequence to another
part without its own supported input and checks.
