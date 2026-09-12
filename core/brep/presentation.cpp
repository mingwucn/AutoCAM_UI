#include "presentation.hpp"
#include "material.hpp"
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace autocam::brep {
namespace {
void positive(double value) {
  if (!std::isfinite(value) || value <= 0)
    throw std::invalid_argument("Display deflection must be positive and finite");
}
}
Mesh tessellate(const TopoDS_Shape& shape, double linear, double angular) {
  positive(linear); positive(angular);
  if (volume(shape)==0) return {};
  BRepBuilderAPI_Copy copy(shape, true, false);
  auto display_shape = copy.Shape();
  BRepMesh_IncrementalMesh mesher(display_shape, linear, false, angular, false);
  if (!mesher.IsDone()) throw std::runtime_error("B-Rep tessellation failed");
  Mesh result;
  for (TopExp_Explorer faces(display_shape, TopAbs_FACE); faces.More(); faces.Next()) {
    const auto face = TopoDS::Face(faces.Current());
    TopLoc_Location location;
    auto mesh = BRep_Tool::Triangulation(face, location);
    if (mesh.IsNull()) throw std::runtime_error("Face has no tessellation");
    BRepLib_ToolTriangulatedShape::ComputeNormals(face, mesh);
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    const auto transform = location.Transformation();
    for (int t = 1; t <= mesh->NbTriangles(); ++t) {
      int a,b,c;
      mesh->Triangle(t).Get(a,b,c);
      if (reverse) std::swap(b,c);
      for (int index : {a,b,c}) {
        const auto p = mesh->Node(index).Transformed(transform);
        auto n = mesh->Normal(index).Transformed(transform);
        if (reverse) n.Reverse();
        result.positions.insert(result.positions.end(), {float(p.X()),float(p.Y()),float(p.Z())});
        result.normals.insert(result.normals.end(), {float(n.X()),float(n.Y()),float(n.Z())});
      }
    }
  }
  return result;
}
std::vector<std::vector<double>> section(const TopoDS_Shape& shape,
                                         const gp_Pln& plane, double deflection) {
  positive(deflection);
  if (volume(shape)==0) return {};
  BRepAlgoAPI_Section operation(shape, plane, false);
  operation.SetNonDestructive(true);
  operation.Build();
  if (!operation.IsDone() || operation.HasErrors())
    throw std::runtime_error("B-Rep section failed");
  std::vector<std::vector<double>> paths;
  for (TopExp_Explorer edges(operation.Shape(), TopAbs_EDGE); edges.More(); edges.Next()) {
    BRepAdaptor_Curve curve(TopoDS::Edge(edges.Current()));
    GCPnts_QuasiUniformDeflection points(curve, deflection);
    if (!points.IsDone()) throw std::runtime_error("Section display discretization failed");
    std::vector<double> path;
    for (int i=1; i<=points.NbPoints(); ++i) {
      auto p = points.Value(i);
      path.insert(path.end(), {p.X(),p.Y(),p.Z()});
    }
    paths.push_back(std::move(path));
  }
  return paths;
}
}
