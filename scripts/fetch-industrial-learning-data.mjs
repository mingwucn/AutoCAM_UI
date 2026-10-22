import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDUSTRIAL_CASES = Object.freeze({industrial: Object.freeze({
  path: '.test-data/cases/industrial/case.json',
  url: 'https://raw.githubusercontent.com/mingwucn/AutoCAM_Data/a2965f894440d202fad749be9a8ef1205a25d50d/releases/v1/cases/industrial/case.json',
  sha256: 'f20d5673d8cfd9021604b6b80dda59384a7e65ef5ef45adc54162308ff53245a',
  size_bytes: 8058296,
}), industrial_00289: Object.freeze({
  path: '.test-data/cases/industrial_00289/case.json',
  url: 'https://raw.githubusercontent.com/mingwucn/AutoCAM_Data/a2965f894440d202fad749be9a8ef1205a25d50d/releases/v1/cases/industrial_00289/case.json',
  sha256: '0f375401f5cfe0e19e00aed12e235810ec8f54e928fb5c774fc8ffbdcea0dbb0',
  size_bytes: 4476422,
})});
export const INDUSTRIAL_DATA = INDUSTRIAL_CASES.industrial;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify(bytes, spec) {
  if (bytes.length !== spec.size_bytes || sha(bytes) !== spec.sha256)
    throw Error('Industrial dataset byte identity differs; the cache must contain the selected pinned dataset.');
}

/** Acquire only the original industrial input; never derive or modify geometry. */
export async function prepareIndustrialLearningData({caseId = 'industrial', root = packageRoot, fetcher = globalThis.fetch} = {}) {
  const spec = INDUSTRIAL_CASES[caseId];
  if (!spec) throw Error('Unsupported industrial case.');
  const destination = path.resolve(root, spec.path);
  try {
    const info = await fs.lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.size_bytes)
      throw Error('Industrial dataset cache is not the pinned regular file.');
    const bytes = await fs.readFile(destination);
    verify(bytes, spec);
    return {case_id:caseId, path: destination, sha256: sha(bytes), size_bytes: bytes.length, acquired: false};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetcher(spec.url, {redirect: 'error', signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw Error('Industrial dataset download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  verify(bytes, spec); // Identity is checked before parsing or creating the cache file.
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.writeFile(destination, bytes, {flag: 'wx'});
  return {case_id:caseId, path: destination, sha256: sha(bytes), size_bytes: bytes.length, acquired: true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if (args.length && (args.length!==2||args[0]!=='--case')) throw Error('Usage: node scripts/fetch-industrial-learning-data.mjs [--case industrial|industrial_00289|all]');
    const selected=args[1]||'all';
    const cases=selected==='all'?Object.keys(INDUSTRIAL_CASES):[selected];
    for(const caseId of cases) console.log(JSON.stringify({status: 'passed', ...await prepareIndustrialLearningData({caseId})}, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
