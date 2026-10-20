/** Own one replaceable preparation. Publication must be guarded even when a
 * local File read cannot be aborted. This does not own an accepted gym state. */
export function latestPreparation(){
  let current=null;
  function cancel(){current?.controller.abort();current=null;}
  function start(){
    cancel();
    const entry={controller:new AbortController()};current=entry;
    return Object.freeze({
      signal:entry.controller.signal,
      isCurrent:()=>current===entry&&!entry.controller.signal.aborted,
      publish:callback=>{if(current!==entry||entry.controller.signal.aborted)return false;callback();return true;},
      finish:()=>{if(current===entry)current=null;},
    });
  }
  return Object.freeze({start,cancel});
}
