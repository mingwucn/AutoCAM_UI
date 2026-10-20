# Install and run

Use the supplied candidate checkout or its exact published commit. Do not assume
the existing hosted site contains unpublished candidate changes. Record
`git rev-parse HEAD` and `git status --short` before verification; a release
archive should carry the corresponding source/build manifest.

The historical comparison release is `v1.0.0` at
`de20f204114767124296542d8d8ecc0361e7666a`. Cloning that tag reproduces V1, not
this candidate. Repository access may require KU Leuven credentials or an SSH
key; source access is separate from access to the public hosted demonstration.

## Requirements

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
