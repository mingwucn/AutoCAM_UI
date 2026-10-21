const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {marked} = require('marked');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// This builds only repository-owned Markdown. It never renders uploaded input.
function buildDocumentation({root, out, execution}) {
  const sources = [];
  const captured = new Set(), linkedSources = new Set();
  const renderer = new marked.Renderer();
  renderer.html = ({text}) => escape(text);
  const renderParagraph = renderer.paragraph.bind(renderer);
  renderer.paragraph = token => {
    // Repository manuals use standalone empty anchors for stable section links.
    // Accept only this exact ASCII form; all other raw HTML remains escaped.
    const anchor = /^<a id="([a-z][a-z0-9-]{0,63})"><\/a>$/.exec(token.text);
    return anchor ? '<a id="' + anchor[1] + '"></a>\n' : renderParagraph(token);
  };
  const render = (text, relative, historical) => marked.parse(text, {renderer, walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && !/^(?:[a-z]+:|\/\/|#)/i.test(token.href) && !historical) {
      const name = decodeURIComponent(token.href.split(/[?#]/)[0]);
      const target = path.resolve(root, path.dirname(relative), name);
      const label = path.relative(root, target).replaceAll('\\', '/');
      if (!label || label.startsWith('../') || path.isAbsolute(label)) throw Error('Linked source escapes release root: ' + token.href);
      if (!/^(?:docs\/|examples\/|config\/|README\.md$)/.test(label)) {
        if (!/^(?:tests|scripts|python|core)\//.test(label)) throw Error('Undeclared linked source: ' + label);
        linkedSources.add(label);
      }
    }
    if (token.type === 'link' && !/^(?:[a-z]+:|\/\/)/i.test(token.href))
      token.href = token.href.replace(/\.md(?=$|#)/i, '.html');
  }});
  const capture = (file, relative, publish) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Regular release input required: ' + relative);
    const bytes = fs.readFileSync(file);
    if (!captured.has(relative)) {
      sources.push({path: relative, sha256: sha(bytes), size_bytes: bytes.length});
      captured.add(relative);
    }
    if (!publish) return;
    const target = path.join(out, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes);
    if (relative.endsWith('.md')) {
      const home = path.relative(path.dirname(target), path.join(out, 'README.html')).replaceAll('\\', '/');
      const historical = relative.startsWith('docs/training-contracts/') && path.basename(relative) !== 'README.md';
      const content = (historical ? '<aside><strong>Historical owner-contract snapshot.</strong> Original Master paths and later features may not exist in this standalone release. Use the <a href="../TRAINING_GUIDE.html">current training guide</a> for executable instructions. See <a href="README.html">source provenance</a>.</aside>' : '') + render(bytes.toString('utf8'), relative, historical);
      fs.writeFileSync(target.replace(/\.md$/, '.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(relative) + ' · AutoCAM</title><style>body{font:17px/1.6 system-ui,sans-serif;color:#172d40;max-width:1050px;margin:2rem auto;padding:0 1.2rem}a{color:#004070}pre{overflow:auto;background:#eef3f7;padding:1rem}code{font-size:.9em}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccd7df;padding:.5rem;text-align:left;vertical-align:top}img{max-width:100%}nav{border-bottom:1px solid #ccd7df;padding-bottom:1rem}</style></head><body><nav><a href="' + escape(home) + '">AutoCAM manual</a></nav><main>' + content + '</main></body></html>');
    }
  };
  function walk(directory, relative, publish) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === '__pycache__' || name.endsWith('.pyc')) continue;
      const file = path.join(directory, name), label = relative + '/' + name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Symlink in release input: ' + label);
      if (stat.isDirectory()) walk(file, label, publish); else capture(file, label, publish);
    }
  }
  capture(path.join(root, 'README.md'), 'README.md', true);
  for (const name of ['docs', 'examples', 'config', 'python']) {
    if (fs.existsSync(path.join(root, name))) walk(path.join(root, name), name, name !== 'python');
  }
  for (const relative of linkedSources) {
    let cursor = root;
    for (const component of relative.split('/')) {
      cursor = path.join(cursor, component);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlink in linked source: ' + relative);
    }
    capture(path.join(root, relative), relative, true);
  }
  sources.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const release = {schema: 'autocam-standalone-release-1', version: pkg.version,
    source_repository: execution.source_repository, ui_input_inventory_sha256: execution.input_inventory_sha256,
    documentation_training_inputs: sources, documentation_training_inputs_sha256: sha(Buffer.from(JSON.stringify(sources))),
    configured_dependencies: JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'))),
    entry_points: {manual: 'README.html', scope: 'docs/MODULE3_SCOPE.html', examples: 'examples/README.html'},
    verification: 'See docs/VERIFICATION_STATUS.html for executed scope; a build is not human acceptance.',
    manufacturing_qualified: false};
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  return release;
}
module.exports = {buildDocumentation};
