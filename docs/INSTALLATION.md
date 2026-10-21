# Install and run

## Use the hosted application

Open the [public AutoCAM application](https://mingwucn.github.io/AutoCAM_UI/)
in a current desktop browser. Built-in cases need no local installation.
Follow the [workflow catalogue](WORKFLOW_CATALOGUE.md) for their menu names and
steps. Local file examples need the source files described below; generating
additional example inputs and training models also needs the listed tools.

Save the site's [release.json](https://mingwucn.github.io/AutoCAM_UI/release.json).
Its `source_repository.revision` identifies the source used for that served
build. The current GitHub `main` branch can contain changes awaiting deployment,
so use this published revision when comparing a local run with the website.

## Obtain the public source and examples

The source and committed examples are in the public
[mingwucn/AutoCAM_UI repository](https://github.com/mingwucn/AutoCAM_UI).
Reading or cloning it over HTTPS requires no KU Leuven account or SSH key.
Install Git, then choose the recipe for your platform. Each reads the current
served revision before cloning and checks out that exact revision.

Windows PowerShell:

```powershell
$publishedRevision = (Invoke-RestMethod -Uri 'https://mingwucn.github.io/AutoCAM_UI/release.json' -ErrorAction Stop).source_repository.revision
if ($publishedRevision -notmatch '^[0-9a-f]{40}$') { throw 'The served release has no valid source revision.' }
git clone https://github.com/mingwucn/AutoCAM_UI.git
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop and resolve the error.' }
Set-Location -LiteralPath AutoCAM_UI -ErrorAction Stop
git checkout --detach $publishedRevision
if ($LASTEXITCODE -ne 0) { throw 'Published checkout failed; do not continue from another revision.' }
git rev-parse HEAD
git status --short
```

Linux/POSIX shell, using Python 3.12 from the requirements below:

```sh
published_revision=$(python3.12 - <<'PY'
import json
import re
import urllib.request
with urllib.request.urlopen('https://mingwucn.github.io/AutoCAM_UI/release.json', timeout=30) as response:
    revision = json.load(response)['source_repository']['revision']
if not isinstance(revision, str) or not re.fullmatch('[0-9a-f]{40}', revision):
    raise SystemExit('The served release has no valid source revision.')
print(revision)
PY
) || exit 1
git clone https://github.com/mingwucn/AutoCAM_UI.git || exit 1
cd AutoCAM_UI || exit 1
git checkout --detach "$published_revision" || exit 1
git rev-parse HEAD
git status --short
```

Keep the selected revision and status with your results; a fresh checkout should
have no local changes. If either recipe fails, resolve that error before
continuing; do not substitute `main` or an older revision.

Without Git, open the public `release.json`, copy the full
`source_repository.revision` value, and replace `PUBLISHED_REVISION` in this URL:

```text
https://github.com/mingwucn/AutoCAM_UI/archive/PUBLISHED_REVISION.zip
```

Download and extract that ZIP, then open a terminal in the extracted folder
containing `package.json`. Keep the archive and its selected commit identity;
Git status commands do not apply to an extracted ZIP.

### Optional: reproduce the walkthrough's historical starting version

The manual walkthrough began on 21 October 2026 from public commit
`c602567afb005777315ee6ecdd3696ffafb26dd6`. To reproduce that older starting
version intentionally, use the following command inside the cloned repository:

```text
git checkout --detach c602567afb005777315ee6ecdd3696ffafb26dd6
```

The [historical starting-source ZIP](https://github.com/mingwucn/AutoCAM_UI/archive/c602567afb005777315ee6ecdd3696ffafb26dd6.zip)
is the same older version. It does not include subsequent walkthrough fixes;
use the primary recipe above for the current published application.

The original GYM V1 comparison release was tagged `v1.0.0` at
`de20f204114767124296542d8d8ecc0361e7666a` in the original GitLab repository;
see [original V1 provenance](PUBLICATION_PROVENANCE.json). These are historical
provenance identifiers, not checkout targets in this public clone. The public
GitHub repository does not provide the `v1.0.0` tag. Use the current served
revision to obtain the supported package.

## Requirements for local build and training

- Node.js 24 with npm; use the committed `package-lock.json` with `npm ci`.
- Python 3.12 for local training and the example HTTP server.
- Internet access to the npm/Python package indexes and pinned AutoCAM_Data
  assets. Browser runtime requests may also need the published runtime's CDN.
- A current desktop browser with WebAssembly and Web Workers. Automated browser
  tests use installed Microsoft Edge on Windows and Playwright Chromium on Linux.

Windows and Linux are the candidate verification targets. Check
[verification status](VERIFICATION_STATUS.md) for completed runs; other platforms
are not claimed tested. Large or unsupported geometry can exceed preparation
limits even on a machine with sufficient memory. Start with the supplied examples.

## Build and serve

Run these commands from the repository root on both platforms:

```text
node --version
npm --version
npm ci
npm run build:release
```

Then serve the generated `dist` folder. Windows PowerShell:

```powershell
python --version
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Linux/POSIX shell:

```sh
python3.12 --version
python3.12 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8080/>. Keep the terminal running; press Ctrl+C to stop.
Use a different free port in both the command and URL if 8080 is occupied.
Do not open `dist/index.html` as a local file: workers and asset loading need HTTP.

`build:release` verifies and stages the runtime and CAD packages selected in
`site.config.json`. Plain `npm run build` is a developer build and does not fetch
those packages. Classic case data is loaded from its separate pinned catalogue.
This installation is not a promise of offline operation.

Each build prepares a fresh output tree and replaces the previous generated
tree only after the build succeeds. Obsolete generated files therefore do not
survive a rebuild. An existing output directory must have its build manifest;
unmanifested files or symlinks stop replacement. Preserve those files elsewhere
or choose a new `--out` directory. Source directories cannot be build outputs.

## Install local training dependencies

Use a new environment in this checkout. Windows PowerShell:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r python/requirements.txt
./.venv/Scripts/python.exe --version
```

Linux/POSIX shell:

```sh
python3.12 -m venv .venv
./.venv/bin/python -m pip install -r python/requirements.txt
./.venv/bin/python --version
```

If Linux reports that `venv` or `ensurepip` is unavailable, install your
distribution's Python 3.12 virtual-environment support, then repeat environment
creation. No activation step is needed when using the explicit interpreter path.
The trainer includes its source under `python/src`; do not set a Master-project
`PYTHONPATH` or install a different AutoCAM checkout.

The package commands select this checkout's `.venv` automatically. The portable
launcher uses the same policy:

```text
node scripts/python-command.mjs --version
```

An explicit launcher `--python EXECUTABLE` takes precedence, followed by the
`AUTOCAM_PYTHON` environment variable, then `.venv/Scripts/python.exe` on Windows
or `.venv/bin/python` on Linux. Use a Python 3.12 environment containing the
declared requirements. No package command silently falls back to a global
`python`. `verify:software` and `verify:examples` also accept `--python` overrides.

Continue with [mixed operator learning](OPERATOR_INPUT_QUICKSTART.md) or
[task-5/task-6 recorded training](RECORDED_TRAINING_QUICKSTART.md).

## Browser test prerequisites

Windows tests use the installed Edge `msedge` channel. Linux uses:

```sh
npx playwright install --with-deps chromium
```

The Linux command may need system-package installation privileges. It is a
test-environment dependency. Run [the validation commands](VALIDATION_GUIDE.md)
after the release build and declared test data are available.

## Where inputs come from

`site.config.json` separately identifies the classic catalogue, adaptive runtime
and adaptive CAD release. Their manifests provide exact asset hashes. The
[example index](../examples/README.md) explains which files are committed and
which are acquired externally. Download failure or identity mismatch must be
resolved against those pins; do not substitute arbitrary newer data.
