import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {INDUSTRIAL_CASES} from './fetch-industrial-learning-data.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function trainingSourceSnapshot() {
  const names = ['src/model.js', 'src/industrial-learning.mjs',
    'scripts/train-industrial-episode.mjs', 'scripts/fetch-industrial-learning-data.mjs'];
  return Promise.all(names.map(async name => {
    const bytes = await fs.readFile(path.join(packageRoot, name));
    return {path: name, sha256: sha(bytes), size_bytes: bytes.length};
  }));
}
async function requireNewOutput(output) {
  if (typeof output !== 'string' || !output.trim()) throw Error('Supply --output NEW-DIRECTORY.');
  const destination = path.resolve(output);
  try { await fs.lstat(destination); }
  catch (error) { if (error.code === 'ENOENT') return destination; throw error; }
  throw Error('Output already exists; choose a new directory.');
}
async function readPinned(filename, expected, maxSize, label) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxSize)
    throw Error(label + ' must be a regular file within its size limit.');
  const bytes = await fs.readFile(filename);
  if (bytes.length > maxSize || sha(bytes) !== expected) throw Error(label + ' SHA-256 differs.');
  return bytes;
}
export async function loadIndustrialTrainingInputs({feedback, expectedSha256, dataset, initialCheckpoint,
  initialCheckpointSha256, root = packageRoot} = {}) {
  if (typeof feedback !== 'string' || !feedback || !validHash(expectedSha256))
    throw Error('Supply --feedback FILE and --expected-sha256 with its lowercase SHA-256.');
  if (Boolean(initialCheckpoint) !== Boolean(initialCheckpointSha256) ||
      (initialCheckpoint && !validHash(initialCheckpointSha256)))
    throw Error('--initial-checkpoint and --initial-checkpoint-sha256 must be supplied together.');
  const feedbackRaw = await readPinned(path.resolve(feedback), expectedSha256, 16 * 1024 * 1024, 'Feedback');
  const bundle = JSON.parse(feedbackRaw), spec = INDUSTRIAL_CASES[bundle?.case?.scene_id];
  if (!spec) throw Error('Feedback does not identify one of the two supported industrial cases.');
  const datasetPath = dataset ? path.resolve(dataset) : path.join(root, spec.path);
  let datasetRaw;
  try { datasetRaw = await readPinned(datasetPath, spec.sha256, spec.size_bytes, 'Industrial dataset'); }
  catch (error) {
    if (error.code === 'ENOENT') throw Error('Industrial dataset missing. Run node scripts/fetch-industrial-learning-data.mjs first.');
    throw error;
  }
  if (datasetRaw.length !== spec.size_bytes) throw Error('Industrial dataset byte size differs.');
  const initialRaw = initialCheckpoint ? await readPinned(path.resolve(initialCheckpoint),
    initialCheckpointSha256, 1024 * 1024, 'Initial checkpoint') : null;
  return {feedbackRaw, datasetRaw, initialRaw, bundle, spec,
    data: JSON.parse(datasetRaw), initialModel: initialRaw ? JSON.parse(initialRaw) : null};
}
export function parseIndustrialTrainingArguments(args) {
  const names = new Map([['--feedback', 'feedback'], ['--expected-sha256', 'expectedSha256'],
    ['--dataset', 'dataset'], ['--output', 'output'], ['--initial-checkpoint', 'initialCheckpoint'],
    ['--initial-checkpoint-sha256', 'initialCheckpointSha256'], ['--alpha', 'alpha'],
    ['--gamma', 'gamma'], ['--clip', 'clip'], ['--epochs', 'epochs'],
    ['--reward-epochs', 'rewardEpochs'], ['--reward-alpha', 'rewardAlpha'],
    ['--exploration-episodes', 'explorationEpisodes'], ['--seed', 'seed']]);
  const numeric = new Set(['alpha','gamma','clip','epochs','rewardEpochs','rewardAlpha','explorationEpisodes','seed']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]), value = args[i + 1];
    if (!name || typeof value !== 'string' || !value.trim() || value.startsWith('--') || name in options)
      throw Error('Unknown, duplicate or incomplete option; use --help.');
    if (numeric.has(name)) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw Error(args[i] + ' must be finite.');
      options[name] = number;
    } else options[name] = value;
  }
  return options;
}
export async function trainIndustrialEpisode(options = {}) {
  const destination = await requireNewOutput(options.output);
  const inputs = await loadIndustrialTrainingInputs(options);
  const sources = await trainingSourceSnapshot();
  const core = await import('../src/industrial-learning.mjs');
  const context = await core.createIndustrialContext(inputs.data);
  const initialModel = inputs.initialModel ?? core.createInitialModel(context);
  await core.validateCheckpoint(context, initialModel);
  // trainModel verifies the original bundle digest and every replay/label.
  // Reconstructing it here would hide tampered envelope fields.
  const bundle = inputs.bundle;
  const config = {};
  for (const key of ['alpha','gamma','clip','epochs','rewardEpochs','rewardAlpha','explorationEpisodes','seed'])
    if (options[key] !== undefined) config[key] = options[key];
  const trained = await core.trainModel(context, bundle, {...config, initialModel});
  await core.validateCheckpoint(context, trained.model);
  if (JSON.stringify(await trainingSourceSnapshot()) !== JSON.stringify(sources))
    throw Error('Training source files changed during the run; no checkpoint was published.');
  const checkpointRaw = jsonBytes(trained.model), initialRaw = inputs.initialRaw ?? jsonBytes(initialModel);
  const report = {schema: 'industrial-training-report-1', status: 'passed',
    runtime: {node: process.versions.node},
    dataset: {case_id:bundle.case.scene_id, path: inputs.spec.path, sha256: sha(inputs.datasetRaw), size_bytes: inputs.datasetRaw.length},
    feedback: {path: 'feedback.json', sha256: sha(inputs.feedbackRaw), size_bytes: inputs.feedbackRaw.length},
    initial_checkpoint: {path:'initial-checkpoint.json', sha256:sha(initialRaw), size_bytes:initialRaw.length},
    source_files: sources,
    source_stability: 'Source bytes checked before core loading and after training. API callers must keep module sources unchanged for the process lifetime; use a fresh Node.js process for the CLI.',
    training: trained.report,
    checkpoint: {path: 'checkpoint.json', sha256: sha(checkpointRaw), size_bytes: checkpointRaw.length},
    interpretation: 'Preference reward learning followed by simulator TD Q fine-tuning. Read reported action/sequence comparisons; changed weights alone establish no improvement or manufacturing qualification.'};
  const reportRaw = jsonBytes(report);
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.mkdir(destination);
  let published = false;
  try {
    await fs.writeFile(path.join(destination, 'feedback.json'), inputs.feedbackRaw, {flag: 'wx'});
    await fs.writeFile(path.join(destination, 'initial-checkpoint.json'), initialRaw, {flag:'wx'});
    await fs.writeFile(path.join(destination, 'training-report.json'), reportRaw, {flag: 'wx'});
    await fs.writeFile(path.join(destination, 'checkpoint.json'), checkpointRaw, {flag: 'wx'});
    published = true;
  } finally {
    if (!published) await fs.unlink(path.join(destination, 'checkpoint.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return {output: destination, checkpoint: path.join(destination, 'checkpoint.json'), report};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      console.log('node scripts/train-industrial-episode.mjs --feedback FILE --expected-sha256 SHA256 --output NEW-DIRECTORY [--dataset FILE] [--initial-checkpoint FILE --initial-checkpoint-sha256 SHA256] [--alpha N --gamma N --clip N --epochs N --reward-epochs N --reward-alpha N --exploration-episodes N --seed N]');
    } else {
      if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Use Node.js 24 for industrial local training.');
      const result = await trainIndustrialEpisode(parseIndustrialTrainingArguments(process.argv.slice(2)));
      console.log(JSON.stringify({status: 'passed', output: result.output,
        checkpoint: result.checkpoint, checkpoint_sha256: result.report.checkpoint.sha256,
        policy_choices:result.report.training.policy_choices,
        actual_feedback_choice_changed:result.report.training.actual_feedback_choice_changed}, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
