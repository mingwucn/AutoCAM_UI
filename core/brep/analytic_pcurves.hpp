#pragma once
#include <TopoDS_Shape.hxx>
#include <BRepAlgoAPI_BuilderAlgo.hxx>
#include <TopTools_ListOfShape.hxx>
#include <cstddef>
#include <string>

namespace autocam::brep {
// Numerical OCCT curve/surface extremum diagnostics over the parameter range.
// OCCT uses PSO/Newton searches; this is not an interval certificate. These
// checks are independent of BRepCheck and never change geometry or tolerances.
struct CurveSurfaceQuality {
  double maximum_vertex_tolerance_mm=0;
  double maximum_edge_tolerance_mm=0;
  double maximum_face_tolerance_mm=0;
  double maximum_curve_surface_residual_mm=0;
  std::size_t tested_incidences=0;
  std::size_t unresolved_incidences=0;
  std::size_t residual_exceeds_stored_budget=0;
};
CurveSurfaceQuality inspect_curve_surface_quality(const TopoDS_Shape&);
// Vertex coordinates, 3D geometry and parameter ranges; excludes pcurves and
// stored tolerances.
std::string geometry3d_identity(const TopoDS_Shape&);
struct BooleanPCurveRestoreResult {
  TopoDS_Shape shape;
  std::size_t restored_incidences=0;
  std::size_t restored_edges=0;
  CurveSurfaceQuality quality;
};
// Private-copy repair of generated cylindrical incidences with exact unchanged
// source-curve identity and Boolean history. It transfers admitted source
// pcurves by the analytic coordinate isometry between equivalent cylinders,
// then recomputes SameParameter only on repaired edges. Unsupported or inherited
// source faults remain visible in quality; this is not a global acceptance gate.
BooleanPCurveRestoreResult restore_boolean_cylindrical_pcurves(
    BRepAlgoAPI_BuilderAlgo& operation,const TopTools_ListOfShape& operands);
}
