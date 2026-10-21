import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {Gym} = createRequire(import.meta.url)('../src/model.js');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const allowed = new Set(['--output', '--python', '--skip-training']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw Error('Unknown option: ' + args[i]);
  if (args[i] !== '--skip-training' && (!args[++i] || args[i].startsWith('--'))) throw Error('Option needs a value');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async relative => fs.readFile(path.join(root, relative));
const json = async relative => JSON.parse(await read(relative));
const output = option('--output', path.join(root, 'runs', 'examples-' + new Date().toISOString().replaceAll(/[:.]/g, '-')));
await fs.mkdir(output, {recursive: false}).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  await fs.mkdir(path.dirname(path.resolve(output)), {recursive: true});
  await fs.mkdir(output);
});
const result = {schema: 'autocam-examples-verification-1', status: 'failed',
  environment: {node: process.version, platform: process.platform, architecture: os.arch()}, checks: [], skipped: []};
try {
  const manifest = await json('examples/manifest.json');
  if (manifest.schema !== 'autocam-example-catalogue-1') throw Error('Unsupported example catalogue');
  for (const input of manifest.files) {
    if (input.path.startsWith('/') || input.path.split('/').includes('..')) throw Error('Invalid example path');
    const bytes = await read(input.path);
    assert.equal(sha(bytes), input.sha256, 'Example hash differs: ' + input.path);
    assert.equal(bytes.length, input.size_bytes, 'Example size differs: ' + input.path);
  }
  result.checks.push({id: 'committed-example-identities', files: manifest.files.length, status: 'passed'});
  const expected = await json('examples/industrial-00350/expected.json');
  let catalogRaw, dataRaw;
  try { catalogRaw = await read('.test-data/catalog.json'); dataRaw = await read(expected.input.local_path); }
  catch (error) { throw Error('Industrial input missing. Run node scripts/fetch-test-data.mjs first.', {cause: error}); }
  assert.equal(sha(catalogRaw), expected.input.catalog_sha256, 'Catalogue identity differs');
  assert.equal(sha(dataRaw), expected.input.dataset.sha256, 'Industrial data identity differs');
  const data = JSON.parse(dataRaw), gym = new Gym(data, expected.case_id, 'turning');
  assert.equal(gym.observation().residual_excess_mm3, expected.initial_excess_mm3);
  const initial = gym.live.slice(), receipts = [];
  for (const step of expected.steps) {
    const prior = gym.live.slice(); gym.setMode(step.process); assert.deepEqual(gym.live, prior);
    const preview = gym.evaluate(step.action_id); assert.deepEqual(gym.live, prior);
    assert.equal(preview.removed_mm3, step.removed_mm3);
    const actual = gym.step(step.action_id);
    assert.equal(actual.observation.residual_excess_mm3, step.residual_excess_mm3);
    assert(gym.live.every((bits, i) => (bits & gym.protected[i]) === gym.protected[i]));
    receipts.push({process: step.process, action_id: step.action_id, removed_mm3: preview.removed_mm3,
      residual_excess_mm3: actual.observation.residual_excess_mm3, state_sha256: sha(gym.live)});
  }
  const final = gym.live.slice();
  assert.throws(() => gym.step(expected.steps.at(-1).action_id), /Episode ended|no_material_removed/);
  assert.deepEqual(gym.live, final); gym.reset(); assert.deepEqual(gym.live, initial);
  gym.setMode('turning'); assert.deepEqual(gym.live, initial);
  const unavailable = gym.spec.actions.find(action => !action.evaluation.available);
  assert(unavailable, 'Reference must include a blocked held-end action');
  assert.throws(() => gym.step(unavailable.id), /held_end_facing/); assert.deepEqual(gym.live, initial);
  result.checks.push({id: 'industrial-00350', status: 'passed', steps: receipts,
    allowed_action: expected.steps[0].action_id, blocked_action: unavailable.id,
    blocked_reason: 'held_end_facing', state_preserved_on_rejection: true,
    evidence_scope: 'sampled geometry; no physical qualification'});
  const stepInputs = await json('examples/step/manifest.json');
  for (const input of stepInputs.inputs) {
    const bytes = await read(input.path); assert.equal(sha(bytes), input.sha256); assert.equal(bytes.length, input.size_bytes);
  }
  result.checks.push({id: 'step-input-identities', status: 'passed', count: stepInputs.inputs.length,
    note: 'Browser import/actions/rejection are checked by npm run test:step-upload.'});
  if (args.includes('--skip-training')) result.skipped.push('local-training');
  else {
    const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = option('--python', process.env.AUTOCAM_PYTHON || localPython);
    for (const [id, script] of [['training', 'verify_examples.py'], ['cylindrical-training', 'verify_cylindrical_examples.py']]) {
      const run = spawnSync(python, ['-I', path.join(root, 'python', script), '--output', path.join(path.resolve(output), id)],
        {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, windowsHide: true});
      await fs.writeFile(path.join(output, id + '.log'), (run.stdout || '') + (run.stderr || ''));
      if (run.error) throw Error('Python verifier could not start. Create .venv or pass --python.', {cause: run.error});
      if (run.status !== 0) throw Error('Python examples failed; see ' + id + '.log');
      result.checks.push({id, status: 'passed', receipt: id + '/result.json'});
    }
  }
  result.status = result.skipped.length ? 'partial' : 'passed';
} catch (error) { result.error = String(error.stack || error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({...result, output: path.resolve(output)}));
