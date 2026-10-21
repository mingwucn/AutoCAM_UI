# STEP examples and failure recovery

Use the built local candidate. Select the intended STEP engine/profile before
preparing a file: classic sampled geometry and adaptive construction have
different support. Local files are read in the browser; the importer does not
upload them to a modelling service.

## Classic sampled preparation

The following existing synthetic files are committed in `core/tests/fixtures/`:

| File | Voxel pitch | Spindle axis |
| --- | ---: | --- |
| `box.step` | 2 mm | Z |
| `overhang.step` | 2 mm | Z |
| `stepped-shaft.step` | 1 mm | X |

In the STEP upload controls choose the voxel engine. Use stock allowance 2 mm,
tool reaches `2, 4`, the negative held end, and holding length 2 mm. Prepare the
file. The generated case begins in turning and provides a staged greedy
turning/milling baseline. Apply an available turning action, then switch to
milling: stock/history must persist and target/holding samples remain.

From the repository root, after the prerequisites in the
[validation guide](../../docs/VALIDATION_GUIDE.md):

```text
npm run test:step-upload
```

This existing browser test exercises those three files plus the failures below.
It does not verify every adaptive construction profile.

## Adaptive profiles

Read the [capability table](../../docs/CAPABILITIES.md) before choosing a profile.
Preparation, original-face inspection and machining are separate stages.
Positive allowance is restricted to supported axis-aligned planar,
principal-frame spherical and coaxial cylindrical profiles. The rational-prism
profile permits preparation/inspection but not machining. Regional model use
requires the exact compatible prepared task and model context; a newly imported
part has no automatically trained industrial policy. A successful import cannot
bypass these limits.

Use only the exact profile/setup pairings listed in the
[example manifest](../manifest.json). Profile-specific fixtures and verification
receipts must be present before claiming that route tested. General arbitrary
STEP machining is outside the supported scope.

## Check rejection and cancellation

First prepare a valid case, so there is an accepted state to preserve.

1. Supply a `broken.step` file containing `not a STEP model`. Preparation must
   report that it could not read the file and retain the previous case.
2. Select `box.step` with voxel pitch `0.01`. Preparation must report its cell
   limit rather than accept an oversized grid.
3. Begin `stepped-shaft.step` preparation at pitch `0.4`, then cancel. A late
   worker result must not replace the previous accepted case.
4. For an unsupported adaptive profile/setup pairing, retain the actual
   rejection reason. Do not treat missing geometry, unresolved cells or a failed
   check as clear access.

A browser exception, disappearing accepted state or silent fallback is a defect,
not an acceptable rejection. Record the source hash, settings, stage and message
when reporting a problem; see [troubleshooting](../../docs/TROUBLESHOOTING.md).
