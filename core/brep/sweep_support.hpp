#pragma once
#include <TopoDS_Shape.hxx>
#include <gp_Vec.hxx>
#include <cstddef>
#include <vector>

class BRepPrimAPI_MakePrism;

namespace autocam::brep {
struct SweepSupportResult {
  TopoDS_Shape boundary;
  std::vector<TopoDS_Shape> sweeps;
  std::size_t restored_faces = 0;
  double max_input_tolerance = 0;
  double max_output_tolerance = 0;
};

// An edge on a plane tangent to the sweep or a parallel cylinder stays on that
// exact support surface.
// Use source adjacency and prism history to retain that analytic support when
// MakePrism represents the side as an extrusion of an intersection BSpline.
// Only private copies are modified; shared base/sweep topology is preserved.
SweepSupportResult restore_sweep_supports(
    const TopoDS_Shape& boundary, BRepPrimAPI_MakePrism& prism,
    const std::vector<TopoDS_Shape>& sweeps, const gp_Vec& sweep);
}
