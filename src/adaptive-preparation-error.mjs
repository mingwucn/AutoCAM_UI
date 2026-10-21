// Presentation only: keep the worker's original message available for diagnosis.
export function adaptivePreparationError(error,stage='Preparation'){
  const details=typeof error==='string'?error:typeof error?.message==='string'?error.message:'';
  const text=details.trim();
  if(!text)return {message:stage+' failed. Check the selected files and settings.',details};
  if(!text.includes('Traceback (most recent call last):'))return {message:text,details};
  const causeLine=text.split(/\r?\n/).map(line=>line.trim()).findLast(line=>!line.includes('Traceback (most recent call last):')&&/^[A-Za-z_][\w.]*:\s*\S/.test(line));
  const cause=causeLine?.replace(/^[^:]+:\s*/,'');
  return {message:cause?stage+' failed: '+cause:stage+' failed. Open technical error details for the full message.',details};
}
