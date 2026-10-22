import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pythonExecutable} from './python-command.mjs';
import {validateVerificationOutput} from './verification-output.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--output', '--python'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
    throw Error('Usage: node scripts/verify-software.mjs --output NEW_DIRECTORY [--python EXECUTABLE]');
  options[args[i]] = args[i + 1];
}
const output = validateVerificationOutput(root, options['--output'] || path.join(root, 'runs', 'software-' + new Date().toISOString().replaceAll(/[:.]/g, '-')));
fs.mkdirSync(output, {recursive: true});
const python = pythonExecutable({override:options['--python']});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = arguments_ => { try { return execFileSync('git', arguments_, {cwd: root, encoding: 'utf8', windowsHide: true}).trim(); } catch { return null; } };
const source = {commit: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all'])};
function sourceInventory() {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, windowsHide: true}).toString('utf8').split('\0').filter(Boolean);
  return [...new Set(names)].sort().map(name => ({path: name, sha256: sha(fs.readFileSync(path.join(root, name)))}));
}
const sourceInputs = sourceInventory();
fs.writeFileSync(path.join(output, 'source-inputs.json'), JSON.stringify(sourceInputs, null, 2) + '\n');
source.input_manifest_sha256 = sha(fs.readFileSync(path.join(output, 'source-inputs.json')));
const steps = [
  ['capabilities', process.execPath, ['scripts/generate-capabilities.mjs', '--check']],
  ['documentation', process.execPath, ['scripts/check-documentation.mjs']],
  ['unit', process.execPath, ['scripts/test.mjs']],
  ['release-assets', process.execPath, ['--test', 'tests/release-assets.test.mjs', 'tests/adaptive-model-assets.test.mjs', 'tests/test-fixtures.test.mjs', 'tests/allowance-fixtures.test.mjs', 'tests/cad-rational-assets.test.mjs']],
  ['release-build', process.execPath, ['scripts/build-release.mjs']],
  ['data', process.execPath, ['scripts/fetch-test-data.mjs']],
  ['core-wasm', process.execPath, ['core/tests/wasm-smoke.mjs']],
  ['step-import', process.execPath, ['core/tests/occt-step-smoke.mjs']],
  ['parity', process.execPath, ['tests/parity.cjs']],
  ['classic-browser', process.execPath, ['tests/browser.cjs', '--output', path.join(output, 'classic-browser')]],
  ['step-browser', process.execPath, ['tests/step-upload.cjs']],
  ['module3-workflow', process.execPath, ['tests/module3-workflow-browser.mjs']],
  ['model-upload-cancellation', process.execPath, ['tests/model-upload-cancellation-browser.mjs']],
  ['industrial-upload-cancellation', process.execPath, ['tests/industrial-learning-cancellation-browser.mjs']],
  ['industrial-learning-browser', process.execPath, ['tests/industrial-learning-browser.mjs', '--site', path.join(root, 'dist'), '--output', path.join(output, 'industrial-learning')]],
  ['recorded-trained-browser', process.execPath, ['tests/recorded-training-browser.mjs', '--site', path.join(root, 'dist'), '--output', path.join(output, 'recorded-browser')]],
  ['recorded-trained-ui', process.execPath, ['tests/recorded-training-ui-browser.mjs', '--site', path.join(root, 'dist'), '--output', path.join(output, 'recorded-ui')]],
  ['python-rejections', python, ['-m', 'unittest', 'discover', '-s', 'python/tests', '-v']],
  ['examples', process.execPath, ['scripts/verify-examples.mjs', '--python', python, '--output', path.join(output, 'examples')]],
  ['packaged-trained-browser', process.execPath, ['tests/packaged-training-browser.mjs', '--site', path.join(root, 'dist'),
    '--training-runs', path.join(output, 'examples/training'), '--cylindrical-runs', path.join(output, 'examples/cylindrical-training'),
    '--python', python, '--output', path.join(output, 'packaged-trained-browser')]],
  ['build-integrity', process.execPath, ['scripts/verify-build.mjs', '--output', path.join(output, 'build-integrity.json')]]
];
const receipt = {schema: 'autocam-software-verification-1', status: 'running', source,
  environment: {node: process.version, platform: process.platform, architecture: process.arch, python},
  prerequisite: 'Fresh declared dependency installation and browser installation must have separate logs.',
  human_acceptance: 'not_performed', manufacturing_qualified: false, steps: []};
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
for (const [id, executable, command] of steps) {
  const log = path.join(output, id + '.log'), fd = fs.openSync(log, 'wx');
  console.log(JSON.stringify({phase: 'start', id}));
  const started = Date.now();
  const run = spawnSync(executable, command, {cwd: root, stdio: ['ignore', fd, fd], windowsHide: true,
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  fs.closeSync(fd);
  const row = {id, executable, arguments: command, status: run.status === 0 && !run.error ? 'passed' : 'failed',
    exit_code: run.status, elapsed_seconds: (Date.now() - started) / 1000, log: id + '.log',
    log_sha256: sha(fs.readFileSync(log))};
  if (run.error) row.error = String(run.error);
  receipt.steps.push(row); save(); console.log(JSON.stringify(row));
  if (row.status !== 'passed') { receipt.status = 'failed'; process.exitCode = 1; break; }
}
if (receipt.status === 'running') {
  if (JSON.stringify(sourceInventory()) !== JSON.stringify(sourceInputs)) {
    receipt.status = 'failed'; receipt.error = 'Source inputs changed during verification'; process.exitCode = 1;
  } else receipt.status = 'passed';
}
receipt.finished_at = new Date().toISOString();
receipt.note = 'Software checks on the declared finite scenarios. Compare the workflow catalogue for family coverage; these checks do not establish independent human acceptance or manufacturing qualification.';
save();
console.log(JSON.stringify({status: receipt.status, steps: receipt.steps.length, output}));
