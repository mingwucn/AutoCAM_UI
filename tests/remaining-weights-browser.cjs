const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');

(async () => {
  const [buildArg, outArg, mode] = process.argv.slice(2);
  const removal = mode === '--removal';
  const build = path.resolve(buildArg), out = path.resolve(outArg), app = path.resolve(__dirname, '..');
  await fs.mkdir(out, {recursive: false});
  const hash = raw => createHash('sha256').update(raw).digest('hex');
  const inputs = [__filename, path.join(__dirname, 'remaining-weights-check.mjs'),
    path.join(app, 'src/adaptive-remaining-weights.mjs'), path.join(build, 'volume-query.mjs'),
    path.join(build, 'volume-query.wasm'), path.join(build, 'artifact-index.json')];
  if (removal) inputs.push(path.join(__dirname, 'removal-weights-check.mjs'), path.join(app, 'src/adaptive-removal-weights.mjs'));
  const pins = [];
  await fs.mkdir(path.join(out, 'inputs'));
  for (const file of inputs) {
    const raw = await fs.readFile(file), retained = path.join('inputs', path.basename(file));
    await fs.writeFile(path.join(out, retained), raw); pins.push({path: file, retained, sha256: hash(raw)});
  }
  const createModule = (await import(pathToFileURL(path.join(build, 'volume-query.mjs')).href)).default;
  const check = (await import(pathToFileURL(path.join(__dirname, removal ? 'removal-weights-check.mjs' : 'remaining-weights-check.mjs')).href))[removal ? 'checkRemovalWeights' : 'checkRemainingWeights'];
  const node = check(await createModule({wasmBinary: await fs.readFile(path.join(build, 'volume-query.wasm'))}));
  const routes = {
    '/volume-query.mjs': path.join(build, 'volume-query.mjs'), '/volume-query.wasm': path.join(build, 'volume-query.wasm'),
    '/tests/check.mjs': path.join(__dirname, 'remaining-weights-check.mjs'),
    '/src/adaptive-remaining-weights.mjs': path.join(app, 'src/adaptive-remaining-weights.mjs'),
  };
  if (removal) {
    routes['/tests/check.mjs'] = path.join(__dirname, 'removal-weights-check.mjs');
    routes['/tests/remaining-weights-check.mjs'] = path.join(__dirname, 'remaining-weights-check.mjs');
    routes['/src/adaptive-removal-weights.mjs'] = path.join(app, 'src/adaptive-removal-weights.mjs');
  }
  const server = http.createServer(async (request, response) => {
    try {
      const file = routes[request.url];
      if (!file) { response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html><title>Remaining weights verification</title>'); return; }
      response.writeHead(200, {'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'});
      response.end(await fs.readFile(file));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const chrome = await page.evaluate(async removal => {
      const create = (await import('/volume-query.mjs')).default;
      const check = (await import('/tests/check.mjs'))[removal ? 'checkRemovalWeights' : 'checkRemainingWeights'];
      return check(await create());
    }, removal);
    if (JSON.stringify(node) !== JSON.stringify(chrome) || errors.length) throw new Error('Chrome parity or page error');
    for (const pin of pins) if (hash(await fs.readFile(pin.path)) !== pin.sha256) throw new Error('Input changed during test');
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({status: 'passed', node, chrome, errors, sourcePins: pins, browserVersion: browser.version(), liveGymIntegrated: false}, null, 2));
    const index = pins.map(pin => ({path: pin.retained.replaceAll('\\', '/'), sha256: pin.sha256}));
    index.push({path: 'result.json', sha256: hash(await fs.readFile(path.join(out, 'result.json')))});
    await fs.writeFile(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
    console.log(JSON.stringify({status: 'passed', exactWeight: node.exactWeight, rejectedPerRuntime: node.rejected}));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
