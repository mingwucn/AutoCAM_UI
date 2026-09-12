#include "analytic_pcurves.hpp"
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepLib.hxx>
#include <BRepLib_CheckCurveOnSurface.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom2d_Curve.hxx>
#include <GeomTools.hxx>
#include <TopoDS.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace autocam::brep {
namespace {
std::string curve_identity(const Handle(Geom_Curve)& curve) {
  std::ostringstream out;out<<std::setprecision(17);
  if(!curve.IsNull())GeomTools::Write(curve,out);
  return out.str();
}
bool has(const TopTools_ListOfShape& list,const TopoDS_Shape& shape) {
  for(const auto& item:list)if(item.IsSame(shape))return true;
  return false;
}
struct Residual { bool done=false;double maximum=0; };
Residual curve_surface_residual(const TopoDS_Edge& edge,const TopoDS_Face& face) {
  Residual result;
  if(!BRep_Tool::SameParameter(edge)||!BRep_Tool::SameRange(edge))return result;
  const bool seam=BRep_Tool::IsClosed(edge,face);
  for(int branch=0;branch<(seam?2:1);++branch) {
    auto oriented=edge;if(branch)oriented.Reverse();
    BRepLib_CheckCurveOnSurface check(oriented,face);check.Perform();
    if(!check.IsDone()||!std::isfinite(check.MaxDistance()))return result;
    result.maximum=std::max(result.maximum,check.MaxDistance());
  }
  result.done=true;return result;
}
}
CurveSurfaceQuality inspect_curve_surface_quality(const TopoDS_Shape& shape) {
  CurveSurfaceQuality result;
  for(TopExp_Explorer it(shape,TopAbs_VERTEX);it.More();it.Next())
    result.maximum_vertex_tolerance_mm=std::max(result.maximum_vertex_tolerance_mm,BRep_Tool::Tolerance(TopoDS::Vertex(it.Current())));
  for(TopExp_Explorer it(shape,TopAbs_EDGE);it.More();it.Next())
    result.maximum_edge_tolerance_mm=std::max(result.maximum_edge_tolerance_mm,BRep_Tool::Tolerance(TopoDS::Edge(it.Current())));
  TopTools_IndexedMapOfShape faces;TopExp::MapShapes(shape,TopAbs_FACE,faces);
  for(int i=1;i<=faces.Extent();++i) {
    const auto face=TopoDS::Face(faces(i));
    result.maximum_face_tolerance_mm=std::max(result.maximum_face_tolerance_mm,BRep_Tool::Tolerance(face));
    for(TopExp_Explorer it(face,TopAbs_EDGE);it.More();it.Next()) {
      const auto edge=TopoDS::Edge(it.Current());if(BRep_Tool::Degenerated(edge))continue;
      const auto check=curve_surface_residual(edge,face);
      if(!check.done){++result.unresolved_incidences;continue;}
      ++result.tested_incidences;
      result.maximum_curve_surface_residual_mm=std::max(result.maximum_curve_surface_residual_mm,check.maximum);
      if(check.maximum>BRep_Tool::Tolerance(edge))++result.residual_exceeds_stored_budget;
    }
  }
  return result;
}
std::string geometry3d_identity(const TopoDS_Shape& shape) {
  std::ostringstream out;out<<std::setprecision(17);
  TopTools_IndexedMapOfShape vertices,edges,faces;
  TopExp::MapShapes(shape,TopAbs_VERTEX,vertices);
  TopExp::MapShapes(shape,TopAbs_EDGE,edges);TopExp::MapShapes(shape,TopAbs_FACE,faces);
  for(int i=1;i<=vertices.Extent();++i) {
    const auto point=BRep_Tool::Pnt(TopoDS::Vertex(vertices(i)));
    out<<"vertex "<<point.X()<<","<<point.Y()<<","<<point.Z()<<"\n";
  }
  for(int i=1;i<=edges.Extent();++i) {
    double first=0,last=0;const auto curve=BRep_Tool::Curve(TopoDS::Edge(edges(i)),first,last);
    if(curve.IsNull()){out<<"null\n";continue;}
    out<<first<<","<<last<<"\n";GeomTools::Write(curve,out);
  }
  for(int i=1;i<=faces.Extent();++i)GeomTools::Write(BRep_Tool::Surface(TopoDS::Face(faces(i))),out);
  return out.str();
}
BooleanPCurveRestoreResult restore_boolean_cylindrical_pcurves(
    BRepAlgoAPI_BuilderAlgo& operation,const TopTools_ListOfShape& operands) {
  BRep_Builder builder;
  TopTools_IndexedDataMapOfShapeListOfShape source_edges;
  // Enumerate directly: adding shared operands to a temporary compound would
  // change their Free flags even though the result geometry owns a deep copy.
  for(const auto& operand:operands)
    TopExp::MapShapesAndAncestors(operand,TopAbs_EDGE,TopAbs_FACE,source_edges);
  std::vector<std::string> source_curves(source_edges.Extent()+1);
  std::vector<int> source_order;
  for(int i=1;i<=source_edges.Extent();++i) {
    source_order.push_back(i);
    double first,last;source_curves[i]=curve_identity(BRep_Tool::Curve(TopoDS::Edge(source_edges.FindKey(i)),first,last));
  }
  // A loose duplicate lineage must not hide an admitted tighter source edge.
  std::stable_sort(source_order.begin(),source_order.end(),[&](int a,int b) {
    return BRep_Tool::Tolerance(TopoDS::Edge(source_edges.FindKey(a)))<BRep_Tool::Tolerance(TopoDS::Edge(source_edges.FindKey(b)));
  });
  BRepBuilderAPI_Copy copy(operation.Shape(),true,false);
  BooleanPCurveRestoreResult result;result.shape=copy.Shape();
  const auto original_geometry=geometry3d_identity(result.shape);
  TopTools_IndexedMapOfShape output_faces,repaired_edges;
  TopExp::MapShapes(operation.Shape(),TopAbs_FACE,output_faces);
  std::map<int,double> repaired_budgets;
  for(int fi=1;fi<=output_faces.Extent();++fi) {
    const auto face=TopoDS::Face(output_faces(fi));const BRepAdaptor_Surface surface(face);
    if(surface.GetType()!=GeomAbs_Cylinder)continue;
    const auto cylinder=surface.Cylinder();
    for(TopExp_Explorer it(face,TopAbs_EDGE);it.More();it.Next()) {
      const auto edge=TopoDS::Edge(it.Current());if(BRep_Tool::Degenerated(edge))continue;
      const auto check=curve_surface_residual(edge,face);
      if(!check.done||check.maximum<=1e-7)continue;
      // This bounded transfer is for single pcurves. A seam needs a paired
      // branch reconstruction; leave it unchanged and visible in quality.
      if(BRep_Tool::IsClosed(edge,face))continue;
      double first,last;const auto output_curve=BRep_Tool::Curve(edge,first,last);
      const auto output_identity=curve_identity(output_curve);bool handled=false;
      for(const int ei:source_order) {
        if(handled)break;
        const auto source_edge=TopoDS::Edge(source_edges.FindKey(ei));
        if(BRep_Tool::Degenerated(source_edge))continue;
        double sf,sl;const auto source_curve=BRep_Tool::Curve(source_edge,sf,sl);
        const bool related=edge.IsSame(source_edge)||has(operation.Modified(source_edge),edge)||has(operation.Generated(source_edge),edge);
        if((output_curve!=source_curve&&!related)||first<sf-1e-12||last>sl+1e-12||output_identity!=source_curves[ei])continue;
        for(const auto& source:source_edges.FindFromIndex(ei)) {
          const auto source_face=TopoDS::Face(source);const BRepAdaptor_Surface source_surface(source_face);
          if(source_surface.GetType()!=GeomAbs_Cylinder)continue;
          if(BRep_Tool::IsClosed(source_edge,source_face))continue;
          const auto source_cylinder=source_surface.Cylinder();
          const gp_Vec offset(cylinder.Location(),source_cylinder.Location()),axis(cylinder.Axis().Direction());
          if(std::abs(source_cylinder.Radius()-cylinder.Radius())>1e-12||
             !source_cylinder.Axis().Direction().IsParallel(cylinder.Axis().Direction(),1e-12)||
             (offset-axis*offset.Dot(axis)).Magnitude()>1e-12)continue;
          const double budget=BRep_Tool::Tolerance(source_edge);
          const auto admitted=curve_surface_residual(source_edge,source_face);
          if(!admitted.done||admitted.maximum>budget)continue;
          if(check.maximum<=budget){handled=true;break;}
          const auto source_pc=BRep_Tool::CurveOnSurface(source_edge,source_face,sf,sl);if(source_pc.IsNull())continue;
          const auto old_x=source_cylinder.Position().XDirection(),old_y=source_cylinder.Position().YDirection();
          const auto new_x=cylinder.Position().XDirection(),new_y=cylinder.Position().YDirection();
          const double angle=std::atan2(old_x.Dot(new_y),old_x.Dot(new_x));
          // Cylinder frames may be indirect after a prism. U and V reflection
          // signs must therefore be computed independently.
          const double determinant=old_x.Dot(new_x)*old_y.Dot(new_y)-old_x.Dot(new_y)*old_y.Dot(new_x);
          const double zsign=source_cylinder.Axis().Direction().Dot(cylinder.Axis().Direction())>0?1:-1;
          gp_Trsf2d transform;transform.SetValues(determinant>0?1:-1,0,angle,0,zsign,offset.Dot(axis));
          const auto pc=Handle(Geom2d_Curve)::DownCast(source_pc->Copy());pc->Transform(transform);
          double of,ol;const auto previous_pc=BRep_Tool::CurveOnSurface(edge,face,of,ol);
          if(previous_pc.IsNull())continue;
          const double midpoint=(first+last)/2,period=2*std::acos(-1.);
          pc->Translate(gp_Vec2d(period*std::round((previous_pc->Value(midpoint).X()-pc->Value(midpoint).X())/period),0));
          const auto new_edge=TopoDS::Edge(copy.ModifiedShape(edge));
          const auto new_face=TopoDS::Face(copy.ModifiedShape(face));
          builder.UpdateEdge(new_edge,pc,new_face,0);builder.Range(new_edge,new_face,first,last);
          const auto repaired=curve_surface_residual(new_edge,new_face);
          if(!repaired.done||repaired.maximum>budget)
            throw std::runtime_error("Source pcurve transfer exceeds its inherited geometry budget");
          const int index=repaired_edges.Add(new_edge);
          const auto current=repaired_budgets.find(index);
          repaired_budgets[index]=current==repaired_budgets.end()?budget:std::min(current->second,budget);
          ++result.restored_incidences;handled=true;break;
        }
      }
    }
  }
  for(int i=1;i<=repaired_edges.Extent();++i) {
    const auto edge=TopoDS::Edge(repaired_edges(i));
    builder.SameParameter(edge,false);BRepLib::SameParameter(edge,1e-7);
    if(!BRep_Tool::SameParameter(edge)||!BRep_Tool::SameRange(edge)||BRep_Tool::Tolerance(edge)>repaired_budgets[i]*(1+1e-6))
      throw std::runtime_error("Pcurve reconstruction exceeds the source edge tolerance budget");
  }
  if(original_geometry!=geometry3d_identity(result.shape))
    throw std::runtime_error("Pcurve reconstruction changed a vertex, 3D curve, surface or parameter range");
  if(!BRepCheck_Analyzer(result.shape).IsValid())throw std::runtime_error("Invalid result after pcurve reconstruction");
  // Validate every incident face on each repaired edge after SameParameter.
  for(int fi=1;fi<=output_faces.Extent();++fi) {
    const auto face=TopoDS::Face(copy.ModifiedShape(output_faces(fi)));
    for(TopExp_Explorer it(face,TopAbs_EDGE);it.More();it.Next()) {
      const auto edge=TopoDS::Edge(it.Current());const int index=repaired_edges.FindIndex(edge);if(!index)continue;
      const auto check=curve_surface_residual(edge,face);
      if(!check.done||check.maximum>repaired_budgets[index])
        throw std::runtime_error("Reconstructed edge fails its full incident curve/surface check");
    }
  }
  result.restored_edges=repaired_edges.Extent();result.quality=inspect_curve_surface_quality(result.shape);
  return result;
}
}
