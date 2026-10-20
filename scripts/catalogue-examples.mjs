import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 3 || process.argv[2] !== '--write')
  throw Error('Explicit --write required. Review changed inputs and expectations before updating their pins.');
const files = [];
async function walk(relative) {
  for (const item of await fs.readdir(path.join(root, relative), {withFileTypes: true})) {
    const name = relative + '/' + item.name;
    if (item.isSymbolicLink()) throw Error('Example symlink forbidden: ' + name);
    if (item.isDirectory()) await walk(name);
    else if (/\.(?:json|bin|step)$/.test(name) && name !== 'examples/manifest.json') {
      const bytes = await fs.readFile(path.join(root, name));
      files.push({path: name, size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
    }
  }
}
await walk('examples');
files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const catalogue = {schema: 'autocam-example-catalogue-1', comparison_release: 'v1.0.0',
  scenarios: [
    {id: 'industrial-00350', guide: 'industrial-00350/README.md', expected: 'industrial-00350/expected.json',
      input_custody: 'external immutable AutoCAM_Data release, fetched and hashed; raw industrial STEP not redistributed', command: 'npm run verify:examples'},
    {id: 'mixed-operator-A-B', guide: 'operator-input/README.md', inputs: 'operator-input/',
      input_custody: 'committed synthetic demonstrations, starting model and original V1 outcomes', command: 'node scripts/python-command.mjs -I python/verify_examples.py --family mixed --output runs/mixed-check'},
    {id: 'task5-task6', guide: 'recorded-training/README.md', inputs: 'recorded-training/',
      input_custody: 'committed synthetic manual and original-model MCTS episodes and expected checkpoints', command: 'node scripts/python-command.mjs -I python/verify_examples.py --output runs/recorded-check'},
    {id: 'regional-v2-v3', guide: 'recorded-training/README.md', inputs: 'recorded-training/regional-manifest.json',
      input_custody: 'committed original synthetic regional episodes with separately pinned v2/v3 expected outcomes', command: 'node scripts/python-command.mjs -I python/verify_examples.py --output runs/regional-check'},
    {id: 'cylindrical-policy', guide: 'cylindrical-policy/README.md', inputs: 'cylindrical-policy/',
      input_custody: 'committed bounded synthetic full-cycle inputs copied with source pins', command: 'node scripts/python-command.mjs -I python/verify_cylindrical_examples.py --output runs/cylindrical-check'},
    {id: 'step-inputs', guide: 'step/README.md', inputs: 'step/manifest.json',
      input_custody: 'existing repository synthetic STEP fixtures; profile restrictions still apply', command: 'npm run test:step-upload'}
  ], files, manufacturing_qualified: false};
await fs.writeFile(path.join(root, 'examples/manifest.json'), JSON.stringify(catalogue, null, 2) + '\n');
console.log(JSON.stringify({files: files.length, output: 'examples/manifest.json', note: 'Pins updated; this is not validation.'}));
