# AutoCAM Shadow Gym

Interactive React explorer for direction and finite tool reach in milling and
axis-based turning. Five cases include simple shapes and parts 3-29-00350 and
3-29-00289. The theme uses KU Leuven blue `#004070`.

This is an experimental voxel shadow model, not a qualified machining or
toolpath simulator. React owns controls and session state; the existing
Three.js renderer and numerical model retain their original behavior.

## Develop

Use Node 24 and run `npm ci`, then `npm run dev`. Open the printed localhost
URL. Reload after editing; the development server rebuilds on each page load.
Run `npm run build` for the standalone site in `dist/`.

`site.config.json` pins the public AutoCAM_Data catalog to an exact commit.
Cases load on demand, with SHA-256 verification, cancellation and caching.
Use `?case=industrial_00289&process=turning#gym` for a direct link.
An optional `?data=https://.../catalog.json` selects another compatible catalog.
Data hosting must permit cross-origin requests. Curated geometry is packed
voxel data inside each case JSON; no separate CAD download is needed.

Simple cases provide report-authored teaching sequences. Industrial cases use
one shared stock across a mill-turn workflow: the baseline greedily applies
positive-removal Turning actions first, then Milling actions, preferring shorter
reach and action ID on ties. Users may switch process without resetting stock.
There is no fixed action limit, and zero-removal actions are disabled.

The standalone site also accepts a local `.step` or `.stp` file. The file is
read inside a Web Worker and is never uploaded. The user selects voxel pitch,
cylindrical stock allowance, tool reaches, spindle axis, held end and holding
length. Browser OpenCascade imports and classifies the solid, while
`core/src/shadow_core.cpp` computes Turning and Milling actions over the same
stock and grid. The generated baseline turns first and then mills. That same C++ source builds as the
native library used by the parent repository's Python adapter and as the
browser WebAssembly module. Local preparations are experimental voxel models.

## Verify

`npm test` expands the committed gzip fixtures into a fresh ignored cache,
checks compressed and raw SHA-256 hashes and sizes, and runs every selected unit
test. Missing fixtures, failed tests, skips or cancellations fail the command.
These are the unchanged synthetic native/browser fixtures from the parent
project's `packaged-node-regression-02` verification, with provenance recorded
in `tests/fixtures/adaptive/manifest.json`. They are test data and are not copied
into the website. No parent checkout or Python installation is needed.
`npm run test:unit` is the raw test list for developers supplying their own
fixture environment; use `npm test` for the complete CI check.

Run `npm test`, `npm run test:core-wasm`, `npm run test:step-import`,
`node scripts/fetch-test-data.mjs`, `npm run test:parity`,
`npx playwright install chromium`, `npm run build`, `npm run test:browser`,
and `npm run test:step-upload`.
Windows browser tests use installed Edge; Linux uses Playwright Chromium.
The reference corpus has 916 fixtures. Browser tests exercise all seven
case/process combinations, replay, holding restrictions and asynchronous loads.
The upload test prepares generated box, overhang and stepped-shaft STEP solids,
applies milling and turning actions, checks protected material, and verifies
that no request contains the local file. It also covers invalid input, the
cell bound, cancellation and stale-result rejection. Set
`AUTOCAM_STEP_FIXTURES` to a JSON array of `{path, process, pitch, axis}` rows
to exercise private or parent-repository industrial fixtures locally.

## Offline report embed

Run `npm run build:embed -- --out PATH`. Include its assets in a page with
`<div id="shadow-gym-root"></div>`. Load the original bundled dataset as
`window.SHADOW_DATA` before `assets/model.js`, `assets/view.js`, then
`assets/app.js`. Link `assets/style.css`. The bundled provider uses no network.
The parent AutoCAM repository owns report prose, figures and export scripts.

## Publish and update

GitHub Pages uses the Actions workflow and publishes only `dist/`. Main-branch
deployments follow provider, parity and browser checks. In repository Settings
â†’ Pages, select GitHub Actions as the source.

Publish a new data commit first, then update `dataCommit` and `catalogUrl`
together and rerun verification. Commit and push the UI; the parent repository
then records that UI commit in its submodule. Roll back by reverting the UI
commit (including its data pin), redeploying, and restoring the parent gitlink.
Keep data commits referenced by published UI revisions available.

### Optional adaptive runtime releases

`npm run build:release` verifies and stages any configured adaptive releases
before calling the normal builder. With no release fields it builds as before.
The Pages workflow uses this command for both reproducibility builds.

Optional `site.config.json` fields `adaptiveRuntimeRelease` and
`adaptiveCadRelease` each take exactly `{ "url": "...", "sha256": "..." }`.
Use a public HTTPS URL such as
`https://raw.githubusercontent.com/mingwucn/AutoCAM_Data/<commit>/releases/<name>/release.json`
and the SHA-256 of those exact index bytes. Keep `<commit>` immutable. Each
index lists relative asset paths, sizes and hashes under schema
`autocam-ui-assets-1`; all files must remain next to the index at those paths.
Missing or changed files fail the build. Downloads go into `.cache/releases/`.
They happen during the build; visitors receive the verified assets from Pages.

From a passed local package with a pinned `index.json`, export its declared
runtime closure with:

```powershell
node scripts/export-runtime-release.mjs --package PATH --index-sha256 SHA256 --out NEW_DIRECTORY
```

The command prints the `release.json` hash and excludes outer producer logs and
diagnostic checkpoints. It preserves declared runtime bytes, including Python
runtime source in the archive. Review and publish the exported directory to the
data repository before selecting its URL/hash in the UI configuration. A
successful export is not geometry or policy qualification. The complete case
catalogue and local STEP preparation still need combined release verification.
This release selects the ordered adaptive catalogue and companion local STEP
preparation package while retaining the original v1 report datasets.

For local development, `npm run build -- --adaptive-assets PATH` still works.
The release command rejects conflicting configured and explicit asset paths.
Run `npm run test:release` to check transport integrity and rejection behavior.

Third-party license notices are included in built assets. `private: true` in
package.json prevents accidental npm publication; this Git repository is public.
