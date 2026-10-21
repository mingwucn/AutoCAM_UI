# Troubleshooting

Start with the supplied examples and the exact candidate version. Record the
message and the last accepted state before retrying. Keep failed training
directories; choose a new output path for a new attempt.

| Symptom | Check and recovery |
| --- | --- |
| Repository access denied | Confirm the supplied repository URL, account and SSH access. A public hosted demo does not grant source-repository access. |
| `npm` unavailable or incompatible | Install Node.js 24 with npm; reopen the terminal and check `node --version`. On Windows, `npm.cmd` may be used when a local PowerShell policy blocks `npm.ps1`; do not change machine-wide policy for this task. |
| Runtime/CAD download or hash failure | Check network/proxy access and the exact pins in `site.config.json`. Keep the failed log. Do not substitute a newer release or disable the hash check. |
| Page opens but adaptive cases are missing | Build with `npm run build:release`, serve `dist` over HTTP, and inspect asset errors. Plain `build` does not fetch the release closure. |
| Classic catalogue fails | It comes from a separate external AutoCAM_Data URL. Check network/CORS and catalogue identity; local UI availability does not prove data availability. |
| Port 8080 is occupied | Use another free port in the server command and browser URL. |
| Browser test cannot find its executable | Windows tests need installed Edge. Linux needs `npx playwright install --with-deps chromium` and its system dependencies. |
| Python dependency/import error | Use Python 3.12 and the `.venv` interpreter created here. Install `python/requirements.txt`; remove inherited AutoCAM `PYTHONPATH` from the environment used for this run. |
| Wrong episode hash | Hash the exact saved file, not a copied JSON object or older download. Browser filename suffixes matter. Never bypass replay validation. |
| Invalid episode despite matching hash | The hash establishes file identity, not semantic validity. Use an unmodified export from the matching case/runtime; retain the rejected file for diagnosis. |
| Incompatible checkpoint | Match the episode/task/feature family. Mixed, task-5, task-6 and cylindrical models are not interchangeable. See the family guide. |
| Output directory exists | Keep it intact and select a new path. Successful or failed previous evidence must not be overwritten. |
| Preparation takes time | Wait for the status to clear or cancel once. Do not repeatedly apply actions. Use recovery/refresh controls when offered and verify accepted state before continuing. |
| Cancel was clicked but recovery includes the restored recording | Cancel stops pending computation; it does not undo an already acknowledged command. Indexed restoration changes to **Recording restored; refreshing accepted state…** after acknowledgement. Cancel during that refresh recovers the restored recording. Cancel before acknowledgement recovers the previous acknowledged head. Use **Restore last completed state** when offered, then verify the ready state and matching decisions/run details before continuing. |
| STEP import, profile or grid limit rejects | Retry the documented synthetic fixture/settings first. Increase voxel pitch if the classic grid exceeds its limit. An unsupported adaptive profile requires a supported input, not a forced acceptance. |
| Model weights changed but action did not | This is possible and occurs in the mixed reference examples. Compare actual scores/actions at identical states; do not infer improved quality. |
| Model run changed stock immediately | Task-4/5/6 **Run model** controls are explicit execution. Mixed/cylindrical suggestion controls require a later Apply/Accept. Read the workflow label. |
| **Build provenance identity differs from the executing worker** | Run details were refused because the received build record does not match the executing worker. The app may have updated, or different release files may have been served. Keep existing downloads and follow [app-update recovery](ILLUSTRATED_MODULE3_MANUAL.md#build-update-recovery). Do not bypass the identity check or use Reset/Forget to clear the message. |

<a id="report-a-reproducible-problem"></a>

## Report a reproducible problem

Include the source/build version, operating system/browser, case/profile,
input and model hashes, exact command or clicks, expected versus actual result,
and the full error message. Add the relevant downloaded run details/episode or
training receipt when sharing is appropriate. A screenshot alone does not identify
the numerical input. Do not publish private CAD simply to report an error.

Return to [installation](INSTALLATION.md), [training families](TRAINING_FAMILIES.md)
or [validation](VALIDATION_GUIDE.md) for the exact supported route.
