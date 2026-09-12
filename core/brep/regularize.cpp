#include "regularize.hpp"
#include "material.hpp"
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Bnd_OBB.hxx>
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom_Surface.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_FixSmallFace.hxx>
#include <ShapeFix_ShapeTolerance.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace autocam::brep {
namespace {
double maximum_tolerance(const TopoDS_Shape& shape) {
  double tolerance = 0;
  for (TopExp_Explorer it(shape, TopAbs_VERTEX); it.More(); it.Next())
    tolerance = std::max(tolerance, BRep_Tool::Tolerance(TopoDS::Vertex(it.Current())));
  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next())
    tolerance = std::max(tolerance, BRep_Tool::Tolerance(TopoDS::Edge(it.Current())));
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next())
    tolerance = std::max(tolerance, BRep_Tool::Tolerance(TopoDS::Face(it.Current())));
  return tolerance;
}

void require_solid_membership(const TopoDS_Shape& shape) {
  TopTools_IndexedMapOfShape members;
  for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next())
    TopExp::MapShapes(it.Current(), members);
  for (const auto kind : {TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX})
    for (TopExp_Explorer it(shape, kind); it.More(); it.Next())
      if (!members.Contains(it.Current()))
        throw std::runtime_error("Generated result has geometry outside its solids");
}

bool planar_component(const TopoDS_Shape& shape) {
  // The OBB supplies an orientation only. Recompute full B-Rep extrema in that
  // frame; a box made from vertices or display triangles is not sufficient.
  Bnd_OBB orientation;
  BRepBndLib::AddOBB(shape, orientation, false, true, false);
  if (orientation.IsVoid())
    throw std::runtime_error("Generated component has no finite geometric bounds");
  gp_Trsf frame;
  frame.SetTransformation(orientation.Position());
  const auto aligned = BRepBuilderAPI_Transform(shape, frame, true).Shape();
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(aligned, bounds, false, false);
  if (bounds.IsVoid() || bounds.IsWhole())
    throw std::runtime_error("Generated component has invalid geometric bounds");
  const auto low = bounds.CornerMin(), high = bounds.CornerMax();
  const double scale = std::max({1.0, low.Distance(high),
      gp_Pnt(orientation.Center()).Distance(gp_Pnt(0, 0, 0))});
  const double roundoff = 256 * std::numeric_limits<double>::epsilon() * scale;
  const double thickness = std::min({high.X()-low.X(), high.Y()-low.Y(), high.Z()-low.Z()});
  if (!std::isfinite(thickness) || thickness < 0)
    throw std::runtime_error("Generated component has nonfinite thickness");
  // This arithmetic bound is deliberately much smaller than the geometric
  // tolerance. A merely thin positive-volume component is not discarded.
  return thickness <= roundoff;
}

