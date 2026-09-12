#include "sweep_support.hpp"
#include "material.hpp"
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepLib_CheckCurveOnSurface.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom2d_Curve.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_Edge.hxx>
#include <ShapeFix_Face.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <sstream>

namespace autocam::brep {
namespace {
void admit_pcurve(const TopoDS_Edge& edge,const TopoDS_Face& face,const char* phase) {
  if(!BRep_Tool::SameParameter(edge)||!BRep_Tool::SameRange(edge))
    throw std::runtime_error("Invariant support requires matching edge parameter ranges");
  const bool seam=BRep_Tool::IsClosed(edge,face);
  for(int branch=0;branch<(seam?2:1);++branch) {
    auto oriented=edge;if(branch)oriented.Reverse();
    BRepLib_CheckCurveOnSurface check(oriented,face);check.Perform();
    if(!check.IsDone()||!std::isfinite(check.MaxDistance())||check.MaxDistance()>BRep_Tool::Tolerance(edge)) {
      std::ostringstream message;message<<"Invariant support "<<phase<<" pcurve residual "<<check.MaxDistance()<<" exceeds its source edge budget "<<BRep_Tool::Tolerance(edge);
      throw std::runtime_error(message.str());
    }
  }
}
double maximum_tolerance(const TopoDS_Shape& shape) {
  double result = 0;
  for (TopExp_Explorer it(shape, TopAbs_VERTEX); it.More(); it.Next())
    result = std::max(result, BRep_Tool::Tolerance(TopoDS::Vertex(it.Current())));
  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next())
    result = std::max(result, BRep_Tool::Tolerance(TopoDS::Edge(it.Current())));
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next())
    result = std::max(result, BRep_Tool::Tolerance(TopoDS::Face(it.Current())));
  return result;
}

TopoDS_Face invariant_support(const TopoDS_Face& previous,
                             const TopoDS_Face& source,
                             const TopoDS_Edge& source_edge,
                             BRepPrimAPI_MakePrism& prism,
                             BRepBuilderAPI_Copy& copy,
                             const gp_Vec& sweep,
                             double tolerance) {
  BRepAdaptor_Surface surface(previous);
  double u0, u1, v0, v1;
  BRepTools::UVBounds(previous, u0, u1, v0, v1);
  gp_Pnt point;
  gp_Vec du, dv;
  surface.D1((u0+u1)/2, (v0+v1)/2, point, du, dv);
  auto normal = du.Crossed(dv);
  if (previous.Orientation() == TopAbs_REVERSED) normal.Reverse();
  const BRepAdaptor_Surface original(source);
  gp_Vec support_normal;
  Handle(Geom_Surface) support;
  if (original.GetType() == GeomAbs_Cylinder) {
    const auto cylinder = original.Cylinder();
    const gp_Vec axis(cylinder.Axis().Direction());
    support_normal = gp_Vec(cylinder.Location(), point);
    support_normal -= axis * support_normal.Dot(axis);
    if (support_normal.Magnitude() <= 1e-15)
      throw std::runtime_error("Cannot locate invariant cylindrical sweep seam");
    // This only changes the parameter seam. The cylinder is inherited from the
    // adjacent source face, not fitted to points from the generated surface.
    const gp_Ax3 frame(cylinder.Location(), cylinder.Axis().Direction(),
                       gp_Dir(-support_normal));
    support = new Geom_CylindricalSurface(frame, cylinder.Radius());
  } else if (original.GetType() == GeomAbs_Plane) {
    support_normal = gp_Vec(original.Plane().Axis().Direction());
    support = new Geom_Plane(original.Plane());
  } else {
    throw std::runtime_error("Unsupported invariant sweep support family");
  }
  if (normal.Magnitude() <= 1e-15 ||
      std::abs(normal.Normalized().Dot(support_normal.Normalized())) < 1e-10)
    throw std::runtime_error("Cannot orient invariant sweep support");
  const bool forward = normal.Dot(support_normal) > 0;
  TopoDS_Face face;
  BRep_Builder builder;
  builder.MakeFace(face, support, BRep_Tool::Tolerance(previous));
  for (TopoDS_Iterator it(previous, false); it.More(); it.Next())
    if (it.Value().ShapeType() == TopAbs_WIRE) builder.Add(face, it.Value());

  // The copied 3D edges and their source tolerances remain unchanged. Attach
  // their pcurves to the analytic support, then orient the retained trim wires.
  const auto first_edge=copy.ModifiedShape(prism.FirstShape(source_edge));
  const auto last_edge=copy.ModifiedShape(prism.LastShape(source_edge));
  if(original.GetType()==GeomAbs_Cylinder) {
    if(BRep_Tool::IsClosed(source_edge,source))throw std::runtime_error("Paired seam support reconstruction is unavailable");
    admit_pcurve(source_edge,source,"source");
  }
  for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
    const auto edge=TopoDS::Edge(it.Current());
    if(original.GetType()==GeomAbs_Cylinder &&
       (edge.IsSame(first_edge)||edge.IsSame(last_edge))) {
      const auto original_cylinder=original.Cylinder();
      const auto new_cylinder=Handle(Geom_CylindricalSurface)::DownCast(support)->Cylinder();
      const auto x=original_cylinder.Position().XDirection();
      const double shift=std::atan2(x.Dot(new_cylinder.Position().YDirection()),x.Dot(new_cylinder.Position().XDirection()));
      const auto y=original_cylinder.Position().YDirection();
      const auto nx=new_cylinder.Position().XDirection(),ny=new_cylinder.Position().YDirection();
      const double determinant=x.Dot(nx)*y.Dot(ny)-x.Dot(ny)*y.Dot(nx);
      double first,last;
      const auto original_pc=BRep_Tool::CurveOnSurface(source_edge,source,first,last);
      if(original_pc.IsNull())throw std::runtime_error("Missing source support pcurve");
      const auto pc=Handle(Geom2d_Curve)::DownCast(original_pc->Copy());
      const double zshift=edge.IsSame(last_edge)?sweep.Dot(gp_Vec(original_cylinder.Axis().Direction())):0.;
      gp_Trsf2d transform;transform.SetValues(determinant>0?1:-1,0,shift,0,1,zshift);pc->Transform(transform);
      builder.UpdateEdge(edge,pc,face,0.);builder.Range(edge,face,first,last);
      continue;
    }
    ShapeFix_Edge fix;
    fix.FixAddPCurve(TopoDS::Edge(it.Current()), face, false, tolerance);
  }
  ShapeFix_Face fix(face);
  fix.SetPrecision(tolerance);
  fix.SetMaxTolerance(tolerance);
  fix.FixOrientation();
  face = fix.Face();
  face.Orientation(forward ? TopAbs_FORWARD : TopAbs_REVERSED);
  for(TopExp_Explorer it(face,TopAbs_EDGE);it.More();it.Next())
    if(!BRep_Tool::Degenerated(TopoDS::Edge(it.Current())))admit_pcurve(TopoDS::Edge(it.Current()),face,"reconstructed");
  if (!BRepCheck_Analyzer(face).IsValid())
    throw std::runtime_error("Invalid invariant sweep support");
  return face;
}
}

