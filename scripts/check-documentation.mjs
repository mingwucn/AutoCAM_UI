import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';
import documentation from './build-documentation.cjs';
const {resolveDocumentationLink} = documentation;

export async function checkDocumentation(root) {
  root = path.resolve(root);
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
      let resolved;
      try { resolved = resolveDocumentationLink(root, file, href); }
      catch (error) { errors.push(`${file}: ${error.message}`); continue; }
      if (!resolved) continue;
      if (resolved.generated) { checked++; continue; }
      try {
        let stat;
        try { stat = await fs.lstat(resolved.target); }
        catch (error) {
          if (error.code !== 'ENOENT' || resolved.runtime || !/\.html$/i.test(resolved.target)) throw error;
          stat = await fs.lstat(resolved.target.replace(/\.html$/i, '.md'));
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Regular source file required');
        checked++;
      } catch { errors.push(`${file}: missing or non-regular ${href}`); }
    }
  }
  const result = {status: errors.length ? 'failed' : 'passed', files: files.length, local_links_checked: checked, errors,
    historical_source_snapshots_not_standalone_instructions: historicalDocuments};
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocumentation(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'failed') process.exitCode = 1;
}
