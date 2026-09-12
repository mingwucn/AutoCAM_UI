#pragma once
#include <TopoDS_Shape.hxx>
#include <cstddef>

namespace autocam::brep {
struct GeneratedRegularization {
  TopoDS_Shape shape;
  std::size_t rebound_vertices = 0;
  std::size_t planar_components_removed = 0;
  double maximum_endpoint_residual_mm = 0;
  double maximum_tolerance_before_mm = 0;
  double maximum_tolerance_after_mm = 0;
  double volume_before_mm3 = 0;
  double volume_after_mm3 = 0;
};

// Regularize a privately copied GENERATED Boolean result. This is not an
// import repair operation. Retain continuous supports, collapse strip faces
// only at the declared linear tolerance, and reject invalid or intersecting
// results. The caller still verifies protected geometry and set containment.
GeneratedRegularization regularize_generated(const TopoDS_Shape& shape,
                                             double linear_tolerance_mm = 1e-7);
}
