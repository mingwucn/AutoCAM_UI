const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {buildDocumentation}=require('../scripts/build-documentation.cjs');
test('built manual resolves local Markdown links, escapes raw HTML and pins downloadable inputs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-docs-')),out=path.join(root,'dist');
  try{
    for(const dir of ['docs','examples','python','config','dist'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'README.md'),'# Manual\n\n[Scope](docs/MODULE3_SCOPE.md)\n<script>alert(1)</script>');
    fs.writeFileSync(path.join(root,'docs/MODULE3_SCOPE.md'),'# Scope\n\n[Home](../README.md)');
    fs.writeFileSync(path.join(root,'examples/example.json'),'{}');
    fs.writeFileSync(path.join(root,'python/launcher.py'),'print("fixture")');
    fs.writeFileSync(path.join(root,'package.json'),'{"version":"1.1.0-rc.1"}');
    fs.writeFileSync(path.join(root,'site.config.json'),'{"catalogUrl":"https://example.invalid/pinned"}');
    const release=buildDocumentation({root,out,execution:{source_repository:{revision:'fixture'},input_inventory_sha256:'fixture'}});
    const html=fs.readFileSync(path.join(out,'README.html'),'utf8');
    assert(html.includes('docs/MODULE3_SCOPE.html'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
    assert(fs.readFileSync(path.join(out,'docs/MODULE3_SCOPE.html'),'utf8').includes('../README.html'));
    assert.equal(fs.readFileSync(path.join(out,'examples/example.json'),'utf8'),'{}');
    assert(release.documentation_training_inputs.some(row=>row.path==='python/launcher.py'&&row.sha256.length===64));
    assert.equal(fs.existsSync(path.join(out,'python/launcher.py')),false);
  }finally{
    const resolved=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('autocam-docs-'))throw Error('Unexpected cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
