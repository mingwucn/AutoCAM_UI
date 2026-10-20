# Retained software evidence

[INDEX.json](INDEX.json) pins the receipts, installation logs and verification
logs retained here. Both clean-install gates tested executable source commit
`d97adaded7f1e094f562c7759cdc2291e3db4128`. The separately checked build correction
below and later documentation/receipts do not claim another complete numerical
run. Use `git log` and the built `release.json` for delivery identity.

| Platform | Full 19-step result | Installation | Example training | Learned worker | Actual task-5/6 UI |
| --- | --- | --- | --- | --- | --- |
| Windows | [Result](windows/software.json) | [Pinned logs](windows/install/install-manifest.json) | [Eight references](windows/training.json), [five cylindrical runs](windows/cylindrical.json) | [Seven cases](windows/packaged-browser.json) | [Four cases](windows/recorded-ui.json) |
| Linux | [Result](linux/software.json) | [Pinned logs](linux/install/install-manifest.json) | [Eight references](linux/training.json), [five cylindrical runs](linux/cylindrical.json) | [Seven cases](linux/packaged-browser.json) | [Four cases](linux/recorded-ui.json) |

Each software result's `log` filenames resolve in its platform folder. Commands
and generated-output paths inside JSON retain their original execution context;
they are historical evidence, not instructions to copy those absolute paths.
Detailed generated runs and screenshots are also retained in the delivery's
`windows-final-evidence.zip` and `linux-final-evidence-with-build.tar.gz` archives. Their
hashes are recorded in the delivery index outside this repository.

## Subsequent build correction

[BUILD_CORRECTION.json](BUILD_CORRECTION.json) records the later root-manifest
filename correction at `6517909584701ea4bc4ddb64477472e2c595e7a0`. Both platforms
passed 12 targeted and 13 release tests, two builds, integrity and documentation
checks. [Windows](build-correction/windows/result.json) and
[Linux](build-correction/linux/result.json) retain their own hashed commands,
logs, source inventory and build metadata. This closes the final documentation
packaging failure; the numerical and training checks remain pinned to the full
19-stage source above.

## Additional React interface checks

[Three further Windows scenarios](additional-ui/summary.json) exercise regional
v3, cylindrical v3 and mixed A through the actual interface. [Input pins](additional-ui/input-pins.json)
identify their earlier fixtures/models. The mixed checkpoint came from an older
run whose positive reproduction passed but whose parent rejection test failed;
its bytes match the final passing reference. These checks do not claim to have
consumed the final cold-run outputs. The complete probe and exports are retained
in `additional-ui-evidence.zip`; its hash and probe hash are in the index.

Inspected previews: [regional](additional-ui/regional-v3-preview.png),
[cylindrical](additional-ui/cylindrical-v3-preview.png),
[mixed](additional-ui/mixed-A-preview.png).

These are finite automated software checks. Native/browser parity uses the same
pinned runtime owner. Derived cylindrical profiles 2/3 have no historical
expected model-output hashes. No human acceptance, industrial model quality,
manufacturing qualification or public candidate deployment is established.
See [verification status](../VERIFICATION_STATUS.md) and the
[independent-user checklist](../ACCEPTANCE_CHECKLIST.md).
