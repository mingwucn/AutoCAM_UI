export function localRecovery(operation,bytes){
  if(!['save','load','delete'].includes(operation))return Promise.reject(Error('Invalid local recovery operation.'));
  if(operation==='save'&&(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024**2))return Promise.reject(Error('Invalid local recovery bytes.'));
  const retained=operation==='save'?bytes.slice():null;
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(Error('Local browser storage is unavailable.'));return;}
    let settled=false;
    const fail=error=>{if(!settled){settled=true;reject(error||Error('Local browser storage failed.'));}};
    const request=indexedDB.open('autocam-shadow-gym-recovery',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('checkpoints');
    request.onerror=()=>fail(request.error);
    request.onblocked=()=>fail(Error('Local browser storage is blocked by another tab.'));
    request.onsuccess=()=>{
      const db=request.result;if(settled){db.close();return;}
      db.onversionchange=()=>db.close();
      let transaction;
      try{transaction=db.transaction('checkpoints',operation==='load'?'readonly':'readwrite');}
      catch(error){db.close();fail(error);return;}
      const store=transaction.objectStore('checkpoints');let result;
      let action;
      try{action=operation==='save'?store.put(retained,'machining-current'):operation==='delete'?store.delete('machining-current'):store.get('machining-current');}
      catch(error){db.close();fail(error);return;}
      action.onsuccess=()=>{result=action.result;};
      transaction.onabort=()=>{db.close();fail(transaction.error);};
      transaction.onerror=()=>{};
      transaction.oncomplete=()=>{
        db.close();if(settled)return;
        if(operation==='load'&&(!(result instanceof Uint8Array)||!result.length||result.length>256*1024**2)){fail(Error('No valid local save is available.'));return;}
        settled=true;resolve(operation==='load'?result.slice():undefined);
      };
    };
  });
}
