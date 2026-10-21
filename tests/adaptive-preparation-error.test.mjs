import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptivePreparationError} from '../src/adaptive-preparation-error.mjs';

test('a Python traceback exposes its cause without displaying the stack in the alert',()=>{
  const raw='Traceback (most recent call last):\n  File "/app/cad_machining.py", line 253, in prepare\n    fields(setup)\nValueError: Unknown or missing fields\n';
  const shown=adaptivePreparationError(new Error(raw),'Machining preparation');
  assert.match(shown.message,/Machining preparation failed: Unknown or missing fields/);
  assert.doesNotMatch(shown.message,/Traceback|\/app\/|line 253/);
  assert.equal(shown.details,raw);
});

test('a chained traceback reports the terminal cause and preserves exact CRLF diagnostics',()=>{
  const raw='PythonError: Traceback (most recent call last):\r\nValueError: Invalid setup\r\n\r\nDuring handling of the above exception, another exception occurred:\r\n\r\nTraceback (most recent call last):\r\n  File "<exec>", line 6, in <module>\r\nRuntimeError: Tool catalog does not match\r\n';
  const shown=adaptivePreparationError(raw,'STEP preparation');
  assert.match(shown.message,/Tool catalog does not match/);
  assert.doesNotMatch(shown.message,/Invalid setup|Traceback/);
  assert.equal(shown.details,raw);
});

test('ordinary preparation errors retain their existing message and exact diagnostic text',()=>{
  const raw='Incompatible STEP profile.';
  assert.deepEqual(adaptivePreparationError(new Error(raw),'STEP preparation'),{message:raw,details:raw});
});

test('unknown or empty errors have an actionable fallback instead of an object dump',()=>{
  for(const error of [undefined,null,{},new Error('')]){
    const shown=adaptivePreparationError(error,'Machining preparation');
    assert.match(shown.message,/Machining preparation failed.*Check the selected files and settings/);
    assert.doesNotMatch(shown.message,/undefined|null|\[object Object\]/);
    assert.equal(shown.details,'');
  }
});

test('an incomplete traceback remains available even when no terminal cause can be extracted',()=>{
  for(const prefix of ['', 'PythonError: ']){
    const raw=prefix+'Traceback (most recent call last):\n  File "/app/worker.py", line 12';
    const shown=adaptivePreparationError(raw);
    assert.match(shown.message,/Open technical error details/);
    assert.doesNotMatch(shown.message,/Traceback|worker.py/);
    assert.equal(shown.details,raw);
  }
});
