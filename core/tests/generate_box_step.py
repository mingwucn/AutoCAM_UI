"""Generate public synthetic STEP import fixtures."""
from pathlib import Path
import cadquery as cq
folder=Path(__file__).with_name('fixtures');folder.mkdir(parents=True,exist_ok=True)
shapes={
    'box.step':cq.Workplane('XY').box(10,8,6),
    'overhang.step':cq.Workplane('XY').box(18,8,4).union(cq.Workplane('XY').workplane(offset=4).box(8,8,8).translate((5,0,0))),
    'stepped-shaft.step':cq.Workplane('XY').circle(7).extrude(6).faces('>Z').workplane().circle(4).extrude(10),
}
for name,shape in shapes.items():
    path=folder/name;cq.exporters.export(shape.val(),str(path),exportType='STEP');print(path)
