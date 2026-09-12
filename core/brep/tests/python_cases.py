"""Run hash-pinned external STEP action cases through the public native API.

Errors are recorded with committed-state nonmutation checks, not called passes.
"""
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"python"))
from autocam_brep import Core

core=Core(sys.argv[1])
manifest_path=Path(sys.argv[2]).resolve()
manifest=json.loads(manifest_path.read_text())
assert manifest["schema"]=="shadow-brep-action-cases-1"
results=[]
for case in manifest["cases"]:
    data=(manifest_path.parent/case["step"]["path"]).read_bytes()
    assert hashlib.sha256(data).hexdigest()==case["step"]["sha256"]
    started=time.perf_counter()
    with core.prepare(data,**case["setup"]) as session:
        row={"id":case["id"],"info":session.info(),"initial":session.observe(),
             "prepare_seconds":time.perf_counter()-started,"steps":[]}
        for action in case["actions"]:
            before=session.observe()
            started=time.perf_counter()
            try:
                preview=session.preview(action)
                assert session.observe()==before,"Preview mutated committed state"
                session.apply(preview["token"],preview["revision"])
                row["steps"].append({"action":action,"status":"applied","preview":preview,
                                     "after":session.observe(),"seconds":time.perf_counter()-started})
            except RuntimeError as error:
                assert session.observe()==before,"Rejected action mutated committed state"
                row["steps"].append({"action":action,"status":"rejected","error":str(error),
                                     "after":session.observe(),"seconds":time.perf_counter()-started})
                break
        row["complete"]=len(row["steps"])==len(case["actions"]) and all(s["status"]=="applied" for s in row["steps"])
        results.append(row)
print(json.dumps({"engine":"shadow-brep-1","runtime":"native","complete":all(r["complete"] for r in results),"results":results}))