SweepSupportResult restore_sweep_supports(
    const TopoDS_Shape& boundary, BRepPrimAPI_MakePrism& prism,
    const std::vector<TopoDS_Shape>& sweeps, const gp_Vec& sweep) {
  if (!std::isfinite(sweep.Magnitude()) || sweep.Magnitude() <= 0)
    throw std::invalid_argument("Sweep support direction must be finite and nonzero");
  SweepSupportResult result{boundary, sweeps};
  BRep_Builder builder;
  TopoDS_Compound combined;
  builder.MakeCompound(combined);
  builder.Add(combined, boundary);
  for (const auto& shape : sweeps) builder.Add(combined, shape);
  result.max_input_tolerance = maximum_tolerance(combined);
  result.max_output_tolerance = result.max_input_tolerance;

  TopTools_IndexedDataMapOfShapeListOfShape adjacent;
  TopExp::MapShapesAndAncestors(boundary, TopAbs_EDGE, TopAbs_FACE, adjacent);
  TopTools_IndexedMapOfShape all_faces;
  TopExp::MapShapes(combined, TopAbs_FACE, all_faces);
  struct Replacement { TopoDS_Face face; TopoDS_Face source; TopoDS_Edge edge; };
  std::vector<Replacement> replacements;
  TopTools_MapOfShape seen;
  const gp_Dir direction(sweep);
  for (int i = 1; i <= adjacent.Extent(); ++i) {
    const auto& edge = adjacent.FindKey(i);
    for (const auto& generated : prism.Generated(edge)) {
      if (generated.ShapeType() != TopAbs_FACE || seen.Contains(generated)) continue;
      const int face_index = all_faces.FindIndex(generated);
      if (!face_index) continue;
      const auto face = TopoDS::Face(all_faces(face_index));
      if (BRepAdaptor_Surface(face).GetType() != GeomAbs_SurfaceOfExtrusion) continue;
      for (const auto& source : adjacent.FindFromIndex(i)) {
        const BRepAdaptor_Surface surface(TopoDS::Face(source));
        const bool cylinder = surface.GetType() == GeomAbs_Cylinder &&
            surface.Cylinder().Axis().Direction().IsParallel(direction, 1e-12);
        const bool plane = surface.GetType() == GeomAbs_Plane &&
            std::abs(surface.Plane().Axis().Direction().Dot(direction)) <= 1e-12;
        if (!cylinder && !plane) continue;
        replacements.push_back({face, TopoDS::Face(source),TopoDS::Edge(edge)});
        seen.Add(face);
        break;
      }
    }
  }
  if (replacements.empty()) return result;

  BRepBuilderAPI_Copy copy(combined, true, false);
  Handle(BRepTools_ReShape) reshape = new BRepTools_ReShape;
  for (const auto& replacement : replacements) {
    const auto previous = TopoDS::Face(copy.ModifiedShape(replacement.face));
    reshape->Replace(previous, invariant_support(previous, replacement.source,replacement.edge,prism,copy,sweep,
                                                 1e-7));
  }
  result.boundary = reshape->Apply(copy.ModifiedShape(boundary));
  result.max_output_tolerance=std::max(result.max_output_tolerance,maximum_tolerance(result.boundary));
  for (std::size_t i = 0; i < sweeps.size(); ++i) {
    result.sweeps[i] = reshape->Apply(copy.ModifiedShape(sweeps[i]));
    if (!BRepCheck_Analyzer(result.sweeps[i]).IsValid())
      throw std::runtime_error("Invalid sweep after invariant support reconstruction");
    GProp_GProps area;
    BRepGProp::SurfaceProperties(sweeps[i], area);
    const double volume_bound = area.Mass() * result.max_input_tolerance;
    if (std::abs(volume(result.sweeps[i])-volume(sweeps[i])) > volume_bound)
      throw std::runtime_error("Invariant support reconstruction changed sweep volume");
    result.max_output_tolerance = std::max(result.max_output_tolerance,
                                          maximum_tolerance(result.sweeps[i]));
  }
  if (result.max_output_tolerance > result.max_input_tolerance * (1+1e-6))
    throw std::runtime_error("Invariant support reconstruction increased geometry tolerance");
  result.restored_faces = replacements.size();
  return result;
}
}
