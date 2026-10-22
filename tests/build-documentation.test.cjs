const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {buildDocumentation}=require('../scripts/build-documentation.cjs');
test('built manual resolves local Markdown links, escapes raw HTML and pins downloadable inputs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-docs-')),out=path.join(root,'dist');
  try{
    for(const dir of ['docs','examples','python','config','dist'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'README.md'),'# Manual\n\n[Scope](docs/MODULE3_SCOPE.md)\n[Verifier](python/verifier.py)\n<script>alert(1)</script>\n\n<a id="reviewer-comments-9-12"></a>\n\n[Reviewer response](#reviewer-comments-9-12)\n\n<a id="bad" onclick="alert(1)"></a>\n\n<a id="Bad"></a>\n\n<a href="javascript:alert(1)">unsafe anchor</a>');
    fs.writeFileSync(path.join(root,'docs/MODULE3_SCOPE.md'),'# Scope\n\n[Home](../README.md)');
    fs.writeFileSync(path.join(root,'examples/example.json'),'{}');
    fs.writeFileSync(path.join(root,'python/launcher.py'),'print("fixture")');
    fs.writeFileSync(path.join(root,'python/verifier.py'),'print("verification")');
    fs.writeFileSync(path.join(root,'package.json'),'{"version":"1.1.0-rc.1"}');
    fs.writeFileSync(path.join(root,'site.config.json'),'{"catalogUrl":"https://example.invalid/pinned"}');
    const release=buildDocumentation({root,out,execution:{source_repository:{revision:'fixture'},input_inventory_sha256:'fixture'}});
    const html=fs.readFileSync(path.join(out,'README.html'),'utf8');
    assert(html.includes('docs/MODULE3_SCOPE.html'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
    assert(html.includes('<a id="reviewer-comments-9-12"></a>'));
    assert(html.includes('href="#reviewer-comments-9-12"'));
    assert(!html.includes('<a id="bad"'));assert(html.includes('&lt;a id=&quot;bad&quot; onclick='));
    assert(!html.includes('<a id="Bad"'));assert(html.includes('&lt;a id=&quot;Bad&quot;&gt;'));
    assert(!html.includes('<a href="javascript:'));assert(html.includes('&lt;a href=&quot;javascript:'));
    assert(fs.readFileSync(path.join(out,'docs/MODULE3_SCOPE.html'),'utf8').includes('../README.html'));
    assert.equal(fs.readFileSync(path.join(out,'examples/example.json'),'utf8'),'{}');
    assert(release.documentation_training_inputs.some(row=>row.path==='python/launcher.py'&&row.sha256.length===64));
    assert.equal(fs.existsSync(path.join(out,'python/launcher.py')),false);
    assert.equal(fs.readFileSync(path.join(out,'python/verifier.py'),'utf8'),'print("verification")');
    assert.equal(release.documentation_training_inputs.filter(row=>row.path==='python/verifier.py').length,1);
    fs.writeFileSync(path.join(root,'private.txt'),'must not publish');
    fs.writeFileSync(path.join(root,'README.md'),'[Private](private.txt)');
    assert.throws(()=>buildDocumentation({root,out,execution:{source_repository:{revision:'fixture'},input_inventory_sha256:'fixture'}}),/Undeclared linked source/);
    assert.equal(fs.existsSync(path.join(out,'private.txt')),false);
  }finally{
    const resolved=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('autocam-docs-'))throw Error('Unexpected cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('portable app and release links retain their paths without replacing runtime output',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-docs-')),out=path.join(root,'dist');
  try{
    for(const dir of ['docs','docs/nested','examples','config','dist'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'README.md'),'[App](index.html?case=industrial&process=turning#gym)\n[Release](release.json)\n[Guide](docs/guide.md?view=full#steps)');
    fs.writeFileSync(path.join(root,'docs/guide.md'),'# Guide\n\n[App](../index.html?case=industrial&process=turning#gym)\n[Release](../release.json)\n[Home](../README.html)\n[Rendered guide](guide.html#steps)\n[Deep](nested/deep.md)\n[Dotted anchor](#steps.md)');
    fs.writeFileSync(path.join(root,'docs/nested/deep.md'),'[App](../../index.html#gym)\n[Release](../../release.json)');
    fs.writeFileSync(path.join(root,'index.html'),'<html>source entry</html>');
    const runtime='<html>already built application</html>';
    fs.writeFileSync(path.join(out,'index.html'),runtime);
    fs.writeFileSync(path.join(root,'package.json'),'{"version":"fixture"}');
    fs.writeFileSync(path.join(root,'site.config.json'),'{}');
    const {checkDocumentation}=await import('../scripts/check-documentation.mjs');
    assert.equal(fs.existsSync(path.join(root,'release.json')),false);
    const checked=await checkDocumentation(root);
    assert.equal(checked.status,'passed',JSON.stringify(checked.errors));
    assert.equal(checked.local_links_checked,10);
    const release=buildDocumentation({root,out,execution:{source_repository:{revision:'fixture'},input_inventory_sha256:'fixture'}});
    const home=fs.readFileSync(path.join(out,'README.html'),'utf8'),guide=fs.readFileSync(path.join(out,'docs/guide.html'),'utf8'),deep=fs.readFileSync(path.join(out,'docs/nested/deep.html'),'utf8');
    assert(home.includes('href="index.html?case=industrial&amp;process=turning#gym"'));
    assert(home.includes('href="docs/guide.html?view=full#steps"'));
    assert(home.includes('href="release.json"'));
    assert(guide.includes('href="../index.html?case=industrial&amp;process=turning#gym"'));
    assert(guide.includes('href="../release.json"'));
    assert(guide.includes('href="guide.html#steps"'));
    assert(guide.includes('href="#steps.md"'));
    assert(deep.includes('href="../../index.html#gym"'));
    assert(deep.includes('href="../../release.json"'));
    assert.equal(fs.readFileSync(path.join(out,'index.html'),'utf8'),runtime);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'release.json'),'utf8')),release);
    assert(!release.documentation_training_inputs.some(row=>['index.html','release.json'].includes(row.path)));
  }finally{
    const resolved=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('autocam-docs-'))throw Error('Unexpected cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('portable output exceptions do not admit escapes, private files or missing documents',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-docs-')),out=path.join(root,'dist');
  try{
    for(const dir of ['docs','examples','dist'])fs.mkdirSync(path.join(root,dir));
    fs.writeFileSync(path.join(root,'private.txt'),'private input');
    fs.writeFileSync(path.join(root,'execution-build.json'),'not a documentation exception');
    fs.writeFileSync(path.join(root,'index.md'),'must not stand in for the runtime entry');
    const {checkDocumentation}=await import('../scripts/check-documentation.mjs');
    for(const href of ['../release.json','%2e%2e/release.json','private.txt','execution-build.json','other-release.json']){
      fs.writeFileSync(path.join(root,'README.md'),'[Invalid]('+href+')');
      const checked=await checkDocumentation(root);
      assert.equal(checked.status,'failed',href);
      assert.throws(()=>buildDocumentation({root,out,execution:{}}),/Linked source escapes release root|Undeclared linked source/,href);
    }
    for(const href of ['index.html','docs/missing.html','docs/release.json']){
      fs.writeFileSync(path.join(root,'README.md'),'[Missing]('+href+')');
      const checked=await checkDocumentation(root);
      assert.equal(checked.status,'failed',href);
      assert(checked.errors.some(error=>error.includes('missing or non-regular')),href);
    }
    assert.equal(fs.existsSync(path.join(out,'private.txt')),false);
    assert.equal(fs.existsSync(path.join(out,'execution-build.json')),false);
  }finally{
    const resolved=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('autocam-docs-'))throw Error('Unexpected cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
