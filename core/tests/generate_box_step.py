"""Generate the public synthetic STEP import fixture."""
from pathlib import Path
import cadquery as cq
path=Path(__file__).with_name('fixtures')/'box.step'
path.parent.mkdir(parents=True,exist_ok=True)
cq.exporters.export(cq.Workplane('XY').box(10,8,6).val(),str(path),exportType='STEP')
print(path)
