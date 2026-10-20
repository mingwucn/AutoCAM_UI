import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md'];
async function collect(relative) {
  for (const item of await fs.readdir(path.join(root, relative), {withFileTypes: true})) {
    const name = relative + '/' + item.name;
    if (item.isDirectory()) await collect(name);
    else if (name.endsWith('.md')) files.push(name);
  }
}
await collect('docs'); await collect('examples');
const errors = [], historicalDocuments = []; let checked = 0;
for (const file of files) {
  if (file.startsWith('docs/training-contracts/') && path.basename(file) !== 'README.md') {
    historicalDocuments.push(file); continue;
  }
  const links = [];
  marked.walkTokens(marked.lexer(await fs.readFile(path.join(root, file), 'utf8')), token => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
  });
  for (const href of links) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split(/[?#]/)[0]).replace(/\.html$/, '.md');
    if (!target) continue;
    const resolved = path.resolve(root, path.dirname(file), target);
    if (!resolved.startsWith(root + path.sep)) { errors.push(`${file}: link escapes standalone checkout: ${href}`); continue; }
    try { await fs.access(resolved); checked++; } catch { errors.push(`${file}: missing ${href}`); }
  }
}
const result = {status: errors.length ? 'failed' : 'passed', files: files.length, local_links_checked: checked, errors,
  historical_source_snapshots_not_standalone_instructions: historicalDocuments};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
