import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const site = path.resolve(option('--site', path.join(root, 'dist')));
const remote = option('--url', null);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async name => {
  if (name.startsWith('/') || name.split('/').includes('..')) throw Error('Invalid manifest path');
  if (!remote) return fs.readFile(path.join(site, name));
  const response = await fetch(new URL(name, remote.endsWith('/') ? remote : remote + '/'));
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const manifestRaw = await read('build-manifest.json');
const manifest = JSON.parse(manifestRaw);
if (manifest.schema !== 'shadow-gym-ui-build-1' || !manifest.files.length) throw Error('Invalid build manifest');
const paths = new Set();
for (const entry of manifest.files) {
  if (paths.has(entry.path)) throw Error('Duplicate manifest path');
  paths.add(entry.path);
  const bytes = await read(entry.path);
  if (bytes.length !== entry.size_bytes || sha(bytes) !== entry.sha256) throw Error('Build asset differs: ' + entry.path);
}
for (const required of ['release.json', 'README.html', 'docs/MODULE3_SCOPE.html', 'docs/FUNCTIONAL_CONTRACT.html', 'examples/README.html'])
  if (!paths.has(required)) throw Error('Required release entry absent: ' + required);
const release = JSON.parse(await read('release.json'));
if (remote) {
  // A remote manifest cannot authenticate itself: compare it to the selected local build.
  if (sha(manifestRaw) !== sha(await fs.readFile(path.join(site, 'build-manifest.json')))) throw Error('Hosted build is not this local candidate');
}
const result = {status: 'passed', files_checked: paths.size, version: release.version,
  source_repository: release.source_repository, build_manifest_sha256: sha(manifestRaw),
  scope: remote ? 'hosted_bytes_match_local_candidate' : 'local_build_integrity', url: remote};
const output = option('--output', null);
if (output) { await fs.mkdir(path.dirname(path.resolve(output)), {recursive: true}); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n'); }
console.log(JSON.stringify(result));
