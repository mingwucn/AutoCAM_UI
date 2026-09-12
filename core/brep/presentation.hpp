#pragma once
#include <TopoDS_Shape.hxx>
#include <gp_Pln.hxx>
#include <vector>

namespace autocam::brep {
struct Mesh {
  std::vector<float> positions;
  std::vector<float> normals;
};
// Presentation-only copies: tessellation never determines the material state.
Mesh tessellate(const TopoDS_Shape& shape, double linear_deflection_mm,
                double angular_deflection_radians = 0.2);
std::vector<std::vector<double>> section(const TopoDS_Shape& shape,
                                         const gp_Pln& plane,
                                         double display_deflection_mm);
}
