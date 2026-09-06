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

The standalone site also accepts a local `.step` or `.stp` file. The file is
read inside a Web Worker and is never uploaded. The user selects milling or
turning, voxel pitch, stock allowance and tool reaches; turning also asks for
the spindle axis, held end and holding length. Browser OpenCascade imports and
classifies the solid, while `core/src/shadow_core.cpp` computes directional
shadow, finite reach and material removal. That same C++ source builds as the
native library used by the parent repository's Python adapter and as the
browser WebAssembly module. Local preparations are experimental voxel models.

## Verify

Run `npm test`, `npm run test:core-wasm`, `npm run test:step-import`,
`node scripts/fetch-test-data.mjs`, `npm run test:parity`,
`npx playwright install chromium`, `npm run build`, `npm run test:browser`,
and `npm run test:step-upload`.
Windows browser tests use installed Edge; Linux uses Playwright Chromium.
The reference corpus has 916 fixtures. Browser tests exercise all seven
case/process combinations, replay, holding restrictions and asynchronous loads.
The upload test prepares a newly generated STEP solid for milling and turning,
applies an action, checks protected material, and verifies that no request
contains the local file.

## Offline report embed

Run `npm run build:embed -- --out PATH`. Include its assets in a page with
`<div id="shadow-gym-root"></div>`. Load the original bundled dataset as
`window.SHADOW_DATA` before `assets/model.js`, `assets/view.js`, then
`assets/app.js`. Link `assets/style.css`. The bundled provider uses no network.
The parent AutoCAM repository owns report prose, figures and export scripts.

## Publish and update

GitHub Pages uses the Actions workflow and publishes only `dist/`. Main-branch
deployments follow provider, parity and browser checks. In repository Settings
→ Pages, select GitHub Actions as the source.

Publish a new data commit first, then update `dataCommit` and `catalogUrl`
together and rerun verification. Commit and push the UI; the parent repository
then records that UI commit in its submodule. Roll back by reverting the UI
commit (including its data pin), redeploying, and restoring the parent gitlink.
Keep data commits referenced by published UI revisions available.

Third-party license notices are included in built assets. `private: true` in
package.json prevents accidental npm publication; this Git repository is public.