void rebound_vertices(const TopoDS_Shape& shape, double linear_tolerance,
                      GeneratedRegularization& receipt) {
  TopTools_IndexedMapOfShape vertices;
  TopExp::MapShapes(shape, TopAbs_VERTEX, vertices);
  std::vector<double> required(vertices.Extent()+1, linear_tolerance);
  std::vector<std::size_t> face_occurrences(vertices.Extent()+1, 0);
  const auto record = [&](const TopoDS_Vertex& vertex, double residual, double tolerance) {
    if (!std::isfinite(residual) || !std::isfinite(tolerance))
      throw std::runtime_error("Nonfinite generated vertex incidence bound");
    const int index = vertices.FindIndex(vertex);
    if (!index) throw std::runtime_error("Missing generated vertex incidence");
    // The vertex must cover each endpoint distance and respect the incident
    // edge/face tolerance hierarchy. They are independent bounds, as in
    // BRepLib::UpdateInnerTolerances, rather than two errors to add together.
    // Stored tolerances already include their construction allowance. Pad only
    // the newly evaluated distance, never an inherited tolerance a second time.
    required[index] = std::max({required[index], residual*(1+1e-6), tolerance});
    receipt.maximum_endpoint_residual_mm = std::max(receipt.maximum_endpoint_residual_mm, residual);
  };

  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next()) {
    const auto edge = TopoDS::Edge(it.Current());
    if (BRep_Tool::Degenerated(edge)) continue; // Its face pcurves are checked below.
    if (!BRep_Tool::SameParameter(edge))
      throw std::runtime_error("Cannot rebound a generated edge without SameParameter");
    BRepAdaptor_Curve curve(edge);
    for (TopExp_Explorer vi(edge, TopAbs_VERTEX); vi.More(); vi.Next()) {
      const auto vertex = TopoDS::Vertex(vi.Current());
      const double residual = curve.Value(BRep_Tool::Parameter(vertex, edge)).Distance(BRep_Tool::Pnt(vertex));
      record(vertex, residual, BRep_Tool::Tolerance(edge));
    }
  }
  for (TopExp_Explorer fi(shape, TopAbs_FACE); fi.More(); fi.Next()) {
    const auto face = TopoDS::Face(fi.Current());
    const auto surface = BRep_Tool::Surface(face); // Includes the face location.
    for (TopExp_Explorer ei(face, TopAbs_EDGE); ei.More(); ei.Next()) {
      const auto original = TopoDS::Edge(ei.Current());
      // Both seam pcurves and every vertex orientation must be inspected.
      for (const auto orientation : {TopAbs_FORWARD, TopAbs_REVERSED}) {
        const auto edge = TopoDS::Edge(original.Oriented(orientation));
        double first, last;
        const auto pcurve = BRep_Tool::CurveOnSurface(edge, face, first, last);
        if (pcurve.IsNull()) throw std::runtime_error("Missing generated face pcurve");
        for (TopExp_Explorer vi(edge, TopAbs_VERTEX); vi.More(); vi.Next()) {
          const auto vertex = TopoDS::Vertex(vi.Current());
          const auto uv = pcurve->Value(BRep_Tool::Parameter(vertex, edge, face));
          const double residual = surface->Value(uv.X(), uv.Y()).Distance(BRep_Tool::Pnt(vertex));
          record(vertex, residual, std::max(BRep_Tool::Tolerance(edge), BRep_Tool::Tolerance(face)));
          ++face_occurrences[vertices.FindIndex(vertex)];
        }
      }
    }
  }
  ShapeFix_ShapeTolerance setter;
  for (int index = 1; index <= vertices.Extent(); ++index) {
    if (!face_occurrences[index]) throw std::runtime_error("Unbound generated vertex");
    const auto vertex = TopoDS::Vertex(vertices(index));
    const double previous = BRep_Tool::Tolerance(vertex);
    const double next = required[index];
    // No tolerance is raised or clamped to a smaller unverified constant.
    if (next < previous) {
      setter.SetTolerance(vertex, next, TopAbs_VERTEX);
      ++receipt.rebound_vertices;
    }
  }
}
}

GeneratedRegularization regularize_generated(const TopoDS_Shape& shape,
                                             double linear_tolerance) {
  if (!std::isfinite(linear_tolerance) || linear_tolerance <= 0)
    throw std::invalid_argument("Generated regularization tolerance must be finite and positive");
  require_solid_membership(shape);
  GeneratedRegularization result;
  result.volume_before_mm3 = volume(shape); // Requires the initial B-Rep to be valid.
  result.maximum_tolerance_before_mm = maximum_tolerance(shape);
  const auto working = BRepBuilderAPI_Copy(shape, true, false).Shape();
  rebound_vertices(working, linear_tolerance, result);
  ShapeFix_FixSmallFace fix;
  fix.Init(working);
  fix.SetPrecision(linear_tolerance);
  fix.SetMaxTolerance(linear_tolerance);
  const auto stripped = fix.FixStripFace();

  TopoDS_Compound retained;
  BRep_Builder builder;
  builder.MakeCompound(retained);
  require_solid_membership(stripped);
  for (TopExp_Explorer it(stripped, TopAbs_SOLID); it.More(); it.Next()) {
    if (planar_component(it.Current())) {
      ++result.planar_components_removed;
      continue;
    }
    builder.Add(retained, it.Current());
  }
  rebound_vertices(retained, linear_tolerance, result);
  result.shape = retained;
  result.volume_after_mm3 = volume(result.shape);
  result.maximum_tolerance_after_mm = maximum_tolerance(result.shape);
  GProp_GProps area;
  BRepGProp::SurfaceProperties(shape, area, 1e-10);
  if (!std::isfinite(area.Mass()) || area.Mass() < 0 ||
      std::abs(result.volume_before_mm3-result.volume_after_mm3) > area.Mass()*linear_tolerance)
    throw std::runtime_error("Generated regularization changed volume beyond its surface bound");
  const double tolerance_roundoff = 64 * std::numeric_limits<double>::epsilon() *
                                   std::max(1.0, result.maximum_tolerance_before_mm);
  if (result.maximum_tolerance_after_mm > result.maximum_tolerance_before_mm+tolerance_roundoff)
    throw std::runtime_error("Generated regularization increased geometry tolerance");
  BOPAlgo_ArgumentAnalyzer check;
  check.SetShape1(result.shape);
  check.SelfInterMode() = true;
  check.Perform();
  if (check.HasFaulty())
    throw std::runtime_error("Generated result still contains self-intersections");
  return result;
}
}
