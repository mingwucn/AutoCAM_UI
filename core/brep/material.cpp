#include "material.hpp"
#include "contours.hpp"
#include "checked_boolean.hpp"
#include "sweep_support.hpp"
#include "regularize.hpp"
#include "analytic_pcurves.hpp"
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <gp_Ax2.hxx>
#include <HLRTopoBRep_OutLiner.hxx>
#include <HLRAlgo_Projector.hxx>
#include <BRepTopAdaptor_MapOfShapeTool.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepLib.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <sstream>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopTools_ListOfShape.hxx>
#include <cmath>
#include <algorithm>
#include <limits>
#include <stdexcept>
#include <vector>

namespace autocam::brep {
namespace {
void valid(const TopoDS_Shape& shape) {
  if (shape.IsNull() || !BRepCheck_Analyzer(shape).IsValid())
    throw std::runtime_error("Invalid B-Rep shape");
}
bool outgoing_face(const TopoDS_Face& face,const gp_Dir& direction) {
  double u0,u1,v0,v1;BRepTools::UVBounds(face,u0,u1,v0,v1);
  BRepAdaptor_Surface surface(face,true);
  // HLR silhouettes split the face into patches with constant sign of n.d.
  // Select an interior parameter point to identify the patch's orientation;
  // the sweep geometry itself remains the continuous trimmed B-Rep face.
  for(int count:{3,7,15,31})for(int i=0;i<count;++i)for(int j=0;j<count;++j) {
    const double u=u0+(u1-u0)*(i+.5)/count,v=v0+(v1-v0)*(j+.5)/count;
    BRepClass_FaceClassifier classify(face,gp_Pnt2d(u,v),1e-9);
    if(classify.State()!=TopAbs_IN)continue;
    gp_Pnt p;gp_Vec du,dv;surface.D1(u,v,p,du,dv);
    auto normal=du.Crossed(dv);if(normal.Magnitude()<=1e-15)continue;
    if(face.Orientation()==TopAbs_REVERSED)normal.Reverse();
    const double dot=normal.Normalized().Dot(gp_Vec(direction));
    if(std::abs(dot)>1e-10)return dot>0;
  }
  throw std::runtime_error("Cannot determine split face sweep orientation");
}

}
double volume(const TopoDS_Shape& shape) {
  valid(shape);
  if(!TopExp_Explorer(shape,TopAbs_SHELL).More())return 0;
  GProp_GProps properties;
  // Adapt integration independently of display tessellation. Geometric Boolean
  // errors must still be detected separately from numerical integration error.
  const double integration_error=BRepGProp::VolumePropertiesGK(shape, properties, 1e-11, true, true);
  if(!std::isfinite(integration_error)||integration_error<0)throw std::runtime_error("B-Rep volume integration failed");
  const double value = properties.Mass();
  if (!std::isfinite(value) || value < 0)
    throw std::runtime_error("Invalid B-Rep volume");
  return value;
}
TopoDS_Shape directional_shadow(const TopoDS_Shape& protected_shape,
                                const gp_Vec& sweep) {
  valid(protected_shape);
  if (!std::isfinite(sweep.Magnitude()) || sweep.Magnitude() <= 0)
    throw std::invalid_argument("Shadow sweep must be finite and nonzero");
  auto shadow = protected_shape;
  // Split curved faces at directional silhouettes before sweeping. A whole
  // cylindrical face swept sideways folds over itself and is not a solid.
  BRepBuilderAPI_Copy copy(protected_shape,true,false);
  HLRTopoBRep_OutLiner outline(copy.Shape());
  BRepTopAdaptor_MapOfShapeTool surface_tools;
  outline.Fill(HLRAlgo_Projector(gp_Ax2(gp_Pnt(0,0,0),gp_Dir(sweep))), surface_tools,0);
  BRepAlgoAPI_Splitter split;
  TopTools_ListOfShape split_arguments, split_tools;
  split_arguments.Append(copy.Shape());
  split.SetArguments(split_arguments);
  split.SetNonDestructive(true);
  auto& data=outline.DataStructure();
  for (TopExp_Explorer faces(copy.Shape(),TopAbs_FACE); faces.More(); faces.Next()) {
    const auto face=TopoDS::Face(faces.Current());
    if(analytic_directional_contours(face,gp_Dir(sweep),split_tools))continue;
    if (!data.FaceHasIntL(face)) continue;
    for (TopTools_ListIteratorOfListOfShape edges(data.FaceIntL(face)); edges.More(); edges.Next()) {
      auto edge=TopoDS::Edge(edges.Value());edge.Orientation(TopAbs_FORWARD);
      if (!BRepLib::BuildCurve3d(edge))
        throw std::runtime_error("Silhouette edge has no reconstructible 3D curve");
      split_tools.Append(edge);
    }
  }
  TopoDS_Shape boundaries=copy.Shape();
  if (!split_tools.IsEmpty()) {
    split.SetTools(split_tools);
    split.Build();
    if (!split.IsDone() || split.HasErrors())
      throw std::runtime_error("Directional silhouette face splitting failed");
    boundaries=split.Shape();
  }
  if (boundaries.IsNull()) throw std::runtime_error("Directional silhouette construction failed");
  struct SweepContribution {TopoDS_Shape shape;double volume;int face_index;TopoDS_Face face;};
  std::vector<SweepContribution> contributions;
  std::vector<std::pair<TopoDS_Face,int>> exit_faces;
  BRep_Builder builder;TopoDS_Compound basis;builder.MakeCompound(basis);
  int face_index=0;
  for (TopExp_Explorer faces(boundaries, TopAbs_FACE); faces.More(); faces.Next()) {
    ++face_index;
    const BRepAdaptor_Surface surface(TopoDS::Face(faces.Current()));
    const auto surface_type=surface.GetType();
    const gp_Dir sweep_direction(sweep);
    // A planar face translated in its own plane has no volumetric sweep.
    // Constructing a prism anyway can create invalid collapsed topology on
    // industrial faces with inner wires. Cylinders parallel to their generator
    // likewise contribute no volume; the adjacent end faces supply the sweep.
    if (surface_type==GeomAbs_Plane && std::abs(surface.Plane().Axis().Direction().Dot(sweep_direction))<=1e-12)continue;
    if (surface_type==GeomAbs_Cylinder && surface.Cylinder().Axis().Direction().IsParallel(sweep_direction,1e-12))continue;
    // Along each ray, downstream material is generated by exit boundaries.
    // Entry boundaries add no points beyond the protected shape and exit sweeps.
    if(!outgoing_face(TopoDS::Face(faces.Current()),sweep_direction))continue;
    const auto face=TopoDS::Face(faces.Current());builder.Add(basis,face);exit_faces.push_back({face,face_index});
  }
  if(exit_faces.empty())return protected_shape;
  // One sweep builder preserves shared generated edges between adjacent faces.
  // The input already belongs to an isolated copy, so it need not be recopied.
  BRepPrimAPI_MakePrism prism(basis,sweep,false,true);
  if(!prism.IsDone())throw std::runtime_error("Boundary sweep failed");
  for(const auto& entry:exit_faces) {
    const auto& face=entry.first;const int face_index=entry.second;
    const auto surface_type=BRepAdaptor_Surface(face).GetType();
    try {
    const auto& generated=prism.Generated(face);
    if(generated.Extent()!=1)throw std::runtime_error("Missing face sweep history");
    auto swept=generated.First();
    const auto amount=volume(swept);
    if (amount > 0) contributions.push_back({swept,amount,face_index,face});
    } catch(const std::runtime_error& error) {
      throw std::runtime_error("Directional sweep face "+std::to_string(face_index)+" surface "+std::to_string(surface_type)+": "+error.what());
    }
  }
  // Resolve shared faces/edges across the whole sweep in one Boolean operation.
  // Pairwise unions can leave near-coincident slivers before adjacent sweeps
  // have supplied their other side. Every nonzero contribution is retained.
  if(!contributions.empty()) {
    std::vector<TopoDS_Shape> sweep_shapes;
    for(const auto& item:contributions)sweep_shapes.push_back(item.shape);
    const auto restored=restore_sweep_supports(boundaries,prism,sweep_shapes,sweep);
    boundaries=restored.boundary;
    for(std::size_t i=0;i<contributions.size();++i) {
      contributions[i].shape=restored.sweeps[i];contributions[i].volume=volume(restored.sweeps[i]);
    }
    BRepAlgoAPI_Fuse fuse;TopTools_ListOfShape args,tools;
    append_boolean_solids(args,boundaries);for(const auto& contribution:contributions)append_boolean_solids(tools,contribution.shape);
    fuse.SetArguments(args);fuse.SetTools(tools);fuse.SetNonDestructive(true);fuse.Build();
    if(!fuse.IsDone()||fuse.HasErrors()) {
      std::ostringstream message;message<<"Directional shadow union failed: ";
      fuse.DumpErrors(message);fuse.DumpWarnings(message);
      throw std::runtime_error(message.str());
    }
    TopTools_ListOfShape repair_inputs;
    for(const auto& operand:args)repair_inputs.Append(operand);
    for(const auto& operand:tools)repair_inputs.Append(operand);
    const auto repaired=restore_boolean_cylindrical_pcurves(fuse,repair_inputs);
    shadow=regularize_generated(repaired.shape).shape;
    // Check each regular solid independently: overlapping sweep operands are
    // not themselves a regularized material compound suitable for a Cut.
    auto require_contained=[&](const TopoDS_Shape& operand) {
      GProp_GProps area;BRepGProp::SurfaceProperties(operand,area,1e-10);
      const double allowed=std::max(1e-6,area.Mass()*1e-7);
      if(volume(checked_boolean<BRepAlgoAPI_Cut>(operand,shadow))>allowed)
        throw std::runtime_error("Directional shadow omitted a boundary sweep");
    };
    require_contained(protected_shape);
    for(const auto& item:contributions)require_contained(item.shape);
  }
  return shadow;
}
TopoDS_Shape milling_region(const TopoDS_Shape& stock,
                           const TopoDS_Shape& protected_shape,
                           const gp_Dir& engagement, double reach_mm) {
  if (!std::isfinite(reach_mm) || reach_mm <= 0)
    throw std::invalid_argument("Tool reach must be finite and positive");
  valid(stock);
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(stock, bounds, false, false);
  const auto low = bounds.CornerMin(), high = bounds.CornerMax();
  const double size = low.Distance(high);
  if (!std::isfinite(size) || size <= 0)
    throw std::invalid_argument("Stock must have finite nonzero bounds");
  const gp_Vec d(engagement);
  double entry = std::numeric_limits<double>::infinity();
  for (double x : {low.X(), high.X()})
    for (double y : {low.Y(), high.Y()})
      for (double z : {low.Z(), high.Z()})
        entry = std::min(entry, gp_Vec(x, y, z).Dot(d));
  gp_Pnt center((low.X()+high.X())/2, (low.Y()+high.Y())/2, (low.Z()+high.Z())/2);
  gp_Ax2 frame(center, engagement);
  const gp_Vec u(frame.XDirection()), v(frame.YDirection());
  const gp_Vec shift = d * (entry - gp_Vec(center.X(),center.Y(),center.Z()).Dot(d))
                     - u * size - v * size;
  frame.SetLocation(center.Translated(shift));
  const auto slab = BRepPrimAPI_MakeBox(frame, 2*size, 2*size,
                                       std::min(reach_mm, 2*size)).Shape();
  const auto reachable = checked_boolean<BRepAlgoAPI_Common>(stock, slab);
  const auto shadow = directional_shadow(protected_shape, d * (2*size));
  return checked_boolean<BRepAlgoAPI_Cut>(reachable, shadow);
}
TopoDS_Shape turning_region(const TopoDS_Shape& stock,
                           const TopoDS_Shape& radial_envelope,
                           const gp_Ax1& axis, double radius,
                           TurningOperation operation, double reach_mm,
                           int held_side) {
  if (!std::isfinite(reach_mm) || reach_mm <= 0 ||
      !std::isfinite(radius) || radius <= 0 || (held_side != -1 && held_side != 1))
    throw std::invalid_argument("Invalid turning setup or reach");
  valid(stock); valid(radial_envelope);
  if (operation == TurningOperation::face_positive || operation == TurningOperation::face_negative) {
    const int sign = operation == TurningOperation::face_positive ? 1 : -1;
    if (sign == -held_side) throw std::invalid_argument("Facing the held end is unavailable");
    const gp_Dir approach = sign > 0 ? axis.Direction() : axis.Direction().Reversed();
    return milling_region(stock, radial_envelope, approach, reach_mm);
  }
  if (operation != TurningOperation::outside)
    throw std::invalid_argument("Unknown turning operation");
  auto removable = checked_boolean<BRepAlgoAPI_Cut>(stock, radial_envelope);
  const double inner_radius = std::max(0.0, radius - reach_mm);
  if (inner_radius == 0) return removable;
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(stock, bounds, false, false);
  auto low = bounds.CornerMin(), high = bounds.CornerMax();
  const gp_Vec direction(axis.Direction());
  double minimum = std::numeric_limits<double>::infinity(), maximum = -minimum;
  for (double x : {low.X(),high.X()}) for (double y : {low.Y(),high.Y()})
    for (double z : {low.Z(),high.Z()}) {
      const double station = gp_Vec(axis.Location(),gp_Pnt(x,y,z)).Dot(direction);
      minimum = std::min(minimum,station); maximum = std::max(maximum,station);
    }
  const auto base = axis.Location().Translated(direction * minimum);
  const auto unreachable = BRepPrimAPI_MakeCylinder(gp_Ax2(base,axis.Direction()),
                                                   inner_radius, maximum-minimum).Shape();
  return checked_boolean<BRepAlgoAPI_Cut>(removable, unreachable);
}
Material::Material(const TopoDS_Shape& stock, const TopoDS_Shape& protected_shape,
                   double tolerance, std::uint64_t initial_revision)
    : remaining_(stock), protected_(protected_shape), tolerance_(tolerance), revision_(initial_revision) {
  if (!std::isfinite(tolerance) || tolerance <= 0)
    throw std::invalid_argument("Volume tolerance must be positive");
  valid(stock); valid(protected_);
  if (volume(checked_boolean<BRepAlgoAPI_Cut>(protected_, stock)) > tolerance_)
    throw std::invalid_argument("Stock does not contain protected material");
}
Transition Material::preview(const TopoDS_Shape& region) const {
  valid(region);
  auto removable = checked_boolean<BRepAlgoAPI_Cut>(region, protected_);
  auto removed = checked_boolean<BRepAlgoAPI_Common>(remaining_, removable);
  auto next = checked_boolean<BRepAlgoAPI_Cut>(remaining_, removed);
  const double before = volume(remaining_), after = volume(next), amount = volume(removed);
  if (after > before + tolerance_ || std::abs(before - after - amount) > tolerance_ ||
      volume(checked_boolean<BRepAlgoAPI_Cut>(protected_, next)) > tolerance_)
    throw std::runtime_error("Material conservation or protection check failed");
  return {next, removed, before, after, amount, revision_};
}
void Material::commit(const Transition& candidate) {
  if (candidate.source_revision != revision_)
    throw std::runtime_error("Stale material transition");
  // Recompute from the removal shape, so a caller cannot forge the next state.
  auto checked = preview(candidate.removed);
  remaining_ = checked.remaining;
  ++revision_;
}
}
